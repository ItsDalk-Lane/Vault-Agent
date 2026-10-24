import {
  captureInstructionFiles,
  restoreInstructionFiles,
  ensureAgentsFile,
  openAgentsFile,
  readAgentsFile,
  writeAgentsFile,
} from "@/instructions/agentsFile";
import { App, Platform, TFile, TFolder } from "obsidian";

function setCaseInsensitiveFilesystem(value: boolean) {
  (Platform as { isMacOS: boolean }).isMacOS = value;
}

interface MockVaultState {
  files: Map<string, string>;
  folders: Set<string>;
}

function makeApp(initialFiles: Record<string, string> = {}, folders: string[] = []) {
  const state: MockVaultState = {
    files: new Map(Object.entries(initialFiles)),
    folders: new Set(folders),
  };
  const toFile = (path: string) => new (TFile as unknown as new (path: string) => TFile)(path);
  const toFolder = (path: string) =>
    new (TFolder as unknown as new (path: string) => TFolder)(path);
  const openFile = jest.fn().mockResolvedValue(undefined);
  const folderWithChildren = (path: string) => {
    const folder = toFolder(path);
    const children = [...state.files.keys()]
      .filter((key) => key.slice(0, key.lastIndexOf("/") + 1) === (path ? `${path}/` : ""))
      .map(toFile);
    (folder as unknown as { children: unknown[] }).children = children;
    return folder;
  };
  const diskPath = (path: string): string | undefined => {
    if (state.files.has(path)) return path;
    if (!Platform.isMacOS) return undefined;
    const target = path.toLowerCase();
    return [...state.files.keys()].find((key) => key.toLowerCase() === target);
  };
  const app = {
    vault: {
      getAbstractFileByPath: jest.fn((path: string) => {
        if (state.files.has(path)) return toFile(path);
        if (state.folders.has(path)) return folderWithChildren(path);
        return null;
      }),
      getRoot: jest.fn(() => folderWithChildren("")),
      create: jest.fn(async (path: string, content: string) => {
        state.files.set(path, content);
        return toFile(path);
      }),
      read: jest.fn(async (file: TFile) => state.files.get(file.path) ?? ""),
      modify: jest.fn(async (file: TFile, content: string) => {
        state.files.set(file.path, content);
      }),
      adapter: {
        exists: jest.fn(async (path: string) => diskPath(path) !== undefined),
        read: jest.fn(async (path: string) => state.files.get(diskPath(path) ?? path) ?? ""),
        write: jest.fn(async (path: string, content: string) => {
          state.files.set(diskPath(path) ?? path, content);
        }),
        stat: jest.fn(async () => ({ ctime: 0, mtime: 0, size: 0 })),
        mkdir: jest.fn(async (path: string) => {
          state.folders.add(path);
        }),
      },
    },
    workspace: {
      getLeaf: jest.fn(() => ({ openFile })),
    },
    fileManager: {
      trashFile: jest.fn(async (file: TFile) => {
        state.files.delete(file.path);
      }),
    },
  };
  return { app: app as unknown as App, state, openFile };
}

describe("agentsFile", () => {
  describe("ensureAgentsFile()", () => {
    it("creates only AGENTS.md without generating a legacy backend file https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { app, state } = makeApp();

      await ensureAgentsFile(app, "", "");

      expect(state.files.get("AGENTS.md")).toBe("");
      expect(state.files.has("CLAUDE.md")).toBe(false);
    });

    it("preserves both existing instruction bodies without appending a backend reference https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { app, state } = makeApp({
        "AGENTS.md": "User rules",
        "CLAUDE.md": "# Claude rules\n",
      });

      await ensureAgentsFile(app, "", "Fallback rules");
      await ensureAgentsFile(app, "", "Different fallback");

      expect(state.files.get("AGENTS.md")).toBe("User rules");
      expect(state.files.get("CLAUDE.md")).toBe("# Claude rules\n");
      expect(app.vault.modify).not.toHaveBeenCalled();
    });

    it("initializes a missing project instruction file from the supplied text", async () => {
      const { app, state } = makeApp({}, ["vault-agent/projects/Research"]);

      await ensureAgentsFile(app, "vault-agent/projects/Research", "Project rules");

      expect(state.files.get("vault-agent/projects/Research/AGENTS.md")).toBe("Project rules");
      expect(state.files.has("vault-agent/projects/Research/CLAUDE.md")).toBe(false);
    });

    it("preserves an existing instruction file without converting its old marker https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const marker =
        "<!-- vault-agent:generated-agents-mirror v1 — Auto-generated; do not edit here. -->";
      const { app, state } = makeApp({
        "Projects/Research/AGENTS.md": `${marker}\n\nExisting instructions`,
      });

      await ensureAgentsFile(app, "Projects/Research", "Fallback rules");

      expect(state.files.get("Projects/Research/AGENTS.md")).toBe(
        `${marker}\n\nExisting instructions`
      );
    });

    it("leaves an existing instruction file unchanged when no initial text is supplied https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const marker =
        "<!-- vault-agent:generated-agents-mirror v1 — Auto-generated; do not edit here. -->";
      const { app, state } = makeApp({
        "Projects/Research/AGENTS.md": `${marker}\n\nExisting instructions`,
      });

      await ensureAgentsFile(app, "Projects/Research", "");

      expect(state.files.get("Projects/Research/AGENTS.md")).toBe(
        `${marker}\n\nExisting instructions`
      );
    });
  });

  describe("readAgentsFile()", () => {
    it("returns an empty string when the folder has no AGENTS.md", async () => {
      const { app } = makeApp();
      expect(await readAgentsFile(app, "Projects/Research")).toBe("");
    });

    it("returns the file body verbatim", async () => {
      const { app } = makeApp({ "AGENTS.md": "Cite every source.\n" });
      expect(await readAgentsFile(app, "")).toBe("Cite every source.\n");
    });

    it("returns all existing text without inspecting an old generated marker https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const marker =
        "<!-- vault-agent:generated-agents-mirror v1 — Auto-generated; do not edit here. -->";
      const { app } = makeApp({
        "Projects/Research/AGENTS.md": `${marker}\n\nCite every source.`,
      });
      expect(await readAgentsFile(app, "Projects/Research")).toBe(
        `${marker}\n\nCite every source.`
      );
    });
  });

  describe("writeAgentsFile()", () => {
    it("writes the requested AGENTS body without creating a legacy backend file https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { app, state } = makeApp();

      await writeAgentsFile(app, "", "Cite every source.");

      expect(state.files.get("AGENTS.md")).toBe("Cite every source.");
      expect(state.files.has("CLAUDE.md")).toBe(false);
    });

    it("replaces the body of a file the user already had", async () => {
      const { app, state } = makeApp({ "AGENTS.md": "Old rules", "CLAUDE.md": "@AGENTS.md\n" });

      await writeAgentsFile(app, "", "New rules");

      expect(state.files.get("AGENTS.md")).toBe("New rules");
    });

    it("writes nothing when a blank draft would create a file out of nothing", async () => {
      const { app, state } = makeApp();

      await writeAgentsFile(app, "", "   ");

      expect(state.files.has("AGENTS.md")).toBe(false);
      expect(state.files.has("CLAUDE.md")).toBe(false);
    });

    it("clears an existing file when the user empties the editor", async () => {
      const { app, state } = makeApp({ "AGENTS.md": "Old rules" });

      await writeAgentsFile(app, "", "");

      expect(state.files.get("AGENTS.md")).toBe("");
    });

    it("replaces the complete file only when the user explicitly saves new instructions", async () => {
      const marker =
        "<!-- vault-agent:generated-agents-mirror v1 — Auto-generated; do not edit here. -->";
      const { app, state } = makeApp({
        "Projects/Research/AGENTS.md": `${marker}\n\nOld rules`,
      });

      await writeAgentsFile(app, "Projects/Research", "New rules");

      expect(state.files.get("Projects/Research/AGENTS.md")).toBe("New rules");
    });

    it("does not rewrite a file whose content already matches", async () => {
      const { app, state } = makeApp({ "AGENTS.md": "Same rules", "CLAUDE.md": "@AGENTS.md\n" });

      await writeAgentsFile(app, "", "Same rules");

      expect(app.vault.modify).not.toHaveBeenCalled();
      expect(state.files.get("AGENTS.md")).toBe("Same rules");
    });
  });

  describe("captureInstructionFiles()", () => {
    it("captures only the current instruction file rather than legacy backend files https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { app } = makeApp({ "AGENTS.md": "Current rules", "CLAUDE.md": "Historical rules" });
      expect(await captureInstructionFiles(app, "")).toEqual({ agents: "Current rules" });
    });
  });

  describe("restoreInstructionFiles()", () => {
    it("leaves a separately edited legacy file untouched while restoring AGENTS.md https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { app, state } = makeApp({
        "AGENTS.md": "Original rules",
        "CLAUDE.md": "Initial historical rules",
      });
      const before = await captureInstructionFiles(app, "");
      state.files.set("AGENTS.md", "Changed rules");
      state.files.set("CLAUDE.md", "User-edited historical rules");
      await restoreInstructionFiles(app, "", before);
      expect(state.files.get("AGENTS.md")).toBe("Original rules");
      expect(state.files.get("CLAUDE.md")).toBe("User-edited historical rules");
    });

    it("does not remove a legacy file created outside the current instruction edit https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { app, state } = makeApp();
      const before = await captureInstructionFiles(app, "");
      state.files.set("CLAUDE.md", "User-created historical rules");
      await restoreInstructionFiles(app, "", before);
      expect(state.files.get("CLAUDE.md")).toBe("User-created historical rules");
    });

    it("removes files the edit created, rather than leaving them blank", async () => {
      const { app, state } = makeApp();
      const before = await captureInstructionFiles(app, "Projects/Research");
      await writeAgentsFile(app, "Projects/Research", "Half-finished rules");

      await restoreInstructionFiles(app, "Projects/Research", before);

      expect(state.files.has("Projects/Research/AGENTS.md")).toBe(false);
      expect(state.files.has("Projects/Research/CLAUDE.md")).toBe(false);
    });

    it("puts an existing body back verbatim", async () => {
      const { app, state } = makeApp({
        "Projects/Research/AGENTS.md": "Old rules",
        "Projects/Research/CLAUDE.md": "@AGENTS.md\n",
      });
      const before = await captureInstructionFiles(app, "Projects/Research");
      await writeAgentsFile(app, "Projects/Research", "New rules");

      await restoreInstructionFiles(app, "Projects/Research", before);

      expect(state.files.get("Projects/Research/AGENTS.md")).toBe("Old rules");
    });

    it("keeps a file the user had deliberately emptied empty", async () => {
      const { app, state } = makeApp({ "Projects/Research/AGENTS.md": "" });
      const before = await captureInstructionFiles(app, "Projects/Research");
      await writeAgentsFile(app, "Projects/Research", "New rules");

      await restoreInstructionFiles(app, "Projects/Research", before);

      expect(state.files.get("Projects/Research/AGENTS.md")).toBe("");
    });
  });

  describe("openAgentsFile()", () => {
    it("opens the ensured AGENTS file in the requested leaf", async () => {
      const { app, openFile } = makeApp();

      await openAgentsFile(app, "");

      expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
      expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "AGENTS.md" }));
    });

    it("opens a note the vault stores under another casing", async () => {
      setCaseInsensitiveFilesystem(true);
      const { app, openFile } = makeApp({ "agents.md": "rules" });

      await openAgentsFile(app, "");

      expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: "agents.md" }));
    });
  });

  describe("differently-cased instruction files", () => {
    afterEach(() => setCaseInsensitiveFilesystem(false));

    it("reads the existing note rather than reporting no instructions", async () => {
      setCaseInsensitiveFilesystem(true);
      const { app } = makeApp({ "agents.md": "Old rules" });

      await expect(readAgentsFile(app, "")).resolves.toBe("Old rules");
    });

    it("edits that same note through the vault instead of creating a second file", async () => {
      setCaseInsensitiveFilesystem(true);
      const { app, state } = makeApp({ "agents.md": "Old rules", "CLAUDE.md": "@AGENTS.md\n" });

      await writeAgentsFile(app, "", "New rules");

      expect(state.files.get("agents.md")).toBe("New rules");
      expect(state.files.has("AGENTS.md")).toBe(false);
      expect(app.vault.modify).toHaveBeenCalled();
      expect(app.vault.adapter.write).not.toHaveBeenCalled();
    });

    it("reads nothing when the folder has no instruction file under any casing", async () => {
      setCaseInsensitiveFilesystem(true);
      const { app } = makeApp();

      await expect(readAgentsFile(app, "")).resolves.toBe("");
    });

    it("keeps them separate on a case-sensitive volume, where the backends read only the exact name", async () => {
      const { app, state } = makeApp({ "agents.md": "Someone else's note" });

      await writeAgentsFile(app, "", "New rules");

      expect(state.files.get("AGENTS.md")).toBe("New rules");
      expect(state.files.get("agents.md")).toBe("Someone else's note");
    });
  });
});
