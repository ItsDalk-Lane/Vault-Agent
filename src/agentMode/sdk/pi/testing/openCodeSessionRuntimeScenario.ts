import { requireNodeModule } from "@/utils/desktopRuntime";
import type { VaultAgentSettings } from "@/settings/model";
import type { ProviderStreams } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createPiModels } from "@/agentMode/sdk/pi/runtime/PiRuntimeModels";

export async function runOpenCodeSessionScenario() {
  const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
  const captured: Record<string, string | null | undefined>[] = [];
  const transports: (typeof window.fetch | undefined)[] = [];
  const fetch: typeof window.fetch = async () => {
    throw new Error("Unexpected network request");
  };
  const respond = () => fauxAssistantMessage("ok");
  const createFakeStream = () => ({
    async *[Symbol.asyncIterator]() {
      yield* [];
    },
    result: async () => respond(),
  });
  const streams = {
    stream: (
      _model: unknown,
      _context: unknown,
      options?: { headers?: Record<string, string | null>; fetch?: typeof window.fetch }
    ) => {
      captured.push({ ...options?.headers });
      transports.push(options?.fetch);
      return createFakeStream();
    },
    streamSimple: (
      _model: unknown,
      _context: unknown,
      options?: { headers?: Record<string, string | null>; fetch?: typeof window.fetch }
    ) => {
      captured.push({ ...options?.headers });
      transports.push(options?.fetch);
      return createFakeStream();
    },
  } as unknown as ProviderStreams;

  const settings = {
    providers: {
      opencode: {
        providerId: "opencode",
        providerType: "openai-compatible",
        displayName: "OpenCode Go",
        extras: { openAIOrgId: "  org-fixture  " },
        baseUrl: "https://opencode.ai/inference/go/v1",
        origin: { kind: "byok" },
        requiresApiKey: false,
        addedAt: 1,
      },
      local: {
        providerId: "local",
        providerType: "openai-compatible",
        displayName: "Local",
        extras: { openAIOrgId: "   " },
        baseUrl: "https://example.test/v1",
        origin: { kind: "byok" },
        requiresApiKey: false,
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "opencode-model",
        providerId: "opencode",
        info: { id: "opencode-model", toolCall: true },
        configuredAt: 1,
      },
      {
        configuredModelId: "local-model",
        providerId: "local",
        info: { id: "local-model", toolCall: true },
        configuredAt: 1,
      },
    ],
  } as unknown as VaultAgentSettings;
  const keychain = {
    isAvailable: () => true,
    getVaultId: () => "open-code-session-fixture",
    getSecretById: () => null,
    setSecretById: () => undefined,
    deleteSecretById: () => undefined,
  };
  for (const protocol of ["anthropic", "responses", "google"] as const) {
    settings.providers[protocol] = {
      providerId: protocol,
      providerType: protocol === "responses" ? "openai-compatible" : protocol,
      displayName: protocol,
      baseUrl: "https://example.test/v1",
      origin: { kind: "byok" },
      requiresApiKey: false,
      addedAt: 1,
      extras: { useResponsesApi: protocol === "responses", openAIOrgId: "org-fixture" },
    };
    settings.configuredModels.push({
      configuredModelId: protocol,
      providerId: protocol,
      info: { id: protocol, displayName: protocol },
      configuredAt: 1,
    });
  }
  const runtime = await createPiModels({
    settings,
    keychain,
    streamsFactory: () => streams,
    fetch,
  });
  const openCodeModel = runtime.models.getModel("opencode", "opencode-model");
  const localModel = runtime.models.getModel("local", "local-model");
  assert.ok(openCodeModel);
  assert.ok(localModel);
  const context = { messages: [{ role: "user" as const, content: "ping", timestamp: 1 }] };
  await runtime.models.complete(openCodeModel, context);
  await runtime.models.complete(openCodeModel, context, {
    headers: { "OpenAI-Organization": "request-org", "x-test-header": "kept" },
  });
  await runtime.models.complete(localModel, context);

  const first = captured[0]?.["x-opencode-session"];
  assert.ok(typeof first === "string" && first.length > 0);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(captured[1]?.["x-opencode-session"], first);
  assert.equal(captured[2]?.["x-opencode-session"], undefined);
  assert.equal(captured[0]?.["OpenAI-Organization"], "org-fixture");
  assert.equal(captured[1]?.["OpenAI-Organization"], "request-org");
  assert.equal(captured[1]?.["x-test-header"], "kept");
  assert.equal(captured[0]?.authorization, null);
  assert.equal(captured[2]?.["OpenAI-Organization"], undefined);
  await runtime.models.completeSimple(openCodeModel, context);
  for (const protocol of ["anthropic", "responses", "google"]) {
    const model = runtime.models.getModel(protocol, protocol);
    assert.ok(model);
    await runtime.models.completeSimple(
      model,
      context,
      protocol === "responses"
        ? { headers: { "openai-organization": "lowercase-request-org" } }
        : undefined
    );
  }
  assert.equal(captured[3]?.["OpenAI-Organization"], "org-fixture");
  assert.equal(captured[4]?.["OpenAI-Organization"], undefined);
  assert.equal(captured[5]?.["OpenAI-Organization"], undefined);
  assert.equal(captured[5]?.["openai-organization"], "lowercase-request-org");
  assert.equal(captured[6]?.["OpenAI-Organization"], undefined);
  await runtime.models.completeSimple(openCodeModel, context, {
    headers: { "OpenAI-Organization": null },
  });
  const responsesModel = runtime.models.getModel("responses", "responses");
  assert.ok(responsesModel);
  await runtime.models.complete(responsesModel, context);
  assert.equal(captured[7]?.["OpenAI-Organization"], null);
  assert.equal(captured[7]?.["x-opencode-session"], first);
  assert.equal(captured[8]?.["OpenAI-Organization"], "org-fixture");
  assert.deepEqual(transports, [fetch, fetch, fetch, fetch, fetch, fetch, undefined, fetch, fetch]);
  return {
    status: "passed",
    checks: [
      "opencode_session_header_present",
      "opencode_session_header_stable",
      "other_provider_unaffected",
      "host_stream_transport_for_openai_and_anthropic",
      "google_does_not_receive_unsupported_fetch",
      "organization_header_preserved_with_case_insensitive_request_priority",
    ],
    requests: captured.length,
  };
}
