import { useApp } from "@/context";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { FanoutMessageCard } from "@/agentMode/ui/FanoutMessageCard";
import type { FanoutMessageCardProps } from "@/agentMode/ui/FanoutMessageCard";
import type { FanoutProjectionView } from "@/agentMode/session/fanout/fanoutTypes";
import type { Meta, StoryObj } from "@/lib/story";
import { TooltipProvider } from "@/components/ui/tooltip";
import React, { useState } from "react";

// Fan-out card states come from real projection events: candidates run, one fails, a cancellation
// lands, and a finished answer with no text shows its explicit state:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const message: AgentChatMessage = {
  id: "fanout-1",
  sender: "AI",
  message: "Fan-out summary",
  timestamp: { epoch: 1, display: "2026/08/07 20:31:10", fileName: "now" },
  isVisible: true,
};

function turn(answers: FanoutTurn["answers"], summary: FanoutTurn["summary"]): FanoutTurn {
  return { answers, summary };
}

const runningTurn = turn(
  {
    "anthropic/claude": {
      backendId: "anthropic/claude",
      status: "running",
      text: "Claude is still reading the notes…",
      modelKey: "anthropic/claude",
    },
    "openai/gpt": {
      backendId: "openai/gpt",
      status: "running",
      text: "",
      modelKey: "openai/gpt",
    },
  },
  { status: "streaming", text: "" }
);

const partialFailureTurn = turn(
  {
    "anthropic/claude": {
      backendId: "anthropic/claude",
      status: "done",
      text: "Claude found the checklist in the notes.",
      modelKey: "anthropic/claude",
    },
    "openai/gpt": {
      backendId: "openai/gpt",
      status: "error",
      text: "",
      error: "The provider timed out after 5 minutes.",
      modelKey: "openai/gpt",
    },
  },
  { status: "done", text: "Only Claude produced an answer; GPT timed out." }
);

const cancelledTurn = turn(
  {
    "anthropic/claude": {
      backendId: "anthropic/claude",
      status: "cancelled",
      text: "partial",
      modelKey: "anthropic/claude",
    },
    "openai/gpt": {
      backendId: "openai/gpt",
      status: "done",
      text: "GPT finished before the stop.",
      modelKey: "openai/gpt",
    },
  },
  { status: "done", text: "Stopped after GPT answered." }
);

const emptyAnswerTurn = turn(
  {
    "anthropic/claude": {
      backendId: "anthropic/claude",
      status: "done",
      text: "   ",
      modelKey: "anthropic/claude",
    },
    "openai/gpt": {
      backendId: "openai/gpt",
      status: "done",
      text: "GPT answered with the full list.",
      modelKey: "openai/gpt",
    },
  },
  { status: "done", text: "One candidate returned no text." }
);

const StoryFrame: React.FC<{ readonly turn: FanoutTurn; readonly onResume?: () => void }> = ({
  turn: storyTurn,
  onResume,
}) => {
  const app = useApp();
  return (
    <TooltipProvider delayDuration={0}>
      <FanoutMessageCard message={message} turn={storyTurn} app={app} onResume={onResume} />
    </TooltipProvider>
  );
};

const ProjectedFrame: React.FC<{ readonly turn: FanoutTurn }> = ({ turn: storyTurn }) => {
  const app = useApp();
  return (
    <TooltipProvider delayDuration={0}>
      <FanoutMessageCard message={message} turn={storyTurn} app={app} projection={projectedView} />
    </TooltipProvider>
  );
};

const LiveFanoutDemo: React.FC = () => {
  const [state, setState] = useState<{
    claude: "running" | "done" | "error";
    gpt: "running" | "done" | "error";
    summary: string;
    summaryStatus: "streaming" | "done";
  }>({ claude: "running", gpt: "running", summary: "", summaryStatus: "streaming" });
  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <div className="tw-flex tw-flex-wrap tw-gap-2">
        <button
          type="button"
          onClick={() => setState((previous) => ({ ...previous, claude: "done" }))}
        >
          Complete Claude
        </button>
        <button
          type="button"
          onClick={() => setState((previous) => ({ ...previous, gpt: "error" }))}
        >
          Fail GPT
        </button>
        <button
          type="button"
          onClick={() =>
            setState((previous) => ({
              ...previous,
              summary: "Claude answered; GPT failed.",
              summaryStatus: "done",
            }))
          }
        >
          Write summary
        </button>
      </div>
      <StoryFrame
        turn={turn(
          {
            "anthropic/claude": {
              backendId: "anthropic/claude",
              status: state.claude,
              text:
                state.claude === "done"
                  ? "Claude finished with the checklist."
                  : "Claude is still reading the notes…",
              modelKey: "anthropic/claude",
            },
            "openai/gpt": {
              backendId: "openai/gpt",
              status: state.gpt,
              text: "",
              modelKey: "openai/gpt",
              ...(state.gpt === "error" ? { error: "The provider timed out." } : {}),
            },
          },
          { status: state.summaryStatus, text: state.summary }
        )}
      />
    </div>
  );
};

const meta = {
  title: "Agent Mode/Fanout Message Card",
  component: FanoutMessageCard,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<FanoutMessageCardProps>;
export default meta;

type Story = StoryObj<FanoutMessageCardProps>;

export const RunningCandidates: Story = {
  render: () => <StoryFrame turn={runningTurn} />,
};

export const PartialFailure: Story = {
  render: () => <StoryFrame turn={partialFailureTurn} />,
};

export const CancelledCandidate: Story = {
  render: () => <StoryFrame turn={cancelledTurn} />,
};

export const EmptyAnswerState: Story = {
  render: () => <StoryFrame turn={emptyAnswerTurn} />,
};

export const EventDrivenUpdates: Story = {
  render: () => <LiveFanoutDemo />,
};

const projectedTurn = partialFailureTurn;

const projectedView: FanoutProjectionView = {
  fanoutId: "fanout-1",
  candidates: [
    {
      slotId: "anthropic/claude",
      modelKey: "anthropic/claude",
      label: "Claude",
      state: "done",
      text: "Claude found the checklist in the notes.",
      emptyAnswer: false,
      copyText: "Claude found the checklist in the notes.",
    },
    {
      slotId: "openai/gpt",
      modelKey: "openai/gpt",
      label: "GPT",
      state: "error",
      text: "",
      error: "The provider timed out after 5 minutes.",
      emptyAnswer: true,
      copyText: "",
    },
  ],
  summary: {
    state: "done",
    text: "Only Claude produced an answer; GPT timed out.",
    synthesisModelKey: "pi/synth",
    consensusVerified: false,
    sources: [{ slotId: "anthropic/claude", modelKey: "anthropic/claude", label: "Claude" }],
    copyText: "Only Claude produced an answer; GPT timed out.",
  },
  modelLabels: { "anthropic/claude": "Claude", "openai/gpt": "GPT" },
  copyText: "Only Claude produced an answer; GPT timed out.",
};

export const ProjectedSummary: Story = {
  render: () => <ProjectedFrame turn={projectedTurn} />,
};

export const Recoverable: Story = {
  args: {
    message,
    turn: {
      ...cancelledTurn,
      checkpoint: {
        fanoutId: "saved-turn",
        mainModelKey: "anthropic/claude",
        originalPromptText: "Compare the notes",
        prompt: [{ type: "text", text: "Compare the notes" }],
      },
    },
    onResume: () => undefined,
  },
  render: (args) => <StoryFrame turn={args.turn ?? cancelledTurn} onResume={args.onResume} />,
};

export const BudgetPaused: Story = {
  render: () => (
    <StoryFrame
      onResume={() => undefined}
      turn={{
        answers: {
          "model-a": {
            backendId: "pi",
            modelKey: "model-a",
            label: "Model A",
            status: "done",
            text: "This answer finished before the limit.",
          },
          "model-b": {
            backendId: "pi",
            modelKey: "model-b",
            label: "Model B",
            status: "paused",
            text: "Partial analysis retained for continuation.",
          },
        },
        summary: { status: "paused", text: "", complete: false },
        checkpoint: {
          fanoutId: "paused-turn",
          mainModelKey: "model-a",
          originalPromptText: "Compare the notes",
          prompt: [{ type: "text", text: "Compare the notes" }],
        },
      }}
    />
  ),
};

export const QueuedBeforeAdmission: Story = {
  render: () => (
    <StoryFrame
      turn={{
        answers: {
          "cm-a": {
            backendId: "pi",
            modelKey: "cm-a",
            label: "Model A",
            status: "paused",
            text: "",
          },
          "cm-b": {
            backendId: "pi",
            modelKey: "cm-b",
            label: "Model B",
            status: "paused",
            text: "",
          },
        },
        summary: { status: "paused", text: "", complete: false },
        checkpoint: {
          fanoutId: "saved-unstarted",
          mainModelKey: "cm-a",
          originalPromptText: "Compare the notes",
          prompt: [{ type: "text", text: "Compare the notes" }],
          awaitingAdmission: true,
        },
      }}
      onResume={() => undefined}
    />
  ),
};

export const QueuedReadOnlyHistory: Story = {
  render: () => (
    <StoryFrame
      turn={{
        checkpoint: {
          fanoutId: "queued-readonly",
          mainModelKey: "cm-a",
          originalPromptText: "Saved comparison",
          prompt: [],
          awaitingAdmission: true,
        },
        answers: {
          "cm-a": { backendId: "pi", modelKey: "cm-a", status: "paused", text: "" },
          "cm-b": { backendId: "pi", modelKey: "cm-b", status: "paused", text: "" },
        },
        summary: { status: "paused", text: "", complete: false },
      }}
    />
  ),
};
