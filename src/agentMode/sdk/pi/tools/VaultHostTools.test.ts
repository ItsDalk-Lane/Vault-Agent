import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { sha256 } from "@/utils/hash";
import { trashFile } from "@/utils/vaultAdapterUtils";
import { AuditLog, type AuditRecord } from "@/agentMode/sdk/pi/policy/AuditLog";
import type { PermissionPrompt, TurnFileChange, VaultAgentMode } from "@/agentMode/session/types";
import { createVaultHostTools as createUnboundVaultHostTools } from "@/agentMode/sdk/pi/tools/VaultHostTools";

import type { MutationJournal } from "@/agentMode/sdk/pi/storage/MutationJournal";

const journals = new Map<string, MutationJournal>();

async function createVaultHostTools(options: Parameters<typeof createUnboundVaultHostTools>[0]) {
  const host = await createUnboundVaultHostTools(options);
  await host.bindMutationJournal({
    load: async () => {
      const saved = journals.get(options.privateDir);
      return saved ? JSON.parse(JSON.stringify(saved)) : null;
    },
    save: async (journal) => {
      journals.set(options.privateDir, JSON.parse(JSON.stringify(journal)));
    },
  });
  return host;
}

type MutableJournal<T> = { -readonly [Key in keyof T]: MutableJournal<T[Key]> };

function readJournal(vault: TestVault): MutableJournal<MutationJournal> {
  const journal = journals.get(vault.privateDir);
  if (!journal) throw new Error("测试账本尚未绑定");
  return JSON.parse(JSON.stringify(journal));
}

interface TestVault {
  readonly app: App;
  readonly root: string;
  readonly privateDir: string;
  readonly prompts: PermissionPrompt[];
  readonly changes: TurnFileChange[][];
  write(name: string, content: string): Promise<void>;
  read(name: string): Promise<string>;
  afterRead?: () => void;
  afterProcess?: () => void;
  afterCreate?: () => void;
  requireParentFolder?: boolean;
  afterRename?: (oldPath: string, newPath: string) => Promise<void>;
}

async function fixture(): Promise<TestVault> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-host-tools-"));
  const root = path.join(dir, "vault");
  const privateDir = path.join(dir, "private");
  await fs.mkdir(root);
  const files = new Map<string, TFile>();
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const prompts: PermissionPrompt[] = [];
  const changes: TurnFileChange[][] = [];
  const vault: TestVault = {
    app: undefined as unknown as App,
    root,
    privateDir,
    prompts,
    changes,
    write: async (name, content) => {
      await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await fs.writeFile(path.join(root, name), content);
      const file = new TFile();
      Object.assign(file, {
        path: name,
        basename: path.basename(name, ".md"),
        stat: { size: content.length },
      });
      files.set(name, file);
    },
    read: (name) => fs.readFile(path.join(root, name), "utf8"),
  };
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  (vault as { app: App }).app = {
    vault: {
      configDir: "custom-config",
      getAbstractFileByPath: (name: string) => files.get(name) ?? null,
      getMarkdownFiles: () => [...files.values()].filter((file) => file.path.endsWith(".md")),
      read: async (file: TFile) => {
        const content = await vault.read(file.path);
        vault.afterRead?.();
        return content;
      },
      create: async (name: string, content: string) => {
        if (files.has(name)) throw new Error("exists");
        if (vault.requireParentFolder) await fs.access(path.dirname(path.join(root, name)));
        await vault.write(name, content);
        emit("create", files.get(name));
        vault.afterCreate?.();
        return files.get(name);
      },
      createFolder: async (name: string) => {
        await fs.mkdir(path.join(root, name));
      },
      process: async (file: TFile, update: (content: string) => string) => {
        await vault.write(file.path, update(await vault.read(file.path)));
        emit("modify", files.get(file.path));
        vault.afterProcess?.();
      },
      on: (event: string, listener: (...args: unknown[]) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
        return { event, listener };
      },
      trash: async (file: TFile) => {
        await fs.unlink(path.join(root, file.path));
        files.delete(file.path);
        emit("delete", file);
      },
      offref: (ref: { event: string; listener: (...args: unknown[]) => void }) =>
        listeners.get(ref.event)?.delete(ref.listener),
    },
    fileManager: {
      renameFile: async (file: TFile, destination: string) => {
        const oldPath = file.path;
        await fs.rename(path.join(root, oldPath), path.join(root, destination));
        files.delete(oldPath);
        Object.assign(file, { path: destination });
        files.set(destination, file);
        emit("rename", file, oldPath);
        await vault.afterRename?.(oldPath, destination);
      },
      trashFile: async (file: TFile) => {
        await fs.unlink(path.join(root, file.path));
        files.delete(file.path);
        emit("delete", file);
      },
    },
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => null },
    workspace: {
      iterateAllLeaves: () => undefined,
      openLinkText: jest.fn().mockResolvedValue(undefined),
      activeEditor: null,
    },
  } as unknown as App;
  return vault;
}

async function invoke(
  registrations: readonly ToolRegistration[],
  name: string,
  args: Record<string, unknown>,
  callId: string,
  signal?: AbortSignal,
  conversationId?: string
): Promise<Record<string, unknown>> {
  const registration = registrations.find((tool) => tool.name === name);
  if (!registration) throw new Error(`missing ${name}`);
  const result = await registration.execute(
    args,
    { callId, conversationId } as unknown as ToolExecutionApi,
    { abortSignal: signal } as Context
  );
  const output = result.output;
  const text =
    typeof output === "string"
      ? output
      : (output ?? []).map((item) => (item.type === "text" ? item.text : "")).join("");
  return JSON.parse(text) as Record<string, unknown>;
}

const temporaryRoots: string[] = [];

async function setup(): Promise<TestVault> {
  const vault = await fixture();
  temporaryRoots.push(path.dirname(vault.root));
  return vault;
}

afterEach(async () => {
  journals.clear();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("VaultHostTools", () => {
  describe("createVaultHostTools()", () => {
    it("keeps the full registered Unicode read envelope inside the SDK byte limit including its real outcome identity https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      const target = Array.from({ length: 8 }, () => "资料".repeat(12)).join("/") + "/长文.md";
      const content = "🙂资料".repeat(14000) + "唯一尾段";
      await vault.write(target, content);
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "长会话".repeat(30),
        getMode: () => "default",
      });
      const registration = host.registrations.find((tool) => tool.name === "vault_read")!;
      const result = await registration.execute(
        { path: target },
        { taskId: 1, conversationId: 2, callId: "read" } as unknown as ToolExecutionApi,
        {} as Context
      );
      const text =
        typeof result.output === "string"
          ? result.output
          : result.output?.find((part) => part.type === "text")?.text;
      expect(text).toBeDefined();
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(
        registration.outputLimits?.maxBytes as number
      );
      const parsed = JSON.parse(text!) as {
        ok: boolean;
        value: { content: string; fileVersion: string; nextCursor: string };
      };
      expect(parsed).toMatchObject({
        ok: true,
        value: { fileVersion: sha256(content), nextCursor: expect.any(String) },
        outcome: { effect: "not_applied", truncation: { truncated: true } },
      });
      expect(result.details).toMatchObject({
        outcome: { effect: "not_applied", truncation: { truncated: true } },
      });
      expect(parsed.value.content.length).toBeGreaterThan(0);
      const next = await invoke(
        host.registrations,
        "vault_read",
        { path: target, cursor: parsed.value.nextCursor },
        "next"
      );
      expect(next).toMatchObject({ ok: true, value: { fileVersion: parsed.value.fileVersion } });
      host.dispose();
    });

    it.each([
      "canonical_only",
      "legacy_only",
      "canonical_with_stale_alias",
      "stale_canonical_with_current_alias",
    ] as const)(
      "uses the registered partial read version consistently for approval and execution with %s https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (versionFields) => {
        const vault = await setup();
        await vault.write("note.md", "# keep heading\noriginal\nkeep trailing text\n");
        const host = await createVaultHostTools({
          app: vault.app,
          vaultRoot: vault.root,
          privateDir: vault.privateDir,
          sessionId: "read-edit-version",
          getMode: () => "default",
          requestPermission: async (prompt) => {
            vault.prompts.push(prompt);
            return { outcome: { outcome: "selected", optionId: "allow_once" } };
          },
        });
        const read = await invoke(
          host.registrations,
          "vault_read",
          { path: "note.md", startLine: 2, lineCount: 1 },
          "read"
        );
        expect(read.ok).toBe(true);
        const value = read.value as { fileVersion: string; sha256: string; content: string };
        expect(value.content).toBe("original");
        expect(value.fileVersion).not.toBe(value.sha256);
        const process = jest.spyOn(vault.app.vault, "process");
        const edited = await invoke(
          host.registrations,
          "vault_edit",
          {
            path: "note.md",
            edits: [{ oldText: value.content, newText: "updated" }],
            ...(versionFields === "legacy_only"
              ? { expectedHash: value.fileVersion }
              : versionFields === "canonical_only"
                ? { fileVersion: value.fileVersion }
                : versionFields === "canonical_with_stale_alias"
                  ? { fileVersion: value.fileVersion, expectedHash: "0".repeat(64) }
                  : { fileVersion: "0".repeat(64), expectedHash: value.fileVersion }),
          },
          "edit"
        );
        if (versionFields === "stale_canonical_with_current_alias") {
          expect(edited).toMatchObject({ ok: false });
          expect(vault.prompts).toHaveLength(0);
          expect(process).not.toHaveBeenCalled();
          expect(await vault.read("note.md")).toBe(
            "# keep heading\noriginal\nkeep trailing text\n"
          );
        } else {
          expect(edited).toMatchObject({
            ok: true,
            receipt: { beforeHash: value.fileVersion },
            outcome: { effect: "applied", receipts: ["read-edit-version:read-edit-version:edit"] },
          });
          expect(vault.prompts).toHaveLength(1);
          expect(process).toHaveBeenCalledTimes(1);
          expect(await vault.read("note.md")).toBe("# keep heading\nupdated\nkeep trailing text\n");
          if (versionFields === "canonical_only")
            expect(vault.prompts[0].toolCall.rawInput).toMatchObject({
              fileVersion: value.fileVersion,
            });
        }
        host.dispose();
      }
    );

    it("keeps a committed effect and its receipt when replaying its display hits a storage error https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      let failProjection = false;
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "catch-effect",
        getMode: () => "auto",
        persistFileChanges: async () => {
          if (failProjection)
            throw Object.assign(new Error("projection unavailable"), { code: "EIO" });
          return false;
        },
      });
      const create = host.registrations.find((tool) => tool.name === "vault_create")!;
      const api = { callId: "same", conversationId: "catch-effect" } as unknown as ToolExecutionApi;
      const writes = jest.spyOn(vault.app.vault, "create");
      try {
        await create.execute({ path: "once.md", content: "real once" }, api, {} as Context);
        failProjection = true;
        const failed = await create.execute(
          { path: "once.md", content: "real once" },
          api,
          {} as Context
        );
        expect(failed.details).toMatchObject({
          outcome: {
            status: "error",
            effect: "applied",
            receipts: ["catch-effect:catch-effect:same"],
            error: { code: "EIO", phase: "persistence" },
          },
        });
        expect(await vault.read("once.md")).toBe("real once");
        expect(writes).toHaveBeenCalledTimes(1);
      } finally {
        host.dispose();
      }
    });
    it("keeps distinct SDK tasks separate when a provider reuses its tool call id https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "reused-call",
        getMode: () => "auto",
      });
      try {
        const create = host.registrations.find((tool) => tool.name === "vault_create")!;
        const context = {} as Context;
        const first = await create.execute(
          { path: "first.md", content: "first" },
          {
            callId: "call_0",
            conversationId: "reused-call",
            taskId: 10,
          } as unknown as ToolExecutionApi,
          context
        );
        expect(first.isError).not.toBe(true);
        const second = await create.execute(
          { path: "second.md", content: "second" },
          {
            callId: "call_0",
            conversationId: "reused-call",
            taskId: 11,
          } as unknown as ToolExecutionApi,
          context
        );
        expect(second.isError).not.toBe(true);
        expect(await vault.read("first.md")).toBe("first");
        expect(await vault.read("second.md")).toBe("second");
        await vault.write("first.md", "changed after execution");
        const replay = await create.execute(
          { path: "first.md", content: "first" },
          {
            callId: "call_0",
            conversationId: "reused-call",
            taskId: 10,
          } as unknown as ToolExecutionApi,
          context
        );
        expect(replay.isError).not.toBe(true);
        expect(replay.details).toMatchObject({
          outcome: {
            operationId: "vault-task:reused-call:reused-call:10",
            status: "success",
            effect: "applied",
            receipts: ["vault-task:reused-call:reused-call:10"],
          },
        });
        expect(await vault.read("first.md")).toBe("changed after execution");
        expect(await vault.read("second.md")).toBe("second");
      } finally {
        host.dispose();
      }
    });

    it("reads the selected editor after a chat leaf, approves its exact contents and commits a reversible Vault mutation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("Notes/selected.md", "颜色：紫色\n");
      let editorText = "颜色：紫色\n";
      const leaves = [
        { view: {} },
        {
          view: {
            file: vault.app.vault.getAbstractFileByPath("Notes/selected.md"),
            editor: {
              getValue: () => editorText,
              getCursor: (which: "from" | "to") => ({
                line: 0,
                ch: which === "from" ? 3 : 5,
              }),
              replaceRange: (text: string) => {
                editorText = `颜色：${text}\n`;
              },
            },
          },
        },
      ] as unknown as WorkspaceLeaf[];
      vault.app.workspace.iterateAllLeaves = (callback) => {
        const visit: (leaf: WorkspaceLeaf) => unknown = callback;
        for (const leaf of leaves) {
          if (visit(leaf)) break;
        }
      };
      const process = vault.app.vault.process.bind(vault.app.vault);
      vault.app.vault.process = async (file, update, options) => {
        const result = await process(file, update, options);
        editorText = await vault.read(file.path);
        return result;
      };
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "session-selection",
        getMode: () => "default",
        onFileChanges: (changes) => vault.changes.push([...changes]),
        requestPermission: async (prompt) => {
          vault.prompts.push(prompt);
          expect(editorText).toBe("颜色：紫色\n");
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        },
      });
      try {
        const result = await invoke(
          host.registrations,
          "obsidian_get_selection",
          {},
          "selection-1"
        );
        expect(result).toMatchObject({
          ok: true,
          text: "紫色",
          snapshot: { filePath: "Notes/selected.md" },
        });
        expect(vault.prompts).toHaveLength(0);
        const replaced = await invoke(
          host.registrations,
          "obsidian_replace_selection",
          { selectionToken: result.selectionToken, text: "青色" },
          "selection-replace-1"
        );
        expect(vault.prompts).toHaveLength(1);
        expect(vault.prompts[0]).toMatchObject({
          binding: { targets: ["Notes/selected.md"] },
          toolCall: {
            rawInput: { affectedPaths: ["Notes/selected.md"] },
            content: [
              {
                type: "diff",
                path: "Notes/selected.md",
                oldText: "颜色：紫色\n",
                newText: "颜色：青色\n",
              },
            ],
          },
        });
        expect(replaced).toMatchObject({ ok: true, filePath: "Notes/selected.md" });
        expect(editorText).toBe("颜色：青色\n");
        expect(vault.changes.at(-1)).toEqual([
          expect.objectContaining({
            path: "Notes/selected.md",
            before: "颜色：紫色\n",
            after: "颜色：青色\n",
            mutationOperationIds: ["session-selection:session-selection:selection-replace-1"],
          }),
        ]);
        expect(await vault.read("Notes/selected.md")).toBe("颜色：青色\n");
        expect(replaced.receipt).toMatchObject({
          operationId: "session-selection:session-selection:selection-replace-1",
          committed: true,
        });
      } finally {
        host.dispose();
      }
    });

    it("connects the public Vault API, concrete approval, persistent journal, diff and reopen-safe revert https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("Notes/a.md", "original");
      const audits: AuditRecord[] = [];
      const options = {
        audit: new AuditLog({
          sink: {
            write: (record) => {
              audits.push(record);
            },
          },
        }),
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "session-1",
        getMode: () => "default" as VaultAgentMode,
        requestPermission: async (prompt: PermissionPrompt) => {
          vault.prompts.push(prompt);
          return { outcome: { outcome: "selected" as const, optionId: "allow_once" } };
        },
        onFileChanges: (changes: readonly TurnFileChange[]) => vault.changes.push([...changes]),
      };
      const host = await createVaultHostTools(options);
      const read = await invoke(host.registrations, "vault_read", { path: "Notes/a.md" }, "read-1");
      expect(read).toMatchObject({
        ok: true,
        value: { content: "original", sha256: sha256("original") },
        outcome: { effect: "not_applied" },
      });
      const edited = await invoke(
        host.registrations,
        "vault_edit",
        {
          path: "Notes/a.md",
          expectedHash: sha256("original"),
          edits: [{ oldText: "original", newText: "updated" }],
        },
        "write-1"
      );
      expect(edited.ok).toBe(true);
      expect(await vault.read("Notes/a.md")).toBe("updated");
      expect(vault.prompts).toHaveLength(1);
      expect(JSON.stringify(vault.prompts[0])).toContain("original");
      expect(JSON.stringify(vault.prompts[0])).toContain("updated");
      expect(vault.changes.at(-1)).toEqual([
        expect.objectContaining({ path: "Notes/a.md", before: "original", after: "updated" }),
      ]);
      const receipt = edited.receipt as { operationId: string };
      host.dispose();
      const reopened = await createVaultHostTools(options);
      const reverted = await reopened.revert(receipt.operationId);
      expect(reverted.ok).toBe(true);
      expect(await vault.read("Notes/a.md")).toBe("original");
      expect(vault.prompts).toHaveLength(2);
      expect(vault.prompts[1].binding?.targets).toEqual(["Notes/a.md"]);
      expect(vault.prompts[1].toolCall.rawInput).toMatchObject({ affectedPaths: ["Notes/a.md"] });
      expect(
        audits.filter((record) => record.status === "executed").map((record) => record.toolId)
      ).toEqual(["vault_read", "vault_edit", "vault_revert"]);
      expect(JSON.stringify(audits)).not.toContain("original");
      expect(JSON.stringify(audits)).not.toContain("updated");
      reopened.dispose();
    });

    it("keeps the actual write receipt and never reapplies it when the final audit sink fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("Notes/a.md", "original");
      let processCalls = 0;
      const process = vault.app.vault.process.bind(vault.app.vault);
      vault.app.vault.process = async (file, apply, options) => {
        processCalls += 1;
        return process(file, apply, options);
      };
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "audit-failure",
        getMode: () => "default",
        requestPermission: async () => ({
          outcome: { outcome: "selected", optionId: "allow_once" },
        }),
        audit: new AuditLog({
          sink: {
            write: (record) => {
              if (record.status === "executed") throw new Error("private audit sink failure");
            },
          },
        }),
      });
      try {
        const args = {
          path: "Notes/a.md",
          expectedHash: sha256("original"),
          edits: [{ oldText: "original", newText: "updated" }],
        };
        const result = await invoke(host.registrations, "vault_edit", args, "same-write");
        expect(result).toMatchObject({
          ok: false,
          code: "AUDIT_FAILED",
          message: expect.stringContaining("可能已经发生"),
        });
        expect(await vault.read("Notes/a.md")).toBe("updated");
        expect(await invoke(host.registrations, "vault_edit", args, "same-write")).toMatchObject({
          ok: true,
          alreadyApplied: true,
        });
        expect(processCalls).toBe(1);
      } finally {
        host.dispose();
      }
    });

    it("uses Vault create/frontmatter/search and public rename/recycle APIs with persistent undo https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "operations",
        getMode: () => "default",
        requestPermission: async () => ({
          outcome: { outcome: "selected", optionId: "allow_once" },
        }),
      });
      const created = await invoke(
        host.registrations,
        "vault_create",
        { path: "a.md", content: "body" },
        "create"
      );
      expect(created.ok).toBe(true);
      const metadata = await invoke(
        host.registrations,
        "vault_frontmatter",
        { path: "a.md", expectedHash: sha256("body"), set: { status: "draft" } },
        "metadata"
      );
      expect(metadata.ok).toBe(true);
      expect(await vault.read("a.md")).toContain("status: draft");
      expect(
        await invoke(host.registrations, "vault_search", { query: "draft" }, "search")
      ).toMatchObject({ ok: true, value: { hits: [expect.objectContaining({ path: "a.md" })] } });
      const renamed = await invoke(
        host.registrations,
        "vault_rename",
        { path: "a.md", newPath: "b.md" },
        "rename"
      );
      expect(renamed.ok).toBe(true);
      expect(
        await host.revert((renamed.receipt as { operationId: string }).operationId)
      ).toMatchObject({ ok: true });
      expect(await vault.read("a.md")).toContain("status: draft");
      const trashed = await invoke(host.registrations, "vault_trash", { path: "a.md" }, "trash");
      expect(trashed.ok).toBe(true);
      expect(
        await host.revert((trashed.receipt as { operationId: string }).operationId)
      ).toMatchObject({ ok: true });
      expect(await vault.read("a.md")).toContain("status: draft");
      expect(
        await host.revert((created.receipt as { operationId: string }).operationId)
      ).toMatchObject({ ok: false, code: "CONFLICT" });
      host.dispose();
    });

    it.each([
      "linked_content",
      "inbound_added",
      "inbound_removed",
      "source_content",
      "destination_created",
    ] as const)(
      "refuses an old rename approval after %s changes without moving or rewriting any note https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (change) => {
        const vault = await setup();
        await vault.write("source.md", "source body");
        await vault.write("link.md", "[[source]] original link");
        vault.app.metadataCache.resolvedLinks = { "link.md": { "source.md": 1 } };
        const rename = jest.spyOn(vault.app.fileManager, "renameFile");
        const host = await createVaultHostTools({
          app: vault.app,
          vaultRoot: vault.root,
          privateDir: vault.privateDir,
          sessionId: "rename-review",
          getMode: () => "default",
          requestPermission: async (prompt) => {
            vault.prompts.push(prompt);
            const reviewed = [
              { path: "source.md", oldText: "source body" },
              { path: "moved.md", oldText: "" },
              { path: "link.md", oldText: "[[source]] original link" },
            ];
            expect(prompt.binding).toMatchObject({
              targets: ["source.md", "moved.md", "link.md"],
              beforeHash: sha256(JSON.stringify(reviewed)),
            });
            expect(
              prompt.toolCall.content
                ?.filter((part) => part.type === "diff")
                .map((part) => ({ path: part.path, oldText: part.oldText }))
            ).toEqual(reviewed);
            if (change === "linked_content")
              await vault.write("link.md", "[[source]] user changed");
            if (change === "inbound_added") {
              await vault.write("new-link.md", "[[source]] new inbound");
              vault.app.metadataCache.resolvedLinks["new-link.md"] = { "source.md": 1 };
            }
            if (change === "inbound_removed") vault.app.metadataCache.resolvedLinks = {};
            if (change === "source_content") await vault.write("source.md", "user changed source");
            if (change === "destination_created") await vault.write("moved.md", "user destination");
            return { outcome: { outcome: "selected", optionId: "allow_once" } };
          },
        });
        const result = await invoke(
          host.registrations,
          "vault_rename",
          { path: "source.md", newPath: "moved.md", fileVersion: sha256("source body") },
          "rename"
        );
        expect(result).toMatchObject({
          ok: false,
          code: expect.stringMatching(/TARGET_CHANGED|STALE_BASELINE/),
          outcome: { effect: "not_applied" },
        });
        expect(rename).not.toHaveBeenCalled();
        expect(await vault.read("source.md")).toBe(
          change === "source_content" ? "user changed source" : "source body"
        );
        expect(await vault.read("link.md")).toBe(
          change === "linked_content" ? "[[source]] user changed" : "[[source]] original link"
        );
        if (change === "destination_created")
          expect(await vault.read("moved.md")).toBe("user destination");
        else await expect(vault.read("moved.md")).rejects.toMatchObject({ code: "ENOENT" });
        if (change === "inbound_added")
          expect(await vault.read("new-link.md")).toBe("[[source]] new inbound");
        host.dispose();
      }
    );

    it.each(["linked_content", "inbound_added"] as const)(
      "rechecks the approved rename snapshot at the final host entry after %s changes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (change) => {
        const vault = await setup();
        await vault.write("source.md", "source body");
        await vault.write("link.md", "[[source]] original link");
        vault.app.metadataCache.resolvedLinks = { "link.md": { "source.md": 1 } };
        const rename = jest.spyOn(vault.app.fileManager, "renameFile");
        const host = await createVaultHostTools({
          app: vault.app,
          vaultRoot: vault.root,
          privateDir: vault.privateDir,
          sessionId: "rename-final",
          getMode: () => "default",
          requestPermission: async () => ({
            outcome: { outcome: "selected", optionId: "allow_once" },
          }),
          beforeMutation: async () => {
            if (change === "linked_content")
              await vault.write("link.md", "[[source]] user changed");
            else {
              await vault.write("new-link.md", "[[source]] new inbound");
              vault.app.metadataCache.resolvedLinks["new-link.md"] = { "source.md": 1 };
            }
          },
        });
        const result = await invoke(
          host.registrations,
          "vault_rename",
          { path: "source.md", newPath: "moved.md" },
          "rename"
        );
        expect(result).toMatchObject({
          ok: false,
          code: expect.stringMatching(/TARGET_CHANGED|STALE_BASELINE/),
          outcome: { effect: "not_applied" },
        });
        expect(rename).not.toHaveBeenCalled();
        expect(await vault.read("source.md")).toBe("source body");
        expect(await vault.read("link.md")).toBe(
          change === "linked_content" ? "[[source]] user changed" : "[[source]] original link"
        );
        await expect(vault.read("moved.md")).rejects.toMatchObject({ code: "ENOENT" });
        host.dispose();
      }
    );

    it("backs up linked changes and refuses rename undo when a linked note has a later user edit https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("a.md", "body");
      await vault.write("link.md", "[[a]]");
      vault.app.metadataCache.resolvedLinks = { "link.md": { "a.md": 1 } };
      vault.afterRename = async () => vault.write("link.md", "[[b]]");
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "linked",
        getMode: () => "default",
        requestPermission: async () => ({
          outcome: { outcome: "selected", optionId: "allow_once" },
        }),
        onFileChanges: (changes) => vault.changes.push([...changes]),
      });
      const result = await invoke(
        host.registrations,
        "vault_rename",
        { path: "a.md", newPath: "b.md" },
        "rename"
      );
      expect(result.ok).toBe(true);
      expect(vault.changes.flat()).toContainEqual(
        expect.objectContaining({ path: "link.md", before: "[[a]]", after: "[[b]]" })
      );
      await vault.write("link.md", "user changed this");
      expect(
        await host.revert((result.receipt as { operationId: string }).operationId)
      ).toMatchObject({ ok: false, code: "CONFLICT" });
      expect(await vault.read("b.md")).toBe("body");
      expect(await vault.read("link.md")).toBe("user changed this");
      host.dispose();
    });

    it("keeps unrelated concurrent work unattributed while a normal rename commits its own folders and linked changes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("source.md", "source body");
      await vault.write("link.md", "[[source]]");
      vault.app.metadataCache.resolvedLinks = { "link.md": { "source.md": 1 } };
      const unknown = jest.fn(async () => undefined);
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "rename-concurrent",
        getMode: () => "default",
        onUnknownEffect: unknown,
        requestPermission: async () => ({
          outcome: { outcome: "selected", optionId: "allow_once" },
        }),
      });
      vault.afterRename = async () => {
        const other = await invoke(
          host.registrations,
          "vault_create",
          { path: "other.md", content: "separate work" },
          "other-create"
        );
        expect(other.ok).toBe(true);
        const linked = vault.app.vault.getAbstractFileByPath("link.md");
        if (!(linked instanceof TFile)) throw new Error("The linked note must exist.");
        await vault.app.vault.process(linked, () => "[[Archive/moved]]");
      };
      const result = await invoke(
        host.registrations,
        "vault_rename",
        { path: "source.md", newPath: "Archive/moved.md", expectedHash: sha256("source body") },
        "rename"
      );
      expect(result).toMatchObject({
        ok: true,
        outcome: { effect: "applied" },
        unattributedChanges: expect.arrayContaining([
          expect.objectContaining({ path: "other.md", attributed: false }),
        ]),
      });
      expect(await vault.read("Archive/moved.md")).toBe("source body");
      expect(await vault.read("link.md")).toBe("[[Archive/moved]]");
      expect(await vault.read("other.md")).toBe("separate work");
      expect(unknown).not.toHaveBeenCalled();
      expect(result.receipt).toMatchObject({
        operationId: "rename-concurrent:rename-concurrent:rename",
        inboundCandidates: ["link.md"],
      });
      host.dispose();
    });

    it("creates missing parent folders before calling the real create contract https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      vault.requireParentFolder = true;
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "new-folders",
        getMode: () => "auto",
      });
      const folders = jest.spyOn(vault.app.vault, "createFolder");
      const create = jest.spyOn(vault.app.vault, "create");
      const result = await invoke(
        host.registrations,
        "vault_create",
        { path: "Research/References/source.md", content: "source" },
        "create"
      );
      expect(result).toMatchObject({ ok: true });
      expect(await vault.read("Research/References/source.md")).toBe("source");
      expect(folders.mock.calls.map(([folder]) => folder)).toEqual([
        "Research",
        "Research/References",
      ]);
      expect(create).toHaveBeenCalledTimes(1);
      host.dispose();
    });

    it("approves both move endpoints and records new parent folders before the real rename contract https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("source.md", "source");
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "move-folders",
        getMode: () => "default",
        requestPermission: async (prompt) => {
          vault.prompts.push(prompt);
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        },
      });
      const folders = jest.spyOn(vault.app.vault, "createFolder");
      const rename = jest.spyOn(vault.app.fileManager, "renameFile");
      const result = await invoke(
        host.registrations,
        "vault_rename",
        { path: "source.md", newPath: "Archive/Previous/moved.md", fileVersion: sha256("source") },
        "rename"
      );
      expect(result).toMatchObject({ ok: true, outcome: { status: "success", effect: "applied" } });
      expect(await vault.read("Archive/Previous/moved.md")).toBe("source");
      await expect(vault.read("source.md")).rejects.toMatchObject({ code: "ENOENT" });
      expect(folders.mock.calls.map(([folder]) => folder)).toEqual(["Archive", "Archive/Previous"]);
      expect(rename).toHaveBeenCalledTimes(1);
      expect(vault.prompts[0].binding?.targets).toEqual(["source.md", "Archive/Previous/moved.md"]);
      const journal = readJournal(vault);
      expect(journal.mutations["move-folders:move-folders:rename"]).toMatchObject({
        kind: "rename",
        path: "source.md",
        newPath: "Archive/Previous/moved.md",
        committed: true,
        effect: "applied",
        createdFolders: ["Archive", "Archive/Previous"],
      });
      host.dispose();
    });

    it("rejects an out-of-scope move destination before creating any parent folders https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("source.md", "source");
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "move-denied",
        getMode: () => "auto",
        requestPermission: async () => ({
          outcome: { outcome: "selected", optionId: "allow_once" },
        }),
        isPathInScope: (target, _conversationId, access) =>
          access !== "write" || target === "source.md",
      });
      const folders = jest.spyOn(vault.app.vault, "createFolder");
      const rename = jest.spyOn(vault.app.fileManager, "renameFile");
      const result = await host.registrations
        .find((tool) => tool.name === "vault_rename")!
        .execute(
          { path: "source.md", newPath: "Denied/moved.md" },
          { callId: "rename" } as ToolExecutionApi,
          {} as Context
        );
      expect(JSON.stringify(result.output)).toContain("PATH_OUT_OF_SCOPE");
      expect(result).toMatchObject({
        isError: true,
        details: { outcome: { effect: "not_applied" } },
      });
      expect(folders).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled();
      expect(await vault.read("source.md")).toBe("source");
      host.dispose();
    });

    it.each([
      "source_changed",
      "linked_changed",
      "inbound_added",
      "destination_created",
      "scope_revoked",
      "mode_changed",
      "stopped",
    ] as const)(
      "rechecks %s after folder preparation and preserves the known folder effect without renaming https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (change) => {
        const vault = await setup();
        await vault.write("source.md", "source");
        await vault.write("link.md", "[[source]]");
        vault.app.metadataCache.resolvedLinks = { "link.md": { "source.md": 1 } };
        let mode: VaultAgentMode = "auto";
        let destinationAllowed = true;
        const controller = new AbortController();
        const options = {
          app: vault.app,
          vaultRoot: vault.root,
          privateDir: vault.privateDir,
          sessionId: "move-recheck",
          getMode: () => mode,
          requestPermission: async (): Promise<
            import("@/agentMode/session/types").PermissionDecision
          > => ({ outcome: { outcome: "selected", optionId: "allow_once" } }),
          isPathInScope: (target: string, _conversationId?: string, access?: "read" | "write") =>
            access !== "write" || target !== "Archive/moved.md" || destinationAllowed,
        };
        const host = await createVaultHostTools(options);
        const createFolder = vault.app.vault.createFolder.bind(vault.app.vault);
        jest.spyOn(vault.app.vault, "createFolder").mockImplementation(async (folder) => {
          const result = await createFolder(folder);
          if (change === "source_changed") await vault.write("source.md", "later user edit");
          if (change === "linked_changed")
            await vault.write("link.md", "[[source]] later user edit");
          if (change === "inbound_added") {
            await vault.write("new-link.md", "[[source]]");
            vault.app.metadataCache.resolvedLinks["new-link.md"] = { "source.md": 1 };
          }
          if (change === "destination_created")
            await vault.write("Archive/moved.md", "another note");
          if (change === "scope_revoked") destinationAllowed = false;
          if (change === "mode_changed") mode = "plan";
          if (change === "stopped") controller.abort();
          return result;
        });
        const rename = jest.spyOn(vault.app.fileManager, "renameFile");
        const result = await invoke(
          host.registrations,
          "vault_rename",
          { path: "source.md", newPath: "Archive/moved.md", fileVersion: sha256("source") },
          "rename",
          controller.signal
        );
        expect(result).toMatchObject({
          ok: false,
          wrote: true,
          outcome: { effect: "partially_applied" },
        });
        expect(rename).not.toHaveBeenCalled();
        expect(await vault.read("source.md")).toBe(
          change === "source_changed" ? "later user edit" : "source"
        );
        if (change === "destination_created")
          expect(await vault.read("Archive/moved.md")).toBe("another note");
        else await expect(vault.read("Archive/moved.md")).rejects.toMatchObject({ code: "ENOENT" });
        const journal = readJournal(vault);
        expect(journal.mutations["move-recheck:move-recheck:rename"]).toMatchObject({
          committed: false,
          effect: "partially_applied",
          createdFolders: ["Archive"],
        });
        host.dispose();
        const reopened = await createVaultHostTools(options);
        expect(reopened.recovery.decisions).toEqual([]);
        reopened.dispose();
      }
    );

    it.each([false, true])(
      "confirms an unchanged source was not moved while preserving existing folder effects (%s) without replay on reconcile or reopen https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (needsFolder) => {
        const vault = await setup();
        await vault.write("source.md", "source bytes");
        const destination = needsFolder ? "Archive/moved.md" : "moved.md";
        const requestPermission = jest.fn(
          async (): Promise<import("@/agentMode/session/types").PermissionDecision> => ({
            outcome: { outcome: "selected", optionId: "allow_once" },
          })
        );
        const options = {
          app: vault.app,
          vaultRoot: vault.root,
          privateDir: vault.privateDir,
          sessionId: "unmoved",
          getMode: () => "default" as VaultAgentMode,
          requestPermission,
        };
        const host = await createVaultHostTools(options);
        const rename = jest
          .spyOn(vault.app.fileManager, "renameFile")
          .mockRejectedValue(new Error("host lost acknowledgement before moving"));
        expect(
          await invoke(
            host.registrations,
            "vault_rename",
            { path: "source.md", newPath: destination, fileVersion: sha256("source bytes") },
            "rename"
          )
        ).toMatchObject({ ok: false, code: "EFFECT_UNKNOWN" });
        expect(host.recovery.decisions).toEqual([expect.objectContaining({ canContinue: false })]);
        rename.mockClear();
        requestPermission.mockClear();

        expect((await host.reconcile()).decisions).toEqual([
          expect.objectContaining({
            operationId: "unmoved:unmoved:rename",
            canContinue: true,
            canReapprove: true,
            receiptWritten: false,
          }),
        ]);
        const journal = readJournal(vault);
        expect(journal.mutations["unmoved:unmoved:rename"]).toMatchObject({
          committed: false,
          state: "failed",
          effect: needsFolder ? "partially_applied" : "not_applied",
          errorCode: "MOVE_NOT_APPLIED",
          ...(needsFolder ? { createdFolders: ["Archive"] } : {}),
        });
        expect(await vault.read("source.md")).toBe("source bytes");
        await expect(vault.read(destination)).rejects.toMatchObject({ code: "ENOENT" });
        if (needsFolder)
          expect((await fs.stat(path.join(vault.root, "Archive"))).isDirectory()).toBe(true);
        expect(await host.reconcile()).toEqual({ decisions: [] });
        host.dispose();
        const reopened = await createVaultHostTools(options);
        expect(reopened.recovery.decisions).toEqual([]);
        expect(rename).not.toHaveBeenCalled();
        expect(requestPermission).not.toHaveBeenCalled();
        reopened.dispose();
      }
    );

    it.each([
      "linked_files",
      "source_changed",
      "both_present",
      "both_absent",
      "missing_before_hash",
      "missing_after_hash",
    ] as const)(
      "keeps a rename unknown when %s prevents confirming unchanged endpoints https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (condition) => {
        const vault = await setup();
        await vault.write("source.md", "source bytes");
        if (condition === "linked_files") {
          await vault.write("link.md", "[[source]]");
          Object.assign(vault.app.metadataCache.resolvedLinks, { "link.md": { "source.md": 1 } });
        }
        const requestPermission = jest.fn(
          async (): Promise<import("@/agentMode/session/types").PermissionDecision> => ({
            outcome: { outcome: "selected", optionId: "allow_once" },
          })
        );
        const options = {
          app: vault.app,
          vaultRoot: vault.root,
          privateDir: vault.privateDir,
          sessionId: "uncertain-move",
          getMode: () => "default" as VaultAgentMode,
          requestPermission,
        };
        const host = await createVaultHostTools(options);
        const rename = jest
          .spyOn(vault.app.fileManager, "renameFile")
          .mockRejectedValue(new Error("host lost acknowledgement"));
        expect(
          await invoke(
            host.registrations,
            "vault_rename",
            { path: "source.md", newPath: "moved.md" },
            "rename"
          )
        ).toMatchObject({ ok: false, code: "EFFECT_UNKNOWN" });
        host.dispose();
        if (condition === "source_changed") await vault.write("source.md", "user change");
        if (condition === "both_present") await vault.write("moved.md", "source bytes");
        if (condition === "both_absent") {
          const source = vault.app.vault.getAbstractFileByPath("source.md");
          if (!(source instanceof TFile)) throw new Error("missing source fixture");
          await trashFile(vault.app, source);
        }
        const journal = readJournal(vault);
        if (condition === "missing_before_hash")
          Reflect.deleteProperty(
            journal.mutations["uncertain-move:uncertain-move:rename"],
            "beforeHash"
          );
        if (condition === "missing_after_hash")
          Reflect.deleteProperty(
            journal.mutations["uncertain-move:uncertain-move:rename"],
            "afterHash"
          );
        journals.set(vault.privateDir, journal);
        rename.mockClear();
        requestPermission.mockClear();
        const reopened = await createVaultHostTools(options);
        expect(reopened.recovery.decisions).toEqual([
          expect.objectContaining({ canContinue: false, canReapprove: false }),
        ]);
        expect(rename).not.toHaveBeenCalled();
        expect(requestPermission).not.toHaveBeenCalled();
        reopened.dispose();
      }
    );

    it("ignores an old journal file and restores only current durable mutations https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      const options = {
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "durable-journal",
        getMode: () => "auto" as VaultAgentMode,
      };
      const journalPath = path.join(vault.privateDir, "mutations", "journal.json");
      await fs.mkdir(path.dirname(journalPath), { recursive: true });
      const original = "unread old journal";
      await fs.writeFile(journalPath, original);
      let value: import("@/agentMode/sdk/pi/storage/MutationJournal").MutationJournal | null = null;
      const store = {
        load: jest.fn(async () => value),
        save: jest.fn(
          async (journal: import("@/agentMode/sdk/pi/storage/MutationJournal").MutationJournal) => {
            value = JSON.parse(JSON.stringify(journal));
          }
        ),
      };
      const host = await createUnboundVaultHostTools(options);
      expect(
        await invoke(
          host.registrations,
          "vault_create",
          { path: "blocked.md", content: "blocked" },
          "unbound"
        )
      ).toMatchObject({ ok: false });
      await host.bindMutationJournal(store);
      expect(store.save).toHaveBeenCalledTimes(1);
      expect(value).toEqual({ version: 1, mutations: {}, reverts: {} });
      expect(
        await invoke(
          host.registrations,
          "vault_create",
          { path: "after.md", content: "after" },
          "new"
        )
      ).toMatchObject({ ok: true });
      expect(await fs.readFile(journalPath, "utf8")).toBe(original);
      host.dispose();
      const reopened = await createUnboundVaultHostTools(options);
      await reopened.bindMutationJournal(store);
      expect(value).toMatchObject({
        mutations: { "durable-journal:durable-journal:new": { committed: true } },
      });
      expect(reopened.recovery.decisions).toEqual([]);
      expect(
        await invoke(
          reopened.registrations,
          "vault_create",
          { path: "after.md", content: "after" },
          "new"
        )
      ).toMatchObject({ ok: true, alreadyApplied: true });
      expect(await fs.readFile(journalPath, "utf8")).toBe(original);
      reopened.dispose();
    });

    it.each(["mode", "scope"])(
      "refuses an approved edit when %s is withdrawn before the host process callback https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (change) => {
        const vault = await setup();
        await vault.write("a.md", "before");
        let mode: VaultAgentMode = "auto";
        let allowed = true;
        const host = await createVaultHostTools({
          app: vault.app,
          vaultRoot: vault.root,
          privateDir: vault.privateDir,
          sessionId: "final-access",
          getMode: () => mode,
          isPathInScope: (_path, _conversation, access) => access !== "write" || allowed,
        });
        const process = vault.app.vault.process.bind(vault.app.vault);
        jest.spyOn(vault.app.vault, "process").mockImplementation(async (file, update) => {
          if (change === "mode") mode = "plan";
          else allowed = false;
          return process(file, update);
        });
        const result = await invoke(
          host.registrations,
          "vault_edit",
          {
            path: "a.md",
            fileVersion: sha256("before"),
            edits: [{ oldText: "before", newText: "after" }],
          },
          "edit"
        );
        expect(result).toMatchObject({ ok: false, outcome: { effect: "not_applied" } });
        expect(await vault.read("a.md")).toBe("before");
        host.dispose();
      }
    );

    it("keeps a rejected stale write terminal across reopen without blocking the chat https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("a.md", "before");
      const options = {
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "known-failure",
        getMode: () => "auto" as VaultAgentMode,
      };
      const host = await createVaultHostTools(options);
      jest
        .spyOn(vault.app.vault, "process")
        .mockRejectedValueOnce(
          Object.assign(new Error("The note changed before writing."), { code: "STALE_BASELINE" })
        );
      await invoke(
        host.registrations,
        "vault_edit",
        {
          path: "a.md",
          expectedHash: sha256("before"),
          edits: [{ oldText: "before", newText: "after" }],
        },
        "stale"
      );
      const journal = readJournal(vault);
      expect(journal.mutations["known-failure:known-failure:stale"]).toMatchObject({
        state: "stale",
        effect: "not_applied",
        errorCode: "STALE_BASELINE",
      });
      host.dispose();
      const reopened = await createVaultHostTools(options);
      expect(reopened.recovery.decisions).toEqual([]);
      expect(await vault.read("a.md")).toBe("before");
      reopened.dispose();
    });

    it("reconciles a crash after the write without applying the patch twice https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("a.md", "before");
      const options = {
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "recover",
        getMode: () => "auto" as VaultAgentMode,
      };
      const host = await createVaultHostTools(options);
      const args = {
        path: "a.md",
        expectedHash: sha256("before"),
        edits: [{ oldText: "before", newText: "after" }],
      };
      expect(await invoke(host.registrations, "vault_edit", args, "write")).toMatchObject({
        ok: true,
      });
      host.dispose();
      const journal = readJournal(vault);
      journal.mutations["recover:recover:write"].committed = false;
      journals.set(vault.privateDir, journal);
      const reopened = await createVaultHostTools(options);
      expect(reopened.recovery.decisions).toContainEqual(
        expect.objectContaining({ state: "committed", receiptWritten: true })
      );
      expect(await invoke(reopened.registrations, "vault_edit", args, "write")).toMatchObject({
        ok: true,
        alreadyApplied: true,
      });
      expect(await vault.read("a.md")).toBe("after");
      reopened.dispose();
    });

    it("reports an unknown effect when the real write lands but verification cannot read it https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("a.md", "before");
      let applied = false;
      vault.afterProcess = () => {
        applied = true;
      };
      vault.afterRead = () => {
        if (applied) throw new Error("verification read unavailable");
      };
      const process = jest.spyOn(vault.app.vault, "process");
      const options = {
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "verification",
        getMode: () => "auto" as VaultAgentMode,
      };
      const host = await createVaultHostTools(options);
      const args = {
        path: "a.md",
        expectedHash: sha256("before"),
        edits: [{ oldText: "before", newText: "after" }],
      };
      const result = await invoke(host.registrations, "vault_edit", args, "write");
      expect(result).toMatchObject({ ok: false, code: "EFFECT_UNKNOWN" });
      expect(await vault.read("a.md")).toBe("after");
      expect(process).toHaveBeenCalledTimes(1);
      const journal = readJournal(vault);
      expect(journal.mutations["verification:verification:write"].committed).toBe(false);
      host.dispose();
      vault.afterRead = undefined;
      const reopened = await createVaultHostTools(options);
      expect(reopened.recovery.decisions[0]).toMatchObject({
        state: "committed",
        receiptWritten: true,
      });
      expect(await invoke(reopened.registrations, "vault_edit", args, "write")).toMatchObject({
        ok: true,
        alreadyApplied: true,
      });
      expect(process).toHaveBeenCalledTimes(1);
      reopened.dispose();
    });

    it("does not claim a failed create had no effect when the host creates the file and then rejects https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      vault.afterCreate = () => {
        throw new Error("host lost acknowledgement");
      };
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "created",
        getMode: () => "auto",
      });
      expect(
        await invoke(
          host.registrations,
          "vault_create",
          { path: "a.md", content: "actual content" },
          "create"
        )
      ).toMatchObject({ ok: false, code: "EFFECT_UNKNOWN" });
      expect(await vault.read("a.md")).toBe("actual content");
      host.dispose();
    });

    it("immediately exposes a live unknown effect to the host gate and explicitly reconciles it without a second file operation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      vault.afterCreate = () => {
        throw new Error("lost host acknowledgement");
      };
      const paused = jest.fn(async () => undefined);
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "live-reconcile",
        getMode: () => "auto",
        onUnknownEffect: paused,
      });
      const create = jest.spyOn(vault.app.vault, "create");
      try {
        expect(
          await invoke(
            host.registrations,
            "vault_create",
            { path: "a.md", content: "already landed" },
            "create"
          )
        ).toMatchObject({ ok: false, code: "EFFECT_UNKNOWN" });
        expect(paused).toHaveBeenCalledTimes(1);
        expect(host.recovery.decisions).toEqual([
          expect.objectContaining({ state: "needs_reconciliation", canContinue: false }),
        ]);
        vault.afterCreate = undefined;
        expect((await host.reconcile()).decisions).toEqual([
          expect.objectContaining({ state: "committed", canContinue: true, receiptWritten: true }),
        ]);
        expect(await host.reconcile()).toEqual({ decisions: [] });
        expect(await vault.read("a.md")).toBe("already landed");
        expect(create).toHaveBeenCalledTimes(1);
      } finally {
        host.dispose();
      }
    });

    it("restores the committed diff after display delivery fails without writing the file again https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("a.md", "before");
      const process = jest.spyOn(vault.app.vault, "process");
      const delivered: TurnFileChange[][] = [];
      const options = {
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "receipt-ui",
        getMode: () => "auto" as VaultAgentMode,
        onFileChanges: () => {
          throw new Error("view was closed");
        },
      };
      const host = await createVaultHostTools(options);
      const args = {
        path: "a.md",
        expectedHash: sha256("before"),
        edits: [{ oldText: "before", newText: "after" }],
      };
      expect(await invoke(host.registrations, "vault_edit", args, "write")).toMatchObject({
        ok: true,
      });
      host.dispose();
      const reopened = await createVaultHostTools({
        ...options,
        onFileChanges: (changes) => {
          delivered.push([...changes]);
        },
      });
      await reopened.replayFileChanges();
      await reopened.replayFileChanges();
      expect(await invoke(reopened.registrations, "vault_edit", args, "write")).toMatchObject({
        ok: true,
        alreadyApplied: true,
      });
      expect(delivered).toEqual([
        [expect.objectContaining({ path: "a.md", before: "before", after: "after" })],
      ]);
      expect(process).toHaveBeenCalledTimes(1);
      expect(await vault.read("a.md")).toBe("after");
      reopened.dispose();
    });

    it("reverts merged changes in actual commit order and still requests approval in Auto mode https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("a.md", "before");
      const prompts: PermissionPrompt[] = [];
      const options = {
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "batch-revert",
        getMode: () => "auto" as VaultAgentMode,
        requestPermission: async (prompt: PermissionPrompt) => {
          prompts.push(prompt);
          return { outcome: { outcome: "selected" as const, optionId: "allow_once" } };
        },
      };
      const host = await createVaultHostTools(options);
      const ids: string[] = [];
      for (const [index, before, after] of [
        [1, "before", "middle"],
        [2, "middle", "after"],
      ] as const) {
        const result = await invoke(
          host.registrations,
          "vault_edit",
          {
            path: "a.md",
            expectedHash: sha256(before),
            edits: [{ oldText: before, newText: after }],
          },
          String(index)
        );
        expect(result.ok).toBe(true);
        ids.push((result.receipt as { operationId: string }).operationId);
      }
      expect(prompts).toEqual([]);
      host.dispose();
      const journal = readJournal(vault);
      journal.mutations[ids[0]].commitOrder = 1;
      journal.mutations[ids[1]].commitOrder = 2;
      journal.mutations = Object.fromEntries(Object.entries(journal.mutations).reverse());
      journals.set(vault.privateDir, journal);
      const reopened = await createVaultHostTools(options);
      const result = await reopened.revertOperations(ids);
      expect(result).toMatchObject({ ok: true, revertedOperationIds: [...ids].reverse() });
      expect(await vault.read("a.md")).toBe("before");
      expect(prompts.map((prompt) => prompt.toolCall.rawInput)).toEqual([
        expect.objectContaining({ operationId: ids[1] }),
        expect.objectContaining({ operationId: ids[0] }),
      ]);
      expect(await reopened.revertOperations(["foreign-operation"])).toMatchObject({
        ok: false,
        code: "INVALID_ARGUMENT",
      });
      reopened.dispose();
    });

    it("keeps a later uncertain rollback distinct from a known partial batch and lists completed operations https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("a.md", "before");
      let reverting = false;
      let reverted = 0;
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "unknown-batch",
        getMode: () => "auto",
        requestPermission: async () => {
          reverting = true;
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        },
      });
      try {
        const ids: string[] = [];
        for (const [index, before, after] of [
          [1, "before", "middle"],
          [2, "middle", "after"],
        ] as const) {
          const result = await invoke(
            host.registrations,
            "vault_edit",
            {
              path: "a.md",
              expectedHash: sha256(before),
              edits: [{ oldText: before, newText: after }],
            },
            String(index)
          );
          expect(result.ok).toBe(true);
          ids.push((result.receipt as { operationId: string }).operationId);
        }
        vault.afterProcess = () => {
          if (reverting) reverted += 1;
        };
        vault.afterRead = () => {
          if (reverted === 2) throw new Error("second rollback verification unavailable");
        };
        expect(await host.revertOperations(ids)).toMatchObject({
          ok: false,
          code: "EFFECT_UNKNOWN",
          revertedOperationIds: [ids[1]],
          wrote: true,
        });
        expect(await vault.read("a.md")).toBe("before");
        expect(host.recovery.decisions).toEqual([expect.objectContaining({ canContinue: false })]);
      } finally {
        host.dispose();
      }
    });

    it.each([false, true])(
      "keeps a lost rename rollback acknowledgement unknown even when Stop also arrives (%s) https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (stop) => {
        const vault = await setup();
        await vault.write("a.md", "body");
        const controller = new AbortController();
        const host = await createVaultHostTools({
          app: vault.app,
          vaultRoot: vault.root,
          privateDir: vault.privateDir,
          sessionId: "rename-unknown",
          getMode: () => "auto",
          requestPermission: async () => ({
            outcome: { outcome: "selected", optionId: "allow_once" },
          }),
        });
        try {
          const renamed = await invoke(
            host.registrations,
            "vault_rename",
            { path: "a.md", newPath: "b.md" },
            "rename"
          );
          expect(renamed.ok).toBe(true);
          vault.afterRename = async () => {
            if (stop) controller.abort();
            throw new Error("host lost rename acknowledgement");
          };
          expect(
            await host.revert(
              (renamed.receipt as { operationId: string }).operationId,
              controller.signal
            )
          ).toMatchObject({ ok: false, code: "EFFECT_UNKNOWN", wrote: true });
          expect(await vault.read("a.md")).toBe("body");
          expect(host.recovery.decisions).toEqual([
            expect.objectContaining({ canContinue: false }),
          ]);
        } finally {
          host.dispose();
        }
      }
    );

    it("stops a batch after its first actual rollback and reports which operations changed https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("a.md", "before");
      const controller = new AbortController();
      let reverting = false;
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "batch-stop",
        getMode: () => "auto",
        requestPermission: async () => {
          reverting = true;
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        },
      });
      const ids: string[] = [];
      for (const [index, before, after] of [
        [1, "before", "middle"],
        [2, "middle", "after"],
      ] as const) {
        const result = await invoke(
          host.registrations,
          "vault_edit",
          {
            path: "a.md",
            expectedHash: sha256(before),
            edits: [{ oldText: before, newText: after }],
          },
          String(index)
        );
        ids.push((result.receipt as { operationId: string }).operationId);
      }
      vault.afterProcess = () => {
        if (reverting) controller.abort();
      };
      const result = await host.revertOperations(ids, controller.signal);
      expect(result).toMatchObject({ ok: false, code: "CANCELLED" });
      expect(await vault.read("a.md")).toBe("middle");
      host.dispose();
    });

    it("rejects writes without a permission callback and preserves files outside the selected scope https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("Allowed/a.md", "original");
      await vault.write("Private/a.md", "secret");
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "scope",
        getMode: () => "default",
        isPathInScope: (name) => name.startsWith("Allowed/"),
      });
      expect(
        await invoke(
          host.registrations,
          "vault_create",
          { path: "Allowed/new.md", content: "new" },
          "create-1"
        )
      ).toMatchObject({ ok: false });
      expect(
        await invoke(host.registrations, "vault_read", { path: "Private/a.md" }, "read-1")
      ).toMatchObject({ ok: false, code: "PATH_OUT_OF_SCOPE" });
      expect(await vault.read("Private/a.md")).toBe("secret");
      host.dispose();
    });

    it("keeps an unrecognized child read-only even when the root uses auto mode https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "root",
        getMode: () => "auto",
      });
      expect(
        await invoke(
          host.registrations,
          "vault_create",
          { path: "child.md", content: "child write" },
          "create",
          undefined,
          "unknown-child"
        )
      ).toMatchObject({ ok: false, code: "READ_ONLY_MODE" });
      host.dispose();
    });

    it("rejects a write when the mode changes to plan while the approval is displayed https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      let mode: VaultAgentMode = "default";
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "mode",
        getMode: () => mode,
        requestPermission: async () => {
          mode = "plan";
          return { outcome: { outcome: "selected", optionId: "allow_once" } };
        },
      });
      expect(
        await invoke(host.registrations, "vault_create", { path: "a.md", content: "new" }, "create")
      ).toMatchObject({ ok: false, code: "SCOPE_REVOKED" });
      expect(vault.app.vault.getAbstractFileByPath("a.md")).toBeNull();
      host.dispose();
    });

    it("settles a pending approval immediately when Stop cancels the call https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      const controller = new AbortController();
      let entered!: () => void;
      const shown = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "pending",
        getMode: () => "default",
        requestPermission: () => {
          entered();
          return new Promise<never>(() => undefined);
        },
      });
      const pending = invoke(
        host.registrations,
        "vault_create",
        { path: "a.md", content: "new" },
        "create",
        controller.signal
      );
      await shown;
      controller.abort();
      expect(await pending).toMatchObject({ ok: false, code: "CANCELLED" });
      expect(vault.app.vault.getAbstractFileByPath("a.md")).toBeNull();
      host.dispose();
    });

    it("does not modify the Vault after its read triggers Stop and does not write in plan mode https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const vault = await setup();
      await vault.write("Notes/a.md", "original");
      const controller = new AbortController();
      let mode: VaultAgentMode = "auto";
      const host = await createVaultHostTools({
        app: vault.app,
        vaultRoot: vault.root,
        privateDir: vault.privateDir,
        sessionId: "cancel",
        getMode: () => mode,
      });
      vault.afterRead = () => controller.abort();
      expect(
        await invoke(
          host.registrations,
          "vault_edit",
          {
            path: "Notes/a.md",
            expectedHash: sha256("original"),
            edits: [{ oldText: "original", newText: "updated" }],
          },
          "write-1",
          controller.signal
        )
      ).toMatchObject({ ok: false });
      expect(await vault.read("Notes/a.md")).toBe("original");
      vault.afterRead = undefined;
      mode = "plan";
      expect(
        await invoke(
          host.registrations,
          "vault_create",
          { path: "Notes/new.md", content: "new" },
          "create-1"
        )
      ).toMatchObject({ ok: false, code: "READ_ONLY_MODE" });
      host.dispose();
    });
  });
});
