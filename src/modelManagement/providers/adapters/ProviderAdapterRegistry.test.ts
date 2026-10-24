jest.mock("@/utils", () => ({ safeFetchNoThrow: jest.fn() }));

import { safeFetchNoThrow } from "@/utils";
import type { ProviderType } from "@/modelManagement/types/catalog";
import { createDefaultAdapterRegistry } from "./ProviderAdapterRegistry";

const mockFetch = jest.mocked(safeFetchNoThrow);
const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";

const FORMATS: readonly [string, ProviderType, boolean, string, string][] = [
  [
    "OpenAI Chat Completions",
    "openai-compatible",
    false,
    "https://api.openai.com/v1",
    "https://api.openai.com/v1/models",
  ],
  [
    "OpenAI Responses",
    "openai-compatible",
    true,
    "https://api.openai.com/v1",
    "https://api.openai.com/v1/models",
  ],
  [
    "Anthropic Messages",
    "anthropic",
    false,
    "https://api.anthropic.com",
    "https://api.anthropic.com/v1/models",
  ],
  [
    "Google Generative AI",
    "google",
    false,
    "https://generativelanguage.googleapis.com/v1beta",
    "https://generativelanguage.googleapis.com/v1beta/models?key=test-key",
  ],
];

describe("ProviderAdapterRegistry", () => {
  describe("ProviderAdapterRegistry", () => {
    describe("verifyCredentials()", () => {
      beforeEach(() => {
        mockFetch.mockReset().mockResolvedValue({ status: 200, text: async () => "" } as Response);
      });
      it.each(FORMATS)(
        `verifies the saved %s format with its shared Responses selection and correct destination (${ISSUE})`,
        async (_name, providerType, useResponsesApi, baseUrl, requestUrl) => {
          const registry = createDefaultAdapterRegistry();
          const result = await registry.verifyCredentials(providerType, {
            provider: {
              providerId: "draft",
              providerType,
              displayName: "Draft provider",
              baseUrl,
              origin: { kind: "byok" },
              addedAt: 0,
            },
            apiKey: "test-key",
            extras: {
              useResponsesApi,
              ...(providerType === "openai-compatible" ? { openAIOrgId: "org-example" } : {}),
            },
          });
          expect(result.ok).toBe(true);
          expect(mockFetch).toHaveBeenCalledWith(
            requestUrl,
            expect.objectContaining({ method: "GET" })
          );
          const headers = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
          expect(headers["OpenAI-Organization"]).toBe(
            providerType === "openai-compatible" ? "org-example" : undefined
          );
        }
      );
      it.each(FORMATS)(
        `continues rejecting unknown extra fields for %s (${ISSUE})`,
        (_name, providerType, _responses, baseUrl) => {
          const registry = createDefaultAdapterRegistry();
          expect(() =>
            registry.verifyCredentials(providerType, {
              provider: {
                providerId: "draft",
                providerType,
                displayName: "Draft provider",
                baseUrl,
                origin: { kind: "byok" },
                addedAt: 0,
              },
              apiKey: "test-key",
              extras: { unknownOption: true },
            })
          ).toThrow();
          expect(mockFetch).not.toHaveBeenCalled();
        }
      );
    });
  });
});
