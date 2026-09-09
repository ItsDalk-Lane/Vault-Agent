import { getLanguage } from "obsidian";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

/**
 * Supported locale identifiers. These are the values a user can pick in the
 * settings dropdown and the values Obsidian's `getLanguage()` may return. Keep
 * this list aligned with the files in `./locales/`.
 *
 * NOTE: We deliberately accept ANY string from `getLanguage()` rather than
 * insisting on a typed union. Obsidian ships its own language list (locale
 * codes like `en`, `en-US`, `zh`, `zh-CN`, `zh-TW`, ...) and pinning to a
 * subset would drift the moment a new locale is added upstream. We match by
 * prefix (e.g. `zh-*` -> `zh-CN`) so the user gets Chinese for any zh locale.
 */
export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Locale every key must resolve to when its primary lookup misses. */
const FALLBACK_LOCALE: Locale = "en";

/** Module-level current locale. Single-threaded JS, so no locking needed. */
let currentLocale: Locale = FALLBACK_LOCALE;

type LocaleTable = { readonly [key: string]: unknown };

/**
 * Translate a dot-separated key in the current locale.
 *
 * Lookup order:
 *   1. Current locale table (`zh-CN` -> e.g. `command.run`)
 *   2. English fallback (so a half-translated locale still works)
 *   3. The key itself (so a typo / missing entry surfaces as a visible string
 *      the user can search for, rather than `undefined` blowing up a render)
 *
 * No parameter interpolation yet — QuickAdd's strings are mostly short labels
 * and don't need it. Add `params` later if a string ever needs it.
 */
export function t(key: string): string {
	const value = lookup(currentLocale, key) ?? lookup(FALLBACK_LOCALE, key);
	return value ?? key;
}

/** Current locale — exposed so callers (e.g. Svelte stores) can react to it. */
export function getLocale(): Locale {
	return currentLocale;
}

/**
 * Resolve and activate a locale.
 *
 * Priority chain (matches the plan):
 *   1. `preferredLocale` from settings, if set AND supported
 *   2. Obsidian's `getLanguage()`, matched by prefix against SUPPORTED_LOCALES
 *   3. English fallback
 *
 * `getLanguage()` is wrapped in try/catch because the obsidian stub used by
 * vitest does not export it (it's optional in some test setups). In production
 * this never throws — but in tests, a missing export must not kill onload.
 */
export function setLocale(preferredLocale?: string): Locale {
	const requested = (preferredLocale ?? "").trim();
	if (requested && matchesSupportedLocale(requested)) {
		currentLocale = resolveSupported(requested);
		return currentLocale;
	}

	const obsidianLocale = safeGetLanguage();
	if (obsidianLocale && matchesSupportedLocale(obsidianLocale)) {
		currentLocale = resolveSupported(obsidianLocale);
		return currentLocale;
	}

	currentLocale = FALLBACK_LOCALE;
	return currentLocale;
}

/**
 * True when `candidate` either equals a supported locale exactly or shares its
 * base language segment. `"zh"`, `"zh-CN"`, and `"zh-TW"` all match the
 * supported `"zh-CN"`; `"en"` and `"en-US"` both match the supported `"en"`.
 *
 * First-segment matching (instead of `candidate.startsWith(supported)`) is the
 * only rule that handles the real-world case where Obsidian returns `"zh-TW"`
 * but our bundle is `"zh-CN"` — strict startsWith returns false there even
 * though the user clearly wants Chinese.
 */
function matchesSupportedLocale(candidate: string): boolean {
	return SUPPORTED_LOCALES.some((supported) =>
		baseLanguage(candidate) === baseLanguage(supported),
	);
}

/** Pick the supported locale whose base matches `candidate`. */
function resolveSupported(candidate: string): Locale {
	const match = SUPPORTED_LOCALES.find(
		(supported) => baseLanguage(candidate) === baseLanguage(supported),
	);
	// `matchesSupportedLocale` was checked by the caller, so `match` is defined.
	return match ?? FALLBACK_LOCALE;
}

/** Strip the region suffix: `"zh-TW"` -> `"zh"`, `"en-US"` -> `"en"`. */
function baseLanguage(locale: string): string {
	return locale.split("-")[0];
}

/**
 * Read `getLanguage()` defensively. The real API throws if the app isn't ready
 * (rare but seen during very early startup on some platforms), and the obsidian
 * stub used in vitest does not export it at all. Either way, a missing
 * language must not crash the plugin.
 */
function safeGetLanguage(): string | null {
	try {
		if (typeof getLanguage !== "function") return null;
		const value = getLanguage();
		return typeof value === "string" && value.length > 0 ? value : null;
	} catch {
		return null;
	}
}

/**
 * Walk a dot-separated key path through a locale table.
 *
 * `key = "command.run"` looks up `table.command.run`. Missing intermediate
 * segments return undefined so the caller's `??` chain picks the fallback.
 */
function lookup(locale: Locale, key: string): string | undefined {
	const table: LocaleTable = locale === "en" ? en : zhCN;
	const segments = key.split(".");
	let cursor: unknown = table;
	for (const segment of segments) {
		if (cursor && typeof cursor === "object" && segment in cursor) {
			cursor = (cursor as Record<string, unknown>)[segment];
		} else {
			return undefined;
		}
	}
	return typeof cursor === "string" ? cursor : undefined;
}
