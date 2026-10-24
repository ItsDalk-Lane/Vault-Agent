import {
  LEGACY_IMPORT_MAX_MATERIAL_BYTES,
  LegacyImport,
  renderMaterial,
  type LegacyImportMapping,
  type LegacyImportPorts,
} from "@/agentMode/sdk/pi/storage/LegacyImport";
import type { LegacyChatEntry } from "@/agentMode/session/legacy/LegacyHistoryReader";

// Importing a legacy chat creates a new Pi root with a sourceHash mapping, so a second click returns the
// existing mapping; the history lands as labelled material rather than a new user instruction, only the
// fields that exist are copied, missing tool results and attachments are never fabricated, the material
// budget is enforced, and the old file is only read:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeImportPorts implements LegacyImportPorts {
  readonly mappings = new Map<string, LegacyImportMapping>();
  readonly roots: Array<{
    title: string | null;
    backendId: string;
    sourcePath: string;
    projectId?: string;
  }> = [];
  readonly materials: Array<{
    sessionId: string;
    text: string;
    origin: string;
    importMode: string;
    truncated: boolean;
  }> = [];
  readonly savedMappings: LegacyImportMapping[] = [];
  readonly attachments = new Map<string, { mime: string; bytes: number }>();
  readonly fileWrites: string[] = [];
  readonly materialRequests = new Map<string, string>();
  nowMs = 1_700_000_000_000;
  private nextRoot = 1;

  findMapping = async (sourceHash: string): Promise<LegacyImportMapping | undefined> =>
    this.mappings.get(sourceHash);

  createRoot = async (input: {
    title: string | null;
    backendId: string;
    sourcePath: string;
    projectId?: string;
  }): Promise<{ rootId: string; sessionId: string }> => {
    this.roots.push({
      title: input.title,
      backendId: input.backendId,
      sourcePath: input.sourcePath,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    });
    const index = this.nextRoot++;
    return { rootId: `root-${index}`, sessionId: `session-${index}` };
  };

  saveMapping = async (mapping: LegacyImportMapping): Promise<void> => {
    this.savedMappings.push(mapping);
    this.mappings.set(mapping.sourceHash, mapping);
  };

  appendMaterial = async (input: {
    requestId: string;
    sessionId: string;
    text: string;
    origin: "legacy_session";
    importMode: "full" | "text_only";
    truncated: boolean;
  }): Promise<{ messageId: string }> => {
    const previous = this.materialRequests.get(input.requestId);
    if (previous) return { messageId: previous };
    this.materials.push({
      sessionId: input.sessionId,
      text: input.text,
      origin: input.origin,
      importMode: input.importMode,
      truncated: input.truncated,
    });
    const messageId = `message-${this.materials.length}`;
    this.materialRequests.set(input.requestId, messageId);
    return { messageId };
  };

  loadAttachment = async (ref: string): Promise<{ mime: string; bytes: number } | undefined> =>
    this.attachments.get(ref);

  now = (): number => this.nowMs;

  writeFile = async (path: string): Promise<void> => {
    this.fileWrites.push(path);
  };
}

function entry(overrides: Partial<LegacyChatEntry> = {}): LegacyChatEntry {
  return {
    backendId: "claude",
    sessionId: "legacy-1",
    title: "Old chat",
    createdAtMs: 1_700_000_000_000,
    lastAccessedAtMs: 1_700_000_000_000,
    sourcePath: "chats/legacy-1.md",
    sourceHash: "hash-legacy-1",
    messages: [
      { role: "user", text: "hello" },
      { role: "assistant", text: "hi there" },
    ],
    unknownFields: {},
    importMode: "text_only",
    notice: "Text-only import.",
    ...overrides,
  };
}

function harness(): { ports: FakeImportPorts; importer: LegacyImport } {
  const ports = new FakeImportPorts();
  return { ports, importer: new LegacyImport({ ports }) };
}

describe("LegacyImport", () => {
  describe("LegacyImport", () => {
    describe("importEntry()", () => {
      it("creates a new Pi root, records the sourceHash mapping and appends labelled material", async () => {
        const { ports, importer } = harness();

        const result = await importer.importEntry(entry());

        expect(result).toMatchObject({
          status: "created",
          rootId: "root-1",
          sessionId: "session-1",
          messageId: "message-1",
        });
        expect(ports.savedMappings).toEqual([
          {
            sourceHash: "hash-legacy-1",
            rootId: "root-1",
            sessionId: "session-1",
            importedAtMs: 1_700_000_000_000,
            status: "pending_material",
          },
          {
            sourceHash: "hash-legacy-1",
            rootId: "root-1",
            sessionId: "session-1",
            importedAtMs: 1_700_000_000_000,
            status: "completed",
            messageId: "message-1",
          },
        ]);
        expect(ports.materials[0]).toMatchObject({
          sessionId: "session-1",
          origin: "legacy_session",
          importMode: "text_only",
        });
        expect(ports.materials[0]?.text).toContain("[Imported legacy chat: backend=claude");
        expect(ports.materials[0]?.text).toContain("not a new user instruction");
        expect(ports.materials[0]?.text).toContain("**user**: hello");
        expect(ports.fileWrites).toEqual([]);
        expect(ports.roots[0]).toMatchObject({
          backendId: "claude",
          sourcePath: "chats/legacy-1.md",
        });
      });

      it("returns the existing mapping on a repeated import instead of building a second session", async () => {
        const { ports, importer } = harness();
        const first = await importer.importEntry(entry());

        const second = await importer.importEntry(entry());

        expect(second).toMatchObject({
          status: "already_imported",
          rootId: first.rootId,
          sessionId: first.sessionId,
        });
        expect(ports.roots).toHaveLength(1);
        expect(ports.materials).toHaveLength(1);
        expect(importer.mappingFor("hash-legacy-1")?.sessionId).toBe("session-1");
      });

      it("repairs a mapped import whose material write failed before restarting without creating another root https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { ports, importer } = harness();
        const append = ports.appendMaterial;
        jest
          .spyOn(ports, "appendMaterial")
          .mockRejectedValueOnce(new Error("storage unavailable"))
          .mockImplementation(append);
        await expect(importer.importEntry(entry())).rejects.toThrow("storage unavailable");
        const restarted = new LegacyImport({ ports });
        await restarted.importEntry(entry());
        expect(ports.roots).toHaveLength(1);
        expect(ports.materials).toHaveLength(1);
        expect(ports.materials[0]?.text).toContain("**user**: hello");
      });

      it("reuses the stable material request after its write succeeded but the completed mapping failed https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { ports, importer } = harness();
        const save = ports.saveMapping;
        let fail = true;
        jest.spyOn(ports, "saveMapping").mockImplementation(async (mapping) => {
          if (mapping.status === "completed" && fail) {
            fail = false;
            throw new Error("mapping write failed");
          }
          await save(mapping);
        });
        await expect(importer.importEntry(entry())).rejects.toThrow("mapping write failed");
        await new LegacyImport({ ports }).importEntry(entry());
        expect(ports.roots).toHaveLength(1);
        expect(ports.materials).toHaveLength(1);
        expect(ports.mappings.get("hash-legacy-1")).toMatchObject({
          status: "completed",
          messageId: "message-1",
        });
      });

      it("shares one in-flight import when the same source is selected concurrently https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { ports, importer } = harness();
        const results = await Promise.all([
          importer.importEntry(entry()),
          importer.importEntry(entry()),
        ]);
        expect(results.map((result) => result.status)).toEqual(["created", "already_imported"]);
        expect(ports.roots).toHaveLength(1);
        expect(ports.materials).toHaveLength(1);
      });

      it("reuses a mapping persisted by an earlier run", async () => {
        const { ports, importer } = harness();
        ports.mappings.set("hash-legacy-1", {
          sourceHash: "hash-legacy-1",
          rootId: "root-existing",
          sessionId: "session-existing",
          importedAtMs: 1,
        });

        const result = await importer.importEntry(entry());

        expect(result).toMatchObject({ status: "already_imported", sessionId: "session-existing" });
        expect(ports.roots).toEqual([]);
      });

      it("carries a projectId only when the legacy chat really had one", async () => {
        const { ports, importer } = harness();

        await importer.importEntry(entry({ projectId: "project-a" }));
        await importer.importEntry(
          entry({ sourceHash: "hash-2", sessionId: "legacy-2", projectId: undefined })
        );

        expect(ports.roots[0]?.projectId).toBe("project-a");
        expect(ports.roots[1]).not.toHaveProperty("projectId");
      });

      it("keeps only the fields that exist and never invents tool results", async () => {
        const { ports, importer } = harness();
        const bare = entry({
          title: null,
          projectId: undefined,
          messages: [{ role: "assistant", text: "only visible text" }],
          importMode: "text_only",
        });

        const result = await importer.importEntry(bare);

        expect(ports.roots[0]?.title).toBeNull();
        const text = ports.materials[0]?.text ?? "";
        expect(text).toContain("only visible text");
        expect(text).not.toContain("Title:");
        expect(text.toLowerCase()).not.toContain("tool");
        expect(result.notices.join(" ")).toContain("tool history is unavailable");
      });

      it("reports a missing attachment instead of fabricating it", async () => {
        const { ports, importer } = harness();
        ports.attachments.set("attachments/present.png", { mime: "image/png", bytes: 12 });

        const result = await importer.importEntry(entry(), {
          attachments: [{ ref: "attachments/present.png" }, { ref: "attachments/gone.png" }],
        });

        const text = ports.materials[0]?.text ?? "";
        expect(text).toContain("[attachment: attachments/present.png (image/png, 12 bytes)]");
        expect(text).toContain("[missing attachment: attachments/gone.png]");
        expect(result.notices.join(" ")).toContain('"attachments/gone.png" is missing');
      });

      it("enforces the material budget and points at the original file", async () => {
        const { ports, importer } = harness();
        const long = entry({
          messages: [{ role: "user", text: "x".repeat(LEGACY_IMPORT_MAX_MATERIAL_BYTES + 10) }],
        });

        const result = await importer.importEntry(long);

        expect(result.truncated).toBe(true);
        expect(result.materialBytes).toBeLessThanOrEqual(LEGACY_IMPORT_MAX_MATERIAL_BYTES);
        expect(result.notices.join(" ")).toContain("read the original at chats/legacy-1.md");
        expect(ports.materials[0]?.truncated).toBe(true);
      });

      it("keeps a second, different legacy chat runnable beside the first import", async () => {
        const { ports, importer } = harness();
        const first = await importer.importEntry(entry());
        const second = await importer.importEntry(
          entry({
            sessionId: "legacy-2",
            sourcePath: "chats/legacy-2.md",
            sourceHash: "hash-legacy-2",
            title: "Another chat",
          })
        );

        expect(second.sessionId).not.toBe(first.sessionId);
        expect(ports.roots.map((root) => root.title)).toEqual(["Old chat", "Another chat"]);
        expect(ports.materials.map((material) => material.sessionId)).toEqual([
          first.sessionId,
          second.sessionId,
        ]);
        expect(importer.mappingFor("hash-legacy-1")?.rootId).toBe(first.rootId);
        expect(importer.mappingFor("hash-legacy-2")?.rootId).toBe(second.rootId);
      });
    });
  });

  describe("renderMaterial()", () => {
    it("labels the imported history as material from an earlier chat", () => {
      const text = renderMaterial(entry({ messages: [{ role: "user", text: "hi" }] }));

      expect(text.split("\n")[0]).toBe(
        "[Imported legacy chat: backend=claude, source=chats/legacy-1.md, hash=hash-legacy-1]"
      );
      expect(text).toContain("not a new user instruction");
      expect(text).toContain("**user**: hi");
    });
  });
});
