import * as fs from "node:fs";
import * as path from "node:path";

import {
  isRunSuccessful,
  type ApprovalStateUpdate,
  type BudgetUpdate,
  type CurrentPlan,
  type RunStateUpdate,
  type RunStatus,
  type SessionEvent,
  type SessionProjection,
  type SessionTodoUpdate,
  type SessionUpdate,
  type SessionUsage,
  type StreamCursor,
} from "@/agentMode/session/types";

// The domain event contract is vendor-agnostic: Pi types stay behind sdk/pi and every
// consumer keeps compiling while new durable facts are added:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const SESSION_ROOT = path.join(PROJECT_ROOT, "src", "agentMode", "session");
const UI_ROOT = path.join(PROJECT_ROOT, "src", "agentMode", "ui");
const DOMAIN_TYPES_FILE = path.join(SESSION_ROOT, "types.ts");

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type SessionEventShapeUnchanged = Assert<
  Equal<keyof SessionEvent, "sessionId" | "update" | "occurredAt">
>;
type NewDomainEventNames = Assert<
  Equal<
    Extract<
      SessionUpdate,
      {
        sessionUpdate:
          | "session_projection"
          | "todo_update"
          | "plan_proposal_update"
          | "approval_state"
          | "recovery_state"
          | "run_state"
          | "budget_update";
      }
    >["sessionUpdate"],
    | "session_projection"
    | "todo_update"
    | "plan_proposal_update"
    | "approval_state"
    | "recovery_state"
    | "run_state"
    | "budget_update"
  >
>;
type LegacyDomainEventsPreserved = Assert<
  Equal<
    Extract<
      SessionUpdate,
      {
        sessionUpdate: "agent_message_chunk" | "tool_call" | "plan" | "compaction" | "usage_update";
      }
    >["sessionUpdate"],
    "agent_message_chunk" | "tool_call" | "plan" | "compaction" | "usage_update"
  >
>;
type RunStatusHasUnknown = Assert<Equal<Extract<RunStatus, "unknown">, "unknown">>;
type BudgetUsageCanBeUnknown = Assert<Equal<BudgetUpdate["usage"], SessionUsage | null>>;
type ProjectionUsesStableCursor = Assert<Equal<SessionProjection["cursor"], StreamCursor>>;
type TodoUpdateHasRevision = Assert<Equal<SessionTodoUpdate["revision"], number>>;
type PlanEventUsesCurrentPlan = Assert<
  Equal<Extract<SessionUpdate, { sessionUpdate: "plan_proposal_update" }>["plan"], CurrentPlan>
>;
type ApprovalStateHasRequestId = Assert<Equal<ApprovalStateUpdate["requestId"], string>>;
type RunStateHasStableRunId = Assert<Equal<RunStateUpdate["runId"], string>>;

type TypeContractChecks = [
  SessionEventShapeUnchanged,
  NewDomainEventNames,
  LegacyDomainEventsPreserved,
  RunStatusHasUnknown,
  BudgetUsageCanBeUnknown,
  ProjectionUsesStableCursor,
  TodoUpdateHasRevision,
  PlanEventUsesCurrentPlan,
  ApprovalStateHasRequestId,
  RunStateHasStableRunId,
];

function assertTypeContract(): TypeContractChecks {
  return [true, true, true, true, true, true, true, true, true, true];
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(fullPath);
  }
  return files;
}

function filesImportingPiSdk(): string[] {
  return [...sourceFiles(SESSION_ROOT), ...sourceFiles(UI_ROOT)]
    .filter((file) =>
      /(?:from\s+|import\s*\(\s*|require\(\s*)["']@earendil-works\//.test(
        fs.readFileSync(file, "utf8")
      )
    )
    .map((file) => path.relative(PROJECT_ROOT, file));
}

const runState: RunStateUpdate = {
  runId: "run-1",
  requestId: "request-1",
  status: "completed",
  startedAtMs: 1000,
  endedAtMs: 2000,
  cancelEpoch: 0,
  modelAttempts: 1,
  toolAttempts: null,
};

const unknownBudget: BudgetUpdate = {
  source: "unavailable",
  usage: null,
  requestLimit: null,
  tokenLimit: null,
  costLimitUsd: null,
  updatedAt: 3000,
};

describe("piDomainContract", () => {
  describe("assertTypeContract()", () => {
    it("keeps SessionEvent and legacy variants while adding the new domain events", () => {
      const checks = assertTypeContract();
      expect(checks).toHaveLength(10);
      expect(checks.every((check) => check === true)).toBe(true);
    });
  });

  describe("isRunSuccessful()", () => {
    it("treats only a completed run as success", () => {
      expect(isRunSuccessful("completed")).toBe(true);
    });

    it("does not turn unknown, interrupted, cancelled or budget-paused runs into success", () => {
      for (const status of [
        "unknown",
        "interrupted",
        "failed",
        "cancelled",
        "paused_budget",
        "cancelling",
        "running",
        "awaiting_permission",
      ] as const) {
        expect({ status, successful: isRunSuccessful(status) }).toEqual({
          status,
          successful: false,
        });
      }
    });
  });

  describe("SessionEvent construction", () => {
    it("represents the new durable facts as discriminated updates", () => {
      const events: SessionUpdate[] = [
        {
          sessionUpdate: "session_projection",
          projection: {
            cursor: { streamEpoch: "epoch-1", frameIndex: 0 },
            mode: "replace",
            messages: [],
            pending: { permissions: [], questions: [], plan: null, recovery: null },
          },
        },
        {
          sessionUpdate: "todo_update",
          todo: {
            revision: 0,
            items: [{ id: "todo-1", text: "ship it", status: "in_progress", priority: "high" }],
          },
        },
        {
          sessionUpdate: "plan_proposal_update",
          plan: {
            id: "plan-1",
            revision: 1,
            body: "plan body",
            title: "plan",
            permissionGated: true,
            pendingToolCallId: "call-1",
            decision: "pending",
          },
        },
        {
          sessionUpdate: "approval_state",
          approval: {
            requestId: "approval-1",
            state: "pending",
            toolCall: { toolCallId: "call-2", title: "write note" },
            options: [],
          },
        },
        {
          sessionUpdate: "recovery_state",
          recovery: {
            status: "unknown",
            pendingPermissionIds: [],
            pendingQuestionIds: [],
            pendingMutationIds: [],
            crashLoopTripped: false,
          },
        },
        { sessionUpdate: "run_state", run: runState },
        { sessionUpdate: "budget_update", budget: unknownBudget },
      ];

      expect(events.map((event) => event.sessionUpdate)).toEqual([
        "session_projection",
        "todo_update",
        "plan_proposal_update",
        "approval_state",
        "recovery_state",
        "run_state",
        "budget_update",
      ]);
    });

    it("keeps stable IDs on run, approval and projection facts", () => {
      expect({
        runId: runState.runId,
        requestId: runState.requestId,
        cancelEpoch: runState.cancelEpoch,
      }).toEqual({ runId: "run-1", requestId: "request-1", cancelEpoch: 0 });
      const projection: SessionProjection = {
        cursor: { streamEpoch: "epoch-1", frameIndex: 7 },
        mode: "prepend",
        messages: [],
        pending: { permissions: [], questions: [], plan: null, recovery: null },
      };
      expect(projection.cursor).toEqual({ streamEpoch: "epoch-1", frameIndex: 7 });
    });
  });

  describe("unknown semantics", () => {
    it("models unknown usage as null instead of a fake zero", () => {
      expect(unknownBudget.usage).toBeNull();
      expect(unknownBudget.source).toBe("unavailable");
    });
  });

  describe("SDK confinement", () => {
    it("does not import the Pi SDK from session or ui modules", () => {
      expect(filesImportingPiSdk()).toEqual([]);
    });

    it("keeps the public domain types file free of Pi SDK imports", () => {
      const text = fs.readFileSync(DOMAIN_TYPES_FILE, "utf8");
      expect(/@earendil-works\//.test(text)).toBe(false);
      expect(/@\/agentMode\/sdk\/pi/.test(text)).toBe(false);
    });
  });
});
