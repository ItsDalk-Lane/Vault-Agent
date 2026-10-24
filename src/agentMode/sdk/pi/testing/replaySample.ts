import type { Message } from "@earendil-works/pi-ai";

// Recorded once from a real Durable Harness run with the official faux provider: one user input
// holding text + an image, one tool round (read_note call and result), then a Markdown answer with
// a code block and a link. Replay tests reopen these exact committed models instead of hand-built
// display objects:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface ReplaySampleEntry {
  readonly id: string;
  readonly kind: string;
  readonly model: readonly Message[] | null;
}

export const REPLAY_SAMPLE_ENTRIES: readonly ReplaySampleEntry[] = [
  {
    id: "7",
    kind: "pi.user",
    model: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Review this plan",
          },
          {
            type: "image",
            data: "iVBORw0KGgoAAAANSUhEUg==",
            mimeType: "image/png",
          },
        ],
        timestamp: 1792600559877,
      },
    ],
  },
  {
    id: "10",
    kind: "pi.system",
    model: [
      {
        role: "system",
        content: "",
        toolsAdded: [
          {
            name: "read_note",
            description: "Read a fixture note",
            parameters: {
              type: "object",
              required: ["path"],
              properties: {
                path: {
                  type: "string",
                },
              },
            },
          },
        ],
        timestamp: 1792600559879,
      },
    ],
  },
  {
    id: "11",
    kind: "pi.assistant",
    model: [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tool:1792600559877:1cqosupzaby",
            name: "read_note",
            arguments: {
              path: "Projects/plan.md",
            },
          },
        ],
        api: "faux:1792600559873:e2xxbj0s39w",
        provider: "faux",
        model: "faux-1",
        usage: {
          input: 51,
          output: 10,
          cacheRead: 0,
          cacheWrite: 51,
          totalTokens: 112,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: "toolUse",
        timestamp: 1792600559877,
      },
    ],
  },
  {
    id: "13",
    kind: "pi.tool-result",
    model: [
      {
        role: "toolResult",
        toolCallId: "tool:1792600559877:1cqosupzaby",
        toolName: "read_note",
        content: [
          {
            type: "text",
            text: "# Projects/plan.md\n\n- first point\n- second point",
          },
        ],
        details: {
          path: "Projects/plan.md",
        },
        isError: false,
        durationMs: 0,
        timestamp: 1792600559885,
      },
    ],
  },
  {
    id: "15",
    kind: "pi.assistant",
    model: [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Here is the fix:\n\n```ts\nconst answer = 42;\n```\n\nSee [the plan](Notes/plan.md) for details.",
          },
        ],
        api: "faux:1792600559873:e2xxbj0s39w",
        provider: "faux",
        model: "faux-1",
        usage: {
          input: 30,
          output: 23,
          cacheRead: 51,
          cacheWrite: 30,
          totalTokens: 134,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: "stop",
        timestamp: 1792600559877,
      },
    ],
  },
];
