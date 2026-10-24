import * as path from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { sha256 } from "@/utils/hash";
import { PathResolver } from "@/agentMode/sdk/pi/policy/PathResolver";
import {
  VaultFrontmatter,
  type VaultFrontmatterAdapter,
  type VaultFrontmatterReceipt,
  type VaultFrontmatterReceiptStore,
  type YamlCodec,
} from "@/agentMode/sdk/pi/tools/VaultFrontmatter";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import { PolicyEngine } from "@/agentMode/sdk/pi/policy/PolicyEngine";

// The frontmatter tool parses with the injected public YAML codec, preserves the body byte-for-byte,
// accepts only JSON values in set/remove, never executes YAML tags, shows serialization/format
// changes in the proposed diff, creates a missing frontmatter block, and writes through the same
// full-text Vault.process CAS:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const YAML_CODEC: YamlCodec = {
  parse: (text) => parseYaml(text),
  stringify: (value) => stringifyYaml(value),
};

class FakeVault implements VaultFrontmatterAdapter {
  readonly files = new Map<string, string>();
  readonly processed: string[] = [];
  afterRead?: () => void;

  async read(filePath: string): Promise<string> {
    const content = this.files.get(filePath) ?? "";
    this.afterRead?.();
    return content;
  }

  async process(filePath: string, callback: (current: string) => string): Promise<void> {
    this.processed.push(filePath);
    const current = this.files.get(filePath) ?? "";
    this.files.set(filePath, callback(current));
  }
}

class MemoryReceipts implements VaultFrontmatterReceiptStore {
  readonly saved: VaultFrontmatterReceipt[] = [];
  readonly byOperation = new Map<string, VaultFrontmatterReceipt>();

  async save(receipt: VaultFrontmatterReceipt): Promise<void> {
    this.saved.push(receipt);
    this.byOperation.set(receipt.operationId, receipt);
  }

  async find(operationId: string): Promise<VaultFrontmatterReceipt | undefined> {
    return this.byOperation.get(operationId);
  }
}

interface Harness {
  readonly vault: FakeVault;
  readonly receipts: MemoryReceipts;
  readonly tools: VaultFrontmatter;
}

function harness(): Harness {
  const vault = new FakeVault();
  const receipts = new MemoryReceipts();
  const pathResolver = new PathResolver({
    vaultRoot: "/vault",
    fileSystem: { realpath: async (target) => target },
    path,
  });
  const tools = new VaultFrontmatter({
    vault,
    pathResolver,
    yaml: YAML_CODEC,
    receipts,
  });
  return { vault, receipts, tools };
}

function bodyOf(content: string): string {
  const lines = content.split("\n");
  const close = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  return close === -1 ? content : lines.slice(close + 1).join("\n");
}

describe("VaultFrontmatter", () => {
  describe("apply()", () => {
    it("asks for the read tool's fileVersion when a property update has no version and preserves the note https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { vault, tools } = harness();
      vault.files.set("note.md", "before");
      expect(await tools.apply({ path: "note.md", set: { status: "ready" } }, {})).toMatchObject({
        ok: false,
        code: "INVALID_ARGUMENT",
        message: "fileVersion is required.",
      });
      expect(vault.files.get("note.md")).toBe("before");
    });
    it("keeps the body byte-for-byte while changing the frontmatter", async () => {
      const { vault, tools } = harness();
      const body = "# Heading\n\nParagraph with trailing spaces  \n";
      const before = `---\ntitle: Original\n---\n${body}`;
      vault.files.set("Notes/a.md", before);

      const result = await tools.apply(
        {
          path: "Notes/a.md",
          expectedHash: sha256(before),
          set: { status: "draft" },
        },
        {}
      );

      expect(result.ok).toBe(true);
      if (!result.ok || "alreadyApplied" in result) return;
      expect(bodyOf(result.proposedContent)).toBe(body);
      expect(result.proposedContent).toContain("status: draft");
      expect(result.proposedContent).toContain("title: Original");
      expect(vault.files.get("Notes/a.md")).toBe(result.proposedContent);
      expect(result.receipt.afterHash).toBe(sha256(result.proposedContent));
      expect(result.safe).toBe(true);
    });

    it("does not execute a malicious YAML tag", async () => {
      const { vault, tools } = harness();
      const before = '---\nevil: !!js/function "function() { return 1; }"\n---\nbody\n';
      vault.files.set("Notes/a.md", before);

      const result = await tools.apply(
        { path: "Notes/a.md", expectedHash: sha256(before), set: { status: "x" } },
        {}
      );

      expect(result).toMatchObject({ ok: false, code: "INVALID_YAML" });
      expect(vault.processed).toHaveLength(0);
      expect(vault.files.get("Notes/a.md")).toBe(before);
    });

    it("creates a missing frontmatter block and preserves the body", async () => {
      const { vault, tools } = harness();
      vault.files.set("Notes/new.md", "Just the body\n");

      const result = await tools.apply(
        { path: "Notes/new.md", expectedHash: sha256("Just the body\n"), set: { status: "draft" } },
        {}
      );

      expect(result.ok).toBe(true);
      if (!result.ok || "alreadyApplied" in result) return;
      expect(result.proposedContent).toMatch(/^---\nstatus: draft\n---\nJust the body\n$/);
    });

    it("spells out serialization format changes in the proposed diff", async () => {
      const { vault, tools } = harness();
      const before = '---\ntitle: "hello"\n# keep this comment\n---\nBody\n';
      vault.files.set("Notes/a.md", before);

      const result = await tools.apply(
        { path: "Notes/a.md", expectedHash: sha256(before), set: { status: "draft" } },
        {}
      );

      expect(result.ok).toBe(true);
      if (!result.ok || "alreadyApplied" in result) return;
      expect(result.diff).toContain('-title: "hello"');
      expect(result.diff).toContain("+title: hello");
      expect(result.diff).toContain("-# keep this comment");
    });

    it("removes keys and rejects values that are not JSON data", async () => {
      const { vault, tools } = harness();
      const before = "---\ntitle: Original\nstatus: old\n---\nBody\n";
      vault.files.set("Notes/a.md", before);

      const removed = await tools.apply(
        {
          path: "Notes/a.md",
          expectedHash: sha256(before),
          remove: ["status"],
        },
        {}
      );
      expect(removed.ok).toBe(true);
      if (removed.ok && !("alreadyApplied" in removed)) {
        expect(removed.proposedContent).not.toContain("status: old");
      }

      const invalid = await tools.apply(
        {
          path: "Notes/a.md",
          expectedHash: sha256(before),
          set: { broken: (() => "not json") as never },
        },
        {}
      );
      expect(invalid).toMatchObject({ ok: false, code: "NON_JSON_VALUE" });
    });

    it("does not overwrite a file that changed during approval", async () => {
      const { vault, tools } = harness();
      const before = "---\ntitle: Original\n---\nBody\n";
      vault.files.set("Notes/a.md", before);
      vault.afterRead = () => vault.files.set("Notes/a.md", "---\ntitle: User Edit\n---\nBody\n");

      const result = await tools.apply(
        { path: "Notes/a.md", expectedHash: sha256(before), set: { status: "draft" } },
        {}
      );

      expect(result).toMatchObject({ ok: false, code: "STALE_BASELINE" });
      expect(vault.files.get("Notes/a.md")).toContain("User Edit");
    });

    it("stops before writing when cancelled and replays without writing twice", async () => {
      const { vault, tools } = harness();
      const before = "---\ntitle: Original\n---\nBody\n";
      vault.files.set("Notes/a.md", before);
      const controller = new AbortController();
      vault.afterRead = () => controller.abort();

      const cancelled = await tools.apply(
        { path: "Notes/a.md", expectedHash: sha256(before), set: { status: "x" } },
        { signal: controller.signal }
      );
      expect(cancelled).toMatchObject({ ok: false, code: "CANCELLED" });
      expect(vault.processed).toHaveLength(0);

      vault.afterRead = undefined;
      const request = {
        path: "Notes/a.md",
        expectedHash: sha256(before),
        set: { status: "draft" },
      };
      const first = await tools.apply(request, { operationId: "op-frontmatter" });
      const second = await tools.apply(request, { operationId: "op-frontmatter" });

      expect(first.ok).toBe(true);
      expect(second).toMatchObject({ ok: true, alreadyApplied: true });
      expect(vault.processed).toHaveLength(1);
    });
  });

  describe("register()", () => {
    it("does not change frontmatter through the registered gateway after Stop cancels the baseline read https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { vault, tools } = harness();
      const before = "---\ntitle: Original\n---\nBody\n";
      vault.files.set("Notes/a.md", before);
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
        "vault_frontmatter",
        { path: "Notes/a.md", expectedHash: sha256(before), set: { title: "Changed" } },
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
      expect(vault.files.get("Notes/a.md")).toBe(before);
      expect(vault.processed).toHaveLength(0);
      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).toContain("CANCELLED");
    });

    it("registers a closed property-update schema requiring either the whole-file version or its legacy alias https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const { tools } = harness();
      const registry = new ToolRegistry();

      tools.register(registry);

      const manifest = registry.requireManifest("vault_frontmatter");
      expect(manifest.family).toBe("vault");
      expect(manifest.effects).toEqual(["write"]);
      expect(manifest.parameters.additionalProperties).toBe(false);
      expect(manifest.parameters.anyOf).toEqual([
        { required: ["fileVersion"] },
        { required: ["expectedHash"] },
      ]);
      expect(manifest.parameters.required).toEqual(["path"]);
    });
  });
});
