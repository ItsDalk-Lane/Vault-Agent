import { execFileSync } from "node:child_process";

import { getProviderCapability, normalizeBaseUrlForProtocol } from "@/utils/providerCapability";

interface BuiltinProviderFact {
  id: string;
  models: { api: string; baseUrl: string }[];
}

const FACTS = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { getBuiltinProviders, getBuiltinModels } from "@earendil-works/pi-ai/providers/all"; process.stdout.write(JSON.stringify(getBuiltinProviders().map(id => ({ id, models: getBuiltinModels(id).map(model => ({ api: model.api, baseUrl: model.baseUrl })) }))));',
    ],
    { encoding: "utf8" }
  )
) as BuiltinProviderFact[];
const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/2";

const CATALOG_ROWS = Object.freeze([
  { id: "anthropic", npm: "@ai-sdk/anthropic", builtin: "anthropic" },
  { id: "openai", npm: "@ai-sdk/openai", builtin: "openai" },
  { id: "google", npm: "@ai-sdk/google", builtin: "google" },
  { id: "groq", npm: "@ai-sdk/groq", builtin: "groq" },
  { id: "cerebras", npm: "@ai-sdk/cerebras", builtin: "cerebras" },
  { id: "togetherai", npm: "@ai-sdk/togetherai", builtin: "together" },
  { id: "xai", npm: "@ai-sdk/xai", builtin: "xai" },
  { id: "minimax", npm: "@ai-sdk/anthropic", builtin: "minimax" },
  { id: "minimax-cn", npm: "@ai-sdk/anthropic", builtin: "minimax-cn" },
  { id: "vercel", npm: "@ai-sdk/gateway", builtin: "vercel-ai-gateway" },
  { id: "mistral", npm: "@ai-sdk/mistral", builtin: "mistral" },
]);

describe("providerCapabilityContract", () => {
  describe("getProviderCapability()", () => {
    it(`requires a policy audit when the locked Pi provider set changes (${ISSUE})`, () => {
      expect(FACTS.map((fact) => fact.id).sort()).toEqual([
        "amazon-bedrock",
        "ant-ling",
        "anthropic",
        "azure",
        "baseten",
        "cerebras",
        "cloudflare-ai-gateway",
        "cloudflare-workers-ai",
        "deepseek",
        "fireworks",
        "github-copilot",
        "google",
        "google-vertex",
        "groq",
        "huggingface",
        "kimi-coding",
        "meta",
        "minimax",
        "minimax-cn",
        "mistral",
        "moonshotai",
        "moonshotai-cn",
        "nvidia",
        "openai",
        "openai-codex",
        "opencode",
        "opencode-go",
        "openrouter",
        "qwen-token-plan",
        "qwen-token-plan-cn",
        "qwen-token-plan-individual",
        "radius",
        "together",
        "typesafe",
        "vercel-ai-gateway",
        "xai",
        "xiaomi",
        "xiaomi-token-plan-ams",
        "xiaomi-token-plan-cn",
        "xiaomi-token-plan-sgp",
        "zai",
        "zai-coding-cn",
      ]);
    });
    it.each(CATALOG_ROWS)(
      `resolves $id to the public Pi host, using the compatible /v1 route when the catalog chooses OpenAI format (${ISSUE})`,
      (row) => {
        const capability = getProviderCapability(row);
        expect(capability).not.toBeNull();
        const bases = FACTS.find((fact) => fact.id === row.builtin)?.models.map((model) =>
          normalizeBaseUrlForProtocol(model.baseUrl, capability!.providerType)
        );
        expect(bases).toContain(capability!.defaultBaseUrl);
        expect(capability!.defaultBaseUrl).toMatch(/^https:\/\//);
        if (capability!.providerType === "anthropic")
          expect(capability!.defaultBaseUrl).not.toMatch(/\/v1$/);
      }
    );
  });
});
