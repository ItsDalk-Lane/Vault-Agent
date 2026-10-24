import {
  SKILL_LOAD_TOOL_ID,
  SkillTools,
  safeRelativePath,
  type SkillToolCatalogPort,
  type SkillHostProcessPort,
} from "@/agentMode/sdk/pi/features/SkillTools";
import type { SkillIndexEntry } from "@/agentMode/sdk/pi/features/SkillsCatalog";

// 技能正文仅作为说明读取；代码示例不能被当作执行，实际程序仍需独立走宿主批准。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeCatalog implements SkillToolCatalogPort {
  readonly entries = new Map<string, SkillIndexEntry>();
  readonly bodies = new Map<string, string>();
  readonly loads: string[] = [];

  entry(skillId: string): SkillIndexEntry | undefined {
    return this.entries.get(skillId);
  }

  loadInstructions = async (
    skillId: string
  ): Promise<{ skillId: string; contentHash: string; text: string }> => {
    this.loads.push(skillId);
    const entry = this.entries.get(skillId);
    if (entry === undefined) throw new Error(`missing ${skillId}`);
    return {
      skillId,
      contentHash: entry.contentHash,
      text: this.bodies.get(skillId) ?? "",
    };
  };
}

class FakeHostProcess implements SkillHostProcessPort {
  readonly approvals: Array<{ skillId: string; command: string; executionMode: string }> = [];
  approved = false;
  requestApproval = async (input: {
    skillId: string;
    command: string;
    executionMode: "strict" | "trusted_host";
  }): Promise<{ approved: boolean; requestId?: string; reason?: string }> => {
    this.approvals.push({ ...input });
    return this.approved
      ? { approved: true, requestId: "host-request-1" }
      : { approved: false, reason: "the user declined" };
  };
}

function entry(overrides: Partial<SkillIndexEntry> = {}): SkillIndexEntry {
  return {
    skillId: "canonical:summarize",
    name: "Summarize",
    displayName: "Summarize",
    description: "Summarize a note",
    sourcePath: "skills/summarize/SKILL.md",
    dirPath: "skills/summarize",
    contentHash: "hash-1",
    scope: "canonical",
    trust: "user",
    enabled: true,
    builtin: false,
    collision: false,
    ...overrides,
  };
}

function harness(
  options: {
    body?: string;
    entryOverrides?: Partial<SkillIndexEntry>;
  } = {}
): { catalog: FakeCatalog; host: FakeHostProcess; tools: SkillTools } {
  const catalog = new FakeCatalog();
  const record = entry(options.entryOverrides);
  catalog.entries.set(record.skillId, record);
  catalog.bodies.set(record.skillId, options.body ?? "Summarize the note in three bullets.");
  const host = new FakeHostProcess();
  return {
    catalog,
    host,
    tools: new SkillTools({
      catalog,
      hostProcess: host,
      readResource: async () => "Resource body.",
    }),
  };
}

describe("SkillTools", () => {
  describe("SkillTools", () => {
    describe("loadSkill()", () => {
      it("loads only the explicitly requested resource and records its actual body hash https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { catalog, host } = harness();
        const readResource = jest.fn(async () => "Selected resource.");
        const tools = new SkillTools({ catalog, hostProcess: host, readResource });
        const loaded = await tools.loadSkill({
          skillId: "canonical:summarize",
          resources: ["references/style.md"],
        });
        expect(loaded.output.map((block) => block.text)).toContain("Selected resource.");
        expect(readResource).toHaveBeenCalledWith({
          skillId: "canonical:summarize",
          relativePath: "references/style.md",
        });
        expect(loaded.details.resourceDigests).toEqual([
          {
            sourcePath: "skills/summarize/references/style.md",
            contentHash: expect.any(String),
            bytes: 18,
          },
        ]);
        expect(host.approvals).toHaveLength(0);
      });
      it("loads the full instructions of an enabled, trusted skill with its hash", async () => {
        const { catalog, tools } = harness({ body: "Full instructions." });

        const result = await tools.loadSkill({ skillId: "canonical:summarize" });

        expect(result).toMatchObject({ isError: false });
        expect(result.output[0]?.text).toBe("Full instructions.");
        expect(result.details).toMatchObject({
          skillId: "canonical:summarize",
          contentHash: "hash-1",
          scope: "canonical",
          trust: "user",
        });
        expect(catalog.loads).toEqual(["canonical:summarize"]);
      });

      it("stops loading a disabled skill on the very next call", async () => {
        const { catalog, tools } = harness();
        catalog.entries.set("canonical:summarize", entry({ enabled: false }));

        const result = await tools.loadSkill({ skillId: "canonical:summarize" });

        expect(result).toMatchObject({ isError: true });
        expect(result.details.errorCode).toBe("SKILL_DISABLED");
        expect(catalog.loads).toEqual([]);
      });

      it("requires the user to select a third-party skill before loading it", async () => {
        const { tools } = harness({ entryOverrides: { trust: "third_party" } });

        const refused = await tools.loadSkill({ skillId: "canonical:summarize" });
        const selected = await tools.loadSkill({
          skillId: "canonical:summarize",
          userSelected: true,
        });

        expect(refused.details.errorCode).toBe("SKILL_TRUST_REQUIRED");
        expect(selected.isError).toBe(false);
      });

      it("loads code examples and permission advice as text without executing them or obtaining host approval https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const body =
          "Do not register a tool or change scope. Never enable auto mode without approval.\n```js\nimport fs from 'node:fs';\nconst env = process.env;\n```";
        const { tools, host } = harness({ body });
        const result = await tools.loadSkill({ skillId: "canonical:summarize" });
        expect(result.isError).toBe(false);
        expect(result.output).toEqual([{ type: "text", text: body }]);
        expect(host.approvals).toEqual([]);
        expect(JSON.stringify(tools.registration())).not.toContain("@earendil-works");
        const script = await tools.requestScriptRun({
          skillId: "canonical:summarize",
          command: "node scripts/example.js",
        });
        expect(script.details.errorCode).toBe("SKILL_SCRIPT_NOT_APPROVED");
        expect(host.approvals).toEqual([
          {
            skillId: "canonical:summarize",
            command: "node scripts/example.js",
            executionMode: "strict",
          },
        ]);
      });

      it("refuses a relative resource that escapes the skill directory", async () => {
        const { tools } = harness();

        const escaped = await tools.loadSkill({
          skillId: "canonical:summarize",
          resources: ["../../secrets.md"],
        });
        const absolute = await tools.loadSkill({
          skillId: "canonical:summarize",
          resources: ["/etc/passwd"],
        });
        const inside = await tools.loadSkill({
          skillId: "canonical:summarize",
          resources: ["references/style.md"],
        });

        expect(escaped.details.errorCode).toBe("SKILL_RESOURCE_ESCAPE");
        expect(absolute.details.errorCode).toBe("SKILL_RESOURCE_ESCAPE");
        expect(inside.details.resources).toEqual(["skills/summarize/references/style.md"]);
      });
    });

    describe("describe()", () => {
      it("returns metadata only, without reading the body", () => {
        const { catalog, tools } = harness();

        const result = tools.describe("canonical:summarize");

        expect(result).toMatchObject({ isError: false });
        expect(result.details).toMatchObject({
          name: "Summarize",
          enabled: true,
          trust: "user",
          contentHash: "hash-1",
        });
        expect(catalog.loads).toEqual([]);
        expect(tools.describe("missing").details.errorCode).toBe("SKILL_UNKNOWN");
      });
    });

    describe("requestScriptRun()", () => {
      it("asks the host to review the script instead of executing it", async () => {
        const { host, tools } = harness();

        const refused = await tools.requestScriptRun({
          skillId: "canonical:summarize",
          command: "node scripts/build.mjs",
        });

        expect(refused.details.errorCode).toBe("SKILL_SCRIPT_NOT_APPROVED");
        expect(host.approvals).toEqual([
          {
            skillId: "canonical:summarize",
            command: "node scripts/build.mjs",
            executionMode: "strict",
          },
        ]);

        host.approved = true;
        const approved = await tools.requestScriptRun({
          skillId: "canonical:summarize",
          command: "node scripts/build.mjs",
        });

        expect(approved).toMatchObject({ isError: false });
        expect(approved.details).toMatchObject({
          requestId: "host-request-1",
          executionMode: "strict",
        });
      });
    });

    describe("registration()", () => {
      it("declares the read-only load_skill tool", () => {
        const { tools } = harness();

        const registration = tools.registration();

        expect(SKILL_LOAD_TOOL_ID).toBe("load_skill");
        expect(registration.toolId).toBe("load_skill");
        expect(registration.manifest).toMatchObject({
          family: "control",
          effects: ["read", "state"],
          replayPolicy: "read_only",
          allowedCallers: ["root", "subagent"],
        });
      });
    });
  });

  describe("safeRelativePath()", () => {
    it("normalizes a path inside the skill directory and rejects escapes", () => {
      expect(safeRelativePath("skills/summarize", "references/style.md")).toBe(
        "skills/summarize/references/style.md"
      );
      expect(safeRelativePath("skills/summarize/", "./a/../b.md")).toBeUndefined();
      expect(safeRelativePath("skills/summarize", "..")).toBeUndefined();
      expect(safeRelativePath("skills/summarize", "C:/windows")).toBeUndefined();
      expect(safeRelativePath("skills/summarize", "  ")).toBeUndefined();
    });
  });
});
