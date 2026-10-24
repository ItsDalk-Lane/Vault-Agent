import { describeListModelsFailure } from "./listModelsFailure";

const DRIFTING_BASE = "https://opencode.ai/inference/go/openai/v1";

function baseContext() {
  return {
    url: `${DRIFTING_BASE}/models`,
    baseUrl: DRIFTING_BASE,
    providerType: "openai-compatible" as const,
  };
}

describe("listModelsFailure", () => {
  describe("describeListModelsFailure()", () => {
    it("keeps the fallback message for statuses that are not a missing route", () => {
      expect(
        describeListModelsFailure(
          { ...baseContext(), status: 401, catalogProviderId: "opencode-go" },
          "Authentication failed — check your API key."
        )
      ).toEqual({ kind: "message", message: "Authentication failed — check your API key." });
    });

    it("names the requested URL when a 404 explains itself", () => {
      const failure = describeListModelsFailure(
        { ...baseContext(), status: 404, catalogProviderId: undefined },
        "HTTP 404"
      );
      expect(failure.kind).toBe("message");
      expect(failure.message).toContain(`${DRIFTING_BASE}/models`);
      expect(failure.message).toContain("HTTP 404");
    });

    it("suggests the endpoint recorded by the locked SDK for a drifting catalog address", () => {
      const failure = describeListModelsFailure(
        { ...baseContext(), status: 404, catalogProviderId: "opencode-go" },
        "HTTP 404"
      );
      expect(failure.kind).toBe("stale-address");
      expect(failure.message).toContain("https://opencode.ai/inference/go/v1");
    });

    it("explains a service that exposes no model list", () => {
      const failure = describeListModelsFailure(
        {
          status: 404,
          url: "https://inference.example.cloud/openai/v1/models",
          baseUrl: "https://inference.example.cloud/openai/v1",
          providerType: "openai-compatible",
          catalogProviderId: "oci",
        },
        "HTTP 404"
      );
      expect(failure.kind).toBe("model-list-unavailable");
      expect(failure.message).toMatch(/model IDs manually/i);
    });
  });
});
