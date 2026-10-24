import { DEFAULT_SETTINGS } from "@/constants";
import {
  applyVaultAgentRootChange,
  vaultAgentRootContainsNotes,
  findVaultAgentRootFileConflict,
} from "@/settings/vaultAgentRootChange";
import { mockTFile, mockTFolder } from "@/__tests__/mockObsidian";
import {
  getSettings,
  settingsAtom,
  settingsStore,
  type VaultAgentSettings,
} from "@/settings/model";
import type { App } from "obsidian";
import * as obsidian from "obsidian";

const persistSettingsWithinTransaction = jest.fn<Promise<void>, unknown[]>();
const suppressNextPersistOnce = jest.fn<void, []>();
jest.mock("@/services/settingsPersistence", () => ({
  runPersistenceTransaction: (task: () => Promise<void>) => task(),
  persistSettingsWithinTransaction: async (...args: unknown[]) => {
    await persistSettingsWithinTransaction(...args);
  },
  suppressNextPersistOnce: () => suppressNextPersistOnce(),
}));

const saveData = jest.fn<Promise<void>, unknown[]>();
jest.mock("@/settings/vaultAgentSaveData", () => ({
  getVaultAgentSaveData: () => saveData,
}));

const app = { vault: { configDir: ".vault-config" } } as unknown as App;

function appWithMarkdown(paths: string[]): App {
  return {
    vault: { getMarkdownFiles: () => paths.map((path) => ({ path })) },
  } as unknown as App;
}

function seedSettings(partial: Partial<VaultAgentSettings>): void {
  settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, ...partial });
}

describe("copilotRootChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    persistSettingsWithinTransaction.mockResolvedValue(undefined);
    saveData.mockResolvedValue(undefined);
    settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS });
  });

  describe("vaultAgentRootContainsNotes()", () => {
    it("returns true when a Markdown file lives directly under the target root", () => {
      const app = appWithMarkdown(["ai/note.md", "other/x.md"]);
      expect(vaultAgentRootContainsNotes(app, "ai")).toBe(true);
    });

    it("returns true for a nested Markdown file under the target root", () => {
      const app = appWithMarkdown(["ai/sub/deep.md"]);
      expect(vaultAgentRootContainsNotes(app, "ai")).toBe(true);
    });

    it("returns false when no Markdown file is at or under the target root", () => {
      const app = appWithMarkdown(["notes/a.md", "ai-adjacent/b.md"]);
      expect(vaultAgentRootContainsNotes(app, "ai")).toBe(false);
    });

    it("returns false for an empty candidate root", () => {
      const app = appWithMarkdown(["a.md"]);
      expect(vaultAgentRootContainsNotes(app, "")).toBe(false);
    });

    it("catches a differently-cased folder where the filesystem is case-insensitive", () => {
      const platform = obsidian.Platform as { isMacOS: boolean };
      const previous = platform.isMacOS;
      platform.isMacOS = true;
      try {
        const app = appWithMarkdown(["notes/private.md"]);
        expect(vaultAgentRootContainsNotes(app, "Notes")).toBe(true);
      } finally {
        platform.isMacOS = previous;
      }
    });

    it("treats a differently-cased folder as distinct where the filesystem is case-sensitive", () => {
      const app = appWithMarkdown(["notes/private.md"]);
      expect(vaultAgentRootContainsNotes(app, "Notes")).toBe(false);
    });
  });

  describe("findVaultAgentRootFileConflict()", () => {
    function appWithEntries(entries: Record<string, "file" | "folder">): App {
      return {
        vault: {
          getAbstractFileByPath: (path: string) => {
            const kind = entries[path];
            if (kind === "file") return mockTFile({ path });
            if (kind === "folder") return mockTFolder({ path });
            return null;
          },
        },
      } as unknown as App;
    }

    it("returns the root itself when it exists as a file", () => {
      const app = appWithEntries({ "ai.txt": "file" });
      expect(findVaultAgentRootFileConflict(app, "ai.txt")).toBe("ai.txt");
    });

    it("returns the first ancestor that exists as a file", () => {
      const app = appWithEntries({ team: "file" });
      expect(findVaultAgentRootFileConflict(app, "team/ai")).toBe("team");
    });

    it("returns null when every existing prefix is a folder", () => {
      const app = appWithEntries({ team: "folder", "team/ai": "folder" });
      expect(findVaultAgentRootFileConflict(app, "team/ai")).toBeNull();
    });

    it("returns null when nothing exists at any prefix yet", () => {
      const app = appWithEntries({});
      expect(findVaultAgentRootFileConflict(app, "brand/new/root")).toBeNull();
    });

    it("returns null for an empty candidate root", () => {
      const app = appWithEntries({});
      expect(findVaultAgentRootFileConflict(app, "")).toBeNull();
    });
  });

  describe("applyVaultAgentRootChange()", () => {
    it("durably persists the new root before activating it in memory", async () => {
      seedSettings({ vaultAgentFolder: "vault-agent", vaultAgentRootHistory: ["vault-agent"] });
      let rootWhenPersisted: string | undefined;
      const persistedSnapshots: string[] = [];
      persistSettingsWithinTransaction.mockImplementation((next: unknown) => {
        rootWhenPersisted = getSettings().vaultAgentFolder;
        persistedSnapshots.push((next as VaultAgentSettings).vaultAgentFolder);
        return Promise.resolve();
      });

      await applyVaultAgentRootChange(app, "ai");

      expect(rootWhenPersisted).toBe("vault-agent");
      expect(persistedSnapshots).toEqual(["ai"]);
      expect(getSettings().vaultAgentFolder).toBe("ai");
      expect(suppressNextPersistOnce).toHaveBeenCalledTimes(1);
    });

    it("preserves a concurrent settings edit in memory across the reconcile", async () => {
      seedSettings({ vaultAgentFolder: "vault-agent", vaultAgentRootHistory: ["vault-agent"] });
      persistSettingsWithinTransaction
        .mockImplementationOnce(() => {
          settingsStore.set(settingsAtom, {
            ...getSettings(),
            qaExclusions: "edit-A",
          });
          return Promise.resolve();
        })
        .mockImplementationOnce(() => {
          settingsStore.set(settingsAtom, {
            ...getSettings(),
            defaultModelKey: "edit-B",
          });
          return Promise.resolve();
        });

      await applyVaultAgentRootChange(app, "ai");

      const after = getSettings();
      expect(after.vaultAgentFolder).toBe("ai");
      expect(after.qaExclusions).toBe("edit-A");
      expect(after.defaultModelKey).toBe("edit-B");
    });

    it("completes the root change even when the reconcile save fails", async () => {
      seedSettings({ vaultAgentFolder: "vault-agent", vaultAgentRootHistory: ["vault-agent"] });
      persistSettingsWithinTransaction
        .mockImplementationOnce(() => {
          settingsStore.set(settingsAtom, {
            ...getSettings(),
            qaExclusions: "edit-A",
          });
          return Promise.resolve();
        })
        .mockRejectedValueOnce(new Error("reconcile disk full"));

      await expect(applyVaultAgentRootChange(app, "ai")).resolves.toBeUndefined();

      expect(getSettings().vaultAgentFolder).toBe("ai");
      expect(getSettings().qaExclusions).toBe("edit-A");
    });

    it("keeps the old root when the durable save fails", async () => {
      seedSettings({ vaultAgentFolder: "vault-agent", vaultAgentRootHistory: ["vault-agent"] });
      persistSettingsWithinTransaction.mockRejectedValueOnce(new Error("disk full"));

      await expect(applyVaultAgentRootChange(app, "ai")).rejects.toThrow("disk full");

      expect(getSettings().vaultAgentFolder).toBe("vault-agent");
      expect(getSettings().vaultAgentRootHistory).toEqual(["vault-agent"]);
      expect(suppressNextPersistOnce).not.toHaveBeenCalled();
    });

    it("does not activate an invalid root", async () => {
      seedSettings({ vaultAgentFolder: "vault-agent", vaultAgentRootHistory: ["vault-agent"] });

      await applyVaultAgentRootChange(app, "../escape");

      expect(getSettings().vaultAgentFolder).toBe("vault-agent");
      expect(getSettings().vaultAgentRootHistory).toEqual(["vault-agent"]);
      expect(persistSettingsWithinTransaction).not.toHaveBeenCalled();
    });
  });
});
