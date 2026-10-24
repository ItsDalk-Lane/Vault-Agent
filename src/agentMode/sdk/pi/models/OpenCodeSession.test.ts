import {
  createOpenCodeSessionId,
  isOpenCodeEndpoint,
  openCodeSessionHeaders,
  withOpenCodeSessionHeaders,
} from "./OpenCodeSession";

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";

describe("OpenCodeSession", () => {
  describe("isOpenCodeEndpoint()", () => {
    it.each([
      "https://opencode.ai/inference/go/v1",
      "https://opencode.ai/inference/v1",
      "https://api.opencode.ai/inference/v1",
      "https://OPENCODE.AI/inference/v1",
    ])(`recognizes the OpenCode host in %s (${ISSUE})`, (baseUrl) => {
      expect(isOpenCodeEndpoint(baseUrl)).toBe(true);
    });
    it.each([
      undefined,
      "",
      "https://api.openai.com/v1",
      "https://notopencode.ai/v1",
      "https://opencode.ai.example.com/v1",
      "not-a-url",
    ])(`rejects non-OpenCode endpoints %p (${ISSUE})`, (baseUrl) => {
      expect(isOpenCodeEndpoint(baseUrl)).toBe(false);
    });
  });

  describe("openCodeSessionHeaders()", () => {
    it(`sends the conversation session id to the OpenCode gateway (${ISSUE})`, () => {
      expect(
        openCodeSessionHeaders("https://opencode.ai/inference/go/v1", "session-1", "fallback")
      ).toEqual({ "x-opencode-session": "session-1" });
    });
    it(`falls back to the per-provider id when the request carries no session (${ISSUE})`, () => {
      expect(
        openCodeSessionHeaders("https://opencode.ai/inference/go/v1", undefined, "fallback")
      ).toEqual({ "x-opencode-session": "fallback" });
    });
    it(`adds no header for other providers (${ISSUE})`, () => {
      expect(openCodeSessionHeaders("https://api.openai.com/v1", "session-1", "fallback"));
    });
  });

  describe("withOpenCodeSessionHeaders()", () => {
    it(`merges the session header without dropping caller headers (${ISSUE})`, () => {
      const request = { headers: { "x-trace": "t" }, sessionId: "session-1" };
      expect(withOpenCodeSessionHeaders(request, "https://opencode.ai/inference/v1", "fb")).toEqual(
        { headers: { "x-trace": "t", "x-opencode-session": "session-1" }, sessionId: "session-1" }
      );
    });
    it(`returns the original request untouched for other providers (${ISSUE})`, () => {
      const request = { headers: { "x-trace": "t" }, sessionId: "session-1" };
      expect(withOpenCodeSessionHeaders(request, "https://api.openai.com/v1", "fb")).toBe(request);
    });
    it(`keeps an absent request absent for other providers (${ISSUE})`, () => {
      expect(withOpenCodeSessionHeaders(undefined, "https://api.openai.com/v1", "fb"));
    });
  });

  describe("createOpenCodeSessionId()", () => {
    it(`mints unique non-empty session ids (${ISSUE})`, () => {
      const first = createOpenCodeSessionId();
      const second = createOpenCodeSessionId();
      expect(first).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(second).not.toBe(first);
    });
  });
});
