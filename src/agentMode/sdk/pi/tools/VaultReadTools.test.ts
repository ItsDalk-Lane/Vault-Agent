import { PolicyEngine } from "@/agentMode/sdk/pi/policy/PolicyEngine";
import { ToolGateway } from "@/agentMode/sdk/pi/tools/ToolGateway";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { sha256 } from "@/utils/hash";
import { PathResolver } from "@/agentMode/sdk/pi/policy/PathResolver";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import {
  VaultReadTools,
  type VaultLinkCache,
  type VaultReadAdapter,
} from "@/agentMode/sdk/pi/tools/VaultReadTools";

// vault_list/read/links use the Vault API for content, paginate deterministically, return the range
// hash and truncation cursor, treat MetadataCache only as link candidates, never invent content from
// a stale cache, exclude protected/out-of-scope paths, and return an empty result instead of an
// error when nothing matches:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
interface Fixture {
  readonly root: string;
  readonly vault: string;
  readonly tools: VaultReadTools;
  readonly reads: string[];
  readonly cache: MutableLinkCache;
}

class MutableLinkCache implements VaultLinkCache {
  resolvedLinks: Record<string, Record<string, number>> = {};
  unresolvedLinks: Record<string, Record<string, number>> = {};
  stale = false;

  isStale(): boolean {
    return this.stale;
  }
}

class FakeVault implements VaultReadAdapter {
  readonly files: Record<string, string>;
  readonly reads: string[] = [];

  constructor(files: Record<string, string>) {
    this.files = files;
  }

  async listMarkdownFiles(folder?: string): Promise<readonly { path: string; size: number }[]> {
    return Object.entries(this.files)
      .filter(([filePath]) => filePath.endsWith(".md"))
      .filter(([filePath]) => folder === undefined || filePath.startsWith(`${folder}/`))
      .map(([filePath, content]) => ({ path: filePath, size: content.length }));
  }

  async read(filePath: string): Promise<string> {
    this.reads.push(filePath);
    const content = this.files[filePath];
    if (content === undefined) throw new Error(`missing ${filePath}`);
    return content;
  }
}

function lines(count: number, prefix = "L"): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join("\n");
}

const tempDirectories: string[] = [];

async function createFixture(
  files: Record<string, string>,
  options: { protectedRelativeRoots?: readonly string[] } = {}
): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-vault-read-"));
  tempDirectories.push(root);
  const vault = path.join(root, "vault");
  await fs.mkdir(vault, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(vault, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  const fakeVault = new FakeVault(files);
  const cache = new MutableLinkCache();
  const tools = new VaultReadTools({
    vault: fakeVault,
    linkCache: cache,
    pathResolver: new PathResolver({
      vaultRoot: vault,
      protectedRoots: (options.protectedRelativeRoots ?? []).map((relative) =>
        path.join(vault, relative)
      ),
      fileSystem: fs,
      path,
    }),
  });
  return { root, vault, tools, reads: fakeVault.reads, cache };
}

afterAll(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe("VaultReadTools", () => {
  describe("read()", () => {
    it("keeps the full version and cursor within the SDK output limit even for a long Unicode path https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const notePath = [
        ...Array.from({ length: 8 }, (_, index) => `${index}${"文".repeat(30)}`),
        "笔记.md",
      ].join("/");
      const content = "x".repeat(80000);
      const fixture = await createFixture({ [notePath]: content });
      const first = await fixture.tools.read({ path: notePath }, {});
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("Expected the first range");
      expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(65536);
      expect(first.value.fileVersion).toBe(sha256(content));
      expect(first.value.nextCursor).toBeDefined();
      const next = await fixture.tools.read({ path: notePath, cursor: first.value.nextCursor }, {});
      expect(next.ok).toBe(true);
      if (!next.ok) throw new Error("Expected the next range");
      expect(first.value.content + next.value.content).toBe(content);
      expect(next.value.fileVersion).toBe(first.value.fileVersion);
    });

    it("returns a full-file version for partial reads and preserves a 400-line trailing newline https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const content = lines(400) + "\n";
      const fixture = await createFixture({ "Boundary.md": content });
      const result = await fixture.tools.read({ path: "Boundary.md" }, {});
      expect(result).toMatchObject({
        ok: true,
        value: { content, fileVersion: sha256(content), truncated: false },
      });
      const partial = await fixture.tools.read(
        { path: "Boundary.md", startLine: 3, lineCount: 2 },
        {}
      );
      expect(partial).toMatchObject({
        ok: true,
        value: { fileVersion: sha256(content), sha256: sha256("L3\nL4") },
      });
    });

    it("pages a long Unicode line without losing characters and rejects a changed cursor https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const content = "测试🙂".repeat(15000) + "\nend\n";
      const fixture = await createFixture({ "Long.md": content });
      let cursor: string | undefined;
      let restored = "";
      do {
        const result = await fixture.tools.read(
          { path: "Long.md", ...(cursor ? { cursor } : {}) },
          {}
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.bytes).toBeLessThanOrEqual(65536);
        restored += result.value.content;
        cursor = result.value.nextCursor;
      } while (cursor);
      expect(restored).toBe(content);
      const changed = await fixture.tools.read(
        { path: "Long.md", cursor: JSON.stringify({ version: sha256("old"), offset: 1 }) },
        {}
      );
      expect(changed).toMatchObject({ ok: false, code: "STALE_BASELINE" });
    });

    it("returns the requested line range with its hash, total lines and range metadata", async () => {
      const fixture = await createFixture({ "Notes/a.md": lines(10) });

      const result = await fixture.tools.read(
        { path: "Notes/a.md", startLine: 3, lineCount: 2 },
        {}
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({
        path: "Notes/a.md",
        content: "L3\nL4",
        startLine: 3,
        lineCount: 2,
        totalLines: 10,
        truncated: true,
        nextStartLine: 5,
      });
      expect(result.value.sha256).toBe(sha256("L3\nL4"));
    });

    it("returns the next segment for a large file and stops at the last segment", async () => {
      const fixture = await createFixture({ "Big.md": lines(1000, "line-") });

      const first = await fixture.tools.read({ path: "Big.md", startLine: 1, lineCount: 400 }, {});
      const second = await fixture.tools.read(
        { path: "Big.md", startLine: 401, lineCount: 400 },
        {}
      );
      const last = await fixture.tools.read({ path: "Big.md", startLine: 801, lineCount: 400 }, {});

      expect(first.ok && first.value.totalLines).toBe(1000);
      expect(first.ok && first.value.nextStartLine).toBe(401);
      expect(second.ok && second.value.nextStartLine).toBe(801);
      expect(last.ok && last.value.lineCount).toBe(200);
      expect(last.ok && last.value.truncated).toBe(false);
      expect(last.ok && last.value.nextStartLine).toBeUndefined();
    });

    it("rejects an invalid range instead of silently clamping it", async () => {
      const fixture = await createFixture({ "Notes/a.md": lines(10) });

      const zero = await fixture.tools.read({ path: "Notes/a.md", startLine: 0 }, {});
      const tooMany = await fixture.tools.read(
        { path: "Notes/a.md", startLine: 1, lineCount: 401 },
        {}
      );

      expect(zero).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(tooMany).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    });

    it("blocks a read outside the approved scope or inside a protected root", async () => {
      const fixture = await createFixture({
        "Other/secret.md": lines(3),
        ".vault-agent/state.md": lines(3),
      });
      const protectedFixture = await createFixture(
        { ".vault-agent/state.md": lines(3) },
        { protectedRelativeRoots: [".vault-agent"] }
      );

      const outOfScope = await fixture.tools.read(
        { path: "Other/secret.md" },
        { isPathInScope: (relative) => relative.startsWith("Notes/") }
      );
      const protectedRead = await protectedFixture.tools.read(
        { path: ".vault-agent/state.md" },
        {}
      );

      expect(outOfScope).toMatchObject({ ok: false, code: "PATH_OUT_OF_SCOPE" });
      expect(protectedRead).toMatchObject({ ok: false, code: "PROTECTED_PATH" });
    });
  });

  describe("list()", () => {
    it("lists Markdown files sorted with a stable cursor and excludes protected/out-of-scope paths", async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-vault-list-"));
      tempDirectories.push(root);
      const vault = path.join(root, "vault");
      await fs.mkdir(vault, { recursive: true });
      const files = {
        "Notes/b.md": "b",
        "Notes/a.md": "a",
        "Other/c.md": "c",
        ".vault-agent/state.md": "s",
      };
      for (const [relative, content] of Object.entries(files)) {
        const target = path.join(vault, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
      }
      const tools = new VaultReadTools({
        vault: new FakeVault(files),
        linkCache: new MutableLinkCache(),
        pathResolver: new PathResolver({
          vaultRoot: vault,
          protectedRoots: [path.join(vault, ".vault-agent")],
          fileSystem: fs,
          path,
        }),
      });

      const page = await tools.list(
        { folder: "Notes", limit: 1 },
        { isPathInScope: (relative) => relative.startsWith("Notes/") }
      );
      const next = await tools.list(
        { folder: "Notes", limit: 1, cursor: page.ok ? page.value.nextCursor : undefined },
        { isPathInScope: (relative) => relative.startsWith("Notes/") }
      );

      expect(page.ok && page.value.files).toEqual([{ path: "Notes/a.md", size: 1 }]);
      expect(page.ok && page.value.total).toBe(2);
      expect(page.ok && page.value.truncated).toBe(true);
      expect(next.ok && next.value.files).toEqual([{ path: "Notes/b.md", size: 1 }]);
      expect(next.ok && next.value.truncated).toBe(false);
    });

    it("returns an empty result instead of an error when nothing matches", async () => {
      const fixture = await createFixture({ "Notes/a.md": "a" });

      const result = await fixture.tools.list({ folder: "Missing" }, {});

      expect(result).toMatchObject({ ok: true });
      if (result.ok) {
        expect(result.value.files).toEqual([]);
        expect(result.value.total).toBe(0);
        expect(result.value.truncated).toBe(false);
      }
    });
  });

  describe("links()", () => {
    it("uses the metadata cache only as link candidates", async () => {
      const fixture = await createFixture({ "Notes/a.md": "a", "Notes/b.md": "b" });
      fixture.cache.resolvedLinks = {
        "Notes/a.md": { "Notes/b.md": 1 },
        "Notes/b.md": { "Notes/a.md": 1 },
      };
      fixture.cache.unresolvedLinks = { "Notes/a.md": { Missing: 1 } };

      const result = await fixture.tools.links({ path: "Notes/a.md", direction: "both" }, {});

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.incoming).toEqual(["Notes/b.md"]);
      expect(result.value.outgoing).toEqual(["Notes/b.md"]);
      expect(result.value.unresolvedOutgoing).toEqual(["Missing"]);
      expect(result.value.cacheStale).toBe(false);
      expect(fixture.reads).toEqual([]);
    });

    it("does not fabricate links from a stale cache", async () => {
      const fixture = await createFixture({ "Notes/a.md": "a", "Notes/b.md": "b" });
      fixture.cache.resolvedLinks = { "Notes/a.md": { "Notes/b.md": 1 } };
      fixture.cache.stale = true;

      const result = await fixture.tools.links({ path: "Notes/a.md" }, {});

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.cacheStale).toBe(true);
      expect(result.value.incoming).toEqual([]);
      expect(result.value.outgoing).toEqual([]);
    });
  });

  describe("register()", () => {
    it("registers read-only vault tools for scoped fanout callers with closed schemas https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = await createFixture({ "Notes/a.md": "a" });
      const registry = new ToolRegistry();

      const gateway = new ToolGateway({ registry, policy: new PolicyEngine() });
      fixture.tools.register(registry, gateway);

      for (const toolId of ["vault_list", "vault_read", "vault_links"]) {
        const manifest = registry.requireManifest(toolId);
        expect(manifest.family).toBe("vault");
        expect(manifest.effects).toEqual(["read"]);
        expect(manifest.replayPolicy).toBe("read_only");
        expect(manifest.parameters.additionalProperties).toBe(false);
        const result = await gateway.executeTool(
          toolId,
          toolId === "vault_list" ? {} : { path: "Notes/a.md" },
          {
            caller: "fanout",
            mode: "plan",
            scope: { vaultRoot: fixture.vault, externalRoots: [], readOnly: true },
            scopeVersion: 1,
            policyVersion: 1,
            targets: [{ kind: "vault_path", value: "Notes/a.md", insideScope: true }],
          }
        );
        expect(result).toMatchObject({ decision: "allow" });
        if (result.decision === "allow")
          expect(JSON.parse(result.content)).toMatchObject({ ok: true });
      }
    });
  });
});
