import {
  applyLanguage,
  formatMessage,
  getLanguage,
  isAppLanguage,
  subscribeToLanguageChange,
  t,
  type MessageKey,
} from "@/i18n";

describe("i18n", () => {
  afterEach(() => {
    applyLanguage("en", []);
  });

  describe("isAppLanguage()", () => {
    it("accepts the supported language settings", () => {
      expect(isAppLanguage("auto")).toBe(true);
      expect(isAppLanguage("en")).toBe(true);
      expect(isAppLanguage("zh-CN")).toBe(true);
    });

    it("rejects unsupported and non-string values", () => {
      expect(isAppLanguage("zh-TW")).toBe(false);
      expect(isAppLanguage("")).toBe(false);
      expect(isAppLanguage(null)).toBe(false);
      expect(isAppLanguage(undefined)).toBe(false);
    });
  });

  describe("applyLanguage()", () => {
    it("resolves an explicit English setting to English", () => {
      applyLanguage("en", ["zh-CN"]);
      expect(getLanguage()).toBe("en");
    });

    it("resolves an explicit Chinese setting to Simplified Chinese", () => {
      applyLanguage("zh-CN", ["en"]);
      expect(getLanguage()).toBe("zh-CN");
    });

    it("follows the first recognized candidate for auto", () => {
      applyLanguage("auto", [null, "zh_CN", "en-US"]);
      expect(getLanguage()).toBe("zh-CN");
    });

    it("falls back to English when auto finds no recognized candidate", () => {
      applyLanguage("auto", [null, "fr-FR", undefined]);
      expect(getLanguage()).toBe("en");
    });

    it("notifies subscribers only when the resolved language changes", () => {
      applyLanguage("en", []);
      const listener = jest.fn();
      const unsubscribe = subscribeToLanguageChange(listener);
      applyLanguage("en", []);
      expect(listener).not.toHaveBeenCalled();
      applyLanguage("zh-CN", []);
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });
  });

  describe("getLanguage()", () => {
    it("starts at English", () => {
      expect(getLanguage()).toBe("en");
    });
  });

  describe("subscribeToLanguageChange()", () => {
    it("stops notifying after unsubscribe", () => {
      applyLanguage("en", []);
      const listener = jest.fn();
      const unsubscribe = subscribeToLanguageChange(listener);
      unsubscribe();
      applyLanguage("zh-CN", []);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("t()", () => {
    it("returns the English message by default", () => {
      applyLanguage("en", []);
      expect(t("controls.newChat")).toBe("New Chat");
    });

    it("returns the Chinese message after switching language", () => {
      applyLanguage("zh-CN", []);
      expect(t("controls.newChat")).toBe("新对话");
    });

    it("interpolates message variables", () => {
      applyLanguage("en", []);
      expect(t("notice.closeFailed", { error: "boom" })).toBe("Could not close session: boom");
    });

    it("leaves placeholders without a supplied value untouched", () => {
      applyLanguage("en", []);
      expect(t("notice.closeFailed", {})).toBe("Could not close session: {error}");
    });

    it("falls back to the key when no message exists", () => {
      applyLanguage("en", []);
      expect(t("missing.key" as MessageKey)).toBe("missing.key");
    });
  });

  describe("formatMessage()", () => {
    it("replaces every occurrence of a provided variable", () => {
      expect(formatMessage("{name} and {name}", { name: "Vault" })).toBe("Vault and Vault");
    });

    it("keeps unknown placeholders as written", () => {
      expect(formatMessage("{known} {unknown}", { known: "yes" })).toBe("yes {unknown}");
    });
  });
});
