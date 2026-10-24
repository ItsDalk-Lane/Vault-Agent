import {
  cacheHitPercent,
  formatSecondsFromMs,
  formatTokenCount,
  turnDisplayTokens,
} from "@/agentMode/ui/usageFormat";

describe("usageFormat", () => {
  describe("formatTokenCount()", () => {
    it("keeps small counts exact and localizes", () => {
      expect(formatTokenCount(0)).toBe("0");
      expect(formatTokenCount(999)).toBe("999");
    });

    it("compresses thousands and millions to one decimal", () => {
      expect(formatTokenCount(1000)).toBe("1.0K");
      expect(formatTokenCount(45_346)).toBe("45.3K");
      expect(formatTokenCount(1_234_567)).toBe("1.2M");
    });
  });

  describe("formatSecondsFromMs()", () => {
    it("renders milliseconds as seconds with one decimal", () => {
      expect(formatSecondsFromMs(1500)).toBe("1.5s");
      expect(formatSecondsFromMs(250)).toBe("0.3s");
    });
  });

  describe("turnDisplayTokens()", () => {
    it("sums uncached input, cache read and output, excluding cache write", () => {
      expect(turnDisplayTokens({ inputTokens: 100, cacheReadTokens: 40, outputTokens: 10 })).toBe(
        150
      );
    });
  });

  describe("cacheHitPercent()", () => {
    it("computes cache read over the read context", () => {
      expect(cacheHitPercent(22_201, 22_144)).toBe(50);
    });

    it("returns null when nothing was read or inputted", () => {
      expect(cacheHitPercent(0, 0)).toBeNull();
    });
  });
});
