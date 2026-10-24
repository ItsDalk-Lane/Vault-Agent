import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectLocalData,
  measureLocalFiles,
  describeLocalKeychainEntries,
} from "@/services/localDataStatus";

describe("localDataStatus", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "va-data-status-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  describe("measureLocalFiles()", () => {
    it("counts file content bytes recursively and ignores symbolic links and missing files https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      await writeFile(join(root, "one"), "abc");
      await symlink(join(root, "one"), join(root, "alias"));
      expect(await measureLocalFiles(root)).toBe(3);
      expect(await measureLocalFiles(join(root, "missing"))).toBe(0);
    });
  });
  describe("describeLocalKeychainEntries()", () => {
    it("groups current-vault credentials and referenced MCP tokens without reading values, labelling entries from the current configuration https://github.com/ItsDalk-Lane/Vault-Agent/issues/8", () => {
      const groups = describeLocalKeychainEntries(
        [
          "copilot-vhere-provider-lm-studio-api-key",
          "copilot-vhere-model-api-key-chat-model",
          "copilot-vhere-pi-credential-provider-abcd",
          "copilot-vhere-pi-credential-index",
          "copilot-vhere-secret-meta",
          "copilot-vhere-other",
          "mcp:docs:token",
          "mcp:unused:token",
          "mcp:local:env",
          "mcp-oauth-here:docs:hash",
          "copilot-velse-provider-openai-api-key",
          "mcp-oauth-else:docs:hash",
          "another-plugin-token",
        ],
        "here",
        [
          {
            apiKeyKeychainId: "copilot-vhere-provider-lm-studio-api-key",
            displayName: "LM Studio",
          },
        ],
        [
          {
            displayName: "Docs server",
            transport: { kind: "http", headerSecretRefs: { Authorization: "mcp:docs:token" } },
          },
          {
            displayName: "Env server",
            transport: { kind: "stdio", envSecretRefs: { TOKEN: "mcp:local:env" } },
          },
          null,
          { transport: null },
          { transport: { headerSecretRefs: { invalid: 123 } } },
        ]
      );
      expect(groups.providers.map((entry) => [entry.id, entry.label])).toEqual([
        ["copilot-vhere-provider-lm-studio-api-key", "LM Studio"],
        ["copilot-vhere-model-api-key-chat-model", undefined],
        ["copilot-vhere-pi-credential-provider-abcd", undefined],
      ]);
      expect(groups.mcp.map((entry) => [entry.id, entry.label])).toEqual([
        ["mcp:docs:token", "Docs server · Authorization"],
        ["mcp:local:env", "Env server · TOKEN"],
        ["mcp-oauth-here:docs:hash", undefined],
      ]);
      expect(groups.other.map((entry) => entry.id)).toEqual([
        "copilot-vhere-other",
        "copilot-vhere-pi-credential-index",
      ]);
      expect(groups.other[0].label).toBeUndefined();
    });
    it("attaches stored times from the secret registry and returns empty groups for an empty keychain https://github.com/ItsDalk-Lane/Vault-Agent/issues/8", () => {
      const groups = describeLocalKeychainEntries(
        ["copilot-vhere-provider-openai-api-key"],
        "here",
        [],
        [],
        { "copilot-vhere-provider-openai-api-key": { createdAt: 1000, updatedAt: 2000 } }
      );
      expect(groups.providers).toEqual([
        {
          id: "copilot-vhere-provider-openai-api-key",
          label: undefined,
          createdAt: 1000,
          updatedAt: 2000,
        },
      ]);
      expect(describeLocalKeychainEntries([], "here")).toEqual({
        providers: [],
        mcp: [],
        other: [],
      });
    });
  });
  describe("collectLocalData()", () => {
    it.each(["vaults", "vault"])(
      "does not traverse a linked %s ancestor while reading current-vault records or indexes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (linkedParent) => {
        const dataRoot = join(root, "v2");
        const vaultsRoot = join(dataRoot, "vaults");
        const vaultRoot = join(vaultsRoot, "current");
        const outside = join(root, "outside");
        const privateVault = linkedParent === "vaults" ? join(outside, "current") : outside;
        await mkdir(join(privateVault, "sessions/root-private"), { recursive: true });
        await writeFile(
          join(privateVault, "sessions/root-private/session.json"),
          "PRIVATE NOT JSON"
        );
        await writeFile(join(privateVault, "agent-chat-index.json"), "PRIVATE NOT JSON");
        await mkdir(linkedParent === "vaults" ? dataRoot : vaultsRoot, { recursive: true });
        await symlink(outside, linkedParent === "vaults" ? vaultsRoot : vaultRoot);
        const paths = {
          dataRoot,
          sessionsRoot: join(vaultRoot, "sessions"),
          indexPath: join(vaultRoot, "agent-chat-index.json"),
          deletionsRoot: join(vaultRoot, "deletions"),
          logsRoot: join(dataRoot, "logs/current"),
          tempRoot: join(dataRoot, "tmp"),
        };
        expect(await collectLocalData(paths, join(root, "data.json"))).toMatchObject({
          totalBytes: 0,
          totalSessionCount: 0,
          sessions: [],
          indexCount: 0,
          indexBytes: 0,
        });
      }
    );

    it("counts current records across vaults without following vault, session-folder or session links https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const dataRoot = join(root, "v2");
      const vaultsRoot = join(dataRoot, "vaults");
      const sessionsRoot = join(vaultsRoot, "current/sessions");
      const paths = {
        dataRoot,
        sessionsRoot,
        indexPath: join(vaultsRoot, "current/agent-chat-index.json"),
        deletionsRoot: join(vaultsRoot, "current/deletions"),
        logsRoot: join(dataRoot, "logs/current"),
        tempRoot: join(dataRoot, "tmp"),
      };
      for (const [vault, id] of [
        ["current", "root-one"],
        ["current", "root-two"],
        ["other", "root-three"],
      ]) {
        const session = join(vaultsRoot, vault, "sessions", id);
        await mkdir(session, { recursive: true });
        await writeFile(join(session, "session.json"), JSON.stringify({ title: id }));
      }
      const outside = join(root, "outside");
      await mkdir(join(outside, "sessions/root-external"), { recursive: true });
      await writeFile(join(outside, "sessions/root-external/session.json"), "{}");
      await symlink(outside, join(vaultsRoot, "linked-vault"));
      await mkdir(join(vaultsRoot, "linked-sessions"));
      await symlink(join(outside, "sessions"), join(vaultsRoot, "linked-sessions/sessions"));
      await symlink(join(outside, "sessions/root-external"), join(sessionsRoot, "root-linked"));
      await mkdir(join(sessionsRoot, "root-unfinished"));
      const current = await collectLocalData(paths, join(root, "data.json"));
      expect(current).toMatchObject({ totalSessionCount: 3 });
      expect(current.sessions.map((session) => session.id)).toEqual(["root-one", "root-two"]);
      await rm(join(sessionsRoot, "root-one"), { recursive: true });
      const afterDelete = await collectLocalData(paths, join(root, "data.json"));
      expect(afterDelete).toMatchObject({ totalSessionCount: 2 });
      expect(afterDelete.sessions.map((session) => session.id)).toEqual(["root-two"]);
    });

    it("does not read linked metadata or linked and out-of-root indexes even when they contain invalid private data https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const dataRoot = join(root, "v2");
      const vaultRoot = join(dataRoot, "vaults/current");
      const sessionsRoot = join(vaultRoot, "sessions");
      const paths = {
        dataRoot,
        sessionsRoot,
        indexPath: join(vaultRoot, "agent-chat-index.json"),
        deletionsRoot: join(vaultRoot, "deletions"),
        logsRoot: join(dataRoot, "logs/current"),
        tempRoot: join(dataRoot, "tmp"),
      };
      await mkdir(join(sessionsRoot, "root-linked"), { recursive: true });
      const outside = join(root, "private.json");
      await writeFile(outside, "PRIVATE DATA THAT IS NOT JSON");
      await symlink(outside, join(sessionsRoot, "root-linked/session.json"));
      await symlink(outside, paths.indexPath);
      expect(await collectLocalData(paths, join(root, "data.json"))).toMatchObject({
        totalBytes: 0,
        totalSessionCount: 0,
        sessions: [],
        indexBytes: 0,
        indexCount: 0,
      });
      expect(
        await collectLocalData({ ...paths, indexPath: outside }, join(root, "data.json"))
      ).toMatchObject({ indexBytes: 0, indexCount: 0 });
    });

    it("reports empty new storage without creating any folders https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const paths = {
        dataRoot: join(root, "new"),
        sessionsRoot: join(root, "new/sessions"),
        indexPath: join(root, "new/index.json"),
        deletionsRoot: join(root, "new/deletions"),
        logsRoot: join(root, "new/logs"),
        tempRoot: join(root, "new/temp"),
      };
      expect(await collectLocalData(paths, join(root, "data.json"))).toEqual({
        totalBytes: 0,
        totalSessionCount: 0,
        sessions: [],
        indexBytes: 0,
        indexCount: 0,
        settingsBytes: 0,
        logsBytes: 0,
        tempBytes: 0,
        pendingBytes: 0,
        legacyPaths: [],
      });
    });
    it("lists sibling legacy data folders but never measures them or follows links into them https://github.com/ItsDalk-Lane/Vault-Agent/issues/8", async () => {
      const dataRoot = join(root, "v2");
      await mkdir(dataRoot, { recursive: true });
      await mkdir(join(root, "vaults"), { recursive: true });
      await mkdir(join(root, ".hidden"));
      await writeFile(join(root, "vaults/old-store"), "LEGACY DATA");
      await symlink(join(root, "vaults"), join(root, "linked-vaults"));
      const data = await collectLocalData(
        {
          dataRoot,
          sessionsRoot: join(dataRoot, "sessions"),
          indexPath: join(dataRoot, "index.json"),
          deletionsRoot: join(dataRoot, "deletions"),
          logsRoot: join(dataRoot, "logs"),
          tempRoot: join(dataRoot, "tmp"),
        },
        join(root, "data.json")
      );
      expect(data.legacyPaths).toEqual([{ name: "vaults", path: join(root, "vaults") }]);
      expect(data.totalBytes).toBe(0);
    });
    it("classifies session content into conversation, recovery, metadata, subtask, attachment and backup groups https://github.com/ItsDalk-Lane/Vault-Agent/issues/8", async () => {
      const sessionsRoot = join(root, "sessions");
      const session = join(sessionsRoot, "root-test");
      const child = join(session, "children", "root-child");
      await mkdir(join(session, "attachments"), { recursive: true });
      await mkdir(join(session, "mutations", "blobs"), { recursive: true });
      await mkdir(child, { recursive: true });
      const sessionMeta = JSON.stringify({ title: "我的聊天" });
      await writeFile(join(session, "session.json"), sessionMeta);
      await writeFile(join(session, "meta.json"), "m");
      await writeFile(join(session, "main.jsonl"), "abc");
      await writeFile(join(session, "doc-1.jsonl"), "xy");
      await writeFile(join(session, "recovery-view.json"), "r");
      await writeFile(join(session, "attachments", "picture"), "12");
      await writeFile(join(session, "mutations", "blobs", "backup"), "b");
      await writeFile(join(child, "main.jsonl"), "c");
      await writeFile(join(child, "session.json"), "s");
      const paths = {
        dataRoot: root,
        sessionsRoot,
        indexPath: join(root, "index.json"),
        deletionsRoot: join(root, "deletions"),
        logsRoot: join(root, "logs"),
        tempRoot: join(root, "temp"),
      };
      const data = await collectLocalData(paths, join(root, "data.json"));
      expect(data.sessions).toEqual([
        {
          id: "root-test",
          title: "我的聊天",
          path: session,
          bytes: Buffer.byteLength(sessionMeta) + 1 + 3 + 2 + 1 + 2 + 1 + 1 + 1,
          attachments: 2,
          backups: 1,
          transcripts: 5,
          recovery: 1,
          metadata: Buffer.byteLength(sessionMeta) + 1 + 1,
          children: 1,
          docFileCount: 1,
        },
      ]);
    });
    it("ignores old names, symlinks and unfinished records while preserving their actual root size https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const paths = {
        dataRoot: root,
        sessionsRoot: join(root, "sessions"),
        indexPath: join(root, "index.json"),
        deletionsRoot: join(root, "deletions"),
        logsRoot: join(root, "logs"),
        tempRoot: join(root, "temp"),
      };
      await mkdir(join(paths.sessionsRoot, "old-chat"), { recursive: true });
      await writeFile(join(paths.sessionsRoot, "old-chat/session.json"), "not a new session");
      await mkdir(join(paths.sessionsRoot, "root-incomplete"));
      await symlink(join(paths.sessionsRoot, "old-chat"), join(paths.sessionsRoot, "root-link"));
      const data = await collectLocalData(paths, join(root, "data.json"));
      expect(data.sessions).toEqual([]);
      expect(data.totalBytes).toBe(Buffer.byteLength("not a new session"));
    });
    it("reports a corrupt current index as an error rather than inventing an entry count https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const paths = {
        dataRoot: root,
        sessionsRoot: join(root, "sessions"),
        indexPath: join(root, "index.json"),
        deletionsRoot: join(root, "deletions"),
        logsRoot: join(root, "logs"),
        tempRoot: join(root, "temp"),
      };
      await writeFile(paths.indexPath, "{");
      await expect(collectLocalData(paths, join(root, "data.json"))).rejects.toThrow(SyntaxError);
    });
    it("reports exact session and child sidecar sizes and excludes a deleted session on the next calculation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const sessionsRoot = join(root, "sessions");
      const session = join(sessionsRoot, "root-test");
      await mkdir(join(session, "attachments"), { recursive: true });
      await mkdir(join(session, "mutations", "blobs"), { recursive: true });
      await writeFile(join(session, "session.json"), JSON.stringify({ title: "我的聊天" }));
      await writeFile(join(session, "attachments", "picture"), "12345");
      await writeFile(join(session, "mutations", "blobs", "backup"), "abc");
      const child = join(session, "children", "root-child");
      await mkdir(join(child, "attachments"), { recursive: true });
      await mkdir(join(child, "mutations", "blobs"), { recursive: true });
      await writeFile(join(child, "attachments", "picture"), "xy");
      await writeFile(join(child, "mutations", "blobs", "backup"), "z");
      const paths = {
        dataRoot: root,
        sessionsRoot,
        indexPath: join(root, "index.json"),
        deletionsRoot: join(root, "deletions"),
        logsRoot: join(root, "logs"),
        tempRoot: join(root, "temp"),
      };
      await writeFile(paths.indexPath, JSON.stringify({ entries: [{ sessionId: "root-test" }] }));
      const data = await collectLocalData(paths, join(root, "data.json"));
      expect(data.sessions).toEqual([
        expect.objectContaining({ title: "我的聊天", attachments: 7, backups: 4 }),
      ]);
      expect(data.indexCount).toBe(1);
      expect(data.sessions[0].bytes).toBe(
        Buffer.byteLength(JSON.stringify({ title: "我的聊天" })) + 11
      );
      expect(data.indexBytes).toBe(
        Buffer.byteLength(JSON.stringify({ entries: [{ sessionId: "root-test" }] }))
      );
      expect(data.totalBytes).toBe(data.sessions[0].bytes + data.indexBytes);
      await rm(session, { recursive: true });
      expect((await collectLocalData(paths, join(root, "data.json"))).sessions).toEqual([]);
    });
  });
});
