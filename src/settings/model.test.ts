import {
  COPILOT_FOLDER_ROOT,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  BUILTIN_CHAT_MODELS,
} from "@/constants";
import {
  normalizeRootFolders,
  resetSettings,
  sanitizeEnvOverrides,
  sanitizeBuiltinPreferences,
  sanitizeQaExclusions,
  settingsAtom,
  settingsStore,
  toVisibleCopilotFolder,
  validateCopilotFolder,
  getModelKeyFromModel,
} from "@/settings/model";
import { CustomModel } from "@/aiParams";

describe("model", () => {
  describe("sanitizeQaExclusions()", () => {
    it("defaults to copilot root when value is not a string", () => {
      expect(sanitizeQaExclusions(undefined)).toBe(
        encodeURIComponent(DEFAULT_QA_EXCLUSIONS_SETTING)
      );
    });

    it("keeps slash-only patterns distinct from canonical entries", () => {
      const rawValue = `${encodeURIComponent("///")},${encodeURIComponent(COPILOT_FOLDER_ROOT)}`;

      const sanitized = sanitizeQaExclusions(rawValue);

      expect(sanitized.split(",")).toEqual([
        encodeURIComponent("///"),
        encodeURIComponent(COPILOT_FOLDER_ROOT),
      ]);
    });

    it("normalizes trailing slashes to canonical path keys", () => {
      const rawValue = `${encodeURIComponent("folder/")},${encodeURIComponent("folder//")}`;

      const sanitized = sanitizeQaExclusions(rawValue);

      expect(sanitized.split(",")).toEqual([encodeURIComponent("folder/")]);
    });

    it("does not add the copilot root to a custom exclusion list (the system exclusion covers it)", () => {
      const rawValue = encodeURIComponent("folder");

      const sanitized = sanitizeQaExclusions(rawValue);

      expect(sanitized.split(",")).toEqual([encodeURIComponent("folder")]);
    });
  });

  describe("sanitizeEnvOverrides()", () => {
    it("returns undefined for non-objects", () => {
      expect(sanitizeEnvOverrides(undefined)).toBeUndefined();
      expect(sanitizeEnvOverrides(null)).toBeUndefined();
      expect(sanitizeEnvOverrides("foo")).toBeUndefined();
      expect(sanitizeEnvOverrides(42)).toBeUndefined();
      expect(sanitizeEnvOverrides([1, 2])).toBeUndefined();
    });

    it("returns undefined when no valid entries remain", () => {
      expect(sanitizeEnvOverrides({})).toBeUndefined();
      expect(sanitizeEnvOverrides({ "": "v", "1FOO": "v", "BAR=BAZ": "v" })).toBeUndefined();
    });

    it("keeps valid POSIX identifiers and string values", () => {
      expect(
        sanitizeEnvOverrides({
          CLAUDE_CONFIG_DIR: "/tmp/claude",
          _PRIVATE: "x",
          myVar2: "y",
        })
      ).toEqual({
        CLAUDE_CONFIG_DIR: "/tmp/claude",
        _PRIVATE: "x",
        myVar2: "y",
      });
    });

    it("drops keys with leading digits, equals signs, whitespace, or invalid characters", () => {
      expect(
        sanitizeEnvOverrides({
          "1FOO": "v",
          "FOO BAR": "v",
          "FOO=BAR": "v",
          "FOO-BAR": "v",
          VALID: "v",
        })
      ).toEqual({ VALID: "v" });
    });

    it("drops entries whose value isn't a string or contains control chars", () => {
      expect(
        sanitizeEnvOverrides({
          OK: "fine",
          NUM: 42,
          NULLED: null,
          UNDEF: undefined,
          TABS: "ok\twith\ttabs",
          NEWLINE: "ok\nnewline",
        })
      ).toEqual({ OK: "fine" });
    });

    it("caps at 64 entries to bound persisted size", () => {
      const big: Record<string, string> = {};
      for (let i = 0; i < 100; i++) big[`VAR_${i}`] = String(i);
      const sanitized = sanitizeEnvOverrides(big);
      expect(sanitized && Object.keys(sanitized).length).toBe(64);
    });
  });

  describe("sanitizeBuiltinPreferences()", () => {
    it.each([
      undefined,
      null,
      false,
      [],
      {},
      { "copilot-web-search": { disabled: false, disabledAgents: [] } },
    ])(
      "keeps absent, malformed, or default preferences empty: %p https://github.com/logancyang/obsidian-copilot/issues/3022",
      (raw) => {
        expect(sanitizeBuiltinPreferences(raw)).toBe(sanitizeBuiltinPreferences({}));
        expect(sanitizeBuiltinPreferences(raw)).toEqual({});
      }
    );

    it("drops retired names and malformed entries while preserving sparse overrides for known skills and absent agents https://github.com/logancyang/obsidian-copilot/issues/3022", () => {
      expect(
        sanitizeBuiltinPreferences({
          "obsidian-markdown": { disabled: true },
          "obsidian-cli": { disabled: false, disabledAgents: ["uninstalled-agent", 3] },
          "copilot-web-search": { disabled: true, disabledAgents: [] },
          "copilot-read-pdf": null,
          "miyo-parse": [],
          "retired-skill": { disabled: true },
        })
      ).toEqual({
        "obsidian-markdown": { disabled: true },
        "obsidian-cli": { disabledAgents: ["uninstalled-agent"] },
      });
    });
  });

  describe("validateCopilotFolder()", () => {
    it("rejects empty and whitespace-only values", () => {
      expect(validateCopilotFolder("").ok).toBe(false);
      expect(validateCopilotFolder("   ").ok).toBe(false);
    });

    it("accepts a simple relative folder and trims it", () => {
      expect(validateCopilotFolder("  my-ai  ")).toEqual({ ok: true, folder: "my-ai" });
    });

    it("accepts a nested relative folder and strips a trailing slash", () => {
      expect(validateCopilotFolder("notes/ai/")).toEqual({ ok: true, folder: "notes/ai" });
    });

    it("rejects parent-traversal, absolute, and drive-letter paths", () => {
      expect(validateCopilotFolder("../escape").ok).toBe(false);
      expect(validateCopilotFolder("a/../b").ok).toBe(false);
      expect(validateCopilotFolder("/etc/passwd").ok).toBe(false);
      expect(validateCopilotFolder("C:/Users/evil").ok).toBe(false);
    });

    it("rejects any segment that starts with a dot, because Obsidian does not index hidden folders (https://github.com/Brevilabs/obsidian-copilot-private/issues/712)", () => {
      expect(validateCopilotFolder(".copilot")).toEqual({
        ok: false,
        reason: "Folder names cannot start with a dot.",
      });
      expect(validateCopilotFolder("notes/.ai").ok).toBe(false);
      expect(validateCopilotFolder("a/./b").ok).toBe(false);
      expect(validateCopilotFolder("notes.ai/copilot").ok).toBe(true);
    });

    it("rejects roots that overlap the active config folder at a segment boundary", () => {
      const configDir = ".vault-config";
      expect(validateCopilotFolder(configDir, configDir).ok).toBe(false);
      expect(validateCopilotFolder(`${configDir.toUpperCase()}/plugins`, configDir).ok).toBe(false);
      expect(validateCopilotFolder("copilot", "copilot/system-prompts").ok).toBe(false);
      expect(validateCopilotFolder("copilot-data", "copilot/system-prompts").ok).toBe(true);
    });

    it("rejects Windows-illegal characters in any segment", () => {
      expect(validateCopilotFolder("a/b<c").ok).toBe(false);
      expect(validateCopilotFolder('a/b"c').ok).toBe(false);
      expect(validateCopilotFolder("a/b|c").ok).toBe(false);
    });

    it("rejects Windows-reserved device names in any segment, any case, with or without extension", () => {
      expect(validateCopilotFolder("NUL").ok).toBe(false);
      expect(validateCopilotFolder("team/CON").ok).toBe(false);
      expect(validateCopilotFolder("con.md").ok).toBe(false);
      expect(validateCopilotFolder("Com1").ok).toBe(false);
      expect(validateCopilotFolder("console").ok).toBe(true);
      expect(validateCopilotFolder("nul-notes").ok).toBe(true);
    });

    it("rejects segments ending with a dot or space on every platform", () => {
      expect(validateCopilotFolder("copilot.").ok).toBe(false);
      expect(validateCopilotFolder("team /ai").ok).toBe(false);
      expect(validateCopilotFolder("team./ai").ok).toBe(false);
    });
  });

  describe("toVisibleCopilotFolder()", () => {
    it("drops the leading dots of every segment and keeps visible paths unchanged", () => {
      expect(toVisibleCopilotFolder(" .copilot ")).toBe("copilot");
      expect(toVisibleCopilotFolder("..a\\.b/c.d")).toBe("a\\b/c.d");
      expect(toVisibleCopilotFolder("notes/ai")).toBe("notes/ai");
    });

    it("turns traversal segments into empty segments that validation still rejects", () => {
      expect(validateCopilotFolder(toVisibleCopilotFolder("../escape")).ok).toBe(false);
      expect(validateCopilotFolder(toVisibleCopilotFolder("a/../b")).ok).toBe(false);
    });
  });

  describe("normalizeRootFolders()", () => {
    it("preserves case and strips trailing slashes without lowercasing", () => {
      expect(normalizeRootFolders(["Copilot/", "ai//"])).toEqual(["Copilot", "ai"]);
    });

    it("dedupes case-sensitively, preserving first-seen order", () => {
      expect(normalizeRootFolders(["copilot", "ai", "copilot", "Copilot"])).toEqual([
        "copilot",
        "ai",
        "Copilot",
      ]);
    });

    it("drops empty, non-string, and vault-escaping entries", () => {
      expect(
        normalizeRootFolders([
          "",
          "   ",
          undefined,
          "../escape",
          "a/../b",
          "/etc",
          "C:\\Users\\Josh",
          "notes/ai",
        ])
      ).toEqual(["notes/ai"]);
    });

    it("collapses interior duplicate slashes into the matcher's canonical form", () => {
      expect(normalizeRootFolders(["a//b"])).toEqual(["a/b"]);
    });

    it("strips interior single-dot segments into the matcher's canonical form", () => {
      expect(normalizeRootFolders(["a/./b"])).toEqual(["a/b"]);
    });

    it("canonicalizes before deduping and traversal filtering", () => {
      expect(normalizeRootFolders(["a//b", "a/./b", "x/../y", "a/b"])).toEqual(["a/b"]);
    });
  });

  describe("resetSettings()", () => {
    it("preserves historical roots and folds in the pre-reset active root", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        copilotFolder: "team-ai",
        copilotRootHistory: ["copilot", "ai"],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.copilotFolder).toBe(DEFAULT_SETTINGS.copilotFolder);
      expect(new Set(after.copilotRootHistory)).toEqual(new Set(["copilot", "ai", "team-ai"]));
    });

    it.each([false, true])(
      "preserves a builtin model's credential routing, including enableCors=%s, while resetting its preferences (https://github.com/logancyang/obsidian-copilot-preview/issues/259)",
      (enableCors) => {
        const customGpt4: CustomModel = {
          ...BUILTIN_CHAT_MODELS[0],
          enabled: false,
          apiKey: "sk-saved",
          baseUrl: "https://proxy.example.test/v1",
          openAIOrgId: "org-model",
          enableCors,
          displayName: "My renamed model",
        };
        settingsStore.set(settingsAtom, {
          ...DEFAULT_SETTINGS,
          activeModels: [customGpt4],
        });

        resetSettings();

        const after = settingsStore.get(settingsAtom);
        const restored = after.activeModels.find(
          (m) => getModelKeyFromModel(m) === getModelKeyFromModel(BUILTIN_CHAT_MODELS[0])
        );
        expect(restored).toBeDefined();
        expect(restored!.apiKey).toBe("sk-saved");
        expect(restored!.baseUrl).toBe("https://proxy.example.test/v1");
        expect(restored!.openAIOrgId).toBe("org-model");
        expect(restored!.enableCors).toBe(enableCors);
        expect(restored!.enabled).toBe(BUILTIN_CHAT_MODELS[0].enabled);
        expect(restored!.displayName).toBe(BUILTIN_CHAT_MODELS[0].displayName);
      }
    );

    it("preserves every custom model, including rows that carry no key (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      const withKey: CustomModel = {
        name: "my-llama",
        provider: "openai",
        enabled: true,
        apiKey: "sk-custom",
        baseUrl: "http://localhost:1234",
      };
      const withoutKey: CustomModel = {
        name: "ollama-llama",
        provider: "ollama",
        enabled: true,
      };
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        activeModels: [withKey, withoutKey],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      const myLlama = after.activeModels.find((m) => m.name === "my-llama");
      expect(myLlama?.apiKey).toBe("sk-custom");
      expect(myLlama?.baseUrl).toBe("http://localhost:1234");
      expect(after.activeModels.find((m) => m.name === "ollama-llama")).toBeDefined();
    });

    it("preserves the top-level vendor config a retained key needs to reach its service (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      const vendorConfig = {
        openAIOrgId: "org-123",
        azureOpenAIApiInstanceName: "my-instance",
        azureOpenAIApiDeploymentName: "chat-deploy",
        azureOpenAIApiVersion: "2025-01-01-preview",
      };
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, ...vendorConfig });

      resetSettings();

      expect(settingsStore.get(settingsAtom)).toMatchObject(vendorConfig);
    });

    it("drops a bundle value whose type its consumer cannot handle (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        openAIApiKey: "sk-openai",
        openAIOrgId: {} as unknown as string,
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.openAIApiKey).toBe("sk-openai");
      expect(after.openAIOrgId).toBe(DEFAULT_SETTINGS.openAIOrgId);
    });

    it("filters out null/undefined model secrets", () => {
      const modelWithNull: CustomModel = {
        ...BUILTIN_CHAT_MODELS[0],
        apiKey: null as unknown as string,
      };
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        activeModels: [modelWithNull],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      const restored = after.activeModels.find(
        (m) => getModelKeyFromModel(m) === getModelKeyFromModel(BUILTIN_CHAT_MODELS[0])
      );
      expect(restored).toBeDefined();
      expect(restored!.apiKey).toBe(BUILTIN_CHAT_MODELS[0].apiKey);
    });

    it("preserves configured models belonging to preserved providers (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", () => {
      const providerId1 = "prov-with-key";
      const providerId2 = "prov-no-key";
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        providers: {
          [providerId1]: {
            providerId: providerId1,
            providerType: "openai-compatible",
            displayName: "Provider With Key",
            apiKeyKeychainId: "kc-123",
            origin: { kind: "byok" },
            addedAt: Date.now(),
          },
          [providerId2]: {
            providerId: providerId2,
            providerType: "openai-compatible",
            displayName: "Provider No Key (Ollama)",
            origin: { kind: "byok" },
            addedAt: Date.now(),
          },
        },
        configuredModels: [
          {
            configuredModelId: "model-1",
            providerId: providerId1,
            info: { id: "gpt-4", displayName: "GPT-4" },
            configuredAt: Date.now(),
          },
          {
            configuredModelId: "model-2",
            providerId: providerId2,
            info: { id: "llama3", displayName: "Llama 3" },
            configuredAt: Date.now(),
          },
        ],
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.providers[providerId1]).toBeDefined();
      expect(after.providers[providerId1].apiKeyKeychainId).toBe("kc-123");
      expect(after.providers[providerId2]).toBeUndefined();
      expect(after.configuredModels.length).toBe(1);
      expect(after.configuredModels[0].configuredModelId).toBe("model-1");
      expect(after.configuredModels[0].providerId).toBe(providerId1);
    });

    it("clears backends regardless of preserved providers", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        providers: {
          prov1: {
            providerId: "prov1",
            providerType: "openai-compatible",
            displayName: "Provider",
            apiKeyKeychainId: "kc-123",
            origin: { kind: "byok" },
            addedAt: Date.now(),
          },
        },
        backends: {
          chat: { enabledModels: ["model-1", "model-2"] },
          opencode: { enabledModels: ["model-3"] },
        },
      });

      resetSettings();

      const after = settingsStore.get(settingsAtom);
      expect(after.providers.prov1).toBeDefined();
      expect(after.backends).toEqual(DEFAULT_SETTINGS.backends);
    });
  });
});
