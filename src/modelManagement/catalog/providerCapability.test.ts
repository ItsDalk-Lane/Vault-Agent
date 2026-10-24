jest.mock("@/settings/model", () => ({ getSettings: () => ({ debug: false }) }));

import {
  declaredEndpointSuggestion,
  declaredProviderEndpoint,
  getProviderCapability,
  getProviderUnsupportedReason,
  isModelListUnavailableCatalogProvider,
  normalizeBaseUrlForProtocol,
  resolveProviderBaseUrl,
} from "./providerCapability";
import { DECLARED_PI_PROVIDER_ENDPOINTS } from "@/utils/declaredPiProviderEndpoints.generated";
import type { Provider } from "@/modelManagement/types/persisted";

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";

function provider(baseUrl?: string, catalogProviderId?: string): Provider {
  return {
    providerId: "p",
    providerType: "openai-compatible",
    displayName: "P",
    baseUrl,
    origin: { kind: "byok", catalogProviderId },
    addedAt: 1,
  };
}

describe("providerCapability", () => {
  describe("getProviderCapability()", () => {
    it.each([
      ["anthropic", "@ai-sdk/anthropic", "anthropic", "https://api.anthropic.com"],
      ["openai", "@ai-sdk/openai", "openai-compatible", "https://api.openai.com/v1"],
      ["google", "@ai-sdk/google", "google", "https://generativelanguage.googleapis.com/v1beta"],
      ["groq", "@ai-sdk/groq", "openai-compatible", "https://api.groq.com/openai/v1"],
      ["togetherai", "@ai-sdk/togetherai", "openai-compatible", "https://api.together.ai/v1"],
      ["vercel", "@ai-sdk/gateway", "openai-compatible", "https://ai-gateway.vercel.sh/v1"],
    ])(
      `resolves the explicit %s protocol and endpoint (${ISSUE})`,
      (id, npm, providerType, defaultBaseUrl) => {
        expect(getProviderCapability({ id, npm })).toEqual(
          expect.objectContaining({ providerType, defaultBaseUrl, requiresApiKey: true })
        );
      }
    );
    it(`rejects a conflicting catalog protocol instead of routing to another API format (${ISSUE})`, () => {
      expect(getProviderCapability({ id: "anthropic", npm: "@ai-sdk/google" })).toBeNull();
      expect(
        getProviderCapability({
          id: "local",
          npm: "@ai-sdk/openai-compatible",
          api: "http://localhost:1234/v1",
        })?.requiresApiKey
      ).toBe(false);
    });
    it(`uses the catalog endpoint for a classified compatible provider (${ISSUE})`, () => {
      expect(
        getProviderCapability({
          id: "example",
          npm: "@ai-sdk/openai-compatible",
          api: "https://example.com/api/v3",
        })?.defaultBaseUrl
      ).toBe("https://example.com/api/v3");
    });
    it.each([
      "@ai-sdk/amazon-bedrock",
      "@ai-sdk/azure",
      "@ai-sdk/google-vertex",
      "watsonx-ai-provider",
      "gitlab-ai-provider",
      "@jerome-benoit/sap-ai-provider-v2",
      "ai-gateway-provider",
      "new-unknown-package",
      "toString",
      "__proto__",
      undefined,
    ])(`rejects unsupported or unknown npm %s (${ISSUE})`, (npm) => {
      expect(
        getProviderCapability({ id: "renamed-provider", npm, api: "https://example.com/v1" })
      ).toBeNull();
    });
    it(`rejects unresolved account placeholders rather than advertising an unusable provider (${ISSUE})`, () => {
      expect(
        getProviderCapability({
          id: "account-api",
          npm: "@ai-sdk/openai-compatible",
          api: "https://api.example.com/\u0024{ACCOUNT}/v1",
        })
      ).toBeNull();
    });
    it(`hides a catalog provider with no resolved address while keeping custom configuration separate (${ISSUE})`, () => {
      expect(
        getProviderCapability({ id: "custom-api", npm: "@ai-sdk/openai-compatible" })
      ).toBeNull();
    });
    it.each([
      ["opencode", "https://opencode.ai/inference/openai/v1", "https://opencode.ai/inference/v1"],
      [
        "opencode-go",
        "https://opencode.ai/inference/go/openai/v1",
        "https://opencode.ai/inference/go/v1",
      ],
    ])(
      `replaces the drifting %s catalog address with the reachable endpoint (${ISSUE})`,
      (id, catalogApi, reachable) => {
        expect(
          getProviderCapability({ id, npm: "@ai-sdk/openai-compatible", api: catalogApi })
            ?.defaultBaseUrl
        ).toBe(reachable);
      }
    );
    it(`falls back to the endpoint recorded by the locked Pi SDK when the catalog has none (${ISSUE})`, () => {
      const declared = DECLARED_PI_PROVIDER_ENDPOINTS["ant-ling"]?.["openai-completions"];
      expect(declared).toBeDefined();
      expect(
        getProviderCapability({ id: "ant-ling", npm: "@ai-sdk/openai-compatible" })?.defaultBaseUrl
      ).toBe(normalizeBaseUrlForProtocol(declared, "openai-compatible"));
    });
    it(`keeps OAuth-only catalog providers out of the API-key surface (${ISSUE})`, () => {
      expect(
        getProviderCapability({ id: "github-copilot", npm: "@ai-sdk/openai-compatible" })
      ).toBeNull();
    });
  });

  describe("declaredProviderEndpoint()", () => {
    it(`reads the protocol-specific endpoint recorded by the locked Pi SDK (${ISSUE})`, () => {
      expect(declaredProviderEndpoint("opencode-go", "openai-compatible")).toBe(
        "https://opencode.ai/inference/go/v1"
      );
      expect(declaredProviderEndpoint("opencode-go", "anthropic")).toBe(
        "https://opencode.ai/inference/go"
      );
    });
    it(`returns nothing for unknown providers (${ISSUE})`, () => {
      expect(declaredProviderEndpoint("unknown-provider", "openai-compatible")).toBeUndefined();
      expect(declaredProviderEndpoint(undefined, "openai-compatible")).toBeUndefined();
    });
  });

  describe("declaredEndpointSuggestion()", () => {
    it(`suggests the recorded endpoint while the resolved address disagrees (${ISSUE})`, () => {
      expect(
        declaredEndpointSuggestion(
          "opencode-go",
          "openai-compatible",
          "https://opencode.ai/inference/go/openai/v1"
        )
      ).toBe("https://opencode.ai/inference/go/v1");
    });
    it(`stays silent when the resolved address already matches or cannot be compared (${ISSUE})`, () => {
      expect(
        declaredEndpointSuggestion(
          "opencode-go",
          "openai-compatible",
          "https://opencode.ai/inference/go/v1"
        )
      ).toBeUndefined();
      expect(declaredEndpointSuggestion(undefined, "openai-compatible", undefined)).toBeUndefined();
      expect(
        declaredEndpointSuggestion(
          "unknown-provider",
          "openai-compatible",
          "https://example.com/v1"
        )
      ).toBeUndefined();
    });
  });

  describe("isModelListUnavailableCatalogProvider()", () => {
    it(`marks only providers whose service has no model-list endpoint (${ISSUE})`, () => {
      expect(isModelListUnavailableCatalogProvider("oci")).toBe(true);
      expect(isModelListUnavailableCatalogProvider("opencode-go")).toBe(false);
      expect(isModelListUnavailableCatalogProvider(undefined)).toBe(false);
    });
  });
  describe("endpoint overrides", () => {
    it.each([
      ["anthropic", "@ai-sdk/anthropic"],
      ["openai", "@ai-sdk/openai"],
      ["google", "@ai-sdk/google"],
      ["groq", "@ai-sdk/groq"],
      ["cerebras", "@ai-sdk/cerebras"],
      ["xai", "@ai-sdk/xai"],
      ["minimax", "@ai-sdk/anthropic"],
      ["minimax-cn", "@ai-sdk/anthropic"],
      ["opencode", "@ai-sdk/openai-compatible"],
      ["opencode-go", "@ai-sdk/openai-compatible"],
    ])(
      `agrees with the endpoint recorded by the locked SDK for %s so a correction cannot silently drift (${ISSUE})`,
      (id, npm) => {
        const capability = getProviderCapability({ id, npm });
        expect(capability).not.toBeNull();
        const declared = declaredProviderEndpoint(id, capability!.providerType);
        expect(declared).toBeDefined();
        expect(capability!.defaultBaseUrl).toBe(declared);
      }
    );
  });
  describe("getProviderUnsupportedReason()", () => {
    it(`explains why an OAuth-only catalog provider cannot be added with an API key (${ISSUE})`, () => {
      expect(
        getProviderUnsupportedReason({ id: "github-copilot", npm: "@ai-sdk/openai-compatible" })
      ).toMatch(/Copilot OAuth/i);
    });
    it(`distinguishes known unsupported authentication, unknown packages and invalid endpoints (${ISSUE})`, () => {
      expect(getProviderUnsupportedReason({ npm: "@ai-sdk/azure" })).toMatch(/deployment/i);
      expect(getProviderUnsupportedReason({ npm: "unknown" })).toMatch(/Unknown npm/);
      expect(getProviderUnsupportedReason({ npm: "toString" })).toMatch(/Unknown npm/);
      expect(
        getProviderUnsupportedReason({ id: "missing", npm: "@ai-sdk/openai-compatible" })
      ).toMatch(/No resolved endpoint/);
      expect(
        getProviderUnsupportedReason({ npm: "@ai-sdk/openai", api: "https://example.com/{id}" })
      ).toMatch(/Endpoint/);
      expect(
        getProviderUnsupportedReason({ npm: "@ai-sdk/openai", api: "https://example.com/v1" })
      ).toBeUndefined();
    });
  });
  describe("normalizeBaseUrlForProtocol()", () => {
    it.each([
      ["https://api.example.com/anthropic/v1/", "anthropic", "https://api.example.com/anthropic"],
      ["https://api.example.com", "openai-compatible", "https://api.example.com/v1"],
      ["https://api.example.com/api/v4/", "openai-compatible", "https://api.example.com/api/v4"],
      ["https://api.example.com/openai", "openai-compatible", "https://api.example.com/openai"],
      ["http://localhost:1234/v1/", "openai-compatible", "http://localhost:1234/v1"],
      [
        "https://generativelanguage.googleapis.com/v1beta",
        "google",
        "https://generativelanguage.googleapis.com/v1beta",
      ],
    ] as const)(`normalizes %s without duplicating a version (${ISSUE})`, (url, type, expected) =>
      expect(normalizeBaseUrlForProtocol(url, type)).toBe(expected)
    );
    it.each([
      "",
      "not-a-url",
      "ftp://api.example.com/v1",
      "https://api.example.com/{account}/v1",
      "https://user:password@api.example.com/v1",
    ])(`rejects invalid endpoint %s (${ISSUE})`, (url) =>
      expect(normalizeBaseUrlForProtocol(url, "openai-compatible")).toBeUndefined()
    );
  });
  describe("resolveProviderBaseUrl()", () => {
    it(`fills a missing known endpoint while leaving unknown compatible providers unroutable (${ISSUE})`, () => {
      expect(resolveProviderBaseUrl(provider(undefined, "openai"))).toBe(
        "https://api.openai.com/v1"
      );
      expect(resolveProviderBaseUrl(provider(undefined, "unknown"))).toBeUndefined();
      expect(resolveProviderBaseUrl(provider())).toBeUndefined();
    });
    it(`fills an empty legacy address from a loaded matching catalog capability without replacing user addresses (${ISSUE})`, () => {
      const capability = getProviderCapability({
        id: "catalog-service",
        npm: "@ai-sdk/openai-compatible",
        api: "https://service.example/api/v3",
      })!;
      expect(resolveProviderBaseUrl(provider(undefined, "catalog-service"), capability)).toBe(
        "https://service.example/api/v3"
      );
      expect(
        resolveProviderBaseUrl(
          provider("https://my-proxy.example/custom", "catalog-service"),
          capability
        )
      ).toBe("https://my-proxy.example/custom");
      expect(
        resolveProviderBaseUrl(
          { ...provider(undefined, "catalog-service"), providerType: "google" },
          capability
        )
      ).toBeUndefined();
    });
    it(`migrates only the exact obsolete MiniMax default and preserves a user address (${ISSUE})`, () => {
      const legacy = {
        ...provider("https://api.minimax.io/anthropic/v1", "minimax"),
        providerType: "anthropic" as const,
      };
      expect(resolveProviderBaseUrl(legacy)).toBe("https://api.minimax.io/anthropic");
      expect(
        resolveProviderBaseUrl({ ...legacy, baseUrl: "https://my-proxy.example/anthropic/v1" })
      ).toBe("https://my-proxy.example/anthropic/v1");
    });
    it.each([
      ["opencode", "https://opencode.ai/inference/openai/v1", "https://opencode.ai/inference/v1"],
      [
        "opencode-go",
        "https://opencode.ai/inference/go/openai/v1",
        "https://opencode.ai/inference/go/v1",
      ],
    ])(
      `repairs a stored %s address only when it still matches the old catalog default (${ISSUE})`,
      (id, stored, reachable) => {
        expect(resolveProviderBaseUrl(provider(stored, id))).toBe(reachable);
      }
    );
    it(`fills an empty legacy address from the locked SDK endpoint when the catalog has none (${ISSUE})`, () => {
      const declared = DECLARED_PI_PROVIDER_ENDPOINTS["ant-ling"]?.["openai-completions"];
      expect(declared).toBeDefined();
      expect(resolveProviderBaseUrl(provider(undefined, "ant-ling"))).toBe(
        normalizeBaseUrlForProtocol(declared, "openai-compatible")
      );
    });
    it(`does not borrow a native catalog address after a protocol change (${ISSUE})`, () => {
      expect(
        resolveProviderBaseUrl({ ...provider(undefined, "anthropic"), providerType: "google" })
      ).toBeUndefined();
    });
  });
});
