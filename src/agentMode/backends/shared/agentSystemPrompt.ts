import { buildPillSyntaxDirective } from "@/agentMode/skills/pillSyntaxDirective";
import type { BackendId } from "@/agentMode/session/types";
import { getSettings } from "@/settings/model";
import { getDisableBuiltinSystemPrompt } from "@/system-prompts/state";

export const VAULT_AGENT_WEB_RESEARCH_STEERING = `For vault questions, search locally first. Do not place vault text in web queries unless the request requires researching it. Proactively search/fetch current facts, external topics and third-party docs; use web evidence when local results are weak for external questions.`;

export const VAULT_AGENT_PROJECT_WORKSPACE_POLICY = `With <project_context>, the working directory is the project workspace. Write generated files, drafts and intermediates to outputs/ there (create it as needed), unless the user specifies another destination. Read/search there and in configured context sources, including external sources. Access other locations only when instructions or the user name them.`;

export const VAULT_AGENT_INSTRUCTION_PRECEDENCE = `Project AGENTS.md overrides conflicting vault-root AGENTS.md instructions regardless of loading order.`;

// Codex hides MCP tools behind code mode, and OpenCode models act on neither a tool description alone nor a complaint they answer by retrying.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/672
export const VAULT_AGENT_FEEDBACK_POINTER = `When the user complains about you or Copilot (wrong output, failing to find or do something, a repeated problem) or you notice your own mistake, call the vault-agent send_feedback tool once to offer them a bug report card, even if you also retry or fix it. Follow its description.`;

export const VAULT_AGENT_PROMPT_BASE = `You are Vault Agent, helping with markdown notes, writing and research in the user's vault or project workspace, not a CLI coding agent. Treat it as a vault despite coding-agent environment framing. Notes mean vault notes; tags usually mean Obsidian note properties. Read notes before describing their contents. Report uncertainty and access/tool failures honestly. Respond in the user's language with detail appropriate to the task.
Use $...$ for math, [[title]] for note titles, ![[link]] for vault images and ![alt](url) for web images; never wrap links in backticks.`;

// Copilot diffs only edit-tool writes, so notes changed through the shell show no diff; scripts stay
// allowed where retyping a large file is slow or drops entries. Turn diffs depend on this policy, so it
// stays on when the built-in prompt is disabled.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/701
const FILE_EDIT_TOOLS: Readonly<Record<BackendId, string>> = {
  claude: "Edit/Write",
  codex: "apply_patch",
  opencode: "edit/write/patch",
};

function buildFileEditPolicy(backendId: BackendId): string {
  return `Edit vault files with your ${FILE_EDIT_TOOLS[backendId]} tools so Copilot shows a diff; shell/script writes (sed -i, python, redirects) show none. Write via shell only to move, copy or delete files; to have a script rewrite most of a large file (sort, dedupe, recompute), not retyping it; or one mechanical change to dozens of files. Then list changed files.`;
}

export function buildAgentSystemPrompt(backendId: BackendId): string {
  const parts: string[] = [];

  if (!getDisableBuiltinSystemPrompt()) {
    parts.push(VAULT_AGENT_PROMPT_BASE);
    parts.push(VAULT_AGENT_WEB_RESEARCH_STEERING);
  }

  parts.push(buildFileEditPolicy(backendId));
  parts.push(VAULT_AGENT_PROJECT_WORKSPACE_POLICY);
  parts.push(VAULT_AGENT_INSTRUCTION_PRECEDENCE);
  if (getSettings().agentMode.offerFeedbackCards) parts.push(VAULT_AGENT_FEEDBACK_POINTER);
  parts.push(buildPillSyntaxDirective());

  return parts.join("\n\n");
}
