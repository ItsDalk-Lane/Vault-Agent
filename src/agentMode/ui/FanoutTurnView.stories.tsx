import { FanoutTurnView } from "@/agentMode/ui/FanoutTurnView";
import { FANOUT_SUMMARY_OPTION } from "@/agentMode/ui/fanoutDropdown";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type Props = React.ComponentProps<typeof FanoutTurnView>;

const meta = {
  title: "Agent/Fanout Turn",
  component: FanoutTurnView,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const SummaryRequestError: StoryObj<Props> = {
  render: function SummaryStory(args) {
    return (
      <FanoutTurnView
        turn={args.turn!}
        value={args.value!}
        onSelect={args.onSelect!}
        app={useApp()}
      />
    );
  },
  args: {
    value: FANOUT_SUMMARY_OPTION,
    onSelect: () => {},
    turn: {
      answers: {
        "local-qwen": {
          backendId: "pi",
          modelKey: "local-qwen",
          label: "Qwen · LM Studio",
          status: "done",
          text: "The notes support a weekly review.",
        },
        "cloud-sonnet": {
          backendId: "pi",
          modelKey: "cloud-sonnet",
          label: "Claude Sonnet · Work",
          status: "done",
          text: "Keep the weekly review focused on the three unfinished actions.",
        },
      },
      summary: {
        status: "done",
        text: "",
        error: "The configured summary model is unavailable. Choose an enabled model and retry.",
      },
    },
  },
};

export const SingleModelAnswer: StoryObj<Props> = {
  render: SummaryRequestError.render,
  args: {
    value: "local-qwen",
    onSelect: () => {},
    turn: {
      answers: {
        "local-qwen": {
          backendId: "pi",
          modelKey: "local-qwen",
          label: "Qwen · LM Studio",
          status: "done",
          text: "The active note supports a weekly review with three concrete follow-ups.",
        },
      },
      summary: { status: "done", text: "" },
    },
  },
};

export const PartialSummaryError: StoryObj<Props> = {
  render: SummaryRequestError.render,
  args: {
    ...SummaryRequestError.args,
    turn: {
      ...SummaryRequestError.args!.turn!,
      summary: {
        status: "done",
        text: "Both models recommend a weekly review.",
        error: "The summary request timed out.",
      },
    },
  },
};
