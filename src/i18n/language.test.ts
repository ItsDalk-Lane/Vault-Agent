import { detectLanguageCandidates, normalizeLanguageTag, resolveLanguage } from "@/i18n/language";

describe("language", () => {
  const windowWithLanguage = window as unknown as { getLanguage?: () => string };

  afterEach(() => {
    delete windowWithLanguage.getLanguage;
  });

  describe("normalizeLanguageTag()", () => {
    it("recognizes English language tags", () => {
      expect(normalizeLanguageTag("en")).toBe("en");
      expect(normalizeLanguageTag("en-US")).toBe("en");
      expect(normalizeLanguageTag("EN")).toBe("en");
    });

    it("recognizes Simplified Chinese language tags", () => {
      expect(normalizeLanguageTag("zh")).toBe("zh-CN");
      expect(normalizeLanguageTag("zh-CN")).toBe("zh-CN");
      expect(normalizeLanguageTag("zh_CN")).toBe("zh-CN");
      expect(normalizeLanguageTag("zh-Hans")).toBe("zh-CN");
    });

    it("rejects unsupported, blank, and traditional Chinese tags", () => {
      expect(normalizeLanguageTag("fr-FR")).toBeNull();
      expect(normalizeLanguageTag("zh-TW")).toBeNull();
      expect(normalizeLanguageTag("")).toBeNull();
      expect(normalizeLanguageTag(null)).toBeNull();
      expect(normalizeLanguageTag(undefined)).toBeNull();
    });
  });

  describe("resolveLanguage()", () => {
    it("prefers an explicit setting over the candidates", () => {
      expect(resolveLanguage("en", ["zh-CN"])).toBe("en");
      expect(resolveLanguage("zh-CN", ["en-US"])).toBe("zh-CN");
    });

    it("scans candidates in order for auto", () => {
      expect(resolveLanguage("auto", [null, "fr-FR", "zh-CN"])).toBe("zh-CN");
      expect(resolveLanguage("auto", ["en-GB", "zh-CN"])).toBe("en");
    });

    it("defaults to English when auto has no usable candidate", () => {
      expect(resolveLanguage("auto", [])).toBe("en");
      expect(resolveLanguage("auto", [null, undefined])).toBe("en");
    });
  });

  describe("detectLanguageCandidates()", () => {
    it("reads the Obsidian app language first", () => {
      windowWithLanguage.getLanguage = () => "zh";
      expect(detectLanguageCandidates()[0]).toBe("zh");
    });

    it("always reports the navigator language as the last candidate", () => {
      const candidates = detectLanguageCandidates();
      expect(candidates[candidates.length - 1]).toBe(window.navigator.language);
    });
  });
});
