export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type ToolFamily =
  | "vault"
  | "native_file"
  | "obsidian_action"
  | "mcp"
  | "control"
  | "host_process";
export type Effect =
  | "read"
  | "write"
  | "create"
  | "delete"
  | "rename"
  | "network"
  | "execute"
  | "ui"
  | "state";
export type ResourceZone = "vault" | "external" | "protected" | "remote";
export type ExecutionMode = "strict" | "trusted_host";
export type EffectState = "none" | "committed" | "partial" | "unknown";

export interface ToolManifest {
  toolId: string;
  family: ToolFamily;
  effects: readonly Effect[];
  implementationVersion: number;
  schemaHash: string;
  replay: "safe" | "unsafe";
  callers: readonly ("model" | "tools")[];
  maxOutputBytes: number;
}

export interface ResolvedTarget {
  requested: string;
  canonical: string;
  zone: ResourceZone;
  scopeId: string;
  exists: boolean;
  kind: "file" | "directory" | "url" | "command";
  identityHash?: string;
}

export interface InvocationIdentity {
  rootId: string;
  conversationId: string;
  runId: string;
  taskId: string;
  callId: string;
  operationId: string;
  actor: "root" | "subagent" | "fanout" | "user";
  cancelEpoch: number;
}

export interface ApprovalBinding {
  requestId: string;
  identity: InvocationIdentity;
  toolId: string;
  argumentsHash: string;
  schemaHash: string;
  implementationVersion: number;
  targets: readonly ResolvedTarget[];
  beforeHashes: Readonly<Record<string, string | null>>;
  policyVersion: number;
  scopeVersion: number;
  createdAtMs: number;
  expiresAtMs: number;
}

export type PolicyDecision =
  | { kind: "allow"; reason: string; ruleId?: string }
  | { kind: "ask"; binding: ApprovalBinding; reason: string }
  | { kind: "deny"; code: string; reason: string; suggestedTool?: string };

export interface ApprovalRecord {
  binding: ApprovalBinding;
  state: "pending" | "approved" | "rejected" | "expired" | "cancelled" | "consumed";
  optionId?: string;
  decidedAtMs?: number;
  consumedAtMs?: number;
}

export interface FileDeltaReceipt {
  path: string;
  zone: "vault" | "external";
  beforeHash: string | null;
  afterHash: string | null;
  beforeBlob?: string;
  afterBlob?: string;
  status: "created" | "modified" | "deleted" | "renamed";
  priorPath?: string;
  attributable: boolean;
}

export interface MutationReceipt {
  operationId: string;
  identity: InvocationIdentity;
  status:
    | "prepared"
    | "applying"
    | "committed"
    | "partial"
    | "effect_unknown"
    | "needs_reconciliation";
  files: readonly FileDeltaReceipt[];
  startedAtMs: number;
  endedAtMs?: number;
  approvalRequestId?: string;
  errorCode?: string;
}

export interface ToolFailure {
  code: string;
  message: string;
  retryable: boolean;
  effectState: EffectState;
  operationId?: string;
  recoveryAction?: "reread" | "reauthorize" | "reconcile" | "configure" | "none";
}

export interface RunRecord {
  runId: string;
  requestId: string;
  status:
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
  modelAttempts: number;
  toolAttempts: number;
  cancelEpoch: number;
  startedAtMs: number;
  endedAtMs?: number;
  stopCode?: string;
}

export interface TodoItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

export interface TodoState {
  revision: number;
  items: readonly TodoItem[];
}

export interface SubagentRecord {
  childConversationId: string;
  parentConversationId: string;
  parentToolUiId: string;
  ownerTaskId: string;
  profileId: string;
  depth: number;
  status:
    | "queued"
    | "starting"
    | "running"
    | "awaiting_permission"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  background: boolean;
  parentRunId: string;
  cancelEpochAtStart: number;
  reportedAnswerIds: readonly string[];
}

export interface StreamCursor {
  streamEpoch: string;
  frameIndex: number;
}

export interface StoreIdentity {
  schemaVersion: 1;
  runtimeVersion: "1.3.0";
  vaultKey: string;
  rootId: string;
  createdAtMs: number;
  source?: { backendId: string; sessionId?: string; sourceHash: string };
}
