import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models";
import { format, resolveConfig } from "prettier";

const destination = new URL("./declaredPiModels.generated.ts", import.meta.url);
const endpointsDestination = new URL(
  "../../../../utils/declaredPiProviderEndpoints.generated.ts",
  import.meta.url
);

// 构建时读取公开目录，仅投影运行必需的事实，避免把所有供应商工厂和全量目录带入插件。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
const facts = Object.fromEntries(
  getBuiltinProviders().map((providerId) => [
    providerId,
    Object.fromEntries(
      getBuiltinModels(providerId).map((model) => [
        model.id,
        {
          id: model.id,
          api: model.api,
          input: model.input,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          reasoning: model.reasoning,
          reasoningEfforts: getSupportedThinkingLevels(model).filter((level) => level !== "off"),
          ...(model.compat ? { compat: model.compat } : {}),
          ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
        },
      ])
    ),
  ])
);

// 端点事实与模型事实同源：供应商地址随 SDK 升级一起更新，不靠插件里的手写特判。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
const DEPLOYABLE_PROTOCOLS = new Set([
  "anthropic-messages",
  "google-generative-ai",
  "openai-completions",
  "openai-responses",
]);

const endpoints = Object.fromEntries(
  getBuiltinProviders()
    .map((providerId) => {
      const byProtocol = new Map();
      for (const model of getBuiltinModels(providerId)) {
        if (!model.baseUrl || !DEPLOYABLE_PROTOCOLS.has(model.api)) continue;
        const existing = byProtocol.get(model.api);
        if (existing === undefined) byProtocol.set(model.api, model.baseUrl);
        else if (existing !== model.baseUrl) byProtocol.set(model.api, null);
      }
      const unambiguous = [...byProtocol].filter(([, baseUrl]) => typeof baseUrl === "string");
      return [providerId, Object.fromEntries(unambiguous)];
    })
    .filter(([, byProtocol]) => Object.keys(byProtocol).length > 0)
);

const source = await format(
  `// 由锁定 Pi SDK 的公开目录自动生成；能力事实不得手工修改。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2\nimport type { DeclaredPiModelFact } from "./DeclaredPiModelFacts";\nexport const DECLARED_PI_MODEL_FACTS: Readonly<Record<string, Readonly<Record<string, DeclaredPiModelFact>>>> = ${JSON.stringify(facts)};\n`,
  { ...(await resolveConfig(fileURLToPath(destination))), parser: "typescript" }
);

const endpointsSource = await format(
  `// 由锁定 Pi SDK 的公开目录自动生成；端点事实不得手工修改。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2\nexport const DECLARED_PI_PROVIDER_ENDPOINTS: Readonly<Record<string, Readonly<Record<string, string>>>> = ${JSON.stringify(endpoints)};\n`,
  { ...(await resolveConfig(fileURLToPath(endpointsDestination))), parser: "typescript" }
);

if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== source) {
    throw new Error(
      "Pi model declarations drifted: run npm run generate:pi-models and review the SDK facts."
    );
  }
  if ((await readFile(endpointsDestination, "utf8")) !== endpointsSource) {
    throw new Error(
      "Pi provider endpoints drifted: run npm run generate:pi-models and review the SDK facts."
    );
  }
} else {
  await writeFile(destination, source);
  await writeFile(endpointsDestination, endpointsSource);
}
process.stdout.write(
  `${JSON.stringify({
    providers: Object.keys(facts).length,
    models: Object.values(facts).reduce((total, models) => total + Object.keys(models).length, 0),
    endpointProviders: Object.keys(endpoints).length,
    status: process.argv.includes("--check") ? "matched" : "generated",
  })}\n`
);
