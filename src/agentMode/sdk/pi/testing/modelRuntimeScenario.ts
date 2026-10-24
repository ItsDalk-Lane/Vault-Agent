import { requireNodeModule } from "@/utils/desktopRuntime";
import type { VaultAgentSettings } from "@/settings/model";
import { createPiModels } from "@/agentMode/sdk/pi/runtime/PiRuntimeModels";

export async function runModelRuntimeScenario() {
  const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
  const http = requireNodeModule<typeof import("node:http")>("node:http");
  const requests: { authorization: string | undefined; content: string }[] = [];
  const respond = async (
    request: import("node:http").IncomingMessage,
    response: import("node:http").ServerResponse
  ): Promise<void> => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of request) chunks.push(new Uint8Array(chunk as Uint8Array));
    requests.push({
      authorization: request.headers.authorization,
      content: Buffer.concat(chunks).toString("utf8"),
    });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const value of [
      {
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "本地真实协议回答" },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      },
    ])
      response.write(
        `data: ${JSON.stringify({ id: "connection-test", object: "chat.completion.chunk", created: 1, model: "local-model", ...value })}\n\n`
      );
    response.end("data: [DONE]\n\n");
  };
  const server = http.createServer((request, response) => {
    void respond(request, response).catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const settings = {
      providers: {
        local: {
          providerId: "local",
          providerType: "openai-compatible",
          displayName: "Local test",
          origin: { kind: "byok" },
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          requiresApiKey: false,
          addedAt: 1,
        },
      },
      configuredModels: [
        {
          configuredModelId: "local-model",
          providerId: "local",
          info: { id: "local-model", displayName: "Local model", toolCall: true },
          configuredAt: 1,
        },
      ],
    } as unknown as VaultAgentSettings;
    const keychain = {
      isAvailable: () => true,
      getVaultId: () => "connection-test",
      getSecretById: () => null,
      setSecretById: () => undefined,
      deleteSecretById: () => undefined,
    };
    const runtime = await createPiModels({ settings, keychain });
    const model = runtime.models.getModel("local", "local-model");
    assert.ok(model);
    const result = await runtime.models.complete(model, {
      messages: [{ role: "user", content: "ping", timestamp: 1 }],
    });
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.equal(
      result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
      "本地真实协议回答"
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].authorization, undefined);
    assert.ok(requests[0].content.includes("ping"));
    return {
      status: "passed",
      checks: [
        "actual_openai_protocol",
        "explicit_keyless_local_endpoint",
        "real_stream_and_usage",
      ],
      requests: requests.length,
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}
