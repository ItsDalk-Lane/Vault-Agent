import type { LucideIcon } from "lucide-react";
import { Bot, MessageCircleQuestion } from "lucide-react";
import { pickToolIcon } from "@/agentMode/ui/toolIcons";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type {} from "@/agentMode/session/types";
import { formatDuration } from "@/lib/duration";
import { t } from "@/i18n";
import { diffTargetPaths, primaryEditTargetPath } from "@/agentMode/session/editTargets";
import { isAbsolutePath } from "@/utils/vaultPath";

export interface ToolSummaryContext {
  vaultBase: string | null;
}

export interface ToolSummary {
  icon: LucideIcon;
  collapsedLine: (part: ToolCallPart, ctx?: ToolSummaryContext) => string;
  outcome: (part: ToolCallPart) => string | null;
  expandedDetails?: (part: ToolCallPart) => string | null;
  targetPath?: (part: ToolCallPart, ctx?: ToolSummaryContext) => string | null;
}

export function lookupToolSummary(part: ToolCallPart): ToolSummary {
  const base = selectToolSummary(part);
  if (!part.mcpServer) return base;
  const server = part.mcpServer;
  return {
    ...base,
    collapsedLine: (p, ctx) => `${server} · ${base.collapsedLine(p, ctx)}`,
  };
}

function selectToolSummary(part: ToolCallPart): ToolSummary {
  // A user's choice remains the visible result even when a late adapter
  // update retains the original tool kind or vendor name.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/41
  if (part.userResponse) return USER_RESPONSE_SUMMARY;
  if (isOpencodeTaskTool(part)) return TASK_SUMMARY;
  if (part.vendorToolName) {
    const v = VENDOR_SUMMARIES[part.vendorToolName];
    if (v) return v;
  }
  if (part.toolKind) {
    const k = KIND_SUMMARIES[part.toolKind];
    if (k) return k;
  }
  return GENERIC_SUMMARY;
}

function isOpencodeTaskTool(part: ToolCallPart): boolean {
  if (part.vendorToolName) return false;
  if (part.toolKind && part.toolKind !== "other") return false;
  const input = part.input as { subagent_type?: unknown } | null | undefined;
  return typeof input?.subagent_type === "string";
}

function targetFromTitle(part: ToolCallPart): string {
  const t = part.title;
  if (!t) return "…";
  if (part.vendorToolName && t.toLowerCase() === part.vendorToolName.toLowerCase()) return "…";
  return t;
}

function humanizeToolName(name: string): string {
  const words = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

function genericToolLabel(part: ToolCallPart): string {
  if (!part.vendorToolName && /\s/.test(part.title)) return part.title;
  const bare = part.vendorToolName ?? part.title;
  return humanizeToolName(bare) || t("agentChat.toolCallFallback");
}

function firstQuestionText(part: ToolCallPart): string | null {
  const input = part.input as
    | { questions?: Array<{ question?: unknown; header?: unknown }> }
    | null
    | undefined;
  const first = input?.questions?.[0];
  if (!first) return null;
  const header = typeof first.header === "string" ? first.header.trim() : "";
  if (header) return header;
  const question = typeof first.question === "string" ? first.question.trim() : "";
  return question || null;
}

function createsNewFile(part: ToolCallPart): boolean {
  const diffs = (part.output ?? []).filter((o) => o.type === "diff");
  return diffs.length > 0 && diffs.every((o) => o.oldText === null);
}

function targetFromPath(part: ToolCallPart, vaultBase: string | null): string | null {
  return primaryEditTargetPath(
    { locations: part.locations, input: part.input, diffPaths: diffTargetPaths(part.output) },
    vaultBase
  );
}

export function displayTargetFromPath(part: ToolCallPart, vaultBase: string | null): string | null {
  const path = targetFromPath(part, vaultBase);
  if (!path || !isAbsolutePath(path)) return path;
  const leaf = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop();
  return leaf ? `…/${leaf}` : "…";
}

function skillNameFromInput(part: ToolCallPart): string | null {
  const input = part.input as { skill?: unknown } | null | undefined;
  const skill = input?.skill;
  if (typeof skill !== "string") return null;
  const trimmed = skill.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function queryFromInput(part: ToolCallPart): string | null {
  const input = part.input as
    | { query?: unknown; pattern?: unknown; q?: unknown }
    | null
    | undefined;
  for (const k of ["query", "pattern", "q"] as const) {
    const v = input?.[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function diffStats(part: ToolCallPart): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const o of part.output ?? []) {
    if (o.type !== "diff") continue;
    if (o.oldText !== null) {
      removed += o.oldText.split("\n").length;
    }
    added += o.newText.split("\n").length;
  }
  return { added, removed };
}

function approxTokens(part: ToolCallPart): number {
  let chars = 0;
  for (const o of part.output ?? []) {
    if (o.type === "text") chars += o.text.length;
  }
  return Math.round(chars / 4);
}

const READ_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "Read" }),
  collapsedLine: (p, ctx) => {
    const target = displayTargetFromPath(p, ctx?.vaultBase ?? null) ?? targetFromTitle(p);
    return p.status === "completed" || p.status === "failed"
      ? t("agentChat.tools.readDone", { target })
      : t("agentChat.tools.readRunning", { target });
  },
  outcome: (p) => {
    const tokens = approxTokens(p);
    return tokens > 0 ? t("agentChat.tools.outcomeTokens", { tokens: formatTokens(tokens) }) : null;
  },
  targetPath: (p, ctx) => targetFromPath(p, ctx?.vaultBase ?? null),
};

const LIST_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "LS" }),
  collapsedLine: (p, ctx) => {
    const path = displayTargetFromPath(p, ctx?.vaultBase ?? null);
    const completed = p.status === "completed" || p.status === "failed";
    if (path) {
      return completed
        ? t("agentChat.tools.listDone", { target: path })
        : t("agentChat.tools.listRunning", { target: path });
    }
    return completed ? t("agentChat.tools.listRootDone") : t("agentChat.tools.listRootRunning");
  },
  outcome: () => null,
};

// A failed or denied file change leaves the note untouched, so the label
// must not claim it happened.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/691
const EDIT_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "Edit" }),
  collapsedLine: (p, ctx) => {
    const diffPathCount = diffTargetPaths(p.output).length;
    const failed = p.status === "failed";
    const creates = createsNewFile(p);
    const completed = p.status === "completed" || failed;
    if (diffPathCount > 1) {
      const count = diffPathCount;
      if (failed) {
        return creates
          ? t("agentChat.tools.editFailedCreateMany", { count })
          : t("agentChat.tools.editFailedEditMany", { count });
      }
      return completed
        ? t("agentChat.tools.editDoneMany", { count })
        : t("agentChat.tools.editRunningMany", { count });
    }
    const target = displayTargetFromPath(p, ctx?.vaultBase ?? null);
    if (failed) {
      if (creates) {
        return target
          ? t("agentChat.tools.editFailedCreate", { target })
          : t("agentChat.tools.editFailedCreateFallback");
      }
      return target
        ? t("agentChat.tools.editFailedEdit", { target })
        : t("agentChat.tools.editFailedEditFallback");
    }
    if (!target) {
      return completed
        ? t("agentChat.tools.editDoneFallback")
        : t("agentChat.tools.editRunningFallback");
    }
    return completed
      ? t("agentChat.tools.editDone", { target })
      : t("agentChat.tools.editRunning", { target });
  },
  outcome: (p) => {
    const { added, removed } = diffStats(p);
    if (added === 0 && removed === 0) return null;
    return t("agentChat.tools.outcomeDiffLines", { added, removed });
  },
  targetPath: (p, ctx) =>
    diffTargetPaths(p.output).length > 1 ? null : targetFromPath(p, ctx?.vaultBase ?? null),
};

const BASH_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "Bash" }),
  collapsedLine: (p) => {
    const input = p.input as { command?: unknown; description?: unknown } | null | undefined;
    if (typeof input?.description === "string" && input.description.length > 0) {
      return input.description;
    }
    const completed = p.status === "completed" || p.status === "failed";
    if (typeof input?.command === "string") {
      const cmd = input.command.length > 60 ? input.command.slice(0, 60) + "…" : input.command;
      return completed
        ? t("agentChat.tools.bashDoneCommand", { command: cmd })
        : t("agentChat.tools.bashRunningCommand", { command: cmd });
    }
    const target = targetFromTitle(p);
    return completed
      ? t("agentChat.tools.bashDoneTarget", { target })
      : t("agentChat.tools.bashRunningTarget", { target });
  },
  outcome: () => null,
  expandedDetails: (p) => {
    const input = p.input as { command?: unknown; description?: unknown } | null | undefined;
    if (typeof input?.command !== "string" || input.command.length === 0) return null;
    if (typeof input.description === "string" && input.description.length > 0) {
      return `# ${input.description}\n${input.command}`;
    }
    return input.command;
  },
};

const SEARCH_VAULT_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "Grep" }),
  collapsedLine: (p) => {
    const completed = p.status === "completed" || p.status === "failed";
    const q = queryFromInput(p);
    if (q) {
      return completed
        ? t("agentChat.tools.searchVaultDoneQuery", { query: q })
        : t("agentChat.tools.searchVaultRunningQuery", { query: q });
    }
    const target = targetFromTitle(p);
    return completed
      ? t("agentChat.tools.searchVaultDoneTarget", { target })
      : t("agentChat.tools.searchVaultRunningTarget", { target });
  },
  outcome: () => null,
};

const WEB_SEARCH_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "WebSearch" }),
  collapsedLine: (p) => {
    const completed = p.status === "completed" || p.status === "failed";
    const q = queryFromInput(p);
    if (q) {
      return completed
        ? t("agentChat.tools.searchWebDoneQuery", { query: q })
        : t("agentChat.tools.searchWebRunningQuery", { query: q });
    }
    const target = targetFromTitle(p);
    return completed
      ? t("agentChat.tools.searchWebDoneTarget", { target })
      : t("agentChat.tools.searchWebRunningTarget", { target });
  },
  outcome: () => null,
};

const WEB_FETCH_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "WebFetch" }),
  collapsedLine: (p) => {
    const completed = p.status === "completed" || p.status === "failed";
    const input = p.input as { url?: unknown } | null | undefined;
    const target = typeof input?.url === "string" ? input.url : targetFromTitle(p);
    return completed
      ? t("agentChat.tools.fetchDone", { target })
      : t("agentChat.tools.fetchRunning", { target });
  },
  outcome: () => null,
};

const TASK_SUMMARY: ToolSummary = {
  icon: Bot,
  collapsedLine: (p) => {
    const input = p.input as
      | { description?: unknown; subagent_type?: unknown; prompt?: unknown }
      | null
      | undefined;
    const agent = typeof input?.subagent_type === "string" ? input.subagent_type : null;
    const desc =
      typeof input?.description === "string" && input.description.length > 0
        ? input.description
        : typeof input?.prompt === "string"
          ? input.prompt.slice(0, 60)
          : targetFromTitle(p);
    return agent
      ? t("agentChat.tools.taskNamed", { agent, description: desc })
      : t("agentChat.tools.taskFallback", { description: desc });
  },
  outcome: (p) => {
    const progress = p.progress;
    if (!progress) return null;
    const bits: string[] = [];
    if ((p.status === "pending" || p.status === "in_progress") && progress.description?.trim()) {
      bits.push(progress.description.trim());
    }
    if (progress.toolUses !== undefined) {
      bits.push(
        progress.toolUses === 1
          ? t("agentChat.subAgent.tools_one", { count: progress.toolUses })
          : t("agentChat.subAgent.tools_many", { count: progress.toolUses })
      );
    }
    if (progress.durationMs !== undefined) bits.push(formatDuration(progress.durationMs));
    return bits.length > 0 ? bits.join(" · ") : null;
  },
};

const TODO_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "TodoWrite" }),
  collapsedLine: (p) =>
    p.status === "completed" || p.status === "failed"
      ? t("agentChat.tools.todoDone")
      : t("agentChat.tools.todoRunning"),
  outcome: (p) => {
    const input = p.input as { todos?: unknown[] } | null | undefined;
    const n = Array.isArray(input?.todos) ? input.todos.length : 0;
    return n > 0
      ? n === 1
        ? t("agentChat.tools.todoOutcome_one", { count: n })
        : t("agentChat.tools.todoOutcome_many", { count: n })
      : null;
  },
};

const EXIT_PLAN_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "ExitPlanMode" }),
  collapsedLine: (p) =>
    p.status === "completed" || p.status === "failed"
      ? t("agentChat.tools.exitPlanDone")
      : t("agentChat.tools.exitPlanRunning"),
  outcome: () => null,
};

const ASK_USER_QUESTION_SUMMARY: ToolSummary = {
  icon: MessageCircleQuestion,
  collapsedLine: (p) => {
    const completed = p.status === "completed" || p.status === "failed";
    const q = firstQuestionText(p);
    if (q) {
      return completed
        ? t("agentChat.tools.askDoneQuestion", { question: q })
        : t("agentChat.tools.askRunningQuestion", { question: q });
    }
    return completed ? t("agentChat.tools.askDoneGeneric") : t("agentChat.tools.askRunningGeneric");
  },
  outcome: () => null,
};

const SKILL_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ vendorToolName: "Skill" }),
  collapsedLine: (p) => {
    const completed = p.status === "completed" || p.status === "failed";
    const name = skillNameFromInput(p);
    if (name) {
      return completed
        ? t("agentChat.tools.skillDoneNamed", { name })
        : t("agentChat.tools.skillRunningNamed", { name });
    }
    return completed
      ? t("agentChat.tools.skillDoneGeneric")
      : t("agentChat.tools.skillRunningGeneric");
  },
  outcome: () => null,
  expandedDetails: (p) => {
    const input = p.input as { args?: unknown } | null | undefined;
    return typeof input?.args === "string" && input.args.length > 0 ? input.args : null;
  },
};

const VENDOR_SUMMARIES: Record<string, ToolSummary> = {
  Read: READ_SUMMARY,
  Edit: EDIT_SUMMARY,
  MultiEdit: EDIT_SUMMARY,
  Write: EDIT_SUMMARY,
  Bash: BASH_SUMMARY,
  Glob: SEARCH_VAULT_SUMMARY,
  Grep: SEARCH_VAULT_SUMMARY,
  WebSearch: WEB_SEARCH_SUMMARY,
  WebFetch: WEB_FETCH_SUMMARY,
  Task: TASK_SUMMARY,
  Agent: TASK_SUMMARY,
  TodoWrite: TODO_SUMMARY,
  ExitPlanMode: EXIT_PLAN_SUMMARY,
  AskUserQuestion: ASK_USER_QUESTION_SUMMARY,
  LS: LIST_SUMMARY,
  Skill: SKILL_SUMMARY,
};

const KIND_SEARCH_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ toolKind: "search" }),
  collapsedLine: (p) => {
    const completed = p.status === "completed" || p.status === "failed";
    const q = queryFromInput(p);
    if (q) {
      return completed
        ? t("agentChat.tools.searchKindDoneQuery", { query: q })
        : t("agentChat.tools.searchKindRunningQuery", { query: q });
    }
    const target = targetFromTitle(p);
    return completed
      ? t("agentChat.tools.searchKindDoneTarget", { target })
      : t("agentChat.tools.searchKindRunningTarget", { target });
  },
  outcome: () => null,
};
const KIND_EXECUTE_SUMMARY: ToolSummary = {
  ...BASH_SUMMARY,
  icon: pickToolIcon({ toolKind: "execute" }),
};
const KIND_FETCH_SUMMARY: ToolSummary = {
  ...WEB_FETCH_SUMMARY,
  icon: pickToolIcon({ toolKind: "fetch" }),
};
const KIND_DELETE_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ toolKind: "delete" }),
  collapsedLine: (p, ctx) => {
    const target = displayTargetFromPath(p, ctx?.vaultBase ?? null) ?? targetFromTitle(p);
    if (p.status === "failed") return t("agentChat.tools.deleteFailed", { target });
    return p.status === "completed"
      ? t("agentChat.tools.deleteDone", { target })
      : t("agentChat.tools.deleteRunning", { target });
  },
  outcome: () => null,
};
const KIND_MOVE_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ toolKind: "move" }),
  collapsedLine: (p, ctx) => {
    const target = displayTargetFromPath(p, ctx?.vaultBase ?? null) ?? targetFromTitle(p);
    return p.status === "completed" || p.status === "failed"
      ? t("agentChat.tools.moveDone", { target })
      : t("agentChat.tools.moveRunning", { target });
  },
  outcome: () => null,
};
const KIND_SWITCH_MODE_SUMMARY: ToolSummary = {
  ...EXIT_PLAN_SUMMARY,
  icon: pickToolIcon({ toolKind: "switch_mode" }),
};
const KIND_THINK_SUMMARY: ToolSummary = {
  icon: pickToolIcon({ toolKind: "think" }),
  collapsedLine: (p) =>
    p.status === "completed" || p.status === "failed"
      ? t("agentChat.tools.thinkDone")
      : t("agentChat.tools.thinkRunning"),
  outcome: () => null,
};

const KIND_SUMMARIES: Record<string, ToolSummary> = {
  read: READ_SUMMARY,
  edit: EDIT_SUMMARY,
  search: KIND_SEARCH_SUMMARY,
  execute: KIND_EXECUTE_SUMMARY,
  fetch: KIND_FETCH_SUMMARY,
  delete: KIND_DELETE_SUMMARY,
  move: KIND_MOVE_SUMMARY,
  switch_mode: KIND_SWITCH_MODE_SUMMARY,
  think: KIND_THINK_SUMMARY,
};

const GENERIC_SUMMARY: ToolSummary = {
  icon: pickToolIcon({}),
  collapsedLine: (p) => genericToolLabel(p),
  outcome: () => null,
};

const USER_RESPONSE_SUMMARY: ToolSummary = {
  icon: MessageCircleQuestion,
  collapsedLine: (part) => part.userResponse!,
  outcome: () => null,
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function extractSubAgentInputPrompt(part: ToolCallPart): string | null {
  const input = part.input as { prompt?: unknown } | null | undefined;
  const prompt = input?.prompt;
  if (typeof prompt !== "string") return null;
  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractSubAgentReturnText(part: ToolCallPart): string | null {
  if (!part.output) return null;
  const textChunks = part.output.filter((o) => o.type === "text") as { text: string }[];
  if (textChunks.length === 0) return null;
  const joined = textChunks.map((c) => c.text).join("\n");
  const m = joined.match(/<task_result>([\s\S]*?)<\/task_result>/);
  const result = m ? m[1].trim() : joined.trim();
  if (!result) return null;
  const prompt = extractSubAgentInputPrompt(part);
  if (prompt && prompt === result) return null;
  return result;
}
