import { sha256 } from "@/utils/hash";

// Secrets are removed by value and by field name, and redaction always happens before truncation so
// a token that crosses the cut is still fully covered. Header/env payloads are replaced as a whole:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const REDACTED = "[REDACTED]";

const SECRET_FIELD_PATTERN =
  /^(authorization|cookie|headers?|env|environment|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|passwd|secret|credential|credentials|private[-_]?key)$/i;

export interface RedactorOptions {
  readonly secretValues?: readonly string[];
}

export class Redactor {
  private readonly secretValues: readonly string[];

  constructor(options: RedactorOptions = {}) {
    this.secretValues = [...(options.secretValues ?? [])]
      .filter((value) => value.length > 0)
      .sort((left, right) => right.length - left.length);
  }

  redactText(text: string): string {
    let redacted = text;
    for (const secret of this.secretValues) {
      redacted = redacted.split(secret).join(REDACTED);
    }
    return redacted;
  }

  redactValue(value: unknown): unknown {
    if (typeof value === "string") return this.redactText(value);
    if (Array.isArray(value)) return value.map((entry) => this.redactValue(entry));
    if (value === null || typeof value !== "object") return value;
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = SECRET_FIELD_PATTERN.test(key) ? REDACTED : this.redactValue(entry);
    }
    return redacted;
  }

  redactAndTruncate(text: string, maxLength: number): string {
    const redacted = this.redactText(text);
    return redacted.length > maxLength ? redacted.slice(0, maxLength) : redacted;
  }

  summarize(value: unknown): string {
    return sha256(canonicalJson(this.redactValue(value)));
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}
