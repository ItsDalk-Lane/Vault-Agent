import {
  SUBAGENT_MAX_DEPTH,
  SUBAGENT_PROFILES,
  SubagentProfileError,
  defaultEnabledProfiles,
  subagentProfile,
  subagentProfileSchema,
  subagentModelSchema,
  validateSubagentRequest,
} from "@/agentMode/sdk/pi/features/subagents/Profiles";

// Built-in profiles are data: researcher/reviewer are read-only and enabled by default, writer is
// write-capable but off until the user enables it, an unknown model is rejected instead of swapped,
// and tool names or instructions that look like executable code are refused:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function expectCode(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(SubagentProfileError);
    expect((thrown as SubagentProfileError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("Profiles", () => {
  describe("SUBAGENT_PROFILES", () => {
    it("defines researcher/reviewer as read-only defaults and writer as an explicit opt-in", () => {
      expect(SUBAGENT_PROFILES.map((profile) => profile.profileId)).toEqual([
        "researcher",
        "reviewer",
        "writer",
      ]);
      expect(defaultEnabledProfiles()).toEqual(["researcher", "reviewer"]);

      const researcher = subagentProfile("researcher");
      const reviewer = subagentProfile("reviewer");
      const writer = subagentProfile("writer");

      expect(researcher).toMatchObject({ writeCapable: false, defaultEnabled: true });
      expect(researcher?.effects).toContain("read");
      expect(researcher?.effects).not.toContain("write");
      expect(reviewer?.effects).toEqual(["read", "state"]);
      expect(writer).toMatchObject({ writeCapable: true, defaultEnabled: false });
      expect(writer?.effects).toContain("write");
      expect(subagentProfile("missing")).toBeUndefined();
    });
  });

  describe("subagentModelSchema()", () => {
    it("publishes exact configured keys with human model and provider names instead of requiring guessed aliases https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const choices = [
        {
          modelKey: "model-uuid-1",
          displayName: "本地审阅模型",
          providerDisplayName: "Local Studio",
        },
        {
          modelKey: "model-uuid-2",
          displayName: "Remote model",
          providerDisplayName: "远程供应商",
        },
      ];
      const schema = subagentModelSchema(choices);
      expect(schema.enum).toEqual(["model-uuid-1", "model-uuid-2"]);
      expect(schema.description).toContain(JSON.stringify(choices));
      expect(schema.description).toContain("inherit the parent");
      expect(schema.enum).not.toContain("Local Studio");
      const withPrivateFields = {
        ...choices[0],
        apiKey: "private-field-marker",
        baseUrl: "private-endpoint-marker",
      };
      expect(subagentModelSchema([withPrivateFields]).description).not.toContain(
        "private-field-marker"
      );
      expect(subagentModelSchema([withPrivateFields]).description).not.toContain(
        "private-endpoint-marker"
      );
    });
    it("keeps legacy key-only callers and distinguishes an empty allowed catalog from an unspecified catalog https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(subagentModelSchema(["legacy-model"]).enum).toEqual(["legacy-model"]);
      expect(subagentModelSchema([]).enum).toEqual([]);
      expect(subagentModelSchema().enum).toBeUndefined();
    });
  });

  describe("subagentProfileSchema()", () => {
    it("derives enum choices and role boundaries from enabled built-in profile data https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const schema = subagentProfileSchema();
      expect(schema.enum).toEqual(defaultEnabledProfiles());
      for (const id of schema.enum)
        expect(schema.description).toContain(subagentProfile(id)!.description);
      expect(schema.description).not.toContain("writer:");
      expect(schema.description).toContain("inputFiles");
      expect(schema.description).toContain("outputPaths");
      expect(subagentProfileSchema(["writer", "unknown", "writer"]).enum).toEqual(["writer"]);
      expect(subagentProfileSchema([]).enum).toEqual([]);
      expect(subagentProfileSchema([]).description).toContain("none");
    });
  });

  describe("validateSubagentRequest()", () => {
    it("lists currently allowed roles when an unknown or disabled role is requested https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(() => validateSubagentRequest({ profileId: "explore" })).toThrow(
        "Allowed enabled profiles: researcher, reviewer"
      );
      expect(() =>
        validateSubagentRequest({ profileId: "writer", enabledProfiles: ["reviewer", "unknown"] })
      ).toThrow("Allowed enabled profiles: reviewer");
    });

    it("exposes real writer tools and bounded delegation in the built-in profiles https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      for (const profile of SUBAGENT_PROFILES) {
        expect(profile.toolAllowlist).toEqual(
          expect.arrayContaining(["delegate_task", "send_subagent_message", "wait_subagent"])
        );
      }
      const writer = validateSubagentRequest({ profileId: "writer", enabledProfiles: ["writer"] });
      expect(writer.toolAllowlist).toEqual(
        expect.arrayContaining(["vault_create", "vault_edit", "vault_frontmatter"])
      );
      expect(writer.toolAllowlist).not.toContain("vault_write");
    });

    it("requires an explicit user enable before writer can run", () => {
      expectCode(
        () => validateSubagentRequest({ profileId: "writer" }),
        "SUBAGENT_PROFILE_DISABLED"
      );

      const enabled = validateSubagentRequest({
        profileId: "writer",
        enabledProfiles: ["researcher", "reviewer", "writer"],
      });

      expect(enabled.profile.profileId).toBe("writer");
      expect(enabled.profile.writeCapable).toBe(true);
    });

    it("rejects unknown profiles and models with allowed choices instead of swapping models https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expectCode(
        () => validateSubagentRequest({ profileId: "hacker" }),
        "SUBAGENT_PROFILE_UNKNOWN"
      );
      expectCode(
        () =>
          validateSubagentRequest({
            profileId: "researcher",
            modelKey: "not-configured",
            knownModels: ["model-a", "model-b"],
          }),
        "SUBAGENT_MODEL_UNKNOWN"
      );

      expect(() =>
        validateSubagentRequest({
          profileId: "researcher",
          modelKey: "missing",
          knownModels: ["actual-a", "actual-b"],
        })
      ).toThrow("actual-a, actual-b");

      const inherited = validateSubagentRequest({ profileId: "researcher" });
      expect(inherited.modelKey).toBeNull();

      const explicit = validateSubagentRequest({
        profileId: "researcher",
        modelKey: "model-a",
        knownModels: ["model-a"],
      });
      expect(explicit.modelKey).toBe("model-a");
    });

    it("rejects executable code and tools outside the profile allowlist", () => {
      expectCode(
        () =>
          validateSubagentRequest({
            profileId: "researcher",
            toolAllowlist: ["vault_read", "eval("],
          }),
        "SUBAGENT_PROFILE_CODE_REJECTED"
      );
      expectCode(
        () =>
          validateSubagentRequest({
            profileId: "researcher",
            toolAllowlist: ["vault_read", "rm_rf"],
          }),
        "SUBAGENT_PROFILE_UNKNOWN_TOOL"
      );
      expectCode(
        () =>
          validateSubagentRequest({
            profileId: "researcher",
            instructions: "import fs from 'node:fs'; process.exit(0)",
          }),
        "SUBAGENT_PROFILE_CODE_REJECTED"
      );
      expectCode(
        () => validateSubagentRequest({ profileId: "researcher", toolAllowlist: [] }),
        "SUBAGENT_PROFILE_UNKNOWN_TOOL"
      );
    });

    it("bounds delegation depth and defaults to the profile scope", () => {
      expectCode(
        () =>
          validateSubagentRequest({ profileId: "researcher", maxDepth: SUBAGENT_MAX_DEPTH + 1 }),
        "SUBAGENT_DEPTH_EXCEEDED"
      );

      const defaults = validateSubagentRequest({ profileId: "reviewer" });
      expect(defaults.maxDepth).toBe(SUBAGENT_MAX_DEPTH);
      expect(defaults.toolAllowlist).toEqual(subagentProfile("reviewer")?.toolAllowlist);
    });
  });
});
