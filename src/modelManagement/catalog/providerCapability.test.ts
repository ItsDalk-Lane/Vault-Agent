import {
  declaredProviderEndpoint,
  getProviderCapability,
  normalizeBaseUrlForProtocol,
  resolveProviderBaseUrl,
} from "./providerCapability";
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
    it(`uses the built-in protocol, endpoint and Responses choice (${ISSUE})`, () => {
      expect(
        getProviderCapability({
          providerType: "openai-compatible",
          defaultBaseUrl: "https://api.example.com",
          useResponsesApi: true,
        })
      ).toEqual({
        providerType: "openai-compatible",
        defaultBaseUrl: "https://api.example.com/v1",
        useResponsesApi: true,
        requiresApiKey: true,
      });
    });
    it(`leaves local endpoints keyless and does not guess missing provider facts (${ISSUE})`, () => {
      expect(
        getProviderCapability({
          providerType: "openai-compatible",
          defaultBaseUrl: "http://localhost:1234/v1",
        })?.requiresApiKey
      ).toBe(false);
      expect(getProviderCapability({ defaultBaseUrl: "https://example.com/v1" })).toBeNull();
      expect(getProviderCapability({ providerType: "anthropic" })).toBeNull();
      expect(
        getProviderCapability({
          providerType: "anthropic",
          defaultBaseUrl: "https://example.com/{account}",
        })
      ).toBeNull();
    });
  });
  describe("declaredProviderEndpoint()", () => {
    it(`uses the SDK endpoint for the requested protocol and leaves missing facts unresolved (${ISSUE})`, () => {
      expect(declaredProviderEndpoint("anthropic", "anthropic")).toBe("https://api.anthropic.com");
      expect(declaredProviderEndpoint("openai", "openai-compatible")).toBe(
        "https://api.openai.com/v1"
      );
      expect(declaredProviderEndpoint("anthropic", "google")).toBeUndefined();
      expect(declaredProviderEndpoint(undefined, "google")).toBeUndefined();
      expect(declaredProviderEndpoint("unknown", "google")).toBeUndefined();
    });
  });
  describe("normalizeBaseUrlForProtocol()", () => {
    it.each([
      ["https://api.example.com/anthropic/v1/", "anthropic", "https://api.example.com/anthropic"],
      ["https://api.example.com", "openai-compatible", "https://api.example.com/v1"],
      ["https://api.example.com/api/v4/", "openai-compatible", "https://api.example.com/api/v4"],
      ["http://localhost:1234/v1/", "openai-compatible", "http://localhost:1234/v1"],
      [
        "https://generativelanguage.googleapis.com/v1beta",
        "google",
        "https://generativelanguage.googleapis.com/v1beta",
      ],
    ] as const)(`normalizes %s without duplicating a version (${ISSUE})`, (url, type, expected) => {
      expect(normalizeBaseUrlForProtocol(url, type)).toBe(expected);
    });
    it.each([
      "",
      "not-a-url",
      "ftp://api.example.com/v1",
      "https://api.example.com/{account}/v1",
      "https://user:password@api.example.com/v1",
      "https://api.example.com/v1?key=secret",
    ])(`rejects invalid endpoint %s (${ISSUE})`, (url) => {
      expect(normalizeBaseUrlForProtocol(url, "openai-compatible")).toBeUndefined();
    });
  });
  describe("resolveProviderBaseUrl()", () => {
    it.each(["agent", "retired"])(
      `does not infer a built-in endpoint for a loaded %s source (${ISSUE})`,
      (kind) => {
        const unavailable = {
          ...provider(undefined, "openai"),
          origin: { kind, catalogProviderId: "openai" },
        } as unknown as Provider;
        expect(resolveProviderBaseUrl(unavailable)).toBeUndefined();
      }
    );

    it(`uses an explicit saved address without rewriting it from a catalog (${ISSUE})`, () => {
      expect(resolveProviderBaseUrl(provider("https://my-proxy.example/custom", "openai"))).toBe(
        "https://my-proxy.example/custom"
      );
      expect(
        resolveProviderBaseUrl({
          ...provider("https://api.minimax.io/anthropic/v1", "minimax"),
          providerType: "anthropic",
        })
      ).toBe("https://api.minimax.io/anthropic/v1");
      expect(resolveProviderBaseUrl(provider("not-a-url", "openai"))).toBeUndefined();
    });
    it(`uses a declared endpoint only when no explicit address is present (${ISSUE})`, () => {
      expect(resolveProviderBaseUrl(provider(undefined, "openai"))).toBe(
        "https://api.openai.com/v1"
      );
      expect(resolveProviderBaseUrl(provider())).toBeUndefined();
      expect(
        resolveProviderBaseUrl({ ...provider(undefined, "anthropic"), providerType: "google" })
      ).toBeUndefined();
    });
    it(`accepts only a matching catalog protocol as an endpoint suggestion (${ISSUE})`, () => {
      const capability = getProviderCapability({
        providerType: "openai-compatible",
        defaultBaseUrl: "https://service.example/api/v3",
      })!;
      expect(resolveProviderBaseUrl(provider(undefined, "custom"), capability)).toBe(
        "https://service.example/api/v3"
      );
      expect(
        resolveProviderBaseUrl(
          { ...provider(undefined, "custom"), providerType: "google" },
          capability
        )
      ).toBeUndefined();
    });
  });
});
