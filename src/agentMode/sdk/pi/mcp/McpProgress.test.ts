import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";
import {
  McpOutputWindow,
  McpProgressTracker,
  type McpProgressNotification,
} from "@/agentMode/sdk/pi/mcp/McpProgress";

// A server progressToken is bound to the host toolCallId before routing, so concurrent calls never
// cross cards; output is redacted incrementally and bounded to a tail window; a percentage appears
// only when the server sent a usable total; and a finished call keeps one bounded terminal record
// while late events are dropped:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function notification(overrides: Partial<McpProgressNotification> = {}): McpProgressNotification {
  return { progressToken: "token-1", progress: 5, total: 10, ...overrides };
}

describe("McpProgress", () => {
  describe("McpOutputWindow", () => {
    it("keeps a bounded tail and reports truncation", () => {
      const window = new McpOutputWindow({
        maxBytes: 100,
        redactor: new Redactor(),
      });

      window.append("a".repeat(500));

      expect(window.bytes).toBeLessThanOrEqual(100);
      expect(window.text.length).toBeLessThanOrEqual(100);
      expect(window.truncated).toBe(true);
      expect(window.text.endsWith("a")).toBe(true);
    });

    it("redacts a secret split across chunks and never leaks it", () => {
      const secret = "sk-live-secret";
      const window = new McpOutputWindow({
        maxBytes: 4_096,
        redactor: new Redactor({ secretValues: [secret] }),
        secretValues: [secret],
      });

      window.append("token is sk-live-");
      window.append("secret and more");
      window.flush();

      expect(window.text).toContain("[REDACTED]");
      expect(window.text).not.toContain(secret);
    });

    it("replaces the buffer and counts bytes for the replacement", () => {
      const window = new McpOutputWindow({ maxBytes: 4_096, redactor: new Redactor() });

      window.append("first");
      window.replace("second");

      expect(window.text).toBe("second");
      expect(window.bytes).toBe(6);
      expect(window.truncated).toBe(false);
    });
  });

  describe("McpProgressTracker", () => {
    it("routes concurrent progress by token without crossing cards", () => {
      const tracker = new McpProgressTracker({ now: () => 1_000 });
      tracker.bind({
        hostToolCallId: "call-a",
        serverId: "docs",
        toolName: "search",
        progressToken: "token-a",
      });
      tracker.bind({
        hostToolCallId: "call-b",
        serverId: "docs",
        toolName: "index",
        progressToken: "token-b",
      });

      const first = tracker.update({
        serverId: "docs",
        toolName: "search",
        notification: notification({ progressToken: "token-a", progress: 3, total: 4 }),
      });
      const second = tracker.update({
        serverId: "docs",
        toolName: "index",
        notification: notification({ progressToken: "token-b", progress: 1, total: 2 }),
      });
      const unknown = tracker.update({
        serverId: "docs",
        toolName: "search",
        notification: notification({ progressToken: "token-x" }),
      });
      const otherServer = tracker.update({
        serverId: "other",
        toolName: "search",
        notification: notification({ progressToken: "token-a" }),
      });

      expect(first).toMatchObject({ toolCallId: "call-a", percent: 75, indeterminate: false });
      expect(second).toMatchObject({ toolCallId: "call-b", percent: 50 });
      expect(unknown).toBeNull();
      expect(otherServer).toBeNull();
      expect(tracker.activeCount).toBe(2);
    });

    it("does not invent a percentage when the server total is missing or unusable", () => {
      const tracker = new McpProgressTracker({ now: () => 1_000 });
      tracker.bind({
        hostToolCallId: "call-a",
        serverId: "docs",
        toolName: "search",
        progressToken: "token-a",
      });

      const missingTotal = tracker.update({
        serverId: "docs",
        toolName: "search",
        notification: notification({ progressToken: "token-a", total: undefined }),
      });
      const zeroTotal = tracker.update({
        serverId: "docs",
        toolName: "search",
        notification: notification({ progressToken: "token-a", total: 0 }),
      });
      const overrun = tracker.update({
        serverId: "docs",
        toolName: "search",
        notification: notification({ progressToken: "token-a", progress: 20, total: 10 }),
      });

      expect(missingTotal).toMatchObject({ percent: null, indeterminate: true });
      expect(zeroTotal).toMatchObject({ percent: null, indeterminate: true });
      expect(overrun).toMatchObject({ percent: 100, indeterminate: false });
    });

    it("drops late events after the call finished and never revives it", () => {
      const tracker = new McpProgressTracker({ now: () => 1_000 });
      tracker.bind({
        hostToolCallId: "call-a",
        serverId: "docs",
        toolName: "search",
        progressToken: "token-a",
      });
      tracker.update({
        serverId: "docs",
        toolName: "search",
        notification: notification({ progressToken: "token-a" }),
      });

      const terminal = tracker.finish("call-a", "completed");

      expect(terminal).toMatchObject({
        toolCallId: "call-a",
        status: "completed",
        updates: 1,
        lastPercent: 50,
      });
      expect(
        tracker.update({
          serverId: "docs",
          toolName: "search",
          notification: notification({ progress: 9 }),
        })
      ).toBeNull();
      expect(tracker.activeCount).toBe(0);
      expect(tracker.terminalInfoFor("call-a")).toEqual(terminal);
    });

    it("counts a repeated finish once and keeps the original duration", () => {
      let now = 1_000;
      const tracker = new McpProgressTracker({ now: () => now });
      tracker.bind({
        hostToolCallId: "call-a",
        serverId: "docs",
        toolName: "search",
        progressToken: "token-a",
      });
      tracker.update({
        serverId: "docs",
        toolName: "search",
        notification: notification({ progressToken: "token-a" }),
      });

      now = 1_250;
      const first = tracker.finish("call-a", "failed");
      now = 9_999;
      const second = tracker.finish("call-a", "failed");

      expect(second).toBe(first);
      expect(second).toMatchObject({ durationMs: 250, updates: 1, status: "failed" });
    });

    it("flags unknown side effects on a timeout or cancellation", () => {
      const tracker = new McpProgressTracker({ now: () => 1_000 });
      tracker.bind({
        hostToolCallId: "call-timeout",
        serverId: "docs",
        toolName: "search",
        progressToken: "t1",
      });
      tracker.bind({
        hostToolCallId: "call-cancel",
        serverId: "docs",
        toolName: "search",
        progressToken: "t2",
      });

      const timedOut = tracker.finish("call-timeout", "timed_out");
      const cancelled = tracker.finish("call-cancel", "cancelled");

      expect(timedOut.note).toContain("side effects are unknown");
      expect(cancelled.note).toContain("side effects are unknown");
    });

    it("bounds and redacts the retained output of a call", () => {
      const secret = "sk-live-secret";
      const tracker = new McpProgressTracker({
        now: () => 1_000,
        maxOutputBytes: 64,
        secretValues: [secret],
      });
      tracker.bind({
        hostToolCallId: "call-a",
        serverId: "docs",
        toolName: "search",
        progressToken: "token-a",
      });
      const window = tracker.output("call-a");
      expect(window).toBeDefined();
      window?.append(`${secret}${"x".repeat(500)}`);
      const terminal = tracker.finish("call-a", "completed");

      expect(window?.truncated).toBe(true);
      expect(window?.text).not.toContain(secret);
      expect(window?.bytes).toBeLessThanOrEqual(64);
      expect(terminal).toMatchObject({ truncatedOutput: true });
      expect(terminal.outputBytes).toBeLessThanOrEqual(64);
    });
  });
});
