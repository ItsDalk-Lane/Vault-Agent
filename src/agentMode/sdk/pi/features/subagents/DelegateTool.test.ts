import {
  DELEGATE_REQUEST_PREFIX,
  DelegateTool,
  type DelegateChildRef,
  type DelegateProgressUpdate,
  type DelegateSessionPort,
} from "@/agentMode/sdk/pi/features/subagents/DelegateTool";
import { SubagentProfileError } from "@/agentMode/sdk/pi/features/subagents/Profiles";

// delegate_task looks the owned child up by ownerTaskId inside the commit and creates it only once,
// submits with the stable requestId `delegate:<taskId>`, reuses the same child/submission after a
// reopen, turns an unanswered child into a real failure, cancels the child when the parent stops, and
// hands the card the real assistant answer with the child reference:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeSession implements DelegateSessionPort {
  readonly children = new Map<string, DelegateChildRef>();
  readonly created: DelegateChildRef[] = [];
  readonly submitted: Array<{ conversationId: string; requestId: string; task: string }> = [];
  readonly cancelled: string[] = [];
  readonly waits: string[] = [];
  answer: { answered: boolean; text: string; entryId?: string } = {
    answered: true,
    text: "Real answer from the child.",
    entryId: "entry-1",
  };
  waitResult: "completed" | "failed" | "cancelled" | "timeout" = "completed";
  private nextId = 1;

  async findChild(ownerTaskId: string): Promise<DelegateChildRef | undefined> {
    return this.children.get(ownerTaskId);
  }

  async createChild(input: {
    ownerTaskId: string;
    profileId: "researcher" | "reviewer" | "writer";
    createdAtMs?: number;
  }): Promise<DelegateChildRef> {
    const child: DelegateChildRef = {
      conversationId: `child-${this.nextId++}`,
      ownerTaskId: input.ownerTaskId,
      profileId: input.profileId,
      createdAtMs: 1_000,
    };
    this.created.push(child);
    return child;
  }

  async writeChildMapping(child: DelegateChildRef): Promise<void> {
    this.children.set(child.ownerTaskId, child);
  }

  async submit(input: { conversationId: string; requestId: string; task: string }): Promise<void> {
    this.submitted.push({ ...input });
  }

  async wait(input: {
    conversationId: string;
    requestId: string;
    signal?: AbortSignal;
  }): Promise<"completed" | "failed" | "cancelled" | "timeout"> {
    this.waits.push(input.conversationId);
    return this.waitResult;
  }

  async readAnswer(): Promise<{ answered: boolean; text: string; entryId?: string }> {
    return this.answer;
  }

  async cancel(input: { conversationId: string }): Promise<void> {
    this.cancelled.push(input.conversationId);
  }
}

function tool(
  session: FakeSession,
  updates: DelegateProgressUpdate[] = [],
  overrides: Partial<ConstructorParameters<typeof DelegateTool>[0]> = {}
): DelegateTool {
  return new DelegateTool({
    session,
    parent: {
      conversationId: "parent-1",
      taskId: "task-7",
      callableTools: ["vault_read", "vault_search"],
      effects: ["read", "state"],
      modelKey: "model-a",
      depth: 0,
      maxDepth: 2,
    },
    now: () => 5_000,
    onUpdate: (update) => updates.push(update),
    ...overrides,
  });
}

const request = {
  profileId: "researcher",
  task: "Summarize the notes",
  description: "Read the notes and summarize",
};

describe("DelegateTool", () => {
  describe("DelegateTool", () => {
    describe("registration()", () => {
      it("exposes exact configured model choices and names through the foreground schema https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const parameters = tool(new FakeSession(), [], {
          knownModels: [
            { modelKey: "model-uuid", displayName: "Review", providerDisplayName: "Local Studio" },
          ],
        }).registration().parameters;
        expect(parameters).toMatchObject({
          properties: {
            modelKey: {
              enum: ["model-uuid"],
              description: expect.stringContaining("Local Studio"),
            },
          },
        });
      });
      it("publishes only currently enabled profile choices with their read and write boundaries https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        expect(tool(new FakeSession()).registration().parameters).toMatchObject({
          properties: {
            profileId: {
              type: "string",
              enum: ["researcher", "reviewer", "writer"],
              description: expect.stringContaining("Read-only"),
            },
          },
        });
        expect(
          tool(new FakeSession(), [], { enabledProfiles: ["writer", "unknown"] }).registration()
            .parameters
        ).toMatchObject({
          properties: {
            profileId: { enum: ["writer"], description: expect.stringContaining("outputPaths") },
          },
        });
      });
      it("registers the model-facing Agent-compatible delegate tool with safe replay", () => {
        const registration = tool(new FakeSession()).registration();

        expect(registration).toMatchObject({
          name: "delegate_task",
          vendorToolName: "Agent",
          replay: "safe",
          callers: ["model"],
        });
        expect(registration.manifest.toolId).toBe("delegate_task");
        expect(registration.manifest.effects).toEqual(["state"]);
      });
    });

    describe("executeTool()", () => {
      it("accepts a named configured key and returns allowed keys when a provider label is mistakenly used as modelKey https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const configured = [
          { modelKey: "model-uuid", displayName: "Review", providerDisplayName: "Local Studio" },
        ];
        expect(
          (
            await tool(new FakeSession(), [], { knownModels: configured }).executeTool({
              ...request,
              modelKey: "model-uuid",
            })
          ).isError
        ).toBe(false);
        const denied = await tool(new FakeSession(), [], { knownModels: configured }).executeTool({
          ...request,
          modelKey: "Local Studio",
        });
        expect(denied.isError).toBe(true);
        expect(denied.output[0].text).toContain("model-uuid");
      });
      it("creates one child per ownerTaskId and reuses it after an interrupted run and reopen", async () => {
        const session = new FakeSession();
        session.waitResult = "failed";
        const first = await tool(session).executeTool(request);

        expect(first.isError).toBe(true);
        expect(session.created).toHaveLength(1);

        session.waitResult = "completed";
        const second = await tool(session).executeTool(request);

        expect(session.created).toHaveLength(1);
        expect(second.isError).toBe(false);
        expect(second.details.childConversationId).toBe(first.details.childConversationId);
        expect(session.submitted.map((entry) => entry.requestId)).toEqual([
          `${DELEGATE_REQUEST_PREFIX}task-7`,
          `${DELEGATE_REQUEST_PREFIX}task-7`,
        ]);
      });

      it("returns a real failure when the child finished without an assistant answer", async () => {
        const session = new FakeSession();
        session.answer = { answered: false, text: "" };

        const result = await tool(session).executeTool(request);

        expect(result.isError).toBe(true);
        expect(result.details.errorCode).toBe("SUBAGENT_UNANSWERED");
        expect(result.output[0]?.text).not.toContain("done");
      });

      it("cancels the child when the parent stop aborts the wait", async () => {
        const session = new FakeSession();
        const controller = new AbortController();
        session.waitResult = "cancelled";
        controller.abort();

        const result = await tool(session).executeTool({ ...request, signal: controller.signal });

        expect(result.isError).toBe(true);
        expect(result.details.errorCode).toBe("SUBAGENT_CANCELLED");
        expect(session.cancelled).toEqual([session.created[0]?.conversationId]);
      });

      it("reports the real answer and child reference to the card", async () => {
        const session = new FakeSession();
        const updates: DelegateProgressUpdate[] = [];

        const result = await tool(session, updates).executeTool(request);

        expect(result.isError).toBe(false);
        expect(result.output[0]?.text).toBe("Real answer from the child.");
        expect(result.details).toMatchObject({
          profileId: "researcher",
          status: "completed",
          turns: 1,
          answerEntryId: "entry-1",
          tools: ["vault_read", "vault_search"],
        });
        expect(updates.map((update) => update.status)).toEqual(["running", "completed"]);
        expect(updates[1]?.childConversationId).toBe(result.details.childConversationId);
      });

      it("reduces the child tools to the parent callable intersection", async () => {
        const session = new FakeSession();

        const result = await tool(session, [], {
          parent: {
            conversationId: "parent-1",
            taskId: "task-7",
            callableTools: ["vault_read"],
            effects: ["read"],
            modelKey: "model-a",
            depth: 0,
            maxDepth: 2,
          },
        }).executeTool(request);

        expect(result.details.tools).toEqual(["vault_read"]);
        expect(session.created).toHaveLength(1);
      });

      it("rejects an invalid profile as a tool failure instead of throwing", async () => {
        const session = new FakeSession();

        // writer 已常开，用未知 profile 验证拒绝路径。https://github.com/ItsDalk-Lane/Vault-Agent/issues/15
        const result = await tool(session).executeTool({ ...request, profileId: "unknown-role" });

        expect(result.isError).toBe(true);
        expect(result.details.errorCode).toBe("SUBAGENT_PROFILE_INVALID");
        expect(session.created).toHaveLength(0);
        expect(() => {
          throw new SubagentProfileError("SUBAGENT_PROFILE_DISABLED", "x");
        }).toThrow(SubagentProfileError);
      });
    });
  });
});
