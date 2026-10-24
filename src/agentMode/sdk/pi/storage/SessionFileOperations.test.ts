import { requireNodeModule } from "@/utils/desktopRuntime";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { SessionFileOperations } from "@/agentMode/sdk/pi/storage/SessionFileOperations";
import { StoreLocator } from "@/agentMode/sdk/pi/storage/StoreLocator";
import { StoreLease } from "@/agentMode/sdk/pi/storage/StoreLease";

describe("SessionFileOperations", () => {
  describe("SessionFileOperations", () => {
    let directory: string;
    let locator: StoreLocator;
    let files: SessionFileOperations;
    const seed = async (id = "root-source") => {
      const root = locator.sessionStorePaths(id).storeDir;
      await fs.mkdir(path.join(root, "attachments"), { recursive: true });
      await fs.mkdir(path.join(root, "mutations", "blobs"), { recursive: true });
      await fs.writeFile(
        path.join(root, "session.json"),
        JSON.stringify({ sessionId: id, title: "Source" })
      );
      await fs.writeFile(path.join(root, "main.jsonl"), "transcript\n");
      await fs.writeFile(path.join(root, "doc-1.jsonl"), "sidecar\n");
      await fs.writeFile(path.join(root, "attachments", "photo"), "image");
      await fs.writeFile(path.join(root, "mutations", "blobs", "before"), "original note");
      return root;
    };

    beforeEach(async () => {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "vault-agent-local-sessions-"));
      locator = new StoreLocator({
        platform: process.platform,
        homeDir: directory,
        vaultRoot: path.join(directory, "notes"),
        vaultId: "fixture",
        sha256: (value) => createHash("sha256").update(value).digest("hex"),
      });
      files = new SessionFileOperations(locator);
      await files.initialize();
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await fs.rm(directory, { recursive: true, force: true });
    });

    describe("initialize()", () => {
      it("creates only the new versioned storage directories https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        await files.initialize();
        expect(files.paths.dataRoot).toBe(path.join(directory, ".vault-agent", "v2"));
        expect(await fs.readdir(files.paths.vaultStoreRoot)).toEqual([
          "deletions",
          "locks",
          "sessions",
        ]);
      });
    });

    describe("rootIds()", () => {
      it("lists root records without publishing unfinished forks or child sidecars https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        await seed();
        await fs.mkdir(path.join(files.paths.sessionsRoot, ".fork-root-next"));
        expect(await files.rootIds()).toEqual(["root-source"]);
      });
    });

    describe("ownerId()", () => {
      it("locates child metadata inside its owning root https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const source = await seed();
        const child = path.join(source, "children", "root-child");
        await fs.mkdir(child, { recursive: true });
        await fs.writeFile(path.join(child, "session.json"), "{}");
        expect(await files.ownerId("root-source")).toBe("root-source");
        expect(await files.ownerId("root-child")).toBe("root-source");
        expect(await files.ownerId("root-missing")).toBe("root-missing");
      });
    });

    describe("withLease()", () => {
      it("releases the external lease when an operation fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        await expect(
          files.withLease("root-source", async () => {
            throw new Error("failed operation");
          })
        ).rejects.toThrow("failed operation");
        await expect(
          fs.access(locator.sessionStorePaths("root-source").leaseDir)
        ).rejects.toMatchObject({ code: "ENOENT" });
      });
    });

    describe("remove()", () => {
      it("permanently removes transcript, sidecars, attachments and backups and supports repeated deletion https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const source = await seed();
        await files.remove("root-source");
        await files.remove("root-source");
        await expect(fs.access(source)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await fs.readdir(files.paths.deletionsRoot)).toEqual([]);
        expect(await files.rootIds()).toEqual([]);
      });

      it("leaves a session untouched while another writer owns its lease https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const source = await seed();
        const paths = locator.sessionStorePaths("root-source");
        const lease = new StoreLease({ leaseDir: paths.leaseDir, storePath: paths.storeDir });
        const held = await lease.acquire();
        expect(held.kind).toBe("acquired");
        try {
          await expect(files.remove("root-source")).rejects.toMatchObject({ code: "STORE_BUSY" });
          expect(await fs.readFile(path.join(source, "main.jsonl"), "utf8")).toBe("transcript\n");
        } finally {
          if (held.kind === "acquired") await lease.release(held.token);
        }
      });
    });

    describe("finishPendingDeletes()", () => {
      it("keeps partial deletions unavailable and finishes them on the next cleanup https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const source = await seed();
        const remove = fs.rm.bind(fs);
        const pending = path.join(files.paths.deletionsRoot, "root-source");
        const failing = jest
          .spyOn(requireNodeModule<typeof fs>("node:fs/promises"), "rm")
          .mockImplementation(async (file, options) => {
            if (file === pending) {
              await remove(path.join(pending, "main.jsonl"));
              throw Object.assign(new Error("locked attachment"), { code: "EACCES" });
            }
            return remove(file, options);
          });
        await expect(files.remove("root-source")).rejects.toMatchObject({
          code: "SESSION_DELETE_INCOMPLETE",
        });
        await expect(fs.access(source)).rejects.toMatchObject({ code: "ENOENT" });
        expect(await fs.readFile(path.join(pending, "attachments", "photo"), "utf8")).toBe("image");
        failing.mockRestore();
        await files.finishPendingDeletes();
        expect(await fs.readdir(files.paths.deletionsRoot)).toEqual([]);
      });
    });

    describe("fork()", () => {
      it("publishes a complete independent copy with new child identities that survives deleting the original https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const source = await seed();
        const child = path.join(source, "children", "root-child");
        await fs.mkdir(child, { recursive: true });
        await fs.writeFile(
          path.join(child, "session.json"),
          JSON.stringify({
            sessionId: "root-child",
            parentSessionId: "root-source",
            conversationId: "7",
          })
        );
        await fs.writeFile(path.join(source, "recovery-view.json"), "stale view");
        await files.fork(
          "root-source",
          "root-copy",
          JSON.stringify({ sessionId: "root-copy", title: "Copy" })
        );
        const copy = locator.sessionStorePaths("root-copy").storeDir;
        const [childId] = await fs.readdir(path.join(copy, "children"));
        expect(childId).not.toBe("root-child");
        expect(
          JSON.parse(
            await fs.readFile(path.join(copy, "children", childId, "session.json"), "utf8")
          )
        ).toMatchObject({ sessionId: childId, parentSessionId: "root-copy", conversationId: "7" });
        const copyMetadata = JSON.parse(
          await fs.readFile(path.join(copy, "session.json"), "utf8")
        ) as { forkChildSessionIds: Record<string, string> };
        expect(copyMetadata.forkChildSessionIds["root-child"]).toBe(childId);
        await files.fork(
          "root-copy",
          "root-again",
          JSON.stringify({ ...copyMetadata, sessionId: "root-again" })
        );
        const again = locator.sessionStorePaths("root-again").storeDir;
        const [nextChildId] = await fs.readdir(path.join(again, "children"));
        expect(
          JSON.parse(await fs.readFile(path.join(again, "session.json"), "utf8"))
        ).toMatchObject({
          forkChildSessionIds: { "root-child": nextChildId, [childId]: nextChildId },
        });
        await files.remove("root-source");
        expect(await fs.readFile(path.join(copy, "main.jsonl"), "utf8")).toBe("transcript\n");
        expect(await fs.readFile(path.join(copy, "doc-1.jsonl"), "utf8")).toBe("sidecar\n");
        expect(await fs.readFile(path.join(copy, "attachments", "photo"), "utf8")).toBe("image");
        expect(await fs.readFile(path.join(copy, "mutations", "blobs", "before"), "utf8")).toBe(
          "original note"
        );
        await expect(fs.access(path.join(copy, "recovery-view.json"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      });
    });
  });
});
