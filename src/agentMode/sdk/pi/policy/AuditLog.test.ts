import {
  AuditError,
  AuditLog,
  toSafeError,
  type AuditRecord,
  type AuditRecordInput,
  type AuditSink,
} from "@/agentMode/sdk/pi/policy/AuditLog";
import { Redactor } from "@/agentMode/sdk/pi/policy/Redactor";

// Audit records only keep identity, hashes, targets and the decision; secrets are redacted by value
// and by field before any truncation, headers/env never reach the sink, a denial can never be
// recorded as a successful execution, and every error carries an actionable machine-readable code:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const SECRET = "sk-abcdef123456";
const REDACTED = "[REDACTED]";

class MemorySink implements AuditSink {
  readonly records: AuditRecord[] = [];

  write(record: AuditRecord): void {
    this.records.push(record);
  }
}

function recordInput(overrides: Partial<AuditRecordInput> = {}): AuditRecordInput {
  return {
    operationId: "operation-1",
    actor: "root",
    toolId: "vault_write",
    arguments: { path: "Notes/a.md", text: "hello" },
    targets: ["/vault/Notes/a.md"],
    effects: ["write"],
    decision: "allow",
    status: "executed",
    ...overrides,
  };
}

function redactor(): Redactor {
  return new Redactor({ secretValues: [SECRET] });
}

describe("Redactor", () => {
  describe("redactText()", () => {
    it("masks a secret value wherever it appears", () => {
      const redacted = redactor().redactText(`before ${SECRET} after ${SECRET}`);

      expect(redacted).toBe(`before ${REDACTED} after ${REDACTED}`);
      expect(redacted).not.toContain(SECRET);
    });
  });

  describe("redactValue()", () => {
    it("masks secret fields and drops header/env payloads", () => {
      const redacted = redactor().redactValue({
        path: "Notes/a.md",
        authorization: `Bearer ${SECRET}`,
        headers: { authorization: `Bearer ${SECRET}` },
        env: { API_KEY: "key-123456" },
        nested: { password: "hunter2" },
      }) as Record<string, unknown>;

      const serialized = JSON.stringify(redacted);
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toContain("key-123456");
      expect(serialized).not.toContain("hunter2");
      expect(redacted.path).toBe("Notes/a.md");
      expect(redacted.headers).toBe(REDACTED);
      expect(redacted.env).toBe(REDACTED);
    });
  });

  describe("redactAndTruncate()", () => {
    it("redacts before truncating so a token across the cut is still covered", () => {
      const text = `${"x".repeat(20)}${SECRET}tail`;
      const output = redactor().redactAndTruncate(text, 24);

      expect(output.length).toBeLessThanOrEqual(24);
      expect(output).not.toContain("sk-");
      expect(output).not.toContain("abc");
      expect(output).not.toContain(SECRET);
    });
  });
});

describe("AuditLog", () => {
  describe("record()", () => {
    it("stores identity, hashes, targets and decision without argument bodies", async () => {
      const sink = new MemorySink();
      const log = new AuditLog({ sink, redactor: redactor(), now: () => 1_000 });

      const record = await log.record(recordInput());

      expect(record).toMatchObject({
        operationId: "operation-1",
        actor: "root",
        toolId: "vault_write",
        targets: ["/vault/Notes/a.md"],
        effects: ["write"],
        decision: "allow",
        status: "executed",
        timestamp: 1_000,
      });
      expect(record?.argumentsHash).toMatch(/^[0-9a-f]{64}$/);
      expect(sink.records).toHaveLength(1);
      expect(JSON.stringify(sink.records[0])).not.toContain("hello");
    });

    it("never persists header or env payloads", async () => {
      const sink = new MemorySink();
      const log = new AuditLog({ sink, redactor: redactor() });

      const record = await log.record(
        recordInput({
          arguments: {
            headers: { authorization: `Bearer ${SECRET}` },
            env: { API_KEY: "key-123456" },
            path: "Notes/a.md",
          },
        })
      );

      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain(SECRET);
      expect(serialized).not.toContain("Bearer");
      expect(serialized).not.toContain("API_KEY");
      expect(serialized).not.toContain("key-123456");
    });

    it("rejects a denial recorded as a successful execution", async () => {
      const sink = new MemorySink();
      const log = new AuditLog({ sink, redactor: redactor() });

      await expect(
        log.record(recordInput({ decision: "deny", status: "executed" }))
      ).rejects.toMatchObject({ code: "INVALID_RECORD" });
      expect(sink.records).toHaveLength(0);

      const denial = await log.record(recordInput({ decision: "deny", status: "rejected" }));
      expect(denial).toMatchObject({ decision: "deny", status: "rejected" });
    });

    it("fails or skips on sink failure without leaking the original text", async () => {
      const failing: AuditSink = {
        write: () => {
          throw new Error(`sink failed while writing ${SECRET}`);
        },
      };
      const failLog = new AuditLog({ sink: failing, redactor: redactor(), onFailure: "fail" });

      await expect(failLog.record(recordInput())).rejects.toMatchObject({ code: "AUDIT_FAILED" });
      await failLog.record(recordInput()).catch((error: AuditError) => {
        expect(error.message).not.toContain(SECRET);
      });

      const skipLog = new AuditLog({ sink: failing, redactor: redactor(), onFailure: "skip" });
      expect(await skipLog.record(recordInput())).toBeNull();
    });
  });

  describe("toSafeError()", () => {
    it("maps catalog codes to actionable messages with suggested tools", () => {
      const vaultError = toSafeError("USE_VAULT_TOOL");

      expect(vaultError).toMatchObject({ code: "USE_VAULT_TOOL", suggestedTool: "vault_read" });
      expect(vaultError.message.length).toBeGreaterThan(0);

      for (const code of [
        "PATH_OUT_OF_SCOPE",
        "PROTECTED_PATH",
        "PERMISSION_DENIED",
        "READ_ONLY_MODE",
        "OPAQUE_EXECUTION_DISABLED",
        "EXTERNAL_SCOPE_REQUIRED",
        "CALLER_NOT_ALLOWED",
        "TOOL_DISABLED",
        "UNKNOWN_TOOL",
        "APPROVAL_EXPIRED",
        "APPROVAL_STALE",
        "APPROVAL_CONSUMED",
        "APPROVAL_UNAVAILABLE",
        "CANCELLED",
        "BUDGET_EXCEEDED",
        "STORE_UNAVAILABLE",
        "PROVIDER_AUTH_MISSING",
        "MODEL_CAPABILITY_UNSUPPORTED",
        "UNSAFE_FILE_ALIAS",
        "INVALID_ARGUMENT",
      ]) {
        const mapped = toSafeError(code);
        expect(mapped.code).toBe(code);
        expect(mapped.message.length).toBeGreaterThan(0);
      }
    });

    it("keeps an unknown code machine-readable as INTERNAL_ERROR", () => {
      expect(toSafeError("SOMETHING_NEW")).toMatchObject({ code: "INTERNAL_ERROR" });
    });
  });
});
