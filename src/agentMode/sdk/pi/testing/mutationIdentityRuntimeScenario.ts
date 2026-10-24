import { TFile, type App } from "obsidian";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import type { VaultAgentSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";
const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");
export async function runMutationIdentityRuntimeScenario(directory: string) {
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const files = new Map<string, TFile>();
  let writes = 0;
  const app = {
    vault: {
      configDir: ".test-config",
      adapter: { getBasePath: () => vaultRoot },
      getAbstractFileByPath: (target: string) => files.get(target) ?? null,
      getFiles: () => [...files.values()],
      getMarkdownFiles: () => [...files.values()],
      read: (file: TFile) => fs.readFile(path.join(vaultRoot, file.path), "utf8"),
      process: async (file: TFile, update: (current: string) => string) => {
        const target = path.join(vaultRoot, file.path);
        const next = update(await fs.readFile(target, "utf8"));
        await fs.writeFile(target, next);
        writes += 1;
      },
      create: async (target: string, content: string) => {
        writes += 1;
        await fs.writeFile(path.join(vaultRoot, target), content, { flag: "wx" });
        const file = Object.assign(new TFile(), {
          path: target,
          extension: "md",
          stat: { size: content.length },
        });
        files.set(target, file);
        return file;
      },
      on: () => ({}),
      offref: () => undefined,
    },
    metadataCache: { resolvedLinks: {}, unresolvedLinks: {}, getFileCache: () => null },
    workspace: { iterateAllLeaves: () => undefined },
  } as unknown as App;
  const settings = {
    providers: {
      fixture: {
        providerId: "fixture",
        providerType: "openai-compatible",
        baseUrl: "https://fixture.invalid/v1",
        origin: { kind: "byok" },
        apiKeyKeychainId: "key",
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "saved",
        providerId: "fixture",
        info: { id: "model", toolCall: true, limits: { context: 262144, output: 4096 } },
        configuredAt: 1,
      },
    ],
    agentMode: {
      activeBackend: "pi",
      backends: { pi: { defaultMode: "auto" } },
      skills: { folder: "skills" },
    },
    backends: { pi: { enabledModels: ["saved"] } },
  } as unknown as VaultAgentSettings;
  const faux = fauxProvider();
  const options = {
    host: {
      app,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "mutation-identity",
        getSecretById: (id: string) => (id === "key" ? "test-key" : null),
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
      getSettings: () => settings,
      privateRoot: path.join(directory, "private"),
      streamsFactory: () => faux.provider,
    },
  };
  let backend = new PiBackendProcess(options);
  const sessionId = "root-identity";
  let messages: readonly AgentChatMessage[] = [];
  const observe = () =>
    backend.registerSessionHandler(sessionId, (event) => {
      if (event.update.sessionUpdate === "session_projection")
        messages = event.update.projection.messages;
    });
  try {
    await backend.start();
    await backend.newSession({ sessionId, cwd: vaultRoot });
    observe();
    for (const [name, content] of [
      ["first.md", "first actual effect"],
      ["second.md", "second actual effect"],
    ]) {
      faux.setResponses([
        fauxAssistantMessage(
          [{ ...fauxToolCall("vault_create", { path: name, content }), id: "call_reused" }],
          { stopReason: "toolUse" }
        ),
        fauxAssistantMessage("done " + name),
      ]);
      await backend.prompt({
        sessionId,
        requestId: name,
        prompt: [{ type: "text", text: "create " + name }],
      });
    }
    assert.equal(writes, 2, "distinct SDK tasks with reused provider call ids must both write");
    assert.equal(
      await fs.readFile(path.join(vaultRoot, "first.md"), "utf8"),
      "first actual effect"
    );
    assert.equal(
      await fs.readFile(path.join(vaultRoot, "second.md"), "utf8"),
      "second actual effect"
    );
    await backend.shutdown();
    backend = new PiBackendProcess(options);
    await backend.start();
    observe();
    await backend.loadSession({ sessionId, cwd: vaultRoot });
    const exported = JSON.parse(
      (await backend.exportSession({ sessionId, format: "json" })).content
    ) as {
      session: {
        extras: { entries: { kind: string; data?: Record<string, unknown> }[] };
        messages: { text: string }[];
      };
    };
    const cards = messages
      .flatMap((message) => message.parts ?? [])
      .filter(
        (part) =>
          part.kind === "tool_call" &&
          part.input &&
          typeof part.input === "object" &&
          "path" in part.input
      );
    assert.equal(
      cards.length,
      2,
      "reused vendor ids must keep two independent historical tool cards"
    );
    assert.equal(new Set(cards.map((card) => (card.kind === "tool_call" ? card.id : ""))).size, 2);
    assert.ok(cards.every((card) => card.kind === "tool_call" && card.status === "completed"));
    const mutations = exported.session.extras.entries.filter(
      (entry) => entry.kind === "va.mutation"
    );
    assert.equal(mutations.length, 2);
    assert.equal(new Set(mutations.map((entry) => entry.data?.operationId)).size, 2);
    assert.equal(writes, 2);
    assert.equal(faux.state.callCount, 4, "cold reopen cannot replay either write");
    for (const tool of ["vault_edit", "vault_frontmatter"] as const) {
      for (const version of ["canonical", "legacy", "canonical_with_stale_alias"] as const) {
        let fromRead: string | undefined;
        const beforeWrites: number = writes;
        faux.setResponses([
          fauxAssistantMessage([fauxToolCall("vault_read", { path: "first.md" })], {
            stopReason: "toolUse",
          }),
          (context) => {
            const read = context.messages.findLast(
              (message) => message.role === "toolResult" && message.toolName === "vault_read"
            );
            assert.ok(read && read.role === "toolResult");
            const body = read.content.find(
              (part) => part.type === "text" && part.text.startsWith("{")
            );
            assert.ok(body && body.type === "text");
            const result = JSON.parse(body.text) as { ok: boolean; value: { fileVersion: string } };
            assert.equal(result.ok, true);
            fromRead = result.value.fileVersion;
            assert.match(fromRead, /^[a-f0-9]{64}$/);
            const versions =
              version === "legacy"
                ? { expectedHash: fromRead }
                : {
                    fileVersion: fromRead,
                    ...(version === "canonical_with_stale_alias"
                      ? { expectedHash: "0".repeat(64) }
                      : {}),
                  };
            return fauxAssistantMessage(
              [
                fauxToolCall(tool, {
                  path: "first.md",
                  ...versions,
                  ...(tool === "vault_edit"
                    ? {
                        edits: [
                          {
                            oldText: "first actual effect",
                            newText: `first actual effect ${version}`,
                          },
                        ],
                      }
                    : { set: { versionContract: version } }),
                }),
              ],
              { stopReason: "toolUse" }
            );
          },
          (context) => {
            const result = context.messages.findLast(
              (message) => message.role === "toolResult" && message.toolName === tool
            );
            assert.ok(result && result.role === "toolResult");
            assert.equal(
              result.isError,
              false,
              `${tool} accepts ${version} from the actual vault_read result`
            );
            return fauxAssistantMessage("实际版本已验证并保存");
          },
        ]);
        await backend.prompt({
          sessionId,
          requestId: `${tool}-${version}`,
          prompt: [{ type: "text", text: `read then ${tool} using returned whole-file version` }],
        });
        assert.ok(fromRead);
        assert.equal(writes, beforeWrites + 1);
      }
      const beforeWrites: number = writes;
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall(tool, {
              path: "first.md",
              ...(tool === "vault_edit"
                ? { edits: [{ oldText: "first actual effect", newText: "must not write" }] }
                : { set: { mustNotWrite: true } }),
            }),
          ],
          { stopReason: "toolUse" }
        ),
        (context) => {
          const material = JSON.stringify(context.messages);
          assert.ok(
            material.includes("host-sdk-tool-rejections"),
            `${tool} missing version must fail in SDK validation before the host executes`
          );
          assert.ok(material.includes("invalid_arguments"));
          return fauxAssistantMessage("缺版本已提前拒绝，未写入");
        },
      ]);
      await backend.prompt({
        sessionId,
        requestId: `${tool}-missing-version`,
        prompt: [{ type: "text", text: "verify missing version is rejected before host write" }],
      });
      assert.equal(writes, beforeWrites, "invalid SDK arguments must never write");
      const rejected = JSON.parse(
        (await backend.exportSession({ sessionId, format: "json" })).content
      ) as typeof exported;
      assert.equal(
        rejected.session.extras.entries.filter(
          (entry) =>
            entry.kind === "pi.tool-result" &&
            JSON.stringify(entry).includes(tool) &&
            JSON.stringify(entry).includes("invalid_arguments")
        ).length,
        1,
        `${tool} must record exactly one SDK validation rejection`
      );
    }
    const unicodePath = Array.from({ length: 8 }, () => "资料".repeat(12)).join("/") + "/长文.md";
    const longContent = "🙂资料".repeat(14000) + "结尾可修改";
    const absolute = path.join(vaultRoot, unicodePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, longContent);
    files.set(
      unicodePath,
      Object.assign(new TFile(), {
        path: unicodePath,
        extension: "md",
        stat: { size: longContent.length },
      })
    );
    const pages: string[] = [];
    let fileVersion: string | undefined;
    let edited = false;
    const beforeUnicodeWrites: number = writes;
    const pageResponse: Parameters<typeof faux.setResponses>[0][number] = (context) => {
      const latest = context.messages.findLast((message) => message.role === "toolResult");
      assert.ok(latest && latest.role === "toolResult");
      const body = latest.content.find((part) => part.type === "text" && part.text.startsWith("{"));
      assert.ok(body && body.type === "text", "model must receive a parseable JSON read envelope");
      let result: {
        ok: boolean;
        value?: {
          path: string;
          content: string;
          fileVersion: string;
          truncated: boolean;
          nextCursor?: string;
        };
      };
      try {
        result = JSON.parse(body.text) as typeof result;
      } catch {
        throw new Error(
          "SDK output truncation damaged the model-visible Unicode read envelope before fileVersion/cursor could be consumed"
        );
      }
      assert.equal(result.ok, true);
      if (latest.toolName === "vault_edit") {
        edited = true;
        return fauxAssistantMessage("完整分页读取后已用原完整版本修改尾段");
      }
      assert.equal(latest.toolName, "vault_read");
      assert.ok(result.value);
      assert.equal(result.value.path, unicodePath);
      assert.match(result.value.fileVersion, /^[a-f0-9]{64}$/);
      if (fileVersion) assert.equal(result.value.fileVersion, fileVersion);
      fileVersion = result.value.fileVersion;
      pages.push(result.value.content);
      if (result.value.truncated) {
        assert.ok(
          result.value.nextCursor,
          "every truncated model-visible page must preserve the continuation cursor"
        );
        return fauxAssistantMessage(
          [fauxToolCall("vault_read", { path: unicodePath, cursor: result.value.nextCursor })],
          { stopReason: "toolUse" }
        );
      }
      assert.equal(pages.join(""), longContent);
      return fauxAssistantMessage(
        [
          fauxToolCall("vault_edit", {
            path: unicodePath,
            fileVersion,
            edits: [{ oldText: "结尾可修改", newText: "尾段已保存" }],
          }),
        ],
        { stopReason: "toolUse" }
      );
    };
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("vault_read", { path: unicodePath })], {
        stopReason: "toolUse",
      }),
      ...Array.from({ length: 6 }, () => pageResponse),
    ]);
    await backend.prompt({
      sessionId,
      requestId: "unicode-read-envelope",
      prompt: [{ type: "text", text: "分页读完长路径文档后，用读取返回的原完整版本修改唯一尾段" }],
    });
    assert.ok(pages.length >= 2, "the real SDK must preserve more than one read page");
    assert.equal(edited, true);
    assert.equal(writes, beforeUnicodeWrites + 1);
    assert.equal(
      await fs.readFile(absolute, "utf8"),
      longContent.replace("结尾可修改", "尾段已保存")
    );
    return {
      status: "passed",
      checks: [
        "reused_provider_call_id_has_two_actual_effects",
        "distinct_durable_mutation_receipts",
        "two_independent_completed_historical_cards",
        "cold_reopen_does_not_replay_effects",
        "sdk_edit_and_frontmatter_accept_real_read_version_and_legacy_alias",
        "sdk_missing_whole_file_version_rejected_before_host_execution",
        "sdk_unicode_read_preserves_json_version_and_cursor_before_edit",
      ],
      providerCalls: faux.state.callCount,
    };
  } finally {
    await backend.shutdown();
  }
}
