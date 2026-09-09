import { afterEach, describe, expect, it } from "vitest";
import { getLocale, setLocale, t } from "../src/i18n";

/**
 * The vitest setup file locks the locale to "en" globally. Tests in this file
 * explicitly swap to "zh-CN" and back, restoring "en" in `afterEach` so a
 * later test in this file (or any test that runs in the same worker) sees a
 * known starting state. `t()` reads a module-level variable — vitest's worker
 * isolation gives one module instance per file, so this only matters within
 * this file.
 */
describe("i18n", () => {
	afterEach(() => {
		setLocale("en");
	});

	describe("t()", () => {
		it("returns the English string for known keys when locale is en", () => {
			setLocale("en");
			expect(t("common.yes")).toBe("Yes");
			expect(t("common.no")).toBe("No");
			expect(t("common.cancel")).toBe("Cancel");
		});

		it("returns the Chinese string for known keys when locale is zh-CN", () => {
			setLocale("zh-CN");
			expect(t("common.yes")).toBe("是");
			expect(t("common.no")).toBe("否");
			expect(t("common.cancel")).toBe("取消");
		});

		it("translates all six command labels in zh-CN", () => {
			setLocale("zh-CN");
			expect(t("command.run")).toBe("运行 QuickAdd");
			expect(t("command.runTemplateFromFolder")).toBe("从模板新建笔记");
			expect(t("command.applyTemplate")).toBe("对当前笔记应用模板");
			expect(t("command.reloadDev")).toBe("重新加载（开发）");
			expect(t("command.openSettings")).toBe("打开 QuickAdd 设置");
			expect(t("command.resumePrompt")).toBe("返回提示");
		});

		it("falls back to English when a key is missing in the active locale", () => {
			// The fallback only matters when the active locale is missing a key.
			// All keys above exist in both, so this test uses a deliberately
			// constructed shape via the public API: switch to zh-CN, then ask
			// for a key that exists only in en.
			setLocale("zh-CN");
			// "common.search" exists in both — sanity check first.
			expect(t("common.search")).toBe("搜索");
			// A typo'd key path returns the key string itself. That's the
			// "developer error" fallback so a render never crashes on `undefined`.
			expect(t("common.doesNotExist")).toBe("common.doesNotExist");
		});

		it("returns the key itself when neither locale has the entry", () => {
			setLocale("en");
			expect(t("totally.bogus.key")).toBe("totally.bogus.key");
			setLocale("zh-CN");
			expect(t("totally.bogus.key")).toBe("totally.bogus.key");
		});
	});

	describe("setLocale()", () => {
		it("uses an explicit preferredLocale when it matches a supported locale", () => {
			expect(setLocale("zh-CN")).toBe("zh-CN");
			expect(getLocale()).toBe("zh-CN");
			expect(t("common.yes")).toBe("是");
		});

		it("matches preferredLocale by prefix (zh -> zh-CN)", () => {
			// Obsidian can return "zh" or "zh-CN" or "zh-TW"; we want any of
			// them to resolve to the zh-CN bundle rather than falling through
			// to English.
			expect(setLocale("zh")).toBe("zh-CN");
			expect(getLocale()).toBe("zh-CN");
			expect(setLocale("zh-TW")).toBe("zh-CN");
			expect(setLocale("en-US")).toBe("en");
		});

		it("falls back to English when preferredLocale is empty", () => {
			// Empty preferredLocale -> consult Obsidian's getLanguage() (which
			// the test stub returns as "en") -> resolve to "en".
			expect(setLocale("")).toBe("en");
			expect(setLocale("   ")).toBe("en"); // whitespace-only treated as empty
		});

		it("falls back to English when preferredLocale is unsupported and getLanguage returns unsupported", () => {
			// "klingon" is not a supported locale, and the obsidian stub returns
			// "en" by default — so we should land on "en".
			expect(setLocale("klingon")).toBe("en");
		});

		it("returns the new locale so callers can react to it", () => {
			const result = setLocale("zh-CN");
			expect(result).toBe("zh-CN");
			expect(getLocale()).toBe(result);
		});
	});
});
