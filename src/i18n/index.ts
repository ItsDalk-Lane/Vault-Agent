import { detectLanguageCandidates, resolveLanguage } from "./language";
import { en, zhCn, type MessageKey } from "./messages";
import type { AppLanguage, MessageVars, ResolvedLanguage } from "./types";

const MESSAGES: Record<ResolvedLanguage, Record<MessageKey, string>> = {
  en,
  "zh-CN": zhCn,
};

const APP_LANGUAGES: readonly AppLanguage[] = ["auto", "en", "zh-CN"];

let currentLanguage: ResolvedLanguage = "en";
const listeners = new Set<() => void>();

export function isAppLanguage(value: unknown): value is AppLanguage {
  return APP_LANGUAGES.includes(value as AppLanguage);
}

export function getLanguage(): ResolvedLanguage {
  return currentLanguage;
}

export function applyLanguage(
  setting: AppLanguage,
  candidates: readonly (string | null | undefined)[] = detectLanguageCandidates()
): void {
  const next = resolveLanguage(setting, candidates);
  if (next === currentLanguage) return;
  currentLanguage = next;
  for (const listener of listeners) listener();
}

export function subscribeToLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function formatMessage(template: string, vars: MessageVars): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : placeholder
  );
}

export function t(key: MessageKey, vars?: MessageVars): string {
  const messages = MESSAGES[currentLanguage] as Partial<Record<MessageKey, string>>;
  const template = messages[key] ?? en[key] ?? key;
  return vars ? formatMessage(template, vars) : template;
}

export type { AppLanguage, MessageKey, MessageVars, ResolvedLanguage };
