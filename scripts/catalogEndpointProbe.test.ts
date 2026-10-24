import { catalogProbeUrl, classifyProbeAttempt, classifyProbeStatus } from "./catalogEndpointProbe";

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";

function capability(
  providerType: "openai-compatible" | "anthropic" | "google",
  defaultBaseUrl?: string
) {
  return { providerType, defaultBaseUrl, requiresApiKey: true };
}

describe("catalogEndpointProbe", () => {
  describe("catalogProbeUrl()", () => {
    it(`appends /models to an OpenAI-compatible endpoint (${ISSUE})`, () => {
      expect(catalogProbeUrl(capability("openai-compatible", "https://x.test/v1"))).toBe(
        "https://x.test/v1/models"
      );
    });
    it(`uses the versioned path for an anthropic endpoint without doubling /v1 (${ISSUE})`, () => {
      expect(catalogProbeUrl(capability("anthropic", "https://x.test/anthropic"))).toBe(
        "https://x.test/anthropic/v1/models"
      );
    });
    it(`keeps a single /v1beta segment for a Google endpoint (${ISSUE})`, () => {
      expect(
        catalogProbeUrl(capability("google", "https://generativelanguage.googleapis.com/v1beta"))
      ).toBe("https://generativelanguage.googleapis.com/v1beta/models");
    });
    it(`returns nothing when the capability has no endpoint (${ISSUE})`, () => {
      expect(catalogProbeUrl(capability("openai-compatible"))).toBeUndefined();
    });
  });

  describe("classifyProbeStatus()", () => {
    it.each([
      [404, "drift"],
      [200, "public"],
      [401, "auth-gated"],
      [403, "auth-gated"],
      [500, "unknown"],
      [null, "unknown"],
    ] as const)(`classifies status %p as %s (${ISSUE})`, (status, expected) => {
      expect(classifyProbeStatus(status)).toBe(expected);
    });
  });

  describe("classifyProbeAttempt()", () => {
    it(`treats a 404 from a service without a model list as expected rather than drift (${ISSUE})`, () => {
      expect(
        classifyProbeAttempt({ id: "oci", url: "https://example.test/models", status: 404 })
      ).toBe("model-list-unavailable");
      expect(
        classifyProbeAttempt({ id: "opencode-go", url: "https://example.test/models", status: 404 })
      ).toBe("drift");
    });
  });
});
