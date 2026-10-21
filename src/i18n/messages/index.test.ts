import { en, zhCn, type MessageKey } from "@/i18n/messages";

const PLACEHOLDER_RE = /\{(\w+)\}/g;

function placeholdersOf(message: string): string[] {
  return [...message.matchAll(PLACEHOLDER_RE)].map((match) => match[1]).sort();
}

describe("messages", () => {
  describe("zhCn", () => {
    it("translates every English message", () => {
      for (const key of Object.keys(en) as MessageKey[]) {
        expect(zhCn[key]).toEqual(expect.any(String));
        expect(zhCn[key].trim()).not.toBe("");
      }
    });

    it("keeps the same interpolation placeholders as the English message", () => {
      for (const key of Object.keys(en) as MessageKey[]) {
        expect(placeholdersOf(zhCn[key])).toEqual(placeholdersOf(en[key]));
      }
    });

    it("actually translates the messages that differ between languages", () => {
      const identical = (Object.keys(en) as MessageKey[]).filter((key) => zhCn[key] === en[key]);
      expect(identical.length).toBeLessThan(Object.keys(en).length / 2);
    });
  });
});
