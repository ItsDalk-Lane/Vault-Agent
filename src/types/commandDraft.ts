import type { TFile } from "obsidian";

export interface CommandDraftContext {
  selectedText: string;
  activeFile: TFile | null;
}
