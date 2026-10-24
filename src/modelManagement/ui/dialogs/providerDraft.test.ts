import {
  createModelDraft,
  mergeDeclaredModelInfo,
  modelDraftInfo,
  orderReasoningEfforts,
  parseTokenCount,
} from "./providerDraft";

describe("providerDraft", () => {
  describe("parseTokenCount()", () => {
    it("accepts decimal K/M suffixes and rejects malformed or unsafe counts (https://github.com/ItsDalk-Lane/Vault-Agent/issues/2)", () => {
      expect(parseTokenCount("1M")).toBe(1000000);
      expect(parseTokenCount("384K")).toBe(384000);
      expect(parseTokenCount("1.5m")).toBe(1500000);
      expect(parseTokenCount("1024")).toBe(1024);
      expect(parseTokenCount("")).toBeUndefined();
      for (const value of ["-1", "abc", "0", "1.2", "Infinity", "9007199254740992"]) {
        expect(parseTokenCount(value)).toBeNull();
      }
    });
  });

  describe("createModelDraft()", () => {
    it("locks text input and preserves exact token counts in an isolated draft (https://github.com/ItsDalk-Lane/Vault-Agent/issues/2)", () => {
      const info = {
        id: "a",
        displayName: "A",
        modalities: { input: ["image", "video", "pdf"] },
        limits: { context: 128555 },
        capabilities: { structuredOutput: false },
      };
      const draft = createModelDraft(info);
      expect(draft.info.modalities?.input).toEqual(["text", "image"]);
      expect(draft.context).toBe("128555");
      expect(draft.info.capabilities).not.toBe(info.capabilities);
    });
  });
  describe("modelDraftInfo()", () => {
    it("persists unchecked capabilities explicitly so SDK defaults cannot silently enable them (https://github.com/ItsDalk-Lane/Vault-Agent/issues/2)", () => {
      expect(
        modelDraftInfo(createModelDraft({ id: "manual", displayName: "Manual" })).capabilities
      ).toEqual({
        structuredOutput: false,
        nativeWebSearch: false,
        midConversationSystemMessages: false,
      });
    });

    it("stores selected reasoning levels and parsed token limits without losing other metadata (https://github.com/ItsDalk-Lane/Vault-Agent/issues/2)", () => {
      const draft = createModelDraft({
        id: " a ",
        displayName: "",
        reasoningEfforts: ["custom"],
        limits: { input: 500 },
      });
      expect(modelDraftInfo({ ...draft, context: "1M", output: "384K" })).toMatchObject({
        id: "a",
        displayName: "a",
        reasoning: true,
        reasoningEfforts: ["custom"],
        limits: { context: 1000000, output: 384000, input: 500 },
      });
    });
  });
  describe("mergeDeclaredModelInfo()", () => {
    it("fills missing declaration fields while preserving explicit user overrides (https://github.com/ItsDalk-Lane/Vault-Agent/issues/2)", () => {
      expect(
        mergeDeclaredModelInfo(
          {
            id: "a",
            displayName: "A",
            capabilities: { structuredOutput: false },
            reasoningEfforts: [],
          },
          {
            capabilities: { structuredOutput: true, midConversationSystemMessages: true },
            reasoningEfforts: ["low"],
          }
        )
      ).toMatchObject({
        capabilities: { structuredOutput: false, midConversationSystemMessages: true },
        reasoningEfforts: [],
      });
    });
  });

  describe("orderReasoningEfforts()", () => {
    it("keeps supported preset levels low to high and appends custom levels in their declared order (https://github.com/ItsDalk-Lane/Vault-Agent/issues/2)", () => {
      expect(
        orderReasoningEfforts(["custom", "high", "low", "medium", "max", "custom-two"])
      ).toEqual(["low", "medium", "high", "max", "custom", "custom-two"]);
    });
  });
});
