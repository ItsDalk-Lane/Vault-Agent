import { PolicyEngine } from "@/agentMode/sdk/pi/policy/PolicyEngine";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import {
  VaultSearchIndex,
  type SearchEventSource,
  type SearchMetadata,
  type SearchVaultAdapter,
  type VaultSearchFileEvent,
} from "@/agentMode/sdk/pi/tools/VaultSearchIndex";
import { VaultSearch } from "@/agentMode/sdk/pi/tools/VaultSearch";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";

// Keyword search is layered (title/tag first, body on demand), reads the Vault in batches that
// respect cancellation, sorts deterministically with a cursor, invalidates on Vault file events,
// never calls rg/grep or uploads content, and skips config/session-private directories:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeSearchVault implements SearchVaultAdapter {
  readonly files = new Map<string, string>();
  readonly reads: string[] = [];
  onRead?: (path: string) => void;

  async listMarkdownFiles(): Promise<readonly string[]> {
    return [...this.files.keys()].sort();
  }

  async read(path: string): Promise<string> {
    this.reads.push(path);
    this.onRead?.(path);
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  }
}

class FakeMetadata implements SearchMetadata {
  readonly titles = new Map<string, string>();
  readonly tags = new Map<string, readonly string[]>();

  titleOf(path: string): string | undefined {
    return this.titles.get(path);
  }

  tagsOf(path: string): readonly string[] {
    return this.tags.get(path) ?? [];
  }
}

class FakeEvents implements SearchEventSource {
  private readonly listeners = new Set<(event: VaultSearchFileEvent) => void>();
  unsubscribed = 0;

  subscribe(listener: (event: VaultSearchFileEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      this.unsubscribed += 1;
    };
  }

  emit(event: VaultSearchFileEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

interface Fixture {
  readonly vault: FakeSearchVault;
  readonly metadata: FakeMetadata;
  readonly events: FakeEvents;
  readonly index: VaultSearchIndex;
}

function fixture(files: Record<string, string>): Fixture {
  const vault = new FakeSearchVault();
  for (const [path, content] of Object.entries(files)) vault.files.set(path, content);
  const metadata = new FakeMetadata();
  const events = new FakeEvents();
  const index = new VaultSearchIndex({ vault, metadata, events, configDir: "config" });
  return { vault, metadata, events, index };
}

describe("VaultSearchIndex", () => {
  describe("search()", () => {
    it("returns a correct Chinese snippet with its line range", async () => {
      const { index } = fixture({
        "Notes/中文.md": "第一行\n这是一段中文关键词内容\n第三行",
      });

      const result = await index.search("中文关键词");

      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]).toMatchObject({
        path: "Notes/中文.md",
        kind: "body",
        startLine: 2,
        endLine: 2,
      });
      expect(result.hits[0].snippet).toContain("中文关键词");
      expect(result.cancelled).toBe(false);
    });

    it("ranks title and tag matches before body matches", async () => {
      const { index, metadata } = fixture({
        "Notes/title.md": "正文没有命中词",
        "Notes/tag.md": "正文没有命中词",
        "Notes/body.md": "正文包含关键词",
      });
      metadata.titles.set("Notes/title.md", "关键词标题");
      metadata.tags.set("Notes/tag.md", ["关键词"]);

      const result = await index.search("关键词");

      expect(result.hits.map((hit) => hit.path)).toEqual([
        "Notes/title.md",
        "Notes/tag.md",
        "Notes/body.md",
      ]);
      expect(result.hits.map((hit) => hit.kind)).toEqual(["title", "tag", "body"]);
    });

    it("invalidates the old path after a rename event", async () => {
      const { index, vault, events } = fixture({ "Notes/old.md": "needle here" });
      expect((await index.search("needle")).hits.map((hit) => hit.path)).toEqual(["Notes/old.md"]);

      vault.files.delete("Notes/old.md");
      vault.files.set("Notes/new.md", "needle here");
      events.emit({ type: "rename", path: "Notes/new.md", oldPath: "Notes/old.md" });

      const renamed = await index.search("needle");
      expect(renamed.hits.map((hit) => hit.path)).toEqual(["Notes/new.md"]);
    });

    it("stops scanning when the signal is aborted", async () => {
      const { index, vault } = fixture({
        "Notes/a.md": "needle",
        "Notes/b.md": "needle",
        "Notes/c.md": "needle",
      });
      const controller = new AbortController();
      vault.onRead = () => controller.abort();

      const result = await index.search("needle", { signal: controller.signal });

      expect(result.cancelled).toBe(true);
      expect(vault.reads.length).toBeLessThan(3);
    });

    it("does not search config or session-private directories", async () => {
      const { index } = fixture({
        "config/app.md": "needle",
        ".vault-agent/state.md": "needle",
        ".trash/old.md": "needle",
        "Notes/ok.md": "needle",
      });

      const result = await index.search("needle");

      expect(result.hits.map((hit) => hit.path)).toEqual(["Notes/ok.md"]);
    });

    it("sorts deterministically and pages with a cursor", async () => {
      const { index } = fixture({
        "Notes/e.md": "needle",
        "Notes/d.md": "needle",
        "Notes/c.md": "needle",
        "Notes/b.md": "needle",
        "Notes/a.md": "needle",
      });

      const first = await index.search("needle", { limit: 2 });
      const second = await index.search("needle", {
        limit: 2,
        cursor: first.nextCursor,
      });
      const third = await index.search("needle", { limit: 2, cursor: second.nextCursor });

      expect(first.hits.map((hit) => hit.path)).toEqual(["Notes/a.md", "Notes/b.md"]);
      expect(first.truncated).toBe(true);
      expect(second.hits.map((hit) => hit.path)).toEqual(["Notes/c.md", "Notes/d.md"]);
      expect(third.hits.map((hit) => hit.path)).toEqual(["Notes/e.md"]);
      expect(third.truncated).toBe(false);
      expect(third.nextCursor).toBeUndefined();
    });

    it("returns an empty result instead of an error when nothing matches", async () => {
      const { index } = fixture({ "Notes/a.md": "nothing" });

      const result = await index.search("missing");

      expect(result).toMatchObject({ hits: [], total: 0, truncated: false, cancelled: false });
    });
  });

  describe("dispose()", () => {
    it("unsubscribes from Vault file events", () => {
      const { events, index } = fixture({ "Notes/a.md": "needle" });

      index.dispose();

      expect(events.unsubscribed).toBe(1);
    });
  });
});

describe("VaultSearch", () => {
  describe("register()", () => {
    it("registers scoped read-only fanout search with bounded query and limit https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { index } = fixture({ "Notes/a.md": "needle" });
      const search = new VaultSearch({ index });
      const registry = new ToolRegistry();

      const gateway = new ToolGateway({ registry, policy: new PolicyEngine() });
      search.register(registry, gateway);

      const manifest = registry.requireManifest("vault_search");
      expect(manifest.family).toBe("vault");
      expect(manifest.effects).toEqual(["read"]);
      expect(manifest.parameters.additionalProperties).toBe(false);
      expect(manifest.parameters.required).toEqual(["query"]);
      const result = await gateway.executeTool(
        "vault_search",
        { query: "needle" },
        {
          caller: "fanout",
          mode: "plan",
          scope: { vaultRoot: "/vault", readOnly: true },
          scopeVersion: 1,
          policyVersion: 1,
          targets: [],
        }
      );
      expect(result).toMatchObject({ decision: "allow" });
      if (result.decision === "allow")
        expect(JSON.parse(result.content)).toMatchObject({
          ok: true,
          value: { hits: [{ path: "Notes/a.md" }] },
        });
    });
  });

  describe("search()", () => {
    it("validates arguments and applies the scope filter", async () => {
      const { index } = fixture({
        "Notes/a.md": "needle",
        "Other/b.md": "needle",
      });
      const search = new VaultSearch({ index });

      const invalid = await search.search({ query: "" }, {});
      const tooLarge = await search.search({ query: "needle", limit: 101 }, {});
      const scoped = await search.search(
        { query: "needle" },
        { isPathInScope: (relative) => relative.startsWith("Notes/") }
      );

      expect(invalid).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(tooLarge).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(scoped.ok && scoped.value.hits.map((hit) => hit.path)).toEqual(["Notes/a.md"]);
    });
  });
});
