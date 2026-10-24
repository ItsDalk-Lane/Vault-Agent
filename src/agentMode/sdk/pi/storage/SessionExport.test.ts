import {
  SESSION_EXPORT_SCHEMA,
  SESSION_EXPORT_VERSION,
  SessionExport,
  redactSecrets,
  type SessionExportInput,
} from "@/agentMode/sdk/pi/storage/SessionExport";

const input: SessionExportInput = {
  sessionId: "root-export",
  backendId: "pi",
  title: "Planning chat",
  createdAtMs: 1,
  lastAccessedAtMs: 2,
  messages: [
    { role: "user", text: "Question", attachments: ["root-export-attachments/image.png"] },
    { role: "assistant", text: "Answer" },
  ],
  attachments: [
    {
      attachmentId: "image",
      mime: "image/png",
      bytes: 3,
      contentHash: "abc",
      name: "root-export-attachments/image.png",
      data: "YWJj",
    },
  ],
};

describe("SessionExport", () => {
  describe("SessionExport", () => {
    describe("exportSession()", () => {
      it("exports an ordered standalone document with embedded attachment bytes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        let content = "";
        const exporter = new SessionExport({
          ports: {
            writeFile: async (_name, text) => {
              content = text;
            },
            now: () => 3,
          },
        });
        const result = await exporter.exportSession(input);
        expect(result).toMatchObject({ ok: true, path: "exports/root-export.json" });
        expect(JSON.parse(content)).toMatchObject({
          schema: SESSION_EXPORT_SCHEMA,
          version: SESSION_EXPORT_VERSION,
          exportedAtMs: 3,
          session: input,
        });
        expect(result.bytes).toBe(Buffer.byteLength(content));
      });

      it("exports large records without an artificial file size limit https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        let content = "";
        const exporter = new SessionExport({
          ports: {
            writeFile: async (_name, text) => {
              content = text;
            },
          },
        });
        await exporter.exportSession({
          ...input,
          messages: [{ role: "user", text: "x".repeat(10 * 1024 * 1024) }],
        });
        expect(JSON.parse(content).session.messages[0].text).toHaveLength(10 * 1024 * 1024);
      });
    });
    describe("toMarkdown()", () => {
      it("keeps message order and references the accompanying image and command output files https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const exporter = new SessionExport({ ports: { writeFile: async () => undefined } });
        const markdown = exporter.toMarkdown({
          ...input,
          attachments: [
            ...input.attachments!,
            {
              attachmentId: "output",
              mime: "text/plain",
              bytes: 4,
              contentHash: "def",
              name: "root-export-attachments/output.txt",
              data: "dGV4dA==",
            },
          ],
        });
        expect(markdown.indexOf("Question")).toBeLessThan(markdown.indexOf("Answer"));
        expect(markdown).toContain(
          "![root-export-attachments/image.png](root-export-attachments/image.png)"
        );
        expect(markdown).toContain(
          "[root-export-attachments/output.txt](root-export-attachments/output.txt)"
        );
      });
    });
  });
  describe("redactSecrets()", () => {
    it("retains public reasoning while removing secrets and opaque provider signatures https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(
        redactSecrets({
          token: "secret",
          values: [
            { type: "thinking", thinking: "public", thinkingSignature: "opaque" },
            { type: "thinking", thinking: "private", redacted: true },
            { name: "visible", credential: "hidden" },
          ],
        })
      ).toEqual({ values: [{ type: "thinking", thinking: "public" }, { name: "visible" }] });
    });
  });
});
