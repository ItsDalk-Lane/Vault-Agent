import type { Context } from "@earendil-works/chord";
import type { Harness, ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";
import { createPiMcpTools } from "./createPiMcpTools";
import { piMcpFixture, mcpConfig } from "./__tests__/piMcpFixture";
import type { PermissionDecision, PermissionPrompt } from "@/agentMode/session/types";

jest.mock(
  "@earendil-works/pi-durable",
  () => ({ defineDoc: (definition: unknown) => ({ definition }) }),
  { virtual: true }
);
jest.mock("@earendil-works/chord/context", () => ({ BACKGROUND_CONTEXT: {} }), { virtual: true });

jest.mock(
  "@earendil-works/pi-ai",
  () => ({
    Type: {
      Object: (properties: unknown) => ({ type: "object", properties }),
      String: () => ({ type: "string" }),
    },
  }),
  { virtual: true }
);

function api(conversationId = "root-conversation") {
  return { callId: "call-1", conversationId } as unknown as ToolExecutionApi;
}
function context(signal?: AbortSignal) {
  return { abortSignal: signal } as Context;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function mcpSession() {
  interface State {
    selections: { serverId: string; fingerprint: string; toolName: string; schemaHash: string }[];
  }
  interface TestToken {
    definition: { kind: string; initial: () => Record<string, unknown> };
  }
  let saved = new Map<string, Record<string, unknown>>();
  const snapshot = jest.fn(
    async (token?: TestToken) =>
      saved.get(token?.definition.kind ?? "va.mcp.loaded") as unknown as State | undefined
  );
  const commit = jest.fn(
    async (
      apply: (tx: {
        doc: (token: TestToken) => Promise<Record<string, unknown>>;
      }) => Promise<unknown>
    ) => {
      const drafts = new Map(
        [...saved].map(([key, value]) => [
          key,
          JSON.parse(JSON.stringify(value)) as Record<string, unknown>,
        ])
      );
      const result = await apply({
        doc: async (token) => {
          const key = token.definition.kind;
          if (!drafts.has(key)) drafts.set(key, token.definition.initial());
          return drafts.get(key)!;
        },
      });
      saved = drafts;
      return result;
    }
  );
  return {
    snapshot,
    commit,
    harness: { snapshot, conversation: async () => ({ commit }) } as unknown as Pick<
      Harness,
      "snapshot" | "conversation"
    >,
  };
}

describe("createPiMcpTools", () => {
  describe("createPiMcpTools()", () => {
    it("executes an approved real client call with its concrete arguments https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture();
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: mcpSession().harness,
        emit: () => undefined,
      });
      const tool = tools.registrations.find(
        (registration) => registration.name !== "mcp_search_tools"
      )!;
      const result = await tool.execute({ text: "approved input" }, api(), context());
      expect(result).toMatchObject({
        isError: false,
        output: [{ type: "text", text: "approved output" }],
      });
      expect(fixture.clients[0]?.callTool).toHaveBeenCalledWith(
        "echo",
        { text: "approved input" },
        expect.any(Object)
      );
      expect(fixture.options.requestPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCall: expect.objectContaining({ rawInput: { text: "approved input" } }),
        })
      );
      await tools.dispose();
    });

    it("keeps separate approval and progress cards for different SDK tasks that reuse call IDs https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture();
      const emit = jest.fn();
      const requestPermission = jest.fn(
        async (_request: PermissionPrompt): Promise<PermissionDecision> => ({
          outcome: { outcome: "selected", optionId: "allow_once" },
        })
      );
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: mcpSession().harness,
        emit,
        requestPermission,
      });
      fixture.clients[0]?.callTool.mockImplementation(async (_name, _args, options) => {
        options.onProgress?.({ progress: 1 });
        return { content: [{ type: "text", text: "approved output" }] };
      });
      const tool = tools.registrations.find((item) => item.name !== "mcp_search_tools")!;
      for (const taskId of [101, 102])
        await tool.execute(
          { text: "approved input" },
          { ...api("1"), callId: "call_0", taskId } as ToolExecutionApi,
          context()
        );
      expect(fixture.clients[0]?.callTool).toHaveBeenCalledTimes(2);
      expect(requestPermission.mock.calls.map(([request]) => request.toolCall.toolCallId)).toEqual([
        "pi-task:root-test:101",
        "pi-task:root-test:102",
      ]);
      expect(emit.mock.calls.map(([update]) => update.toolCallId)).toEqual(
        expect.arrayContaining(["pi-task:root-test:101", "pi-task:root-test:102"])
      );
      await tools.dispose();
    });

    it("blocks further external effects across sibling conversations and reopening after a dispatched call becomes unknown https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture();
      const session = mcpSession();
      const options = {
        ...fixture.options,
        conversationId: "1",
        harness: session.harness,
        emit: () => undefined,
      };
      const first = await createPiMcpTools(options);
      const tool = first.registrations.find((item) => item.name !== "mcp_search_tools")!;
      fixture.clients[0].callTool.mockRejectedValueOnce(
        new Error("Connection closed after remote execution")
      );
      await tool.execute({ text: "mutation" }, api("2"), context());
      const blocked = await tool.execute(
        { text: "another mutation" },
        { ...api("3"), callId: "sibling-call" },
        context()
      );
      expect(fixture.clients[0].callTool).toHaveBeenCalledTimes(1);
      expect(blocked).toMatchObject({ isError: true });
      expect(first.recovery.decisions).toEqual([
        expect.objectContaining({ serverId: "docs", canContinue: false, effect: "unknown" }),
      ]);
      expect((await first.reconcile()).decisions[0].canContinue).toBe(false);
      await first.dispose();
      const restored = await createPiMcpTools(options);
      const restoredTool = restored.registrations.find((item) => item.name !== "mcp_search_tools")!;
      await restoredTool.execute(
        { text: "new connection does not prove prior effects" },
        { ...api("1"), callId: "reconnected" },
        context()
      );
      expect(fixture.clients[1].callTool).not.toHaveBeenCalled();
      expect((await restored.reconcile()).decisions[0].effect).toBe("unknown");
      await restored.dispose();
    });

    it("allows a locally verified read-only status tool while keeping the original unknown outcome blocked https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture();
      const session = mcpSession();
      const createClient = fixture.options.sdk!.createClient;
      jest.spyOn(fixture.options.sdk!, "createClient").mockImplementation((config) => {
        const client = createClient(config) as unknown as (typeof fixture.clients)[number];
        const catalog = [
          { name: "echo", inputSchema: { type: "object" } },
          { name: "status", inputSchema: { type: "object" } },
        ];
        client.listTools.mockResolvedValue(catalog);
        client.request.mockResolvedValue({ tools: catalog });
        return client;
      });
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: session.harness,
        emit: () => undefined,
        riskFor: (tool) =>
          tool.toolName === "status"
            ? { effects: ["read"], unknownEffects: false }
            : { effects: ["network"], unknownEffects: true },
      });
      const mutation = tools.registrations.find((item) => item.name.includes("_echo_"))!;
      const status = tools.registrations.find((item) => item.name.includes("_status_"))!;
      fixture.clients[0].callTool.mockRejectedValueOnce(new Error("Remote result lost"));
      await mutation.execute({}, api("2"), context());
      const checked = await status.execute({}, { ...api("3"), callId: "check-only" }, context());
      expect(checked.isError).toBe(false);
      expect(fixture.clients[0].callTool).toHaveBeenCalledTimes(2);
      expect((await tools.reconcile()).decisions[0].canContinue).toBe(false);
      await tools.dispose();
    });

    it("stores the pending outcome before dispatch and blocks a concurrent sibling until a successful result is saved https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture();
      const session = mcpSession();
      const started = deferred<void>();
      const answer = deferred<{ content: { type: "text"; text: string }[] }>();
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: session.harness,
        emit: () => undefined,
      });
      fixture.clients[0].callTool.mockImplementationOnce(async () => {
        started.resolve();
        return answer.promise;
      });
      const tool = tools.registrations.find((item) => item.name !== "mcp_search_tools")!;
      const first = tool.execute({}, api("2"), context());
      await started.promise;
      expect(tools.recovery.decisions[0].effect).toBe("unknown");
      await tool.execute({}, { ...api("3"), callId: "concurrent" }, context());
      expect(fixture.clients[0].callTool).toHaveBeenCalledTimes(1);
      answer.resolve({ content: [{ type: "text", text: "completed" }] });
      await first;
      expect(tools.recovery.decisions[0].canContinue).toBe(true);
      await tool.execute({}, { ...api("3"), callId: "after-completion" }, context());
      expect(fixture.clients[0].callTool).toHaveBeenCalledTimes(2);
      await tools.dispose();
    });

    it("never dispatches without the pending durable record and retains unknown when the completion write fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture();
      const session = mcpSession();
      const onUnknownEffect = jest.fn(async () => undefined);
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: session.harness,
        emit: () => undefined,
        onUnknownEffect,
      });
      const tool = tools.registrations.find((item) => item.name !== "mcp_search_tools")!;
      session.commit.mockRejectedValueOnce(new Error("pending write failed"));
      await tool.execute({}, api("2"), context());
      expect(fixture.clients[0].callTool).not.toHaveBeenCalled();
      const commit = session.commit.getMockImplementation()!;
      session.commit
        .mockImplementationOnce(commit)
        .mockRejectedValueOnce(new Error("completion write failed"));
      await expect(
        tool.execute({}, { ...api("2"), callId: "completion-failure" }, context())
      ).rejects.toThrow("completion write failed");
      expect(fixture.clients[0].callTool).toHaveBeenCalledTimes(1);
      expect((await tools.reconcile()).decisions[0].effect).toBe("unknown");
      expect(onUnknownEffect).toHaveBeenCalledTimes(1);
      await tools.dispose();
    });

    it("uses the durable task identity so separate real executions may reuse a provider call identifier https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture();
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: mcpSession().harness,
        emit: () => undefined,
      });
      const tool = tools.registrations.find((item) => item.name !== "mcp_search_tools")!;
      const first = await tool.execute(
        {},
        { ...api("2"), taskId: 100 as ToolExecutionApi["taskId"] },
        context()
      );
      const second = await tool.execute(
        {},
        { ...api("2"), taskId: 101 as ToolExecutionApi["taskId"] },
        context()
      );
      expect(first.isError).toBe(false);
      expect(second.isError).toBe(false);
      expect(fixture.clients[0].callTool).toHaveBeenCalledTimes(2);
      await tools.dispose();
    });

    it.each(["资料查询台", "Research Desk"])(
      "discovers and installs the actual deferred tool schema using the configured service display name %s https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (displayName) => {
        const serverId = "server-6d5f9e0a-41bd-4f1d-a808";
        const fixture = piMcpFixture([
          mcpConfig({ serverId, displayName, toolExposure: "deferred" }),
        ]);
        const loaded: ToolRegistration[] = [];
        const tools = await createPiMcpTools({
          ...fixture.options,
          conversationId: "1",
          harness: mcpSession().harness,
          emit: () => undefined,
          installTools: (additions) => loaded.push(...additions),
        });
        expect(loaded).toEqual([]);
        const search = tools.registrations.find((tool) => tool.name === "mcp_search_tools")!;
        const response = await search.execute(
          { query: displayName.toUpperCase() },
          api("1"),
          context()
        );
        expect(loaded).toHaveLength(1);
        expect(loaded[0]).toMatchObject({
          deferred: true,
          parameters: {
            type: "object",
            required: ["text"],
            properties: { text: { type: "string" } },
          },
        });
        const text = response.output?.find((block) => block.type === "text");
        if (text?.type !== "text") throw new Error("missing tool directory result");
        expect(JSON.parse(text.text)).toEqual([
          expect.objectContaining({
            serverId,
            serverDisplayName: displayName,
            name: loaded[0].name,
            parameters: loaded[0].parameters,
          }),
        ]);
        expect(response.control?.addTools).toEqual([loaded[0].name]);
        await tools.dispose();
      }
    );

    it("connects deferred servers only when directory search is invoked and installs native deferred tools https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture([mcpConfig({ toolExposure: "deferred" })]);
      const install = jest.fn();
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: mcpSession().harness,
        emit: () => undefined,
        installTools: install,
      });
      expect(fixture.clients).toHaveLength(0);
      expect(tools.registrations.map((tool) => tool.name)).toEqual(["mcp_search_tools"]);
      const found = await tools.registrations[0].execute({ query: "echo" }, api(), context());
      const loaded = install.mock.calls[0]?.[0] as readonly ToolRegistration[];
      expect(loaded).toHaveLength(1);
      expect(loaded[0]?.deferred).toBe(true);
      expect(found.control?.addTools).toEqual([loaded[0]?.name]);
      await loaded[0].execute({ text: "approved input" }, api(), context());
      expect(fixture.clients[0]?.callTool).toHaveBeenCalledTimes(1);
      await tools.dispose();
    });

    it("never connects or registers hidden servers even for nested calls https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture([mcpConfig({ toolExposure: "hidden" })]);
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: mcpSession().harness,
        emit: () => undefined,
      });
      expect(tools.registrations).toEqual([]);
      expect(fixture.clients).toHaveLength(0);
      await tools.dispose();
    });

    it("rejects external effects from a read-only child even when its parent is in default mode https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture();
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: mcpSession().harness,
        emit: () => undefined,
        isReadOnly: (id) => id === "child",
      });
      const result = await tools.registrations[0].execute(
        { text: "denied input" },
        api("child"),
        context()
      );
      expect(result.isError).toBe(true);
      expect(fixture.options.requestPermission).not.toHaveBeenCalled();
      expect(fixture.clients[0]?.callTool).not.toHaveBeenCalled();
      await tools.dispose();
    });

    it("cancels while approval is pending without starting a late external effect https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture();
      const approval = deferred<PermissionDecision>();
      const started = deferred<PermissionPrompt>();
      const controller = new AbortController();
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: mcpSession().harness,
        requestPermission: (request) => {
          started.resolve(request);
          return approval.promise;
        },
        emit: () => undefined,
      });
      const running = tools.registrations[0].execute(
        { text: "cancelled input" },
        api(),
        context(controller.signal)
      );
      await started.promise;
      controller.abort();
      expect((await running).isError).toBe(true);
      approval.resolve({ outcome: { outcome: "selected", optionId: "allow_once" } });
      expect(fixture.clients[0]?.callTool).not.toHaveBeenCalled();
      await tools.dispose();
    });

    it("invalidates approval if the server is disabled while the user is reviewing it https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture();
      const approval = deferred<PermissionDecision>();
      const started = deferred<void>();
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: mcpSession().harness,
        requestPermission: () => {
          started.resolve();
          return approval.promise;
        },
        emit: () => undefined,
      });
      const running = tools.registrations[0].execute({ text: "stale input" }, api(), context());
      await started.promise;
      fixture.change([mcpConfig({ enabled: false })]);
      approval.resolve({ outcome: { outcome: "selected", optionId: "allow_once" } });
      expect((await running).isError).toBe(true);
      expect(fixture.clients[0]?.callTool).not.toHaveBeenCalled();
      await tools.dispose();
    });

    it("keeps secrets out of successful output and failed-call errors https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture([
        mcpConfig({
          transport: {
            kind: "http",
            url: "https://mcp.example.com/mcp",
            headerSecretRefs: { Authorization: "mcp:docs:authorization" },
          },
        }),
      ]);
      fixture.secrets.set("mcp:docs:authorization", "Bearer private-token");
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: mcpSession().harness,
        emit: () => undefined,
      });
      fixture.clients[0].callTool.mockResolvedValueOnce({
        content: [{ type: "text", text: "echo private-token" }],
      });
      expect(
        JSON.stringify(await tools.registrations[0].execute({ text: "read" }, api(), context()))
      ).not.toContain("private-token");
      fixture.clients[0].callTool.mockRejectedValueOnce(new Error("failed private-token"));
      expect(
        JSON.stringify(await tools.registrations[0].execute({ text: "read" }, api(), context()))
      ).not.toContain("private-token");
      await tools.dispose();
    });

    it("saves deferred tool origins before exposing them and restores only matching current schemas https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture([mcpConfig({ toolExposure: "deferred" })]);
      const session = mcpSession();
      const install = jest.fn();
      const options = {
        ...fixture.options,
        conversationId: "1",
        harness: session.harness,
        emit: () => undefined,
        installTools: install,
      };
      const first = await createPiMcpTools(options);
      const found = await first.registrations[0].execute({ query: "echo" }, api("1"), context());
      expect(session.commit).toHaveBeenCalledTimes(1);
      expect((await session.snapshot())?.selections).toEqual([
        expect.objectContaining({
          serverId: "docs",
          fingerprint: mcpConfig({ toolExposure: "deferred" }).fingerprint,
          toolName: found.control?.addTools?.[0],
        }),
      ]);
      await first.dispose();
      install.mockClear();
      const restored = await createPiMcpTools(options);
      expect(install).not.toHaveBeenCalled();
      await restored.prepare("1");
      expect(install.mock.calls[0]?.[0].map((tool: ToolRegistration) => tool.name)).toEqual(
        found.control?.addTools
      );
      await restored.dispose();
    });

    it.each(["disabled", "untrusted", "hidden", "removed", "changed"])(
      "does not restore %s servers from persisted tool names https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (change) => {
        const fixture = piMcpFixture([mcpConfig({ toolExposure: "deferred" })]);
        const session = mcpSession();
        const install = jest.fn();
        const options = {
          ...fixture.options,
          conversationId: "1",
          harness: session.harness,
          emit: () => undefined,
          installTools: install,
        };
        const first = await createPiMcpTools(options);
        await first.registrations[0].execute({ query: "echo" }, api("1"), context());
        await first.dispose();
        fixture.change(
          change === "removed"
            ? []
            : [
                mcpConfig({
                  toolExposure: change === "hidden" ? "hidden" : "deferred",
                  enabled: change !== "disabled",
                  trusted: change !== "untrusted",
                  ...(change === "changed"
                    ? {
                        transport: {
                          kind: "http",
                          url: "https://changed.example/mcp",
                          headerSecretRefs: {},
                        },
                      }
                    : {}),
                }),
              ]
        );
        install.mockClear();
        const restored = await createPiMcpTools(options);
        await restored.prepare("1");
        expect(install).not.toHaveBeenCalled();
        await restored.dispose();
      }
    );

    it("keeps changed schemas unavailable until the user searches their current catalog again https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture([mcpConfig({ toolExposure: "deferred" })]);
      const session = mcpSession();
      const install = jest.fn();
      const options = {
        ...fixture.options,
        conversationId: "1",
        harness: session.harness,
        emit: () => undefined,
        installTools: install,
      };
      const first = await createPiMcpTools(options);
      await first.registrations[0].execute({ query: "echo" }, api("1"), context());
      await first.dispose();
      const state = await session.snapshot();
      state!.selections[0].schemaHash = "previous-schema";
      install.mockClear();
      const restored = await createPiMcpTools(options);
      await restored.prepare("1");
      expect(install).not.toHaveBeenCalled();
      await restored.dispose();
    });

    it("leaves local chat available when a saved external server cannot reconnect https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture([mcpConfig({ toolExposure: "deferred" })]);
      const session = mcpSession();
      const install = jest.fn();
      const options = {
        ...fixture.options,
        conversationId: "1",
        harness: session.harness,
        emit: () => undefined,
        installTools: install,
      };
      const first = await createPiMcpTools(options);
      await first.registrations[0].execute({ query: "echo" }, api("1"), context());
      await first.dispose();
      const originalClient = fixture.options.sdk!.createClient;
      jest.spyOn(fixture.options.sdk!, "createClient").mockImplementation((config) => {
        const client = originalClient(config);
        client.connect = async () => {
          throw new Error("fixture external server unavailable");
        };
        return client;
      });
      install.mockClear();
      const restored = await createPiMcpTools(options);
      await expect(restored.prepare("1")).resolves.toBeUndefined();
      expect(install).not.toHaveBeenCalled();
      await restored.dispose();
    });

    it("propagates snapshot and commit failures without publishing deferred tool registrations https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = piMcpFixture([mcpConfig({ toolExposure: "deferred" })]);
      const session = mcpSession();
      const install = jest.fn();
      const tools = await createPiMcpTools({
        ...fixture.options,
        conversationId: "1",
        harness: session.harness,
        emit: () => undefined,
        installTools: install,
      });
      session.snapshot.mockRejectedValueOnce(new Error("snapshot unavailable"));
      await expect(tools.prepare("1")).rejects.toThrow("snapshot unavailable");
      session.commit.mockRejectedValueOnce(new Error("disk full"));
      await expect(
        tools.registrations[0].execute({ query: "echo" }, api("1"), context())
      ).rejects.toThrow("disk full");
      expect(install).not.toHaveBeenCalled();
      expect(await session.snapshot()).toBeUndefined();
      await tools.dispose();
    });
  });
});
