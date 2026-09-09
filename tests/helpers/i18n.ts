/**
 * Test helpers for the i18n module.
 *
 * `lockTestLocale()` exists so test files (or the global setup) can pin the
 * module-level locale to a known value before any `t()` call happens. Most
 * tests want English so existing assertions like `expect(button).toBe("Yes")`
 * keep working — but a small number will want to assert the Chinese path
 * directly, and that's the case `setLocaleForTest` is for.
 *
 * The exported wrapper hides the implementation detail (mutating a module-level
 * variable) so a future refactor that swaps the backing store only changes one
 * place.
 */
import { getLocale, setLocale, t } from "../../src/i18n";

export { getLocale, setLocale, t };

/**
 * Pin the i18n module to a specific locale for the rest of the test run.
 *
 * Called from `tests/vitest-setup.ts`. Without this, every test would race on
 * the module-level `currentLocale` — fine in serial vitest runs, surprising
 * in parallel ones, and the kind of "works on my machine" bug that costs an
 * afternoon to track down.
 */
export function lockTestLocale(locale: "en" | "zh-CN"): void {
	setLocale(locale);
}
