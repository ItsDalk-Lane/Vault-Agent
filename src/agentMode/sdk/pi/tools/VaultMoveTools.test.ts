import * as path from "node:path";

import { sha256 } from "@/utils/hash";
import { PathResolver } from "@/agentMode/sdk/pi/policy/PathResolver";
import {
  VaultMoveTools,
  type MoveLinkCache,
  type MoveReceipt,
  type MoveReceiptStore,
  type VaultMoveAdapter,
  type MoveEventSource,
  type MoveFileEvent,
} from "@/agentMode/sdk/pi/tools/VaultMoveTools";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import { PolicyEngine } from "@/agentMode/sdk/pi/policy/PolicyEngine";

// Rename/trash are unsafe replay tools: rename reviews both endpoints and inbound-link candidates,
// uses the injected FileManager API (never Node fs), captures attributable changes and keeps
// concurrent unknown changes unattributed; trash uses the recycle API instead of permanent delete,
// and recovery never re-deletes a new file that reuses the old path:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeEvents implements MoveEventSource {
  private readonly listeners = new Set<(event: MoveFileEvent) => void>();

  subscribe(listener: (event: MoveFileEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: MoveFileEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

class FakeMoveVault implements VaultMoveAdapter {
  readonly files = new Map<string, string>();
  readonly renames: Array<{ oldPath: string; newPath: string }> = [];
  readonly trashes: string[] = [];
  permanentDeleteCalls = 0;
  afterRename?: () => void;
  afterRead?: () => void;
  readonly events = new FakeEvents();

  async fileExists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  async read(filePath: string): Promise<string> {
    const content = this.files.get(filePath) ?? "";
    this.afterRead?.();
    return content;
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    this.renames.push({ oldPath, newPath });
    const content = this.files.get(oldPath);
    if (content === undefined) throw new Error("missing source");
    this.files.delete(oldPath);
    this.files.set(newPath, content);
    this.events.emit({ type: "rename", path: newPath, oldPath });
    this.events.emit({ type: "create", path: newPath });
    this.afterRename?.();
  }

  async trashFile(filePath: string): Promise<void> {
    this.trashes.push(filePath);
    this.files.delete(filePath);
    this.events.emit({ type: "delete", path: filePath });
  }

  deletePermanently(): void {
    this.permanentDeleteCalls += 1;
  }
}

class MemoryReceipts implements MoveReceiptStore {
  readonly saved: MoveReceipt[] = [];
  readonly byOperation = new Map<string, MoveReceipt>();

  async save(receipt: MoveReceipt): Promise<void> {
    this.saved.push(receipt);
    this.byOperation.set(receipt.operationId, receipt);
  }

  async find(operationId: string): Promise<MoveReceipt | undefined> {
    return this.byOperation.get(operationId);
  }
}

interface Harness {
  readonly vault: FakeMoveVault;
  readonly receipts: MemoryReceipts;
  readonly linkCache: MoveLinkCache;
  readonly tools: VaultMoveTools;
}

function harness(): Harness {
  const vault = new FakeMoveVault();
  const receipts = new MemoryReceipts();
  const linkCache: MoveLinkCache = {
    resolvedLinks: { "Notes/link.md": { "Notes/old.md": 1 } },
  };
  const pathResolver = new PathResolver({
    vaultRoot: "/vault",
    fileSystem: { realpath: async (target) => target },
    path,
  });
  const tools = new VaultMoveTools({
    vault,
    pathResolver,
    linkCache,
    events: vault.events,
    receipts,
  });
  return { vault, receipts, linkCache, tools };
}

describe("VaultMoveTools", () => {
  describe("rename()", () => {
    it.each(["EFFECT_UNKNOWN", "STALE_BASELINE", "CANCELLED"])(
      "preserves the host %s result without disguising an unknown effect https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (code) => {
        const { vault, tools } = harness();
        vault.files.set("Notes/old.md", "content");
        jest
          .spyOn(vault, "renameFile")
          .mockRejectedValue(Object.assign(new Error("host failure"), { code }));
        const result = await tools.rename({ path: "Notes/old.md", newPath: "Notes/new.md" }, {});
        expect(result).toMatchObject({ ok: false, code });
      }
    );
    it("reviews both endpoints and exposes inbound-link candidates that may be updated", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/old.md", "content");
      vault.files.set("Notes/link.md", "[[old]]");

      const result = await tools.rename(
        { path: "Notes/old.md", newPath: "Notes/new.md" },
        { operationId: "op-rename-1" }
      );

      expect(result.ok).toBe(true);
      if (!result.ok || result.kind !== "rename") return;
      expect(result.inboundCandidates).toEqual(["Notes/link.md"]);
      expect(result.linkUpdates).toEqual([{ path: "Notes/link.md", mayHaveUpdatedLinks: true }]);
      expect(result.safe).toBe(false);
      expect(result.receipt.replay).toBe("unsafe");
      expect(vault.renames).toEqual([{ oldPath: "Notes/old.md", newPath: "Notes/new.md" }]);
      expect(vault.files.get("Notes/new.md")).toBe("content");
    });

    it("keeps a concurrent user edit unattributed instead of calling it an Agent change", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/old.md", "content");
      vault.files.set("Notes/link.md", "[[old]]");
      vault.files.set("Notes/user.md", "before user edit");
      vault.afterRename = () => {
        vault.files.set("Notes/user.md", "user changed this");
        vault.events.emit({ type: "modify", path: "Notes/user.md" });
        vault.files.set("Notes/link.md", "[[new]]");
        vault.events.emit({ type: "modify", path: "Notes/link.md" });
      };

      const result = await tools.rename({ path: "Notes/old.md", newPath: "Notes/new.md" }, {});

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.agentChanges.map((change) => change.path)).toContain("Notes/link.md");
      expect(result.agentChanges.map((change) => change.path)).not.toContain("Notes/user.md");
      expect(result.unattributedChanges.map((change) => change.path)).toEqual(["Notes/user.md"]);
    });

    it("fails without renaming when the destination already exists or the baseline changed", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/old.md", "content");
      vault.files.set("Notes/existing.md", "existing");

      const existing = await tools.rename(
        { path: "Notes/old.md", newPath: "Notes/existing.md" },
        {}
      );
      const stale = await tools.rename(
        {
          path: "Notes/old.md",
          newPath: "Notes/new.md",
          expectedHash: sha256("something else"),
        },
        {}
      );

      expect(existing).toMatchObject({ ok: false, code: "ALREADY_EXISTS" });
      expect(stale).toMatchObject({ ok: false, code: "STALE_BASELINE" });
      expect(vault.renames).toHaveLength(0);
    });
  });

  describe("trash()", () => {
    it.each(["EFFECT_UNKNOWN", "STALE_BASELINE", "CANCELLED"])(
      "preserves the host %s result without disguising an unknown effect https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (code) => {
        const { vault, tools } = harness();
        vault.files.set("Notes/old.md", "content");
        jest
          .spyOn(vault, "trashFile")
          .mockRejectedValue(Object.assign(new Error("host failure"), { code }));
        const result = await tools.trash({ path: "Notes/old.md" }, {});
        expect(result).toMatchObject({ ok: false, code });
      }
    );
    it("uses the recycle API instead of a permanent delete", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/old.md", "content");

      const result = await tools.trash({ path: "Notes/old.md" }, { operationId: "op-trash-1" });

      expect(result.ok).toBe(true);
      expect(result.ok && result.kind).toBe("trash");
      expect(result.ok && result.safe).toBe(false);
      expect(vault.trashes).toEqual(["Notes/old.md"]);
      expect(vault.permanentDeleteCalls).toBe(0);
      expect(vault.files.has("Notes/old.md")).toBe(false);
    });
  });

  describe("rollbackTrash()", () => {
    it("does not re-delete a new file that reused the old path", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/old.md", "old content");
      await tools.trash({ path: "Notes/old.md" }, { operationId: "op-trash-2" });
      vault.files.set("Notes/old.md", "new user file");

      const result = await tools.rollbackTrash(
        { operationId: "op-trash-2", path: "Notes/old.md" },
        {}
      );

      expect(result).toMatchObject({ ok: false, code: "PATH_RECREATED", deleted: false });
      expect(vault.trashes).toHaveLength(1);
      expect(vault.files.get("Notes/old.md")).toBe("new user file");
    });

    it("reports an absent trash as already absent without deleting anything", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/old.md", "old content");
      await tools.trash({ path: "Notes/old.md" }, { operationId: "op-trash-3" });

      const result = await tools.rollbackTrash(
        { operationId: "op-trash-3", path: "Notes/old.md" },
        {}
      );

      expect(result).toMatchObject({ ok: true, status: "already_absent", deleted: false });
      expect(vault.trashes).toHaveLength(1);
      expect(vault.permanentDeleteCalls).toBe(0);
    });
  });

  describe("register()", () => {
    it.each(["vault_rename", "vault_trash"])(
      "does not run %s through the registered gateway after Stop cancels the baseline read https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (toolId) => {
        const { vault, tools } = harness();
        vault.files.set("Notes/old.md", "original");
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
          toolId,
          toolId === "vault_rename"
            ? { path: "Notes/old.md", newPath: "Notes/new.md" }
            : { path: "Notes/old.md" },
          {
            caller: "root",
            mode: "default",
            scope: { vaultRoot: "/vault", readOnly: false },
            scopeVersion: 1,
            policyVersion: 1,
            targets: [{ kind: "vault_path", value: "/vault/Notes/old.md", insideScope: true }],
            signal: controller.signal,
          }
        );
        expect(vault.files.get("Notes/old.md")).toBe("original");
        expect(vault.renames).toHaveLength(0);
        expect(vault.trashes).toHaveLength(0);
        expect(result).toMatchObject({ isError: true });
        expect(JSON.stringify(result)).toContain("CANCELLED");
      }
    );

    it("registers unsafe move manifests with both rename endpoints and only the trash source https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { tools } = harness();
      const registry = new ToolRegistry();

      tools.register(registry);

      const rename = registry.requireManifest("vault_rename");
      const trash = registry.requireManifest("vault_trash");
      expect(rename.effects).toEqual(["rename"]);
      expect(trash.effects).toEqual(["delete"]);
      expect(rename.replayPolicy).toBe("unsafe");
      expect(trash.replayPolicy).toBe("unsafe");
      expect(rename.parameters.additionalProperties).toBe(false);
      expect(trash.parameters.additionalProperties).toBe(false);
      expect(rename.extractTargets({ path: "Notes/old.md", newPath: "Archive/new.md" })).toEqual([
        { kind: "vault_path", value: "Notes/old.md" },
        { kind: "vault_path", value: "Archive/new.md" },
      ]);
      expect(trash.extractTargets({ path: "Notes/old.md", newPath: "ignored.md" })).toEqual([
        { kind: "vault_path", value: "Notes/old.md" },
      ]);
    });
  });
});
