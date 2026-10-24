import {
  defineToolManifest,
  isolateModelArguments,
  isReservedToolName,
  RESERVED_ARGUMENT_KEYS,
  ToolManifestError,
  type ToolManifestDefinition,
} from "@/agentMode/sdk/pi/policy/ToolManifest";
import { ToolRegistry, ToolRegistryError } from "@/agentMode/sdk/pi/tools/ToolRegistry";

// The host writes every tool manifest itself: an unregistered tool is never callable, a remote or
// skill registration cannot shadow a reserved host tool, model arguments can never turn themselves
// into permissions, and reusing a schema version with a different schema fails loudly:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function definition(overrides: Partial<ToolManifestDefinition> = {}): ToolManifestDefinition {
  return {
    toolId: "vault_read",
    family: "vault",
    effects: ["read"],
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    extractTargets: (args) => {
      const path = (args as { path?: unknown }).path;
      return typeof path === "string" ? [{ kind: "vault_path", value: path }] : [];
    },
    implementationVersion: 1,
    schemaVersion: 1,
    replayPolicy: "read_only",
    allowedCallers: ["root", "subagent"],
    maxOutputBytes: 64_000,
    ...overrides,
  };
}

function registryErrorCode(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return error instanceof ToolRegistryError ? error.code : undefined;
  }
}

describe("ToolManifest", () => {
  describe("defineToolManifest()", () => {
    it("freezes the host-written manifest and derives a stable schema hash", () => {
      const manifest = defineToolManifest(definition());

      expect(manifest.toolId).toBe("vault_read");
      expect(manifest.description).toContain("vault_read");
      expect(
        defineToolManifest(definition({ description: "Read notes using vault-relative paths." }))
          .description
      ).toBe("Read notes using vault-relative paths.");
      expect(manifest.family).toBe("vault");
      expect(manifest.effects).toEqual(["read"]);
      expect(manifest.schemaHash).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.isFrozen(manifest)).toBe(true);
      expect(Object.isFrozen(manifest.effects)).toBe(true);
      expect(defineToolManifest(definition()).schemaHash).toBe(manifest.schemaHash);
    });

    it("changes the schema hash when the parameter schema changes", () => {
      const first = defineToolManifest(definition());
      const second = defineToolManifest(
        definition({
          parameters: {
            type: "object",
            properties: { path: { type: "string" }, offset: { type: "number" } },
            required: ["path"],
          },
        })
      );

      expect(second.schemaHash).not.toBe(first.schemaHash);
    });

    it.each([
      ["missing tool id", { toolId: "" }],
      ["unknown family", { family: "shell" as never }],
      ["empty effects", { effects: [] }],
      ["unknown effect", { effects: ["sudo" as never] }],
      ["zero implementation version", { implementationVersion: 0 }],
      ["zero schema version", { schemaVersion: 0 }],
      ["non-object parameters", { parameters: "path" as never }],
      ["invalid replay policy", { replayPolicy: "maybe" as never }],
      ["empty allowed callers", { allowedCallers: [] }],
      ["negative output bound", { maxOutputBytes: -1 }],
    ])("rejects a manifest with %s", (_name, overrides) => {
      expect(() => defineToolManifest(definition(overrides))).toThrow(ToolManifestError);
      try {
        defineToolManifest(definition(overrides));
      } catch (error) {
        expect(error).toBeInstanceOf(ToolManifestError);
        expect((error as ToolManifestError).code).toBe("INVALID_MANIFEST");
      }
    });
  });

  describe("isolateModelArguments()", () => {
    it("keeps a frozen nested approval snapshot independent of the original arguments https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const manifest = defineToolManifest(definition());
      const args = { edits: [{ text: "approved" }] };
      const isolated = isolateModelArguments(manifest, args);
      args.edits[0].text = "changed";
      expect(isolated).toEqual({ edits: [{ text: "approved" }] });
      expect(Object.isFrozen(isolated.edits)).toBe(true);
      expect(Object.isFrozen((isolated.edits as unknown[])[0])).toBe(true);
      expect(args.edits[0].text).toBe("changed");
    });
    it("passes ordinary model arguments through as a copy", () => {
      const manifest = defineToolManifest(definition());
      const args = { path: "Notes/a.md" };

      const isolated = isolateModelArguments(manifest, args);

      expect(isolated).toEqual(args);
      expect(isolated).not.toBe(args);
    });

    it.each(RESERVED_ARGUMENT_KEYS.map((key) => [key]))(
      "rejects model-supplied %s instead of letting it change the manifest",
      (key) => {
        const manifest = defineToolManifest(definition());

        expect(() => isolateModelArguments(manifest, { path: "Notes/a.md", [key]: true })).toThrow(
          ToolManifestError
        );
        try {
          isolateModelArguments(manifest, { path: "Notes/a.md", [key]: true });
        } catch (error) {
          expect((error as ToolManifestError).code).toBe("INVALID_ARGUMENT");
        }
        expect(manifest.effects).toEqual(["read"]);
      }
    );

    it("cannot grant a write effect from an args.safe flag", () => {
      const manifest = defineToolManifest(definition());

      expect(() => isolateModelArguments(manifest, { path: "Notes/a.md", safe: true })).toThrow(
        /reserved/
      );
      expect(manifest.effects).toEqual(["read"]);
      expect(manifest.family).toBe("vault");
    });
  });

  describe("isReservedToolName()", () => {
    it.each([
      ["read", true],
      ["write", true],
      ["bash", true],
      ["Agent", true],
      ["vault_read", true],
      ["va.plan", true],
      ["mcp__notes__search", false],
      ["my_extension_tool", false],
    ] as const)("marks %s as reserved = %s", (toolId, reserved) => {
      expect(isReservedToolName(toolId)).toBe(reserved);
    });
  });
});

describe("ToolRegistry", () => {
  describe("register()", () => {
    it("rejects an unregistered tool at the gate", () => {
      const registry = new ToolRegistry();

      expect(registry.has("vault_read")).toBe(false);
      expect(registryErrorCode(() => registry.requireManifest("vault_read"))).toBe("UNKNOWN_TOOL");
      expect(registry.describe("vault_read")).toBeNull();
    });

    it("does not let a remote server or extension override a host tool of the same name", () => {
      const registry = new ToolRegistry();
      const hostManifest = defineToolManifest(definition());
      registry.register(hostManifest, "host");

      for (const source of ["mcp", "extension"] as const) {
        const error = registryErrorCode(() =>
          registry.register(
            defineToolManifest(
              definition({ family: "mcp", effects: ["network"], parameters: { type: "object" } })
            ),
            source
          )
        );
        expect(error).toBe("RESERVED_TOOL_NAME");
        expect(registry.requireManifest("vault_read").family).toBe("vault");
        expect(registry.requireManifest("vault_read").effects).toEqual(["read"]);
      }
    });

    it("reserves host tool names even before the host registers them", () => {
      const registry = new ToolRegistry();

      expect(
        registryErrorCode(() =>
          registry.register(defineToolManifest(definition({ toolId: "vault_write" })), "extension")
        )
      ).toBe("RESERVED_TOOL_NAME");
      expect(registry.has("vault_write")).toBe(false);

      expect(() =>
        registry.register(defineToolManifest(definition({ toolId: "vault_write" })), "host")
      ).not.toThrow();
    });

    it("rejects model arguments that would grant permissions", () => {
      const registry = new ToolRegistry();
      registry.register(defineToolManifest(definition()), "host");
      const manifest = registry.requireManifest("vault_read");

      expect(() => isolateModelArguments(manifest, { path: "Notes/a.md", safe: true })).toThrow(
        ToolManifestError
      );
      expect(registry.requireManifest("vault_read").effects).toEqual(["read"]);
    });

    it("fails loudly when a schema version is reused with a different schema", () => {
      const registry = new ToolRegistry();
      registry.register(defineToolManifest(definition()), "host");

      expect(
        registryErrorCode(() =>
          registry.register(
            defineToolManifest(
              definition({
                parameters: {
                  type: "object",
                  properties: { path: { type: "string" }, absolute: { type: "boolean" } },
                },
              })
            ),
            "host"
          )
        )
      ).toBe("SCHEMA_VERSION_CONFLICT");

      expect(() => registry.register(defineToolManifest(definition()), "host")).toThrow(
        ToolRegistryError
      );
      expect(
        registryErrorCode(() => registry.register(defineToolManifest(definition()), "host"))
      ).toBe("DUPLICATE_TOOL");
    });

    it("rejects a schema downgrade for an existing tool", () => {
      const registry = new ToolRegistry();
      registry.register(defineToolManifest(definition({ implementationVersion: 3 })), "host");

      expect(
        registryErrorCode(() =>
          registry.register(
            defineToolManifest(definition({ schemaVersion: 2, implementationVersion: 2 })),
            "host"
          )
        )
      ).toBe("SCHEMA_VERSION_CONFLICT");
    });
  });

  describe("descriptions", () => {
    it("exposes only plain descriptions, never the raw manifest or its extractor", () => {
      const registry = new ToolRegistry();
      registry.register(defineToolManifest(definition()), "host");

      const description = registry.describe("vault_read");
      expect(description).not.toBeNull();
      expect(description).not.toHaveProperty("extractTargets");
      expect(description).toMatchObject({
        toolId: "vault_read",
        family: "vault",
        effects: ["read"],
        implementationVersion: 1,
        schemaVersion: 1,
      });
      expect(Object.isFrozen(description)).toBe(true);
      expect(Object.isFrozen(registry.listDescriptions())).toBe(true);
      expect(registry.listDescriptions()).toHaveLength(1);
      expect(registryErrorCode(() => registry.register("raw" as never, "host"))).toBe(
        "INVALID_MANIFEST"
      );
    });
  });
});
