// Versioned product state documents from design 04; they stay reconstructible from the
// conversation transcript and each fork applies the documented copy policy:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const PRODUCT_DOC_VERSION = 1;

export const PRODUCT_DOC_KINDS = [
  "va.session",
  "va.run",
  "va.todos",
  "va.plan",
  "va.approvals",
  "va.questions",
  "va.mutations",
  "va.subagents",
  "va.fanout",
  "va.skills",
  "va.budget",
] as const;

export type ProductDocKind = (typeof PRODUCT_DOC_KINDS)[number];

export interface ProductDocBase {
  readonly kind: ProductDocKind;
  readonly version: number;
  readonly revision: number;
  readonly updatedAtMs: number;
}

export interface SessionSource {
  readonly legacyBackendId: string;
  readonly legacySessionId?: string;
  readonly sourcePath?: string;
  readonly importHash: string;
}

export interface SessionDoc extends ProductDocBase {
  readonly kind: "va.session";
  readonly rootId: string;
  readonly source: SessionSource | null;
  readonly projectId: string | null;
  readonly title: string | null;
  readonly selectedModelKey: string | null;
}

export type RunDocStatus =
  | "idle"
  | "accepting"
  | "running"
  | "awaiting_permission"
  | "awaiting_question"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "paused_budget"
  | "failed"
  | "interrupted";

export interface RunLimits {
  readonly maxModelAttempts: number | null;
  readonly maxToolAttempts: number | null;
  readonly maxBudgetUsd: number | null;
}

export interface RunDoc extends ProductDocBase {
  readonly kind: "va.run";
  readonly runId: string;
  readonly requestId: string;
  readonly status: RunDocStatus;
  readonly modelAttempts: number;
  readonly toolAttempts: number;
  readonly cancelEpoch: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly stopCode: string | null;
  readonly limits: RunLimits;
}

export type TodoStatus = "pending" | "in_progress" | "completed";
export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  readonly id: string;
  readonly text: string;
  readonly status: TodoStatus;
  readonly priority: TodoPriority;
}

export interface TodosDoc extends ProductDocBase {
  readonly kind: "va.todos";
  readonly items: readonly TodoItem[];
}

export type PlanApprovalState = "unapproved" | "pending" | "approved" | "rejected";

export interface PlanBody {
  readonly planId: string;
  readonly title: string;
  readonly body: string;
  readonly permissionGated: boolean;
  readonly sourceFilePath?: string;
}

export interface PlanDoc extends ProductDocBase {
  readonly kind: "va.plan";
  readonly plan: PlanBody | null;
  readonly approval: PlanApprovalState;
  readonly feedback: string | null;
}

export type ApprovalState =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "consumed";

export interface StoredApproval {
  readonly requestId: string;
  readonly bindingHash: string;
  readonly state: ApprovalState;
  readonly expiresAtMs: number;
  readonly decidedAtMs?: number;
  readonly consumedAtMs?: number;
}

export interface ApprovalsDoc extends ProductDocBase {
  readonly kind: "va.approvals";
  readonly items: readonly StoredApproval[];
}

export interface StoredQuestion {
  readonly requestId: string;
  readonly prompt: string;
  readonly answers: readonly string[] | null;
  readonly delivered: boolean;
}

export interface QuestionsDoc extends ProductDocBase {
  readonly kind: "va.questions";
  readonly items: readonly StoredQuestion[];
}

export type MutationStatus =
  | "prepared"
  | "committed"
  | "partial"
  | "effect_unknown"
  | "needs_reconciliation";

export interface StoredMutationFile {
  readonly path: string;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly status: "created" | "modified" | "deleted" | "renamed";
}

export interface StoredMutation {
  readonly operationId: string;
  readonly status: MutationStatus;
  readonly files: readonly StoredMutationFile[];
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly backupRef?: string;
}

export interface MutationsDoc extends ProductDocBase {
  readonly kind: "va.mutations";
  readonly items: readonly StoredMutation[];
}

export type SubagentStatus =
  | "queued"
  | "starting"
  | "running"
  | "awaiting_permission"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface StoredSubagent {
  readonly childConversationId: string;
  readonly parentConversationId: string;
  readonly ownerTaskId: string;
  readonly profileId: string;
  readonly status: SubagentStatus;
  readonly resultConsumed: boolean;
}

export interface SubagentsDoc extends ProductDocBase {
  readonly kind: "va.subagents";
  readonly items: readonly StoredSubagent[];
}

export type FanoutCandidateStatus = "pending" | "evaluated" | "synthesized" | "failed";

export interface StoredFanoutCandidate {
  readonly candidateId: string;
  readonly status: FanoutCandidateStatus;
  readonly answerEntryId: string | null;
}

export interface FanoutDoc extends ProductDocBase {
  readonly kind: "va.fanout";
  readonly items: readonly StoredFanoutCandidate[];
}

export interface StoredSkillSelection {
  readonly skillId: string;
  readonly contentHash: string;
  readonly trust: "trusted" | "untrusted";
  readonly sourcePath: string;
  readonly verifiedAtMs: number | null;
}

export interface SkillsDoc extends ProductDocBase {
  readonly kind: "va.skills";
  readonly selections: readonly StoredSkillSelection[];
}

export interface BudgetSpend {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly usd: number;
  readonly unknownCost: boolean;
}

export interface BudgetThresholds {
  readonly warnAtUsd: number | null;
  readonly stopAtUsd: number | null;
}

export interface BudgetDoc extends ProductDocBase {
  readonly kind: "va.budget";
  readonly spent: BudgetSpend;
  readonly thresholds: BudgetThresholds;
}

export type ProductDoc =
  | SessionDoc
  | RunDoc
  | TodosDoc
  | PlanDoc
  | ApprovalsDoc
  | QuestionsDoc
  | MutationsDoc
  | SubagentsDoc
  | FanoutDoc
  | SkillsDoc
  | BudgetDoc;

export type ProductForkMode =
  | "copy"
  | "initial"
  | "copy-todos-as-of"
  | "copy-plan-reunapproved"
  | "copy-history"
  | "copy-fanout-as-of"
  | "copy-skills-revalidate"
  | "reset-budget";

export const PRODUCT_FORK_POLICIES: Readonly<Record<ProductDocKind, ProductForkMode>> = {
  "va.session": "copy",
  "va.run": "initial",
  "va.todos": "copy-todos-as-of",
  "va.plan": "copy-plan-reunapproved",
  "va.approvals": "initial",
  "va.questions": "initial",
  "va.mutations": "copy-history",
  "va.subagents": "initial",
  "va.fanout": "copy-fanout-as-of",
  "va.skills": "copy-skills-revalidate",
  "va.budget": "reset-budget",
};

export type ProductDocErrorCode = "INVALID_OPTIONS";

export class ProductDocError extends Error {
  readonly code: ProductDocErrorCode;

  constructor(code: ProductDocErrorCode, message: string) {
    super(message);
    this.name = "ProductDocError";
    this.code = code;
  }
}

export type ParsedProductDoc =
  | { kind: "ok"; doc: ProductDoc }
  | { kind: "unsupported"; foundVersion: number }
  | { kind: "invalid"; reason: "not-an-object" | "unknown-kind" | "invalid-shape" };

export interface CreateProductDocOptions {
  now: number;
  rootId?: string;
  runId?: string;
  requestId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isBase(value: Record<string, unknown>): boolean {
  return isInteger(value.revision) && value.revision >= 1 && isFiniteNumber(value.updatedAtMs);
}

function isValidSession(value: Record<string, unknown>): boolean {
  if (!isBase(value) || !isString(value.rootId)) return false;
  if (value.source !== null) {
    if (!isRecord(value.source) || !isString(value.source.legacyBackendId)) return false;
    if (!isNullableString(value.source.legacySessionId)) return false;
    if (!isNullableString(value.source.sourcePath)) return false;
    if (!isString(value.source.importHash)) return false;
  }
  return (
    isNullableString(value.projectId) &&
    isNullableString(value.title) &&
    isNullableString(value.selectedModelKey)
  );
}

function isValidRun(value: Record<string, unknown>): boolean {
  if (!isBase(value) || !isString(value.runId) || !isString(value.requestId)) return false;
  if (typeof value.status !== "string") return false;
  if (!isInteger(value.modelAttempts) || value.modelAttempts < 0) return false;
  if (!isInteger(value.toolAttempts) || value.toolAttempts < 0) return false;
  if (!isInteger(value.cancelEpoch) || value.cancelEpoch < 0) return false;
  if (!isFiniteNumber(value.startedAtMs)) return false;
  if (!(value.endedAtMs === null || isFiniteNumber(value.endedAtMs))) return false;
  if (!isNullableString(value.stopCode)) return false;
  if (!isRecord(value.limits)) return false;
  for (const key of ["maxModelAttempts", "maxToolAttempts", "maxBudgetUsd"] as const) {
    const limit = value.limits[key];
    if (limit !== null && !isFiniteNumber(limit)) return false;
  }
  return true;
}

function isValidTodos(value: Record<string, unknown>): boolean {
  if (!isBase(value) || !isArray(value.items)) return false;
  return value.items.every(
    (item) =>
      isRecord(item) &&
      isString(item.id) &&
      typeof item.text === "string" &&
      typeof item.status === "string" &&
      typeof item.priority === "string"
  );
}

function isValidPlan(value: Record<string, unknown>): boolean {
  if (!isBase(value) || typeof value.approval !== "string") return false;
  if (!isNullableString(value.feedback)) return false;
  if (value.plan === null) return true;
  return (
    isRecord(value.plan) &&
    isString(value.plan.planId) &&
    typeof value.plan.title === "string" &&
    typeof value.plan.body === "string" &&
    typeof value.plan.permissionGated === "boolean"
  );
}

function isValidApprovals(value: Record<string, unknown>): boolean {
  if (!isBase(value) || !isArray(value.items)) return false;
  return value.items.every(
    (item) =>
      isRecord(item) &&
      isString(item.requestId) &&
      isString(item.bindingHash) &&
      typeof item.state === "string" &&
      isFiniteNumber(item.expiresAtMs)
  );
}

function isValidQuestions(value: Record<string, unknown>): boolean {
  if (!isBase(value) || !isArray(value.items)) return false;
  return value.items.every(
    (item) =>
      isRecord(item) &&
      isString(item.requestId) &&
      typeof item.prompt === "string" &&
      (item.answers === null || isArray(item.answers)) &&
      typeof item.delivered === "boolean"
  );
}

function isValidMutations(value: Record<string, unknown>): boolean {
  if (!isBase(value) || !isArray(value.items)) return false;
  return value.items.every(
    (item) =>
      isRecord(item) &&
      isString(item.operationId) &&
      typeof item.status === "string" &&
      isArray(item.files) &&
      isFiniteNumber(item.startedAtMs) &&
      item.files.every(
        (file) =>
          isRecord(file) &&
          isString(file.path) &&
          isNullableString(file.beforeHash) &&
          isNullableString(file.afterHash) &&
          typeof file.status === "string"
      )
  );
}

function isValidSubagents(value: Record<string, unknown>): boolean {
  if (!isBase(value) || !isArray(value.items)) return false;
  return value.items.every(
    (item) =>
      isRecord(item) &&
      isString(item.childConversationId) &&
      isString(item.parentConversationId) &&
      isString(item.ownerTaskId) &&
      isString(item.profileId) &&
      typeof item.status === "string" &&
      typeof item.resultConsumed === "boolean"
  );
}

function isValidFanout(value: Record<string, unknown>): boolean {
  if (!isBase(value) || !isArray(value.items)) return false;
  return value.items.every(
    (item) =>
      isRecord(item) &&
      isString(item.candidateId) &&
      typeof item.status === "string" &&
      isNullableString(item.answerEntryId)
  );
}

function isValidSkills(value: Record<string, unknown>): boolean {
  if (!isBase(value) || !isArray(value.selections)) return false;
  return value.selections.every(
    (item) =>
      isRecord(item) &&
      isString(item.skillId) &&
      isString(item.contentHash) &&
      typeof item.trust === "string" &&
      isString(item.sourcePath) &&
      (item.verifiedAtMs === null || isFiniteNumber(item.verifiedAtMs))
  );
}

function isValidBudget(value: Record<string, unknown>): boolean {
  if (!isBase(value) || !isRecord(value.spent) || !isRecord(value.thresholds)) return false;
  const spent = value.spent;
  const thresholds = value.thresholds;
  if (!isInteger(spent.inputTokens) || !isInteger(spent.outputTokens)) return false;
  if (!isFiniteNumber(spent.usd) || typeof spent.unknownCost !== "boolean") return false;
  for (const key of ["warnAtUsd", "stopAtUsd"] as const) {
    if (thresholds[key] !== null && !isFiniteNumber(thresholds[key])) return false;
  }
  return true;
}

const DOC_VALIDATORS: Readonly<
  Record<ProductDocKind, (value: Record<string, unknown>) => boolean>
> = {
  "va.session": isValidSession,
  "va.run": isValidRun,
  "va.todos": isValidTodos,
  "va.plan": isValidPlan,
  "va.approvals": isValidApprovals,
  "va.questions": isValidQuestions,
  "va.mutations": isValidMutations,
  "va.subagents": isValidSubagents,
  "va.fanout": isValidFanout,
  "va.skills": isValidSkills,
  "va.budget": isValidBudget,
};

function isProductDocKind(value: unknown): value is ProductDocKind {
  return typeof value === "string" && (PRODUCT_DOC_KINDS as readonly string[]).includes(value);
}

function requireId(
  options: CreateProductDocOptions,
  field: "rootId" | "runId" | "requestId"
): string {
  const value = options[field];
  if (!isString(value)) {
    throw new ProductDocError("INVALID_OPTIONS", `A ${field} is required to create this document.`);
  }
  return value;
}

export function createProductDoc(
  kind: ProductDocKind,
  options: CreateProductDocOptions
): ProductDoc {
  const base = { version: PRODUCT_DOC_VERSION, revision: 1, updatedAtMs: options.now };
  switch (kind) {
    case "va.session":
      return {
        ...base,
        kind,
        rootId: requireId(options, "rootId"),
        source: null,
        projectId: null,
        title: null,
        selectedModelKey: null,
      };
    case "va.run":
      return {
        ...base,
        kind,
        runId: requireId(options, "runId"),
        requestId: requireId(options, "requestId"),
        status: "idle",
        modelAttempts: 0,
        toolAttempts: 0,
        cancelEpoch: 0,
        startedAtMs: options.now,
        endedAtMs: null,
        stopCode: null,
        limits: { maxModelAttempts: null, maxToolAttempts: null, maxBudgetUsd: null },
      };
    case "va.todos":
      return { ...base, kind, items: [] };
    case "va.plan":
      return { ...base, kind, plan: null, approval: "unapproved", feedback: null };
    case "va.approvals":
    case "va.questions":
    case "va.mutations":
    case "va.subagents":
    case "va.fanout":
      return { ...base, kind, items: [] };
    case "va.skills":
      return { ...base, kind, selections: [] };
    case "va.budget":
      return {
        ...base,
        kind,
        spent: { inputTokens: 0, outputTokens: 0, usd: 0, unknownCost: false },
        thresholds: { warnAtUsd: null, stopAtUsd: null },
      };
  }
}

export function parseProductDoc(value: unknown): ParsedProductDoc {
  if (!isRecord(value)) return { kind: "invalid", reason: "not-an-object" };
  if (!isProductDocKind(value.kind)) return { kind: "invalid", reason: "unknown-kind" };
  if (!isInteger(value.version) || value.version < 1) {
    return { kind: "invalid", reason: "invalid-shape" };
  }
  if (value.version !== PRODUCT_DOC_VERSION) {
    return { kind: "unsupported", foundVersion: value.version };
  }
  if (!DOC_VALIDATORS[value.kind](value)) {
    return { kind: "invalid", reason: "invalid-shape" };
  }
  return { kind: "ok", doc: value as unknown as ProductDoc };
}

export function forkProductDocs(
  parent: Partial<Record<ProductDocKind, ProductDoc>>,
  options: { now: number }
): Partial<Record<ProductDocKind, ProductDoc>> {
  const fork: Partial<Record<ProductDocKind, ProductDoc>> = {};
  for (const kind of PRODUCT_DOC_KINDS) {
    const source = parent[kind];
    if (!source) continue;
    const mode = PRODUCT_FORK_POLICIES[kind];
    if (mode === "initial") continue;
    const base = { ...source, version: PRODUCT_DOC_VERSION, revision: 1, updatedAtMs: options.now };
    switch (mode) {
      case "copy":
        fork[kind] = base;
        break;
      case "copy-todos-as-of":
        fork[kind] = { ...base, kind: "va.todos", items: [...(source as TodosDoc).items] };
        break;
      case "copy-plan-reunapproved": {
        const planDoc = source as PlanDoc;
        fork[kind] = {
          ...base,
          kind: "va.plan",
          plan: planDoc.plan,
          approval: "unapproved",
          feedback: null,
        };
        break;
      }
      case "copy-history": {
        const historyDoc = source as MutationsDoc;
        fork[kind] = { ...base, kind: "va.mutations", items: [...historyDoc.items] };
        break;
      }
      case "copy-fanout-as-of": {
        const fanoutDoc = source as FanoutDoc;
        fork[kind] = { ...base, kind: "va.fanout", items: [...fanoutDoc.items] };
        break;
      }
      case "copy-skills-revalidate": {
        const skillsDoc = source as SkillsDoc;
        fork[kind] = {
          ...base,
          kind: "va.skills",
          selections: skillsDoc.selections.map((selection) => ({
            ...selection,
            verifiedAtMs: null,
          })),
        };
        break;
      }
      case "reset-budget": {
        const budgetDoc = source as BudgetDoc;
        fork[kind] = {
          ...base,
          kind: "va.budget",
          spent: { inputTokens: 0, outputTokens: 0, usd: 0, unknownCost: false },
          thresholds: budgetDoc.thresholds,
        };
        break;
      }
    }
  }
  return fork;
}
