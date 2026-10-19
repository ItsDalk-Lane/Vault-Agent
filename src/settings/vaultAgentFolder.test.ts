import {
  VAULT_AGENT_SUBFOLDER,
  deriveConversationAttachmentsFolder,
  deriveConversationsFolder,
  deriveCustomPromptsFolder,
  deriveMemoryFolder,
  deriveProjectsFolder,
  deriveSkillsFolder,
  deriveSystemPromptsFolder,
  ensureVaultAgentSubfolders,
  getEffectiveConversationsFolder,
  getEffectiveVaultAgentFolder,
  getEffectiveCustomPromptsFolder,
  getEffectiveMemoryFolder,
  getEffectiveProjectsFolder,
  getEffectiveSkillsFolder,
  getEffectiveSystemPromptsFolder,
} from "@/settings/vaultAgentFolder";
import type { VaultAgentSettings } from "@/settings/model";
import { settingsAtom, settingsStore } from "@/settings/model";
import { DEFAULT_SETTINGS } from "@/constants";

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

function setGlobalRoot(vaultAgentFolder: string): void {
  settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, vaultAgentFolder });
}

function settingsWithRoot(vaultAgentFolder: string): VaultAgentSettings {
  return { vaultAgentFolder } as VaultAgentSettings;
}

describe("vaultAgentFolder", () => {
  describe("deriveConversationsFolder()", () => {
    it("derives the historical default conversations path for the default root", () => {
      expect(deriveConversationsFolder(settingsWithRoot("vault-agent"))).toBe(
        "vault-agent/conversations"
      );
    });

    it("re-roots the conversations folder under a custom root", () => {
      expect(deriveConversationsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/conversations");
    });

    it("falls back to the default root when the configured root is blank", () => {
      expect(deriveConversationsFolder(settingsWithRoot("  "))).toBe("vault-agent/conversations");
    });
  });

  describe("deriveConversationAttachmentsFolder()", () => {
    it("nests the attachment store inside the conversations folder it is given", () => {
      expect(deriveConversationAttachmentsFolder("vault-agent/conversations")).toBe(
        "vault-agent/conversations/attachments"
      );
    });

    it("follows a relocated Copilot root through the conversations folder", () => {
      expect(deriveConversationAttachmentsFolder("team/ai/conversations")).toBe(
        "team/ai/conversations/attachments"
      );
    });
  });

  describe("deriveCustomPromptsFolder()", () => {
    it("derives the historical default custom-prompts path for the default root", () => {
      expect(deriveCustomPromptsFolder(settingsWithRoot("vault-agent"))).toBe(
        "vault-agent/custom-prompts"
      );
    });

    it("re-roots the custom-prompts folder under a custom root", () => {
      expect(deriveCustomPromptsFolder(settingsWithRoot("notes/vault-agent"))).toBe(
        "notes/vault-agent/custom-prompts"
      );
    });
  });

  describe("deriveSystemPromptsFolder()", () => {
    it("derives the historical default system-prompts path for the default root", () => {
      expect(deriveSystemPromptsFolder(settingsWithRoot("vault-agent"))).toBe(
        "vault-agent/system-prompts"
      );
    });

    it("re-roots the system-prompts folder under a custom root", () => {
      expect(deriveSystemPromptsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/system-prompts");
    });
  });

  describe("deriveSkillsFolder()", () => {
    it("derives the historical default skills path for the default root", () => {
      expect(deriveSkillsFolder(settingsWithRoot("vault-agent"))).toBe("vault-agent/skills");
      expect(deriveSkillsFolder(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.agentMode.skills.folder);
    });

    it("re-roots the skills folder under a custom root", () => {
      expect(deriveSkillsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/skills");
    });
  });

  describe("deriveMemoryFolder()", () => {
    it("derives the historical default memory path for the default root", () => {
      expect(deriveMemoryFolder(settingsWithRoot("vault-agent"))).toBe("vault-agent/memory");
    });

    it("re-roots the memory folder under a custom root", () => {
      expect(deriveMemoryFolder(settingsWithRoot("team/ai"))).toBe("team/ai/memory");
    });
  });

  describe("deriveProjectsFolder()", () => {
    it("derives the historical default projects path for the default root", () => {
      expect(deriveProjectsFolder(settingsWithRoot("vault-agent"))).toBe("vault-agent/projects");
    });

    it("re-roots the projects folder under a custom root", () => {
      expect(deriveProjectsFolder(settingsWithRoot("team/ai"))).toBe("team/ai/projects");
    });
  });

  describe("VAULT_AGENT_SUBFOLDER", () => {
    it("pins the sub-folder names to the historical hardcoded defaults", () => {
      expect(VAULT_AGENT_SUBFOLDER).toEqual({
        conversations: "conversations",
        customPrompts: "custom-prompts",
        systemPrompts: "system-prompts",
        skills: "skills",
        memory: "memory",
        projects: "projects",
      });
    });
  });

  describe.each([
    ["getEffectiveVaultAgentFolder", getEffectiveVaultAgentFolder, "team/ai"],
    ["getEffectiveConversationsFolder", getEffectiveConversationsFolder, "team/ai/conversations"],
    ["getEffectiveCustomPromptsFolder", getEffectiveCustomPromptsFolder, "team/ai/custom-prompts"],
    ["getEffectiveSystemPromptsFolder", getEffectiveSystemPromptsFolder, "team/ai/system-prompts"],
    ["getEffectiveSkillsFolder", getEffectiveSkillsFolder, "team/ai/skills"],
    ["getEffectiveMemoryFolder", getEffectiveMemoryFolder, "team/ai/memory"],
    ["getEffectiveProjectsFolder", getEffectiveProjectsFolder, "team/ai/projects"],
  ])("%s()", (_name, getEffective, expected) => {
    it("derives the folder from the current global vaultAgentFolder", () => {
      setGlobalRoot("team/ai");
      expect(getEffective()).toBe(expected);
    });
  });

  describe("ensureVaultAgentSubfolders()", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ensureFolderExists } = require("@/utils") as {
      ensureFolderExists: jest.MockedFunction<(vault: unknown, folder: string) => Promise<void>>;
    };
    const fakeVault = {} as import("obsidian").Vault;

    beforeEach(() => ensureFolderExists.mockClear());

    it("creates all six derived sub-folders under the given root", async () => {
      await ensureVaultAgentSubfolders(fakeVault, settingsWithRoot("team/ai"));
      const created = ensureFolderExists.mock.calls.map((call) => call[1]);
      expect(created).toEqual([
        "team/ai/conversations",
        "team/ai/custom-prompts",
        "team/ai/system-prompts",
        "team/ai/skills",
        "team/ai/memory",
        "team/ai/projects",
      ]);
    });

    it("continues past a folder that fails so one bad path cannot block the rest", async () => {
      ensureFolderExists
        .mockRejectedValueOnce(new Error("path conflict"))
        .mockResolvedValue(undefined);
      await expect(
        ensureVaultAgentSubfolders(fakeVault, settingsWithRoot("vault-agent"))
      ).resolves.toBeUndefined();
      expect(ensureFolderExists).toHaveBeenCalledTimes(6);
    });
  });
});
