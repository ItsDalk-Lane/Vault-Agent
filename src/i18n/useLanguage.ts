import { getLanguage, subscribeToLanguageChange } from "@/i18n";
import type { ResolvedLanguage } from "@/i18n";
import { useSyncExternalStore } from "react";

export function useLanguage(): ResolvedLanguage {
  return useSyncExternalStore(subscribeToLanguageChange, getLanguage, getLanguage);
}
