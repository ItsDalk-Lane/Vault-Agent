import {
  ReportIssueFlow,
  type PreparedReport,
  type ReportIssueFlowProps,
  type ReportSourceOption,
} from "@/agentMode/ui/ReportIssueFlow";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

const SOURCES: ReportSourceOption[] = [
  { id: "screenshot", label: "Screenshot of the Obsidian window", defaultChecked: true },
  { id: "activityLog", label: "Agent Mode activity log", defaultChecked: true },
  {
    id: "chatLog",
    label: "Vault Agent log",
    description: "includes Agent Mode backend errors",
    defaultChecked: true,
  },
];

const REPORT: PreparedReport = {
  zipDir: "/tmp/copilot-report-a1b2c3",
  zipPath: "/tmp/copilot-report-a1b2c3/copilot-report-a1b2c3.zip",
  zipName: "copilot-report-a1b2c3.zip",
  bytes: 4_404_019,
  issueDraft: { title: "Agent stops mid-turn", body: "It stops after the first tool call." },
  manualIssueUrl: "https://github.com/logancyang/obsidian-copilot/issues/new",
  attachments: [
    { id: "report", name: "report.md", bytes: 2_310, included: true },
    { id: "screenshot", name: "screenshot.png", bytes: 284_115, included: true },
    {
      id: "activityLog",
      name: "acp-frames.ndjson.txt",
      bytes: 2_097_152,
      included: true,
      note: "truncated to the newest entries of 40 MB",
    },
    {
      id: "chatLog",
      name: "vault-agent-log.md",
      bytes: 0,
      included: false,
      note: "failed: EACCES",
    },
  ],
};

const pending = <T,>(): Promise<T> => new Promise<T>(() => undefined);

const BASE: ReportIssueFlowProps = {
  sources: SOURCES,
  prepare: async () => REPORT,
  discardReport: async () => undefined,
  onCancel: () => undefined,
  openIssuePage: () => undefined,
  revealFile: () => undefined,
};

const AtStep: React.FC<{ steps: string[]; props?: Partial<ReportIssueFlowProps> }> = ({
  steps,
  props,
}) => {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    let index = 0;
    const tick = window.setInterval(() => {
      if (index >= steps.length) return window.clearInterval(tick);
      const button = Array.from(ref.current?.querySelectorAll("button") ?? []).find(
        (candidate) => candidate.textContent?.trim() === steps[index] && !candidate.disabled
      );
      if (!button) return;
      button.click();
      index += 1;
    }, 50);
    return () => window.clearInterval(tick);
  }, [steps]);
  return (
    <div ref={ref}>
      <ReportIssueFlow {...BASE} {...props} />
    </div>
  );
};

const PREPARE = "Prepare report";

const meta = {
  title: "Agent Mode/Report Issue Flow",
  component: ReportIssueFlow,
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ReportIssueFlowProps>;
export default meta;

export const Details: StoryObj<ReportIssueFlowProps> = {
  render: () => <ReportIssueFlow {...BASE} />,
};

export const Preparing: StoryObj<ReportIssueFlowProps> = {
  render: () => <AtStep steps={[PREPARE]} props={{ prepare: () => pending<PreparedReport>() }} />,
};

export const Review: StoryObj<ReportIssueFlowProps> = {
  render: () => <AtStep steps={[PREPARE]} />,
};

export const DraftedNote: StoryObj<ReportIssueFlowProps> = {
  render: () => (
    <ReportIssueFlow
      {...BASE}
      sources={SOURCES.map((source) => ({ ...source, defaultChecked: true }))}
      initialNote={[
        "Replied in Swedish to an English request",
        "",
        "What happened: The agent answered 'hej' instead of English.",
        "",
        'What the user said: "Why do you switch to a different language?"',
        "",
        "Steps to reproduce: 1. Type a garbled 'commit and push'. 2. Observe a Swedish reply.",
        "",
        "Evidence: engine Vault Agent · model deepseek-v4-pro · session ses_8f2a · 2026-10-12T17:42:05Z",
      ].join("\n")}
    />
  ),
};
