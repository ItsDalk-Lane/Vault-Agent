import { moment } from "obsidian";
import type { AppLanguage, ResolvedLanguage } from "./types";

export function normalizeLanguageTag(tag: string | null | undefined): ResolvedLanguage | null {
  const normalized = tag?.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return null;
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (normalized === "zh" || normalized.startsWith("zh-cn") || normalized.startsWith("zh-hans")) {
    return "zh-CN";
  }
  return null;
}

export function resolveLanguage(
  setting: AppLanguage,
  candidates: readonly (string | null | undefined)[]
): ResolvedLanguage {
  if (setting !== "auto") return setting;
  for (const candidate of candidates) {
    const language = normalizeLanguageTag(candidate);
    if (language) return language;
  }
  return "en";
}

function readObsidianLanguage(): string | null {
  try {
    return typeof getLanguage === "function" ? getLanguage() : null;
  } catch {
    return null;
  }
}

function readMomentLanguage(): string | null {
  try {
    return moment.locale();
  } catch {
    return null;
  }
}

function readNavigatorLanguage(): string | null {
  try {
    return navigator.language;
  } catch {
    return null;
  }
}

export function detectLanguageCandidates(): (string | null | undefined)[] {
  return [readObsidianLanguage(), readMomentLanguage(), readNavigatorLanguage()];
}
