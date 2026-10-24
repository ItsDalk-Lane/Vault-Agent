import { execFileSync } from "node:child_process";
import { BuiltinModelCatalog } from "@/modelManagement";

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

const CATALOG_ROWS = new BuiltinModelCatalog().getAllProviders();

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
    it(`keeps checked-in model and catalog data identical to the locked SDK (${ISSUE})`, () => {
      expect(() =>
        execFileSync(
          process.execPath,
          ["src/agentMode/sdk/pi/models/generateDeclaredModels.mjs", "--check"],
          { encoding: "utf8" }
        )
      ).not.toThrow();
    });
    it.each(CATALOG_ROWS)(
      `resolves bundled $id to its public Pi protocol endpoint (${ISSUE})`,
      (row) => {
        const capability = getProviderCapability(row);
        expect(capability).not.toBeNull();
        const bases = FACTS.find((fact) => fact.id === row.id)?.models.map((model) =>
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
