import type { AssistantMessage, ThinkingContent } from "@earendil-works/pi-ai";
import type { MessageChange } from "@earendil-works/pi-durable";

import { ThinkingProjection, type ThoughtPart } from "@/agentMode/sdk/pi/events/ThinkingProjection";

// The projection turns only publicly returned thinking blocks into thought parts: it keeps one
// span per contentIndex so blocks cannot bleed into each other, records the real start/end
// timestamps, never prints a provider's opaque signature, and a model without thinking support
// yields no fabricated content:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function thinking(text = "", overrides: Partial<ThinkingContent> = {}): ThinkingContent {
  return { type: "thinking", thinking: text, ...overrides };
}

function start(contentIndex: number, block: ThinkingContent = thinking()): MessageChange {
  return { type: "thinking_start", contentIndex, block };
}

function delta(contentIndex: number, text: string): MessageChange {
  return { type: "thinking_delta", contentIndex, delta: text };
}

function replaceBlock(
  contentIndex: number,
  block: AssistantMessage["content"][number]
): MessageChange {
  return { type: "block", contentIndex, block };
}

function messageChange(content: AssistantMessage["content"]): MessageChange {
  return {
    type: "message",
    message: {
      role: "assistant",
      content,
      api: "anthropic",
      provider: "anthropic",
      model: "test-model",
      stopReason: "stop",
      timestamp: 0,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  };
}

function text(part: ThoughtPart): string {
  return part.text;
}

describe("ThinkingProjection", () => {
  describe("apply()", () => {
    it("projects streamed thinking deltas into one thought part per block", () => {
      const projection = new ThinkingProjection({ now: () => 0, thinkingSupported: true });

      projection.apply([start(0)], 1_000);
      const parts = projection.apply([delta(0, "Look "), delta(0, "first.")], 1_500);

      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ kind: "thought", text: "Look first.", startedAtMs: 1_000 });
      expect(parts[0].durationMs).toBeUndefined();
    });

    it("does not fabricate thought content for a model without thinking support", () => {
      const projection = new ThinkingProjection({ now: () => 5_000, thinkingSupported: false });

      expect(projection.apply([start(0), delta(0, "hidden reasoning")], 1_000)).toEqual([]);
      expect(projection.finish(2_000)).toEqual([]);
    });

    it("keeps separate blocks from bleeding into each other and closes the previous span", () => {
      const projection = new ThinkingProjection({ now: () => 0, thinkingSupported: true });

      projection.apply([start(0), delta(0, "first block")], 1_000);
      const parts = projection.apply([start(1), delta(1, "second block")], 3_000);

      expect(parts.map(text)).toEqual(["first block", "second block"]);
      expect(parts[0]).toMatchObject({ startedAtMs: 1_000, durationMs: 2_000 });
      expect(parts[1]).toMatchObject({ startedAtMs: 3_000 });
      expect(parts[1].durationMs).toBeUndefined();
    });

    it("never exposes a provider signature or redacted payload as display text", () => {
      const projection = new ThinkingProjection({ now: () => 0, thinkingSupported: true });

      projection.apply(
        [
          start(0, thinking("", { thinkingSignature: "opaque-signature" })),
          delta(0, "visible reason"),
          replaceBlock(0, thinking("visible reason", { thinkingSignature: "opaque-signature" })),
        ],
        1_000
      );
      const parts = projection.apply(
        [messageChange([thinking("", { thinkingSignature: "encrypted-payload", redacted: true })])],
        2_000
      );

      expect(parts).toEqual([]);
      expect(JSON.stringify(projection.apply([], 3_000))).not.toContain("opaque-signature");
      expect(JSON.stringify(projection.apply([], 3_000))).not.toContain("encrypted-payload");
    });

    it("closes every open span when the message ends", () => {
      const projection = new ThinkingProjection({ now: () => 0, thinkingSupported: true });
      projection.apply([start(0), delta(0, "thinking")], 1_000);

      const parts = projection.finish(4_000);

      expect(parts[0]).toMatchObject({ text: "thinking", startedAtMs: 1_000, durationMs: 3_000 });
    });
  });

  describe("fromMessage()", () => {
    it("reuses persisted timing instead of restarting the clock on reload", () => {
      const now = jest.fn(() => 9_000);
      const projection = new ThinkingProjection({ now, thinkingSupported: true });
      const persisted: ThoughtPart[] = [
        { kind: "thought", text: "restored reasoning", startedAtMs: 1_000, durationMs: 4_000 },
      ];

      const parts = projection.fromMessage(
        { content: [thinking("restored reasoning"), { type: "text", text: "answer" }] },
        persisted
      );

      expect(parts).toEqual([
        { kind: "thought", text: "restored reasoning", startedAtMs: 1_000, durationMs: 4_000 },
      ]);
      expect(now).not.toHaveBeenCalled();
    });

    it("projects one part per committed thinking block", () => {
      const projection = new ThinkingProjection({ now: () => 0, thinkingSupported: true });

      const parts = projection.fromMessage({
        content: [thinking("first"), { type: "text", text: "between" }, thinking("second")],
      });

      expect(parts.map(text)).toEqual(["first", "second"]);
      expect(parts.every((part) => part.durationMs === undefined)).toBe(true);
    });
  });
});
