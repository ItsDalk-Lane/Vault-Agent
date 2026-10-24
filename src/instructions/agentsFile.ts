import { logWarn } from "@/logger";
import { ensureFolderExists } from "@/utils";
import { hasCaseInsensitiveFilesystem, trashFile } from "@/utils/vaultAdapterUtils";
import { App, normalizePath, TFile, TFolder } from "obsidian";

export const AGENTS_FILE_NAME = "AGENTS.md";
export async function readAgentsFile(app: App, folderPath: string): Promise<string> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  const file = findCachedInstructionFile(app, agentsPath);
  if (!file) return "";
  return app.vault.read(file);
}

export async function writeAgentsFile(
  app: App,
  folderPath: string,
  content: string
): Promise<void> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  if (!findCachedInstructionFile(app, agentsPath) && !content.trim()) return;
  const file = await ensureAgentsFile(app, folderPath, content);
  if ((await app.vault.read(file)) === content) return;
  await app.vault.modify(file, content);
}

export interface InstructionFilesSnapshot {
  agents: string | null;
}

export async function captureInstructionFiles(
  app: App,
  folderPath: string
): Promise<InstructionFilesSnapshot> {
  return {
    agents: await readIfPresent(app, childPath(folderPath, AGENTS_FILE_NAME)),
  };
}

export async function restoreInstructionFiles(
  app: App,
  folderPath: string,
  snapshot: InstructionFilesSnapshot
): Promise<void> {
  try {
    await restoreFile(app, childPath(folderPath, AGENTS_FILE_NAME), snapshot.agents);
  } catch (error) {
    logWarn(`[Instructions] Failed to restore instruction files in "${folderPath}"`, error);
  }
}

async function readIfPresent(app: App, filePath: string): Promise<string | null> {
  const file = findCachedInstructionFile(app, filePath);
  return file ? await app.vault.read(file) : null;
}

async function restoreFile(app: App, filePath: string, previous: string | null): Promise<void> {
  const file = findCachedInstructionFile(app, filePath);
  if (previous === null) {
    if (file) await trashFile(app, file);
    return;
  }
  if (!file) {
    await ensureFile(app, filePath, previous);
    return;
  }
  if ((await app.vault.read(file)) !== previous) {
    await app.vault.modify(file, previous);
  }
}

export async function ensureAgentsFile(
  app: App,
  folderPath: string,
  initialContent: string
): Promise<TFile> {
  const agentsPath = childPath(folderPath, AGENTS_FILE_NAME);
  return ensureFile(app, agentsPath, initialContent);
}

export async function openAgentsFile(app: App, folderPath: string): Promise<void> {
  const file = await ensureAgentsFile(app, folderPath, "");
  await app.workspace.getLeaf(true).openFile(file);
}

function childPath(folderPath: string, fileName: string): string {
  return normalizePath(folderPath ? `${folderPath}/${fileName}` : fileName);
}

export function findCachedInstructionFile(app: App, filePath: string): TFile | null {
  const cached = app.vault.getAbstractFileByPath(filePath);
  return cached instanceof TFile ? cached : findCasedSibling(app, filePath);
}

function findCasedSibling(app: App, filePath: string): TFile | null {
  if (!hasCaseInsensitiveFilesystem()) return null;
  const slash = filePath.lastIndexOf("/");
  const folderPath = slash === -1 ? "" : filePath.slice(0, slash);
  const name = (slash === -1 ? filePath : filePath.slice(slash + 1)).toLowerCase();
  const folder = folderPath ? app.vault.getAbstractFileByPath(folderPath) : app.vault.getRoot();
  if (!(folder instanceof TFolder)) return null;
  return (
    folder.children.find(
      (child): child is TFile => child instanceof TFile && child.name.toLowerCase() === name
    ) ?? null
  );
}

async function ensureFile(app: App, filePath: string, content: string): Promise<TFile> {
  const existing = findCachedInstructionFile(app, filePath);
  if (existing) return existing;

  const folderPath = filePath.split("/").slice(0, -1).join("/");
  if (folderPath) await ensureFolderExists(app.vault, folderPath);
  return await app.vault.create(filePath, content);
}
