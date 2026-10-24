import { CapabilityCatalog } from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import { compileHostToolDefinition } from "@/agentMode/sdk/pi/tools/HostToolDefinition";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import type { App } from "obsidian";
import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi, Conversation, Harness } from "@earendil-works/pi-durable";
import type { VaultAgentSettings } from "@/settings/model";
import {
  createPiFeatureTools,
  type PiFeatureToolsOptions,
} from "@/agentMode/sdk/pi/runtime/PiFeatureTools";
import type { SkillCatalogSourcePort } from "@/agentMode/sdk/pi/features/SkillsCatalog";

jest.mock(
  "@earendil-works/pi-durable",
  () => ({ defineDoc: (definition: unknown) => ({ definition }) }),
  { virtual: true }
);
jest.mock(
  "@earendil-works/pi-ai",
  () => ({
    Type: {
      Array: jest.fn((items) => ({ type: "array", items })),
      Boolean: jest.fn(() => ({ type: "boolean" })),
      Object: jest.fn((properties) => ({ type: "object", properties })),
      Optional: jest.fn((schema) => schema),
      String: jest.fn(() => ({ type: "string" })),
    },
  }),
  { virtual: true }
);
jest.mock(
  "@earendil-works/chord/context",
  () => ({
    BACKGROUND_CONTEXT: {},
    withAbortSignal: (signal: AbortSignal, context: object) => ({
      ...context,
      abortSignal: signal,
    }),
  }),
  { virtual: true }
);

async function pendingFixture(
  skillsSource?: SkillCatalogSourcePort,
  overrides: Partial<PiFeatureToolsOptions> = {}
) {
  const documents = new Map<string, unknown>();
  const results = new Map<string, Record<string, unknown>>();
  interface Token {
    definition: { kind: string; initial?: () => { value: unknown } };
  }
  interface State {
    revision: number;
    updatedAtMs: number;
    value: unknown;
    results: Record<string, unknown>;
  }
  interface Transaction {
    doc(token: Token): Promise<State>;
    appendEntry(): Promise<void>;
  }
  const snapshot = jest.fn(async (token: { definition: { kind: string } }) => {
    const value = documents.get(token.definition.kind);
    return value === undefined
      ? undefined
      : { revision: 1, updatedAtMs: 1, value, results: results.get(token.definition.kind) ?? {} };
  });
  let commits: Promise<void> = Promise.resolve();
  const conversation = {
    id: "conversation",
    commit: jest.fn((apply: (transaction: Transaction) => Promise<void>) => {
      const write = commits.then(async () => {
        const pending = new Map<string, State>();
        await apply({
          doc: async (token) => {
            const state = {
              revision: 1,
              updatedAtMs: 1,
              value: JSON.parse(
                JSON.stringify(
                  documents.get(token.definition.kind) ?? token.definition.initial?.().value ?? null
                )
              ),
              results: { ...results.get(token.definition.kind) },
            };
            pending.set(token.definition.kind, state);
            return state;
          },
          appendEntry: async () => undefined,
        });
        for (const [kind, state] of pending) {
          documents.set(kind, state.value);
          results.set(kind, state.results);
        }
      });
      commits = write.catch(() => undefined);
      return write;
    }),
    submit: jest.fn(),
  };
  const ask = jest.fn();
  const requestPermission = jest.fn();
  const setMode = jest.fn();
  const emit = jest.fn();
  const features = await createPiFeatureTools({
    app: {} as App,
    harness: { snapshot } as unknown as Harness,
    conversation: conversation as unknown as Conversation,
    sessionId: "root",
    getMode: () => "plan",
    setMode,
    emit,
    ask,
    requestPermission,
    privateDir: "/private",
    settings: () => ({ agentMode: { offerFeedbackCards: true } }) as unknown as VaultAgentSettings,
    skillsSource,
    ...overrides,
  });
  snapshot.mockClear();
  emit.mockClear();
  return {
    features,
    documents,
    results,
    snapshot,
    conversation,
    ask,
    requestPermission,
    setMode,
    emit,
  };
}

const savedQuestion = {
  requestId: "question-original",
  sessionId: "root",
  questions: [
    {
      question: "检查哪些内容？",
      options: [{ label: "标题" }, { label: "正文", description: "检查正文" }],
      multiSelect: true,
      allowOther: true,
      answerKey: "check",
    },
  ],
  status: "pending",
  answers: null,
  createdAtMs: 1,
  updatedAtMs: 1,
};

const savedPlan = {
  planId: "plan-original",
  revision: 2,
  title: "核对计划",
  body: "先核对原文，再提交修改预览。",
  steps: ["核对原文"],
  decision: "pending",
  permissionGated: true,
  pendingToolCallId: "root:plan-call",
  bodySource: "propose_plan",
  createdAtMs: 1,
  updatedAtMs: 2,
};

describe("PiFeatureTools", () => {
  describe("prepareContext()", () => {
    it("persists only the latest project update beside the original project context across turns https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const { features } = await pendingFixture();
      await features.prepareContext({
        text: "Original project rules",
        sourcePath: "project/AGENTS.md",
      });
      await features.prepareContext({ text: "Old context warning", updateOnly: true });
      const updated = await features.prepareContext({
        text: "Latest context warning",
        updateOnly: true,
      });
      expect(updated.project?.text).toBe("Original project rules\n\nLatest context warning");
      expect(await features.prepareContext()).toEqual(updated);
      await features.prepareContext({
        text: "Replacement project rules",
        sourcePath: "project/AGENTS.md",
      });
      expect((await features.prepareContext()).project?.text).toBe("Replacement project rules");
      await features.dispose();
    });

    it("restores selected skill sections and the owning project without resending the skill body as a user turn https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const body = "Review only the supplied material.";
      const fixture = await pendingFixture({
        listSkills: async () => [
          {
            name: "review",
            description: "Review",
            filePath: "skills/review/SKILL.md",
            dirPath: "skills/review",
            enabledAgents: ["pi"],
            body,
            location: { kind: "canonical" },
          },
        ],
        readBody: async () => body,
      });
      const features = fixture.features as typeof fixture.features & {
        prepareContext(project?: { text: string; sourcePath?: string }): Promise<{
          project?: { text: string; sourcePath?: string };
          skills: readonly { skillId: string; text: string; contentHash: string; trust: string }[];
        }>;
      };
      await features.loadSkill("canonical:review", "selected");
      const selected = await features.prepareContext({
        text: "Project rules",
        sourcePath: "project.md",
      });
      expect(selected).toMatchObject({
        project: { text: "Project rules", sourcePath: "project.md" },
        skills: [
          {
            skillId: "canonical:review",
            text: body,
            contentHash: expect.any(String),
            trust: "user",
            sourcePath: "skills/review/SKILL.md",
            scope: "skills/review",
          },
        ],
      });
      expect(await features.prepareContext()).toEqual(selected);
      expect(JSON.stringify(fixture.conversation.submit.mock.calls)).not.toContain(body);
      expect(JSON.stringify(fixture.documents.get("va.context"))).toContain(body);
      await features.dispose();
    });

    it("requires reselection after a selected skill changes and stops reading it immediately when disabled https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let body = "Selected version.";
      let enabled = true;
      let sourcePath = "skills/review/SKILL.md";
      const readBody = jest.fn(async () => body);
      const fixture = await pendingFixture({
        listSkills: async () => [
          {
            name: "review",
            description: "Review",
            filePath: sourcePath,
            dirPath: "skills/review",
            enabledAgents: enabled ? ["pi"] : [],
            body,
            location: { kind: "canonical" },
          },
        ],
        readBody,
      });
      const features = fixture.features as typeof fixture.features & {
        prepareContext(): Promise<{ skills: readonly unknown[] }>;
      };
      await features.loadSkill("canonical:review");
      body = "Changed version.";
      await expect(features.prepareContext()).rejects.toThrow("重新选择");
      expect(
        await fixture.features.prepareContext(undefined, {
          readOnly: true,
          refreshInstructions: true,
        })
      ).toMatchObject({
        skills: [
          {
            text: "Changed version.",
            contentHash: expect.any(String),
            sourcePath: "skills/review/SKILL.md",
            scope: "skills/review",
          },
        ],
      });
      sourcePath = "skills/rebound/SKILL.md";
      const beforeRebound = readBody.mock.calls.length;
      expect(
        await fixture.features.prepareContext(undefined, {
          readOnly: true,
          refreshInstructions: true,
        })
      ).toMatchObject({ skills: [], notices: [expect.stringContaining("another source")] });
      expect(readBody).toHaveBeenCalledTimes(beforeRebound);
      enabled = false;
      const before = readBody.mock.calls.length;
      expect(await features.prepareContext()).toMatchObject({ skills: [] });
      expect(readBody).toHaveBeenCalledTimes(before);
      await features.dispose();
    });
  });

  describe("createPiFeatureTools()", () => {
    it("preserves a pending question when disposing for a saved pause and stops accepting fresh feature calls https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = await pendingFixture();
      const controller = new AbortController();
      let shown!: () => void;
      const displayed = new Promise<void>((resolve) => {
        shown = resolve;
      });
      let withdrawn!: () => void;
      const hidden = new Promise<void>((resolve) => {
        withdrawn = resolve;
      });
      fixture.ask.mockImplementation(
        (request) =>
          new Promise((resolve) => {
            request.signal?.addEventListener(
              "abort",
              () => {
                withdrawn();
                resolve({});
              },
              { once: true }
            );
            shown();
          })
      );
      const tool = fixture.features.registrations.find((item) => item.name === "ask_user")!;
      const api = {
        taskId: 12,
        conversationId: "conversation",
        callId: "question",
      } as unknown as ToolExecutionApi;
      const running = tool.execute(
        { questions: [{ question: "Which?", options: [{ label: "A" }] }] },
        api,
        { abortSignal: controller.signal } as Context
      );
      await displayed;
      await fixture.features.dispose({ preservePending: true });
      await hidden;
      expect(await fixture.features.pendingQuestions()).toEqual([
        expect.objectContaining({ requestId: "12" }),
      ]);
      expect(controller.signal.aborted).toBe(false);
      expect(
        await tool.execute(
          { questions: [{ question: "New?", options: [{ label: "A" }] }] },
          { ...api, taskId: 13 } as ToolExecutionApi,
          {} as Context
        )
      ).toMatchObject({ isError: true });
      expect(fixture.ask).toHaveBeenCalledTimes(1);
      controller.abort();
      await running;
      await fixture.features.dispose();
      expect(await fixture.features.pendingQuestions()).toEqual([
        expect.objectContaining({ requestId: "12" }),
      ]);
    });

    it("keeps skill text readable while each optional script separately rechecks the actual command capability https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const capabilities = new CapabilityCatalog();
      let commandAvailable = false;
      capabilities.setExecutionGate(async (name) => ({
        caller: "root",
        ...(name === "bash" && !commandAvailable
          ? { block: "Local programs are unavailable" }
          : {}),
      }));
      const execute = jest.fn(async () => ({
        output: [{ type: "text" as const, text: "actual command result" }],
      }));
      const command = compileHostToolDefinition(
        {
          toolId: "bash",
          family: "host_process",
          effects: ["execute"],
          allowedCallers: ["root"],
          description: "Run an explicitly approved command.",
          parameters: { type: "object" },
          replay: "unsafe",
          outputLimits: { maxBytes: 1024 },
          execute,
        },
        capabilities
      );
      const fixture = await pendingFixture(
        {
          listSkills: async () => [
            {
              name: "review",
              description: "Review",
              filePath: "skills/review/SKILL.md",
              dirPath: "skills/review",
              enabledAgents: ["pi"],
              body: "Read the supplied text.",
              location: { kind: "canonical" },
            },
          ],
          readBody: async () => "Read the supplied text.",
        },
        {
          capabilities,
          settings: () =>
            ({
              agentMode: {
                offerFeedbackCards: true,
                backends: { pi: { hostExecutionMode: "trusted_host" } },
              },
            }) as unknown as VaultAgentSettings,
          runSkillHostProcess: (input, api, context) =>
            command.execute({ command: input.command }, api, context),
        }
      );
      const load = fixture.features.registrations.find((tool) => tool.name === "load_skill")!;
      const api = { conversationId: 1, taskId: 2, callId: "skill" } as unknown as ToolExecutionApi;
      expect(load.description).toContain("separate local-program action");
      expect(await load.execute({ skillId: "canonical:review" }, api, {} as Context)).toMatchObject(
        { isError: false, output: [{ text: "Read the supplied text." }] }
      );
      expect(
        await load.execute(
          { skillId: "canonical:review", script: { command: "fixture" } },
          api,
          {} as Context
        )
      ).toMatchObject({
        isError: true,
        details: { outcome: { effect: "not_applied", error: { code: "TOOL_EXECUTION_BLOCKED" } } },
      });
      expect(execute).not.toHaveBeenCalled();
      commandAvailable = true;
      expect(
        await load.execute(
          { skillId: "canonical:review", script: { command: "fixture" } },
          api,
          {} as Context
        )
      ).toMatchObject({
        isError: false,
        output: [{ text: "actual command result" }],
        details: { outcome: { effect: "applied" } },
      });
      expect(execute).toHaveBeenCalledTimes(1);
      await fixture.features.dispose();
    });
    it("registers actual feature effects and roles and rechecks the current web-search setting https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const capabilities = new CapabilityCatalog();
      let enabled = true;
      const fixture = await pendingFixture(undefined, {
        capabilities,
        webSearch: async () => ({ content: "", citations: [] }),
        settings: () =>
          ({
            firecrawlApiKey: enabled ? "fixture-key" : "",
            selfHostSearchProvider: "firecrawl",
            agentMode: { offerFeedbackCards: true },
          }) as unknown as VaultAgentSettings,
      });
      expect(capabilities.filter("web_search", { caller: "root", mode: "default" })).toBe(true);
      expect(capabilities.filter("web_search", { caller: "root", mode: "plan" })).toBe(false);
      expect(capabilities.filter("todo_get", { caller: "fanout", mode: "plan" })).toBe(true);
      expect(capabilities.filter("todo_set", { caller: "fanout", mode: "plan" })).toBe(false);
      expect(capabilities.filter("load_skill", { caller: "root", mode: "default" })).toBe(false);
      enabled = false;
      expect(capabilities.filter("web_search", { caller: "root", mode: "default" })).toBe(false);
      await fixture.features.dispose();
      expect(capabilities.filter("todo_get", { caller: "root", mode: "default" })).toBe(false);
    });
    it("registers the configured web search tool on the real runtime surface https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
      const fixture = await pendingFixture();
      expect(
        fixture.features.registrations.find((tool) => tool.name === "web_search")
      ).toBeDefined();
      await fixture.features.dispose();
    });
    it("requests approval before sending a web query through the configured host and labels source material as untrusted https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
      const webSearch = jest
        .fn()
        .mockResolvedValue({ content: "Public result", citations: ["https://example.com/source"] });
      const fixture = await pendingFixture(undefined, {
        webSearch,
        settings: () =>
          ({
            firecrawlApiKey: "fixture-key",
            selfHostSearchProvider: "firecrawl",
            agentMode: { offerFeedbackCards: true },
          }) as unknown as VaultAgentSettings,
      });
      fixture.requestPermission.mockResolvedValue({
        outcome: { outcome: "selected", optionId: "allow_search" },
      });
      const tool = fixture.features.registrations.find((item) => item.name === "web_search")!;
      const response = await tool.execute(
        { query: "  public topic  " },
        { callId: "search-call" } as ToolExecutionApi,
        {} as Context
      );
      expect(fixture.requestPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCall: expect.objectContaining({ rawInput: { query: "public topic" } }),
        })
      );
      expect(webSearch).toHaveBeenCalledWith("public topic", expect.any(AbortSignal));
      expect(response).toMatchObject({
        isError: false,
        details: {
          outcome: {
            status: "success",
            effect: "not_applied",
            source: { toolId: "web_search" },
            data: {
              content: "Public result",
              citations: ["https://example.com/source"],
              untrusted: true,
            },
          },
        },
      });
      expect(tool.replay).toBe("unsafe");
      await fixture.features.dispose();
    });
    it.each(["approved", "pending"])(
      "requires fresh approval for a real task even when a legacy %s plan used the same provider call ID https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (decision) => {
        const fixture = await pendingFixture();
        const previous = { ...savedPlan, pendingToolCallId: "pi:root:call_0", decision };
        fixture.documents.set("va.plan", previous);
        if (decision === "approved") fixture.results.set("va.plan", { "pi:root:call_0": previous });
        fixture.requestPermission.mockResolvedValue({
          outcome: { outcome: "selected", optionId: "approve_plan" },
        });
        const tool = fixture.features.registrations.find((item) => item.name === "propose_plan")!;
        const result = await tool.execute(
          { title: "新计划", body: "必须重新检查并批准的新正文", steps: ["重新核对"] },
          { callId: "call_0", taskId: 101 } as ToolExecutionApi,
          {} as Context
        );
        expect(result.isError).toBe(false);
        expect(fixture.requestPermission).toHaveBeenCalledTimes(1);
        expect(fixture.requestPermission).toHaveBeenCalledWith(
          expect.objectContaining({
            toolCall: expect.objectContaining({
              toolCallId: "pi-task:root:101",
              rawInput: { plan: "必须重新检查并批准的新正文" },
            }),
          })
        );
        expect(fixture.documents.get("va.plan")).toMatchObject({
          title: "新计划",
          body: "必须重新检查并批准的新正文",
          decision: "approved",
          pendingToolCallId: "pi-task:root:101",
        });
        await fixture.features.dispose();
      }
    );
    it("keeps web approval identities separate when providers reuse a call ID and retains the legacy fallback https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = await pendingFixture(undefined, {
        webSearch: async () => ({ content: "unused", citations: [] }),
        settings: () =>
          ({
            firecrawlApiKey: "fixture-key",
            selfHostSearchProvider: "firecrawl",
            agentMode: {},
          }) as unknown as VaultAgentSettings,
      });
      fixture.requestPermission.mockResolvedValue({
        outcome: { outcome: "selected", optionId: "deny_search" },
      });
      for (const name of ["web_search", "web_fetch"]) {
        fixture.requestPermission.mockClear();
        const tool = fixture.features.registrations.find((item) => item.name === name)!;
        for (const taskId of [101, 102, undefined])
          await tool.execute(
            name === "web_search" ? { query: "topic" } : { url: "https://example.test" },
            { callId: "call_0", ...(taskId === undefined ? {} : { taskId }) } as ToolExecutionApi,
            {} as Context
          );
        expect(
          fixture.requestPermission.mock.calls.map(([request]) => request.toolCall.toolCallId)
        ).toEqual(["pi-task:root:101", "pi-task:root:102", "pi:root:call_0"]);
      }
      await fixture.features.dispose();
    });
    it.each(["disabled", "missing-host", "blank", "denied", "revoked", "failed"])(
      "does not send an unapproved query or report a failed search as success: %s https://github.com/ItsDalk-Lane/Vault-Agent/issues/2",
      async (condition) => {
        let enabled = condition !== "disabled";
        const webSearch = jest.fn().mockRejectedValue(new Error("Search service unavailable"));
        const fixture = await pendingFixture(undefined, {
          webSearch: condition === "missing-host" ? undefined : webSearch,
          settings: () =>
            ({
              firecrawlApiKey: enabled ? "fixture-key" : "",
              selfHostSearchProvider: "firecrawl",
              agentMode: { offerFeedbackCards: true },
            }) as unknown as VaultAgentSettings,
        });
        fixture.requestPermission.mockImplementation(async () => {
          if (condition === "revoked") enabled = false;
          return {
            outcome: {
              outcome: "selected",
              optionId: condition === "denied" ? "deny_search" : "allow_search",
            },
          };
        });
        const tool = fixture.features.registrations.find((item) => item.name === "web_search")!;
        const response = await tool.execute(
          { query: condition === "blank" ? "  " : "public topic" },
          { callId: "search-call" } as ToolExecutionApi,
          {} as Context
        );
        expect(response.isError).toBe(true);
        expect(webSearch).toHaveBeenCalledTimes(condition === "failed" ? 1 : 0);
        await fixture.features.dispose();
      }
    );
    it("aborts the active search request when the tool context is cancelled https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      const webSearch = jest.fn(
        (_query: string, signal?: AbortSignal) =>
          new Promise<{ content: string; citations: string[] }>((_resolve, reject) => {
            signal!.addEventListener(
              "abort",
              () => reject(new DOMException("cancelled", "AbortError")),
              { once: true }
            );
            started();
          })
      );
      const fixture = await pendingFixture(undefined, {
        webSearch,
        settings: () =>
          ({
            firecrawlApiKey: "fixture-key",
            selfHostSearchProvider: "firecrawl",
            agentMode: { offerFeedbackCards: true },
          }) as unknown as VaultAgentSettings,
      });
      fixture.requestPermission.mockResolvedValue({
        outcome: { outcome: "selected", optionId: "allow_search" },
      });
      const controller = new AbortController();
      const tool = fixture.features.registrations.find((item) => item.name === "web_search")!;
      const pending = tool.execute(
        { query: "topic" },
        { callId: "search-call" } as ToolExecutionApi,
        { abortSignal: controller.signal } as Context
      );
      await ready;
      controller.abort();
      expect((await pending).isError).toBe(true);
      await fixture.features.dispose();
    });
    it("loads only explicit skill resources and runs skill scripts through the actual reviewed native gateway with durable sections https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const stdout = execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs", "skills"], {
        cwd: path.resolve(__dirname, "../../../../.."),
        encoding: "utf8",
        timeout: 60_000,
      });
      const report = JSON.parse(stdout) as { status: string; approvals: number; checks: string[] };
      expect(report.status).toBe("passed");
      expect(report.approvals).toBe(1);
      expect(report.checks).toEqual([
        "fixed_sections_reach_real_provider",
        "skill_not_duplicated_in_user_history",
        "selected_note_stays_untrusted",
        "actual_requested_resource_loaded",
        "resource_symlink_and_size_boundaries",
        "other_project_skill_hidden",
        "strict_skill_script_spawns_nothing",
        "trusted_skill_script_uses_real_host_approval",
        "stop_rejects_late_script_approval",
        "changed_enabled_skill_replaces_previous_instructions",
        "reopen_restores_project_and_selected_skill_version",
      ]);
    }, 65_000);

    it("runs durable todos, plan decisions, actual questions, error feedback, cancellation and reopening through the production backend https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const projectRoot = path.resolve(__dirname, "../../../../..");
      const stdout = execFileSync(process.execPath, ["scripts/test-pi-runtime.mjs"], {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 60_000,
      });
      const report = JSON.parse(stdout) as {
        status: string;
        checks: string[];
        approvals: number;
        questionCount: number;
      };
      expect(report.status).toBe("passed");
      expect(report.approvals).toBe(1);
      expect(report.questionCount).toBe(1);
      expect(report.checks).toEqual(
        expect.arrayContaining([
          "production_backend_prompt",
          "durable_todo_tool",
          "plan_approval_callback",
          "actual_user_question",
          "feature_state_reopen",
          "plan_approval_leaves_read_only_mode",
          "rejected_plan_stays_rejected",
          "reused_provider_call_id_independent_plan_approvals_and_cards",
          "web_denial_without_network",
          "todo_revision_conflict",
          "error_feedback_persisted_and_dismissed",
          "stop_pending_question",
        ])
      );
    }, 65_000);
  });

  describe("pendingQuestions()", () => {
    it("reads the original pending question and its options without asking, writing, or continuing work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = await pendingFixture();
      fixture.documents.set("va.questions", {
        pending: savedQuestion,
        answered: { ...savedQuestion, requestId: "answered", status: "answered" },
        cancelled: { ...savedQuestion, requestId: "cancelled", status: "cancelled" },
        unrelated: { ...savedQuestion, requestId: "other", sessionId: "other-root" },
      });

      const restored = await fixture.features.pendingQuestions();

      expect(restored).toEqual([
        {
          sessionId: "root",
          requestId: "question-original",
          questions: savedQuestion.questions,
        },
      ]);
      restored[0].questions[0].options[0].label = "已修改的界面副本";
      expect((await fixture.features.pendingQuestions())[0].questions[0].options[0].label).toBe(
        "标题"
      );
      expect(fixture.ask).not.toHaveBeenCalled();
      expect(fixture.requestPermission).not.toHaveBeenCalled();
      expect(fixture.setMode).not.toHaveBeenCalled();
      expect(fixture.conversation.commit).not.toHaveBeenCalled();
      expect(fixture.conversation.submit).not.toHaveBeenCalled();
      expect(fixture.emit).not.toHaveBeenCalled();
      expect(fixture.snapshot).toHaveBeenCalledWith(
        expect.objectContaining({ definition: expect.objectContaining({ kind: "va.questions" }) }),
        "conversation",
        expect.any(Object)
      );
      await fixture.features.dispose();
    });

    it("reuses an empty snapshot until a stored request becomes pending and removes it after a decision https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = await pendingFixture();
      const empty = await fixture.features.pendingQuestions();
      expect(await fixture.features.pendingQuestions()).toBe(empty);
      fixture.documents.set("va.questions", { pending: savedQuestion });
      expect(await fixture.features.pendingQuestions()).toHaveLength(1);
      fixture.documents.set("va.questions", {
        pending: { ...savedQuestion, status: "answered", answers: { check: "标题" } },
      });
      expect(await fixture.features.pendingQuestions()).toBe(empty);
      await fixture.features.dispose();
    });
  });

  describe("pendingPlan()", () => {
    it("reads the current pending revision without approving or changing the saved plan https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = await pendingFixture();
      expect(await fixture.features.pendingPlan()).toBeNull();
      fixture.documents.set("va.plan", savedPlan);

      expect(await fixture.features.pendingPlan()).toEqual({
        id: "plan-original",
        revision: 2,
        title: savedPlan.title,
        body: savedPlan.body,
        decision: "pending",
        permissionGated: true,
        pendingToolCallId: "root:plan-call",
      });

      fixture.documents.set("va.plan", { ...savedPlan, revision: 3, body: "修订后的原文" });
      expect(await fixture.features.pendingPlan()).toMatchObject({
        revision: 3,
        body: "修订后的原文",
      });
      for (const decision of ["approved", "rejected", "rejected_with_feedback"]) {
        fixture.documents.set("va.plan", { ...savedPlan, decision });
        expect(await fixture.features.pendingPlan()).toBeNull();
      }
      expect(fixture.requestPermission).not.toHaveBeenCalled();
      expect(fixture.setMode).not.toHaveBeenCalled();
      expect(fixture.conversation.commit).not.toHaveBeenCalled();
      expect(fixture.conversation.submit).not.toHaveBeenCalled();
      expect(fixture.emit).not.toHaveBeenCalled();
      await fixture.features.dispose();
    });
  });

  describe("answerPendingQuestion()", () => {
    it("saves a restored answer once without invoking a prompter or starting the model https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = await pendingFixture();
      fixture.documents.set("va.questions", { "question-original": savedQuestion });
      const service = fixture.features;

      const results = await Promise.allSettled([
        service.answerPendingQuestion("question-original", { check: "标题, 正文" }),
        service.answerPendingQuestion("question-original", { check: "正文" }),
      ]);

      expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((entry) => entry.status === "rejected")).toHaveLength(1);
      expect(fixture.documents.get("va.questions")).toEqual({
        "question-original": expect.objectContaining({
          requestId: "question-original",
          sessionId: "root",
          status: "answered",
          answers: { check: "标题, 正文" },
        }),
      });
      expect(await fixture.features.pendingQuestions()).toEqual([]);
      expect(fixture.ask).not.toHaveBeenCalled();
      expect(fixture.requestPermission).not.toHaveBeenCalled();
      expect(fixture.setMode).not.toHaveBeenCalled();
      expect(fixture.conversation.submit).not.toHaveBeenCalled();
      await fixture.features.dispose();
    });
  });

  describe("decidePendingPlan()", () => {
    it("saves a restored decision without approving a permission, changing mode or continuing work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = await pendingFixture();
      fixture.documents.set("va.plan", savedPlan);
      const service = fixture.features;

      await expect(
        service.decidePendingPlan({ planId: "plan-original", revision: 1, action: "approve" })
      ).rejects.toMatchObject({ code: "PLAN_REVISION_CONFLICT" });
      const decisions = await Promise.allSettled([
        service.decidePendingPlan({ planId: "plan-original", revision: 2, action: "approve" }),
        service.decidePendingPlan({ planId: "plan-original", revision: 2, action: "reject" }),
      ]);
      expect(decisions.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
      expect(decisions.filter((entry) => entry.status === "rejected")).toHaveLength(1);
      expect(fixture.documents.get("va.plan")).toMatchObject({
        planId: "plan-original",
        revision: 2,
        decision: "approved",
        permissionGated: false,
      });
      expect(await fixture.features.pendingPlan()).toBeNull();
      expect(fixture.requestPermission).not.toHaveBeenCalled();
      expect(fixture.setMode).not.toHaveBeenCalled();
      expect(fixture.conversation.submit).not.toHaveBeenCalled();
      await fixture.features.dispose();
    });
  });

  describe("cancelPendingInteractions()", () => {
    it("persists Stop for this session's restored question and plan without changing answered or unrelated requests https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = await pendingFixture();
      const unrelated = { ...savedQuestion, sessionId: "other-root", requestId: "other" };
      const answered = { ...savedQuestion, status: "answered", requestId: "answered" };
      fixture.documents.set("va.questions", {
        "question-original": savedQuestion,
        other: unrelated,
        answered,
      });
      fixture.documents.set("va.plan", savedPlan);
      const service = fixture.features;

      await service.cancelPendingInteractions();
      await service.cancelPendingInteractions();

      expect(fixture.documents.get("va.questions")).toEqual({
        "question-original": expect.objectContaining({ status: "cancelled", answers: null }),
        other: unrelated,
        answered,
      });
      expect(fixture.documents.get("va.plan")).toMatchObject({
        planId: "plan-original",
        decision: "rejected",
        permissionGated: false,
      });
      expect(await fixture.features.pendingQuestions()).toEqual([]);
      expect(await fixture.features.pendingPlan()).toBeNull();
      expect(fixture.ask).not.toHaveBeenCalled();
      expect(fixture.requestPermission).not.toHaveBeenCalled();
      expect(fixture.setMode).not.toHaveBeenCalled();
      expect(fixture.conversation.submit).not.toHaveBeenCalled();
      await fixture.features.dispose();
    });
  });
});
