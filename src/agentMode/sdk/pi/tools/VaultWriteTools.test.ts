import * as path from "node:path";

import { VaultReadTools } from "@/agentMode/sdk/pi/tools/VaultReadTools";
import { sha256 } from "@/utils/hash";
import { PathResolver } from "@/agentMode/sdk/pi/policy/PathResolver";
import {
  VaultWriteTools,
  type VaultWriteAdapter,
  type VaultWriteReceipt,
  type VaultWriteReceiptStore,
} from "@/agentMode/sdk/pi/tools/VaultWriteTools";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import { PolicyEngine } from "@/agentMode/sdk/pi/policy/PolicyEngine";

// vault_create never overwrites, vault_edit re-checks the baseline hash inside Vault.process, the
// final gateway/cancel check runs before writing, a successful write is verified against the
// approved after hash and gets a receipt, and replaying the same operation id never applies the
// patch twice:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeVault implements VaultWriteAdapter {
  readonly files = new Map<string, string>();
  readonly created: string[] = [];
  readonly processed: string[] = [];
  afterRead?: () => void;
  ignoreProcessResult = false;

  async read(filePath: string): Promise<string> {
    const content = this.files.get(filePath) ?? "";
    this.afterRead?.();
    return content;
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async create(filePath: string, content: string): Promise<void> {
    if (this.files.has(filePath)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
    this.files.set(filePath, content);
    this.created.push(filePath);
  }

  async process(filePath: string, callback: (current: string) => string): Promise<void> {
    this.processed.push(filePath);
    const current = this.files.get(filePath) ?? "";
    const next = callback(current);
    this.files.set(filePath, this.ignoreProcessResult ? "tampered" : next);
  }
}

class MemoryReceipts implements VaultWriteReceiptStore {
  readonly saved: VaultWriteReceipt[] = [];
  readonly byOperation = new Map<string, VaultWriteReceipt>();
  fail = false;

  async save(receipt: VaultWriteReceipt): Promise<void> {
    if (this.fail) throw new Error("receipt store unavailable");
    this.saved.push(receipt);
    this.byOperation.set(receipt.operationId, receipt);
  }

  async find(operationId: string): Promise<VaultWriteReceipt | undefined> {
    return this.byOperation.get(operationId);
  }
}

interface Harness {
  readonly vault: FakeVault;
  readonly receipts: MemoryReceipts;
  readonly tools: VaultWriteTools;
}

function harness(): Harness {
  const vault = new FakeVault();
  const receipts = new MemoryReceipts();
  const pathResolver = new PathResolver({
    vaultRoot: "/vault",
    fileSystem: { realpath: async (target) => target },
    path,
  });
  const tools = new VaultWriteTools({ vault, pathResolver, receipts });
  return { vault, receipts, tools };
}

describe("VaultWriteTools", () => {
  describe("edit()", () => {
    it("asks for the read tool's fileVersion when the edit has no version and leaves the file unchanged https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { vault, tools } = harness();
      vault.files.set("note.md", "before");
      expect(
        await tools.edit({ path: "note.md", edits: [{ oldText: "before", newText: "after" }] }, {})
      ).toMatchObject({ ok: false, code: "INVALID_ARGUMENT", message: "fileVersion is required." });
      expect(vault.files.get("note.md")).toBe("before");
      expect(vault.processed).toEqual([]);
    });
    it("edits a long note using only the baseline returned by a partial read https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { vault, tools } = harness();
      const original = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`).join("\n") + "\n";
      vault.files.set("Long.md", original);
      const reads = new VaultReadTools({
        vault: { read: (p) => vault.read(p), listMarkdownFiles: async () => [] },
        linkCache: { resolvedLinks: {}, unresolvedLinks: {} },
        pathResolver: new PathResolver({
          vaultRoot: "/vault",
          fileSystem: { realpath: async (p) => p },
          path,
        }),
      });
      const read = await reads.read({ path: "Long.md", lineCount: 2 }, {});
      if (!read.ok) throw new Error(read.message);
      const edited = await tools.edit(
        {
          path: "Long.md",
          fileVersion: read.value.fileVersion,
          edits: [{ oldText: "Line 1\n", newText: "Updated\n" }],
        },
        {}
      );
      expect(edited.ok).toBe(true);
      expect(vault.files.get("Long.md")).toBe(original.replace("Line 1\n", "Updated\n"));
    });
    it("reports STALE_BASELINE when the file changed during approval", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/a.md", "original");
      vault.afterRead = () => vault.files.set("Notes/a.md", "user changed");

      const result = await tools.edit(
        {
          path: "Notes/a.md",
          expectedHash: sha256("original"),
          edits: [{ oldText: "original", newText: "agent change" }],
        },
        {}
      );

      expect(result).toMatchObject({ ok: false, code: "STALE_BASELINE" });
      expect(vault.files.get("Notes/a.md")).toBe("user changed");
      expect(vault.processed).toHaveLength(1);
    });

    it("applies the patch, verifies the real content and stores a safe receipt", async () => {
      const { vault, receipts, tools } = harness();
      vault.files.set("Notes/a.md", "hello world");

      const result = await tools.edit(
        {
          path: "Notes/a.md",
          expectedHash: sha256("hello world"),
          edits: [{ oldText: "world", newText: "vault" }],
        },
        { operationId: "op-edit-1", approvalRef: "approval-1" }
      );

      expect(result.ok).toBe(true);
      expect(result.ok && result.safe).toBe(true);
      expect(vault.files.get("Notes/a.md")).toBe("hello vault");
      expect(receipts.saved).toHaveLength(1);
      expect(receipts.saved[0]).toMatchObject({
        operationId: "op-edit-1",
        path: "Notes/a.md",
        beforeHash: sha256("hello world"),
        afterHash: sha256("hello vault"),
        kind: "edit",
        approvalRef: "approval-1",
        safe: true,
      });
    });

    it("does not apply the patch twice when the same operation id is replayed", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/a.md", "hello world");
      const request = {
        path: "Notes/a.md",
        expectedHash: sha256("hello world"),
        edits: [{ oldText: "world", newText: "vault" }],
      };

      const first = await tools.edit(request, { operationId: "op-replay" });
      const second = await tools.edit(request, { operationId: "op-replay" });

      expect(first.ok && first.alreadyApplied).toBeUndefined();
      expect(second).toMatchObject({ ok: true, safe: true, alreadyApplied: true });
      expect(vault.processed).toHaveLength(1);
    });

    it("stops before writing when cancelled", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/a.md", "original");
      const controller = new AbortController();
      vault.afterRead = () => controller.abort();

      const result = await tools.edit(
        {
          path: "Notes/a.md",
          expectedHash: sha256("original"),
          edits: [{ oldText: "original", newText: "updated" }],
        },
        { signal: controller.signal }
      );

      expect(result).toMatchObject({ ok: false, code: "CANCELLED" });
      expect(vault.processed).toHaveLength(0);
      expect(vault.files.get("Notes/a.md")).toBe("original");
    });

    it("rejects a mismatched expected hash before touching the file", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/a.md", "original");

      const result = await tools.edit(
        {
          path: "Notes/a.md",
          expectedHash: sha256("something else"),
          edits: [{ oldText: "original", newText: "updated" }],
        },
        {}
      );

      expect(result).toMatchObject({ ok: false, code: "STALE_BASELINE" });
      expect(vault.processed).toHaveLength(0);
    });

    it("reports effect_unknown when the write succeeded but the receipt failed", async () => {
      const { vault, receipts, tools } = harness();
      vault.files.set("Notes/a.md", "hello world");
      receipts.fail = true;

      const result = await tools.edit(
        {
          path: "Notes/a.md",
          expectedHash: sha256("hello world"),
          edits: [{ oldText: "world", newText: "vault" }],
        },
        {}
      );

      expect(result).toMatchObject({ ok: false, code: "EFFECT_UNKNOWN", wrote: true });
      expect(vault.files.get("Notes/a.md")).toBe("hello vault");
    });
  });

  describe("create()", () => {
    it("creates a missing file and returns a safe receipt", async () => {
      const { vault, receipts, tools } = harness();

      const result = await tools.create(
        { path: "Notes/new.md", content: "new note" },
        { operationId: "op-create-1" }
      );

      expect(result.ok).toBe(true);
      expect(vault.files.get("Notes/new.md")).toBe("new note");
      expect(receipts.saved[0]).toMatchObject({ kind: "create", safe: true });
    });

    it("fails instead of overwriting an existing file", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/a.md", "existing");

      const result = await tools.create({ path: "Notes/a.md", content: "replacement" }, {});

      expect(result).toMatchObject({ ok: false, code: "ALREADY_EXISTS" });
      expect(vault.created).toHaveLength(0);
      expect(vault.files.get("Notes/a.md")).toBe("existing");
    });

    it("does not create twice when the same operation id is replayed", async () => {
      const { vault, tools } = harness();

      const first = await tools.create(
        { path: "Notes/new.md", content: "new note" },
        { operationId: "op-create-replay" }
      );
      const second = await tools.create(
        { path: "Notes/new.md", content: "new note" },
        { operationId: "op-create-replay" }
      );

      expect(first.ok).toBe(true);
      expect(second).toMatchObject({ ok: true, alreadyApplied: true });
      expect(vault.created).toHaveLength(1);
    });
  });

  describe("register()", () => {
    it("does not edit through the registered gateway after Stop cancels the baseline read https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/a.md", "original");
      const controller = new AbortController();
      vault.afterRead = () => controller.abort();
      const registry = new ToolRegistry();
      const gateway = new ToolGateway({
        registry,
        policy: new PolicyEngine(),
        requestApproval: async () => "approved",
      });
      tools.register(registry, gateway);
      const result = await gateway.executeTool(
        "vault_edit",
        {
          path: "Notes/a.md",
          expectedHash: sha256("original"),
          edits: [{ oldText: "original", newText: "updated" }],
        },
        {
          caller: "root",
          mode: "default",
          scope: { vaultRoot: "/vault", readOnly: false },
          scopeVersion: 1,
          policyVersion: 1,
          targets: [{ kind: "vault_path", value: "/vault/Notes/a.md", insideScope: true }],
          signal: controller.signal,
        }
      );
      expect(vault.files.get("Notes/a.md")).toBe("original");
      expect(vault.processed).toHaveLength(0);
      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).toContain("CANCELLED");
    });

    it("registers closed create/edit schemas requiring either the whole-file version or its legacy alias https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { tools } = harness();
      const registry = new ToolRegistry();

      tools.register(registry);

      const create = registry.requireManifest("vault_create");
      const edit = registry.requireManifest("vault_edit");
      expect(create.family).toBe("vault");
      expect(create.effects).toEqual(["create"]);
      expect(edit.effects).toEqual(["write"]);
      expect(create.parameters.additionalProperties).toBe(false);
      expect(edit.parameters.additionalProperties).toBe(false);
      expect(edit.parameters.anyOf).toEqual([
        { required: ["fileVersion"] },
        { required: ["expectedHash"] },
      ]);
      expect(edit.parameters.required).toEqual(["path", "edits"]);
    });
  });
});
