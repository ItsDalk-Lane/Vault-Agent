import type { TranscriptContext } from "@earendil-works/pi-ai";
import { compileModelToolResults, formatToolOutcomeMetadata } from "./ModelToolResults";
import { createToolOutcome } from "@/agentMode/sdk/pi/tools/ToolOutcome";

function fixture(receipts = ["receipt-one"]): TranscriptContext {
  return {
    messages: [
      {
        role: "toolResult",
        toolCallId: "call",
        toolName: "vault_edit",
        content: [
          { type: "text", text: "Original tool body" },
          { type: "image", mimeType: "image/png", data: "image-data" },
        ],
        details: {
          outcome: {
            operationId: "actual-operation",
            source: { toolId: "vault_edit", caller: "root" },
            status: "error",
            effect: "unknown",
            data: { original: "must not be duplicated" },
            error: {
              code: "EFFECT_UNKNOWN",
              phase: "persistence",
              message: "Full message stays in the original result",
            },
            truncation: { truncated: false },
            receipts,
            nextActions: ["read", "reconcile"],
          },
        },
        isError: true,
        timestamp: 1,
      },
    ],
  } as unknown as TranscriptContext;
}

describe("ModelToolResults", () => {
  describe("formatToolOutcomeMetadata()", () => {
    it("uses the same source and side-effect facts for model tool results and persisted summary evidence https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const text = formatToolOutcomeMetadata(
        createToolOutcome({
          operationId: "receipt-one",
          toolId: "vault_read",
          caller: "subagent",
          success: true,
          effect: "not_applied",
          receipts: ["entry-one"],
          data: { large: "must remain outside metadata" },
        })
      );
      expect(JSON.parse(text.split("\n")[2])).toMatchObject({
        operationId: "receipt-one",
        source: { toolId: "vault_read", caller: "subagent" },
        status: "success",
        effect: "not_applied",
        receipts: ["entry-one"],
        nextActions: ["continue"],
      });
      expect(text).not.toContain("must remain outside metadata");
    });
  });
  describe("compileModelToolResults()", () => {
    it("shows unknown effects and read/reconcile actions to the model while preserving original text, images and durable data https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const original = fixture();
      const compiled = compileModelToolResults(original);
      const message = compiled.messages[0];
      expect(message.role).toBe("toolResult");
      if (message.role !== "toolResult") throw new Error("Expected actual tool result");
      const before = original.messages[0];
      if (before.role !== "toolResult") throw new Error("Expected original tool result");
      expect(message.content.slice(0, 2)).toEqual(before.content);
      expect(message.details).toBe(before.details);
      const metadata = message.content.at(-1)!;
      expect(metadata.type).toBe("text");
      if (metadata.type !== "text") throw new Error("Expected metadata text");
      expect(JSON.parse(metadata.text.split("\n")[2])).toEqual({
        operationId: "actual-operation",
        source: { toolId: "vault_edit", caller: "root" },
        status: "error",
        effect: "unknown",
        error: { code: "EFFECT_UNKNOWN", phase: "persistence" },
        truncation: { hostTruncated: false, metadataTruncated: false },
        receipts: ["receipt-one"],
        receiptsOmitted: 0,
        nextActions: ["read", "reconcile"],
      });
      expect(metadata.text).toContain("A successful read can be success + not_applied");
      expect(metadata.text).not.toContain("must not be duplicated");
      expect(original.messages[0]).toBe(before);
      expect(before.content).toHaveLength(2);
    });

    it("bounds only receipt references and reports omissions without dropping result identity, error phase or recovery actions https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const compiled = compileModelToolResults(
        fixture(Array.from({ length: 200 }, (_, index) => `receipt-${index}-reference`))
      );
      const message = compiled.messages[0];
      if (message.role !== "toolResult") throw new Error("Expected actual tool result");
      const block = message.content.at(-1)!;
      if (block.type !== "text") throw new Error("Expected metadata text");
      expect(new TextEncoder().encode(block.text).byteLength).toBeLessThanOrEqual(2048);
      const metadata = JSON.parse(block.text.split("\n")[2]);
      expect(metadata).toMatchObject({
        operationId: "actual-operation",
        status: "error",
        effect: "unknown",
        error: { code: "EFFECT_UNKNOWN", phase: "persistence" },
        truncation: { hostTruncated: false, metadataTruncated: true },
        nextActions: ["read", "reconcile"],
      });
      expect(metadata.receipts.length + metadata.receiptsOmitted).toBe(200);
      expect(metadata.receiptsOmitted).toBeGreaterThan(0);
    });

    it("keeps SDK truncation diagnostics intact and scopes a false host flag without claiming the SDK retained all output https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const context = fixture();
      const message = context.messages[0];
      if (message.role !== "toolResult") throw new Error("Expected tool result");
      const diagnostic = {
        type: "text" as const,
        text: "<harness>\n[warn] Output truncated to its beginning: 2 lines, 40 bytes dropped\n</harness>",
      };
      const input = {
        ...context,
        messages: [{ ...message, content: [...message.content, diagnostic] }],
      };
      const compiled = compileModelToolResults(input);
      const result = compiled.messages[0];
      if (result.role !== "toolResult") throw new Error("Expected tool result");
      expect(result.content.slice(0, -1)).toEqual([...message.content, diagnostic]);
      const metadata = result.content.at(-1)!;
      if (metadata.type !== "text") throw new Error("Expected metadata text");
      expect(JSON.parse(metadata.text.split("\n")[2]).truncation).toEqual({
        hostTruncated: false,
        metadataTruncated: false,
      });
      expect(metadata.text).toContain("hostTruncated covers host output only");
      expect(metadata.text).toContain(
        "SDK output-limit warnings remain in the original harness diagnostics"
      );
      expect(compileModelToolResults(compiled)).toBe(compiled);
    });

    it("keeps legacy results unchanged and never appends duplicate metadata when the same request is compiled again https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const legacy = {
        messages: [
          { role: "user", content: "hello", timestamp: 1 },
          {
            role: "toolResult",
            toolName: "old",
            toolCallId: "old",
            content: [{ type: "text", text: "legacy" }],
            isError: false,
            timestamp: 2,
          },
        ],
      } as unknown as TranscriptContext;
      expect(compileModelToolResults(legacy)).toBe(legacy);
      const once = compileModelToolResults(fixture());
      expect(compileModelToolResults(once)).toBe(once);
    });
  });
});
