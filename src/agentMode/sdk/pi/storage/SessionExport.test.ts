import {
  SESSION_EXPORT_MAX_BYTES,
  SESSION_EXPORT_SCHEMA,
  SESSION_EXPORT_VERSION,
  SessionExport,
  redactSecrets,
  type SessionExportInput,
  type SessionExportPorts,
} from "@/agentMode/sdk/pi/storage/SessionExport";
import { LegacyHistoryReader } from "@/agentMode/session/legacy/LegacyHistoryReader";
import { sha256 } from "@/utils/hash";

// A full export carries schema/version/hash and attachments, never ships credentials or MCP tokens,
// refuses an oversized document instead of writing a partial one, is read-only until re-authorized, and
// its Markdown projection stays readable by the existing legacy reader:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeExportPorts implements SessionExportPorts {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  failRead = false;
  nowMs = 1_700_000_000_000;

  writeFile = async (path: string, content: string): Promise<void> => {
    this.writes.push(path);
    this.files.set(path, content);
  };

  readFile = async (path: string): Promise<string> => {
    if (this.failRead) throw new Error("missing file");
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  };

  now = (): number => this.nowMs;
}

function sessionInput(overrides: Partial<SessionExportInput> = {}): SessionExportInput {
  return {
    sessionId: "session-1",
    backendId: "pi",
    title: "Planning chat",
    projectId: "project-a",
    createdAtMs: 1_700_000_000_000,
    lastAccessedAtMs: 1_700_000_100_000,
    messages: [
      { role: "user", text: "first question", timestampMs: 1 },
      { role: "assistant", text: "first answer", timestampMs: 2 },
      { role: "user", text: "second question", timestampMs: 3 },
    ],
    attachments: [
      {
        attachmentId: "a1",
        mime: "image/png",
        bytes: 4,
        contentHash: sha256("image-bytes"),
        blobRef: "blob-1",
      },
    ],
    extras: {
      mcpServers: [
        { name: "docs", url: "https://docs.test/mcp", token: "mcp-secret-token" },
        { name: "files", url: "https://files.test/mcp", headers: { Authorization: "Bearer abc" } },
      ],
      apiKeyKeychainId: "keychain-openai",
      theme: "dark",
    },
    ...overrides,
  };
}

function harness(): { ports: FakeExportPorts; exporter: SessionExport } {
  const ports = new FakeExportPorts();
  return { ports, exporter: new SessionExport({ ports }) };
}

describe("SessionExport", () => {
  describe("SessionExport", () => {
    describe("exportSession()", () => {
      it("writes a versioned document with schema, hash and attachments", async () => {
        const { ports, exporter } = harness();

        const result = await exporter.exportSession(sessionInput());

        expect(result).toMatchObject({ ok: true, path: "exports/session-1.json" });
        expect(ports.writes).toEqual(["exports/session-1.json"]);
        const document = JSON.parse(ports.files.get("exports/session-1.json") ?? "{}");
        expect(document).toMatchObject({
          schema: SESSION_EXPORT_SCHEMA,
          version: SESSION_EXPORT_VERSION,
          exportedAtMs: 1_700_000_000_000,
        });
        expect(document.session.attachments).toHaveLength(1);
        expect(document.contentHash).toBe(sha256(canonical(document.session)));
        expect(result).toMatchObject({ contentHash: document.contentHash });
      });

      it("keeps the message order so a re-read is identical", async () => {
        const { ports, exporter } = harness();

        const exported = await exporter.exportSession(sessionInput());
        const imported = await exporter.importDocument((exported as { path: string }).path);

        expect(imported).toMatchObject({ ok: true, readOnly: true, requiresAuthorization: true });
        const session = (imported as { document: { session: SessionExportInput } }).document
          .session;
        expect(session.messages.map((message) => message.text)).toEqual([
          "first question",
          "first answer",
          "second question",
        ]);
        expect(session.messages.map((message) => message.role)).toEqual([
          "user",
          "assistant",
          "user",
        ]);
        expect(ports.writes).toHaveLength(1);
      });

      it("removes credentials and MCP tokens from the exported document", async () => {
        const { ports, exporter } = harness();

        await exporter.exportSession(sessionInput());
        const content = ports.files.get("exports/session-1.json") ?? "";

        expect(content).not.toContain("mcp-secret-token");
        expect(content).not.toContain("Bearer abc");
        expect(content).not.toContain("keychain-openai");
        expect(content).not.toContain("Authorization");
        expect(content).toContain("https://docs.test/mcp");
        expect(content).toContain("dark");
      });

      it("refuses to write an export above the size limit", async () => {
        const { ports, exporter } = harness();
        const huge = sessionInput({
          messages: [{ role: "user", text: "x".repeat(SESSION_EXPORT_MAX_BYTES + 100) }],
        });

        const result = await exporter.exportSession(huge);

        expect(result).toMatchObject({
          ok: false,
          errorCode: "SESSION_EXPORT_TOO_LARGE",
          limit: SESSION_EXPORT_MAX_BYTES,
        });
        expect((result as { bytes: number }).bytes).toBeGreaterThan(SESSION_EXPORT_MAX_BYTES);
        expect(ports.writes).toEqual([]);
      });
    });

    describe("importDocument()", () => {
      it.each([
        ["schema", "another.document"],
        ["schema", undefined],
        ["version", undefined],
        ["version", 0],
        ["version", 1.5],
        ["exportedAtMs", -1],
      ])(
        "rejects an invalid %s envelope even with a valid session hash https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
        async (field, value) => {
          const { ports, exporter } = harness();
          await exporter.exportSession(sessionInput());
          const document: Record<string, unknown> = JSON.parse(
            ports.files.get("exports/session-1.json") ?? "{}"
          );
          document[field] = value;
          ports.files.set("exports/session-1.json", JSON.stringify(document));

          expect(await exporter.importDocument("exports/session-1.json")).toMatchObject({
            ok: false,
            errorCode: "SESSION_EXPORT_UNREADABLE",
          });
          expect(ports.writes).toHaveLength(1);
        }
      );

      it.each([
        { sessionId: "" },
        { backendId: null },
        { title: {} },
        { createdAtMs: -1 },
        { lastAccessedAtMs: "yesterday" },
        { messages: [{ role: "tool", text: "untrusted" }] },
        { messages: [{ role: "user", text: 3 }] },
        { messages: [{ role: "user", text: "valid", timestampMs: -1 }] },
        {
          attachments: [
            { attachmentId: "a", mime: "text/plain", bytes: -1, contentHash: sha256("x") },
          ],
        },
        { attachments: [{ attachmentId: "a", mime: "text/plain", bytes: 1, contentHash: "bad" }] },
        { extras: [] },
      ])(
        "rejects malformed session fields without trusting a matching hash https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
        async (invalid) => {
          const { ports, exporter } = harness();
          const session: unknown = { ...sessionInput(), ...invalid };
          ports.files.set(
            "exports/invalid.json",
            JSON.stringify({
              schema: SESSION_EXPORT_SCHEMA,
              version: SESSION_EXPORT_VERSION,
              exportedAtMs: 1,
              contentHash: sha256(canonical(session)),
              session,
            })
          );

          expect(await exporter.importDocument("exports/invalid.json")).toMatchObject({
            ok: false,
            errorCode: "SESSION_EXPORT_UNREADABLE",
          });
        }
      );

      it("rejects oversized UTF-8 input before parsing or verifying its hash https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { ports } = harness();
        const exporter = new SessionExport({ ports, maxBytes: 20 });
        ports.files.set("exports/large.json", "汉".repeat(7));

        expect(await exporter.importDocument("exports/large.json")).toMatchObject({
          ok: false,
          errorCode: "SESSION_EXPORT_TOO_LARGE",
          bytes: 21,
          limit: 20,
        });
        expect(ports.writes).toEqual([]);
      });

      it("rejects a tampered document through its recorded hash", async () => {
        const { ports, exporter } = harness();
        await exporter.exportSession(sessionInput());
        const document = JSON.parse(ports.files.get("exports/session-1.json") ?? "{}");
        document.session.title = "tampered";
        ports.files.set("exports/session-1.json", JSON.stringify(document));

        const result = await exporter.importDocument("exports/session-1.json");

        expect(result).toMatchObject({ ok: false, errorCode: "SESSION_EXPORT_HASH_MISMATCH" });
      });

      it("reads an unknown future version without rewriting it", async () => {
        const { ports, exporter } = harness();
        ports.files.set(
          "exports/future.json",
          JSON.stringify({
            schema: SESSION_EXPORT_SCHEMA,
            version: SESSION_EXPORT_VERSION + 5,
            exportedAtMs: 1,
            contentHash: "x",
            session: sessionInput(),
          })
        );

        const result = await exporter.importDocument("exports/future.json");

        expect(result).toMatchObject({ ok: false, errorCode: "SESSION_EXPORT_FUTURE_VERSION" });
        expect(ports.writes).toEqual([]);
      });

      it("reports an unreadable export instead of pretending it imported", async () => {
        const { ports, exporter } = harness();
        ports.failRead = true;

        const result = await exporter.importDocument("exports/missing.json");

        expect(result).toMatchObject({ ok: false, errorCode: "SESSION_EXPORT_UNREADABLE" });
        ports.failRead = false;
        ports.files.set("exports/broken.json", "{ not json");

        expect(await exporter.importDocument("exports/broken.json")).toMatchObject({
          ok: false,
          errorCode: "SESSION_EXPORT_UNREADABLE",
        });
      });
    });

    describe("toMarkdown()", () => {
      it("stays readable by the existing legacy reader in the original order", () => {
        const { exporter } = harness();
        const input = sessionInput();

        const markdown = exporter.toMarkdown(input);
        const reader = new LegacyHistoryReader({
          ports: { listFiles: async () => [], isTombstoned: async () => false },
        });
        const parsed = reader.parse("exports/session-1.md", markdown);

        expect(markdown).toContain("mode: agent");
        expect(markdown).toContain("backendId: pi");
        expect(parsed?.backendId).toBe("pi");
        expect(parsed?.title).toBe("Planning chat");
        expect(parsed?.messages.map((message) => message.text)).toEqual([
          "first question",
          "first answer",
          "second question",
        ]);
        expect(exporter.fromMarkdown(markdown).map((message) => message.role)).toEqual([
          "user",
          "assistant",
          "user",
        ]);
      });
    });
  });

  describe("redactSecrets()", () => {
    it("exports only public reasoning and omits opaque provider signatures https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(
        redactSecrets([
          { type: "thinking", thinking: "public", thinkingSignature: "opaque" },
          { type: "thinking", thinking: "private", redacted: true },
          { type: "text", text: "answer" },
        ])
      ).toEqual([
        { type: "thinking", thinking: "public" },
        { type: "text", text: "answer" },
      ]);
    });
    it("drops secret keys at any depth and keeps ordinary fields", () => {
      const redacted = redactSecrets({
        token: "t",
        nested: { refreshToken: "r", apiKeyKeychainId: "k", keep: 1 },
        list: [{ password: "p", name: "keep" }],
      });

      expect(redacted).toEqual({ nested: { keep: 1 }, list: [{ name: "keep" }] });
    });
  });
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "null";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
}
