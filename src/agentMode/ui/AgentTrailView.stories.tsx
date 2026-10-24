import { useApp } from "@/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgentMessagePart, TurnFileChange } from "@/agentMode/session/types";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTrailProps = React.ComponentProps<typeof AgentTrail>;

function tool(
  id: string,
  vendorToolName: string,
  overrides: Partial<Extract<AgentMessagePart, { kind: "tool_call" }>> = {}
): AgentMessagePart {
  return {
    kind: "tool_call",
    id,
    title: id,
    status: "completed",
    vendorToolName,
    ...overrides,
  };
}

const think = (text: string): AgentMessagePart => ({ kind: "thought", text });
const say = (text: string): AgentMessagePart => ({ kind: "text", text });

// Projected reasoning keeps one span per thinking block: the Pi ThinkingProjection supplies the
// real start/end times and only public text, and the trail renders those spans as separate rows
// instead of one growing reasoning block:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const reasoned = (text: string, startedAtMs: number, durationMs?: number): AgentMessagePart => ({
  kind: "thought",
  text,
  startedAtMs,
  ...(durationMs !== undefined ? { durationMs } : {}),
});

const PROJECTED_REASONING: AgentMessagePart[] = [
  reasoned(
    "Read the durable projection before touching the renderer; the first block is a complete span.",
    1_000,
    12_400
  ),
  tool("read-1", "Read", {
    locations: [{ path: "src/agentMode/sdk/pi/events/ThinkingProjection.ts" }],
  }),
  reasoned(
    "A second thinking block starts a new span, so its timer begins after the tool result.",
    18_000,
    7_300
  ),
  say("Both reasoning blocks are public thinking from the model, not reconstructed prose."),
];

const TURN: AgentMessagePart[] = [
  think("The conference is probably on the calendar rather than in a note."),
  tool("s1", "Skill", { input: { skill: "gcal" } }),
  think("The helper is not on PATH here."),
  tool("b1", "Bash", { input: { description: "Locate the gws binary" } }),
  think("Searching the calendar for anything summit-shaped."),
  tool("b2", "Bash", { input: { description: "Search calendar for summit events" } }),
  tool("b3", "Bash", { input: { description: "Check calendar auth options" } }),
  think("Two accounts are configured, so I should ask which one to read."),
  say("I found two calendar accounts on this machine. Reading the personal one first."),
  tool("q1", "AskUserQuestion", {
    input: { questions: [{ header: "Account", question: "Which calendar should I read?" }] },
  }),
  tool("b4", "Bash", { input: { description: "Fetch Aug 1–2 events with descriptions" } }),
  tool("b5", "Bash", {
    input: { description: "Re-run with the personal profile" },
    status: "failed",
  }),
  think("The first profile has no access; the second one works."),
  say("Found it — **Agentic AI Summit 2026**, August 1–2 at the Marriott. Saving it to the vault."),
  tool("e1", "Edit", { input: { file_path: "Events/Agentic AI Summit 2026.md" } }),
  say("Saved to [[Agentic AI Summit 2026]] with the schedule and the two talks you flagged."),
];

const STREAMING: AgentMessagePart[] = [
  ...TURN.slice(0, 8),
  tool("b6", "Bash", {
    input: { description: "Fetch Aug 1–2 events with descriptions" },
    status: "in_progress",
  }),
];

const UNIFIED_CARDS: AgentMessagePart[] = [
  think("I should inspect the source before changing it."),
  say("The reasoning row uses the same inset and disclosure treatment as the work below."),
  tool("read-1", "Read", {
    locations: [{ path: "src/agentMode/ui/AgentTrailView.tsx" }],
    output: [{ type: "text", text: "export const AgentTrail = ..." }],
  }),
  say("Every tool call stays its own row instead of folding into a group."),
  tool("read-2", "Read", { locations: [{ path: "src/agentMode/ui/ActionCard.tsx" }] }),
  tool("test-1", "Bash", { input: { description: "Run focused activity-card tests" } }),
  say("Consecutive tools render as consecutive blocks with the same header geometry."),
  tool("delegate-1", "Task", {
    input: { subagent_type: "Explore", description: "Check nested trail cards" },
  }),
  tool("delegate-read", "Read", {
    parentToolCallId: "delegate-1",
    locations: [{ path: "src/agentMode/ui/SubAgentCard.tsx" }],
  }),
  say("Reasoning, individual tools, and delegated work now align."),
];

const FAILED_FILE_CHANGES: AgentMessagePart[] = [
  say("The edit was denied, so the card says the note was not edited."),
  tool("failed-edit", "Edit", { status: "failed", input: { file_path: "Projects/plan.md" } }),
  say("A denied write with no diff says the note was not edited."),
  tool("failed-write", "Write", {
    status: "failed",
    input: { file_path: "Projects/notes.md", content: "# Notes\n" },
    output: [{ type: "text", text: "User declined" }],
  }),
  say("A denied delete says the note was not deleted."),
  tool("failed-delete", "Delete", {
    status: "failed",
    toolKind: "delete",
    input: { filePath: "Archive/old.md" },
  }),
  say("A failed shell command still ran, so its label is unchanged."),
  tool("failed-bash", "Bash", { status: "failed", input: { command: "npm test" } }),
  say("A completed edit keeps its past-tense label."),
  tool("done-edit", "Edit", { input: { file_path: "Projects/plan.md" } }),
];

const SEARCH_RESULTS = JSON.stringify({
  results: [{ path: "notes/Standing desk setup.md" }, { path: "notes/Untitled 3.md" }],
});

const VAULT_SEARCH: AgentMessagePart[] = [
  tool("search-1", "vault_search", {
    title: "Search notes for standing desk and back pain",
    toolKind: "search",
    input: { query: "standing desk back pain" },
    output: [{ type: "text", text: SEARCH_RESULTS }],
  }),
  tool("read-1", "vault_read", {
    title: "Read Standing desk setup.md",
    toolKind: "read",
    input: { path: "notes/Standing desk setup.md" },
    locations: [{ path: "notes/Standing desk setup.md" }],
  }),
  say("You wrote that a monitor arm and a sit-stand rhythm fixed it. See [[Standing desk setup]]."),
];

const LINK_NOTES: Record<string, string> = {
  "Standing desk setup": "notes/Standing desk setup.md",
  "Untitled 3": "notes/Untitled 3.md",
  "Reading list": "notes/Reading list.md",
  "Trip planning": "notes/Trip planning.md",
};

const NOTE_REFERENCES: AgentMessagePart[] = [
  tool("search-1", "vault_search", {
    title: "Find notes about the standing desk",
    toolKind: "search",
    input: { query: "standing desk" },
    output: [{ type: "text", text: SEARCH_RESULTS }],
  }),
  tool("search-2", "vault_search", {
    title: "Find notes containing ZX-4471",
    toolKind: "search",
    input: { query: "ZX-4471" },
  }),
  say(
    "The notes reference [[Standing desk setup]] (see [[Standing desk setup#Fixes]]) and your scratch note, [[Untitled 3|desk scratchpad]]. A second search added [[Reading list]] and [Trip planning](notes/Trip%20planning.md)."
  ),
];

const VAULT_SEARCH_RUNNING: AgentMessagePart[] = [
  tool("search-1", "vault_search", {
    title: "Search notes for standing desk and back pain",
    toolKind: "search",
    status: "in_progress",
    input: { query: "standing desk back pain" },
  }),
];

type CompactionOverrides = Partial<Extract<AgentMessagePart, { kind: "compaction" }>>;

const compaction = (overrides: CompactionOverrides = {}): AgentMessagePart => ({
  kind: "compaction",
  id: "compaction-1",
  status: "completed",
  trigger: "manual",
  startedAtMs: Date.now() - 12_000,
  ...overrides,
});

const TrailDemo: React.FC<{
  parts: AgentMessagePart[];
  isStreaming?: boolean;
  showCompletedDuration?: boolean;
  fileChanges?: TurnFileChange[];
  linkNotes?: Record<string, string>;
}> = ({ parts, isStreaming = false, showCompletedDuration = true, fileChanges, linkNotes }) => {
  const contextApp = useApp();
  const app = linkNotes
    ? Object.create(contextApp, {
        vault: { value: Object.create(contextApp.vault, { getName: { value: () => "step-2" } }) },
        metadataCache: {
          value: {
            getFirstLinkpathDest: (linkpath: string) => {
              const path = linkNotes[linkpath] ?? linkpath;
              return Object.values(linkNotes).includes(path) ? { path } : null;
            },
          },
        },
      })
    : contextApp;
  return (
    <TooltipProvider>
      <AgentTrail
        parts={parts}
        isStreaming={isStreaming}
        turnStartedAtMs={isStreaming ? Date.now() - 138_000 : undefined}
        turnDurationMs={!isStreaming && showCompletedDuration ? 138_000 : undefined}
        timestamp="2026/08/07 20:31:10"
        app={app}
        turnStopReason={isStreaming ? undefined : "end_turn"}
        fileChanges={fileChanges}
      />
    </TooltipProvider>
  );
};

const meta = {
  title: "Agent Mode/Agent Trail",
  component: AgentTrail,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentTrailProps>;
export default meta;

export const InterleavedRunBlocks: StoryObj<AgentTrailProps> = {
  // 一个 run 的思考、工具与文本逐块独立渲染：https://github.com/ItsDalk-Lane/Vault-Agent/issues/6
  render: () => <TrailDemo parts={TURN} />,
};

export const ProjectedReasoningSpans: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={PROJECTED_REASONING} />,
};

export const ProjectedReasoningStreaming: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        ...PROJECTED_REASONING.slice(0, 3),
        reasoned(
          "The last block is still streaming, so its timer runs from its own start.",
          30_000
        ),
      ]}
      isStreaming
    />
  ),
};

export const NoPublicReasoning: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        tool("read-2", "Read", {
          locations: [{ path: "src/agentMode/ui/AgentTrailView.tsx" }],
        }),
        say("This model returned no thinking blocks, so no reasoning row is fabricated."),
      ]}
    />
  ),
};

export const Streaming: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={STREAMING} isStreaming />,
};

export const UnifiedCardStyles: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={UNIFIED_CARDS} />,
};

export const FailedFileChanges: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={FAILED_FILE_CHANGES} />,
};

export const VaultSearch: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={VAULT_SEARCH} />,
};

export const NoteReferences: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={NOTE_REFERENCES} linkNotes={LINK_NOTES} />,
};

export const VaultSearchRunning: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={VAULT_SEARCH_RUNNING} isStreaming />,
};

export const CompletedWithoutDuration: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={UNIFIED_CARDS} showCompletedDuration={false} />,
};

const EDITED_FILES: TurnFileChange[] = [
  {
    path: "Events/Agentic AI Summit 2026.md",
    status: "created",
    before: null,
    after: "after\n",
    additions: 42,
    deletions: 0,
  },
  {
    path: "Daily/2026-08-07.md",
    status: "modified",
    before: "before\n",
    after: "after\n",
    additions: 3,
    deletions: 1,
  },
];

export const WithFilesChanged: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={TURN} fileChanges={EDITED_FILES} />,
};

export const CompactionRunningManual: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={[compaction({ status: "in_progress" })]} isStreaming />,
};

export const CompactionRunningAuto: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        say("Reading the remaining notes before I summarize them."),
        compaction({ status: "in_progress", trigger: "auto" }),
      ]}
      isStreaming
    />
  ),
};

export const CompactionCompletedWithTokens: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[compaction({ preTokens: 182_340, postTokens: 24_100 })]}
      showCompletedDuration={false}
    />
  ),
};

export const CompactionCompletedWithoutTokens: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={[compaction()]} showCompletedDuration={false} />,
};

export const CompactionCompletedAutomatically: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        tool("b1", "Bash", { input: { description: "Search the vault" } }),
        tool("b2", "Bash", { input: { description: "Read the matching notes" } }),
        compaction({ trigger: "auto", preTokens: 910_000, postTokens: 31_000 }),
        tool("b3", "Bash", { input: { description: "Draft the summary" } }),
        tool("b4", "Bash", { input: { description: "Save it to the vault" } }),
        say("Saved the summary to [[Weekly review]]."),
      ]}
    />
  ),
};

export const CompactionFailed: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[compaction({ status: "failed", error: "The summarization request timed out." })]}
      showCompletedDuration={false}
    />
  ),
};

export const CompactionCancelled: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo parts={[compaction({ status: "cancelled" })]} showCompletedDuration={false} />
  ),
};

export const CompactionSkipped: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo parts={[compaction({ status: "skipped" })]} showCompletedDuration={false} />
  ),
};
