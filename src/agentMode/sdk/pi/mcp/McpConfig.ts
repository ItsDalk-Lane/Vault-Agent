import { sha256 } from "@/utils/hash";
import {
  McpSecretRefError,
  assertMcpSecretRef,
  isMcpSecretRef,
} from "@/agentMode/sdk/pi/mcp/McpSecretRefs";

// MCP configs are a discriminated HTTP/stdio union with an explicit scope, a content fingerprint and
// a revision. Tokens exist only as secretRefs; `!command`/shell evaluation, auto-downloading
// launchers, relative executables and implicit PATH/env evaluation are rejected; and an imported
// config arrives disabled and untrusted until the user reviews the diff:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type McpScope = "global" | "this-vault" | "project";
export type McpTransportKind = "http" | "stdio";
export type McpToolExposure = "direct" | "deferred" | "hidden";

export interface McpHttpOAuthConfig {
  readonly authorizationUrl?: string;
  readonly clientId?: string;
  readonly scopes?: readonly string[];
  readonly tokenSecretRef?: string;
}

export interface McpHttpTransport {
  readonly kind: "http";
  readonly url: string;
  readonly headerSecretRefs: Readonly<Record<string, string>>;
  readonly oauth?: McpHttpOAuthConfig;
}

export interface McpStdioTransport {
  readonly kind: "stdio";
  readonly commandPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly envSecretRefs: Readonly<Record<string, string>>;
}

export type McpTransportConfig = McpHttpTransport | McpStdioTransport;

export interface McpServerConfig {
  readonly serverId: string;
  readonly displayName: string;
  readonly scope: McpScope;
  readonly projectId?: string;
  readonly enabled: boolean;
  readonly trusted: boolean;
  readonly transport: McpTransportConfig;
  readonly timeoutMs: number;
  readonly toolExposure: McpToolExposure;
  readonly credentialRefs: readonly string[];
  readonly revision: number;
  readonly fingerprint: string;
}

export type McpConfigErrorCode =
  | "MCP_CONFIG_INVALID"
  | "MCP_UNKNOWN_FIELD"
  | "MCP_COMMAND_EVALUATION_DENIED"
  | "MCP_RELATIVE_EXECUTABLE_DENIED"
  | "MCP_IMPLICIT_ENV_DENIED"
  | "MCP_SECRET_PLAINTEXT_DENIED"
  | "MCP_INSECURE_URL_DENIED"
  | "MCP_REVISION_CONFLICT";

export class McpConfigError extends Error {
  readonly code: McpConfigErrorCode;
  readonly field: string | undefined;

  constructor(code: McpConfigErrorCode, message: string, field?: string) {
    super(message);
    this.name = "McpConfigError";
    this.code = code;
    this.field = field;
  }
}

export const MCP_DEFAULT_TIMEOUT_MS = 30_000;
export const MCP_MAX_TIMEOUT_MS = 300_000;
export const MCP_DEFAULT_TOOL_EXPOSURE: McpToolExposure = "deferred";

const KNOWN_FIELDS = new Set([
  "serverId",
  "displayName",
  "scope",
  "projectId",
  "enabled",
  "trusted",
  "transport",
  "timeoutMs",
  "toolExposure",
  "credentialRefs",
  "revision",
  "fingerprint",
  "headers",
  "env",
  "commandPath",
  "url",
]);

const SCOPES: readonly McpScope[] = ["global", "this-vault", "project"];
const EXPOSURES: readonly McpToolExposure[] = ["direct", "deferred", "hidden"];
const DOWNLOAD_LAUNCHERS = new Set(["npx", "uvx", "uv", "bunx", "pnpm", "yarn", "npm"]);
const SHELL_EVALUATION = /[`$]|\$\{|\$\(/;
const SECRET_FIELD_PATTERN = /(token|secret|password|api[_-]?key|authorization)/i;

export function normalizeMcpServerConfig(input: unknown): McpServerConfig {
  const record = asRecord(input, "config");
  for (const key of Object.keys(record)) {
    if (!KNOWN_FIELDS.has(key)) {
      throw new McpConfigError("MCP_UNKNOWN_FIELD", `Unknown MCP config field "${key}".`, key);
    }
  }
  if (record.headers !== undefined) {
    throw new McpConfigError(
      "MCP_SECRET_PLAINTEXT_DENIED",
      "HTTP headers must be headerSecretRefs, never plaintext headers.",
      "headers"
    );
  }
  const serverId = requireText(record.serverId, "serverId");
  const scope = requireEnum(record.scope ?? "global", SCOPES, "scope");
  const displayName =
    typeof record.displayName === "string" && record.displayName.trim().length > 0
      ? record.displayName
      : serverId;
  const transportInput = asRecord(record.transport, "transport");
  const transport = normalizeTransport(transportInput, record);
  const timeoutMs = optionalPositiveInt(record.timeoutMs, MCP_DEFAULT_TIMEOUT_MS, "timeoutMs");
  if (timeoutMs > MCP_MAX_TIMEOUT_MS) {
    throw new McpConfigError(
      "MCP_CONFIG_INVALID",
      `timeoutMs must be at most ${MCP_MAX_TIMEOUT_MS}.`,
      "timeoutMs"
    );
  }
  const toolExposure = requireEnum(
    record.toolExposure ?? MCP_DEFAULT_TOOL_EXPOSURE,
    EXPOSURES,
    "toolExposure"
  );
  const credentialRefs = collectCredentialRefs(transport, record.credentialRefs);
  const base: McpServerConfig = {
    serverId,
    displayName,
    scope,
    ...(scope === "project" && typeof record.projectId === "string" && record.projectId.trim()
      ? { projectId: record.projectId.trim() }
      : {}),
    enabled: record.enabled === true,
    trusted: record.trusted === true,
    transport,
    timeoutMs,
    toolExposure,
    credentialRefs,
    revision: 1,
    fingerprint: "",
  };
  const fingerprint = computeMcpFingerprint(base);
  return Object.freeze({
    ...base,
    revision: optionalPositiveInt(record.revision, 1, "revision"),
    fingerprint,
  });
}

export function computeMcpFingerprint(config: McpServerConfig): string {
  return sha256(canonicalize(fingerprintInput(config)));
}

export function isMcpFingerprintApproved(
  config: McpServerConfig,
  approvedFingerprint: string | null | undefined
): boolean {
  return typeof approvedFingerprint === "string" && approvedFingerprint === config.fingerprint;
}

export function applyMcpConfigChange(
  previous: McpServerConfig | null,
  input: unknown
): McpServerConfig {
  const normalized = normalizeMcpServerConfig(input);
  if (previous !== null && previous.serverId !== normalized.serverId) {
    throw new McpConfigError(
      "MCP_CONFIG_INVALID",
      "A config change must keep the same serverId.",
      "serverId"
    );
  }
  const unchanged = previous !== null && previous.fingerprint === normalized.fingerprint;
  return Object.freeze({
    ...normalized,
    enabled: unchanged ? previous.enabled : normalized.enabled,
    trusted: previous === null ? normalized.trusted : unchanged ? previous.trusted : false,
    revision: unchanged ? previous.revision : (previous?.revision ?? 0) + 1,
  });
}

export function toExportableMcpConfig(config: McpServerConfig): Readonly<Record<string, unknown>> {
  return Object.freeze({
    serverId: config.serverId,
    displayName: config.displayName,
    scope: config.scope,
    ...(config.projectId ? { projectId: config.projectId } : {}),
    enabled: config.enabled,
    trusted: config.trusted,
    transport: freezeDeep(config.transport),
    timeoutMs: config.timeoutMs,
    toolExposure: config.toolExposure,
    credentialRefs: Object.freeze([...config.credentialRefs]),
    revision: config.revision,
    fingerprint: config.fingerprint,
  });
}

export function exportMcpServerConfig(config: McpServerConfig): string {
  return JSON.stringify(toExportableMcpConfig(config));
}

export function importMcpServerConfigs(input: unknown): readonly McpServerConfig[] {
  const parsed = typeof input === "string" ? parseJson(input) : input;
  const list = Array.isArray(parsed) ? (parsed as readonly unknown[]) : [parsed];
  return Object.freeze(
    list.map((entry) => {
      const record = asRecord(entry, "config");
      const normalized = normalizeMcpServerConfig({
        ...record,
        enabled: false,
        trusted: false,
        revision: 1,
      });
      return Object.freeze({ ...normalized, enabled: false, trusted: false, revision: 1 });
    })
  );
}

function normalizeTransport(
  transport: Record<string, unknown>,
  topLevel: Record<string, unknown>
): McpTransportConfig {
  const kind = transport.kind ?? transport.type;
  if (kind === "http") {
    const url = requireText(transport.url ?? topLevel.url, "url");
    assertAllowedUrl(url);
    const headerSecretRefs = secretRefMap(transport.headerSecretRefs, "headerSecretRefs");
    const oauth = normalizeOAuth(transport.oauth);
    return Object.freeze({
      kind: "http",
      url,
      headerSecretRefs,
      ...(oauth !== undefined ? { oauth } : {}),
    });
  }
  if (kind === "stdio") {
    const commandPath = requireText(transport.commandPath ?? topLevel.commandPath, "commandPath");
    assertExecutableAllowed(commandPath);
    const args = stringArray(transport.args, "args");
    const cwd = requireText(transport.cwd, "cwd");
    if (!isAbsolutePath(cwd)) {
      throw new McpConfigError("MCP_CONFIG_INVALID", "cwd must be absolute.", "cwd");
    }
    const env = literalEnv(transport.env ?? topLevel.env);
    const envSecretRefs = secretRefMap(transport.envSecretRefs, "envSecretRefs");
    return Object.freeze({ kind: "stdio", commandPath, args, cwd, env, envSecretRefs });
  }
  throw new McpConfigError(
    "MCP_CONFIG_INVALID",
    'transport.kind must be "http" or "stdio".',
    "transport"
  );
}

function normalizeOAuth(value: unknown): McpHttpOAuthConfig | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value, "oauth");
  const authorizationUrl =
    record.authorizationUrl === undefined
      ? undefined
      : requireText(record.authorizationUrl, "oauth.authorizationUrl");
  if (authorizationUrl !== undefined) assertAllowedUrl(authorizationUrl);
  const tokenSecretRef =
    record.tokenSecretRef === undefined
      ? undefined
      : assertSecretRefValue(record.tokenSecretRef, "oauth.tokenSecretRef");
  const scopes =
    record.scopes === undefined ? undefined : Object.freeze(stringArray(record.scopes, "scopes"));
  const clientId =
    record.clientId === undefined ? undefined : requireText(record.clientId, "oauth.clientId");
  return Object.freeze({
    ...(authorizationUrl !== undefined ? { authorizationUrl } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
    ...(scopes !== undefined ? { scopes } : {}),
    ...(tokenSecretRef !== undefined ? { tokenSecretRef } : {}),
  });
}

function collectCredentialRefs(
  transport: McpTransportConfig,
  explicit: unknown
): readonly string[] {
  const refs = new Set<string>();
  if (transport.kind === "http") {
    for (const ref of Object.values(transport.headerSecretRefs)) refs.add(ref);
    if (transport.oauth?.tokenSecretRef !== undefined) refs.add(transport.oauth.tokenSecretRef);
  } else {
    for (const ref of Object.values(transport.envSecretRefs)) refs.add(ref);
  }
  if (explicit !== undefined) {
    for (const ref of stringArray(explicit, "credentialRefs")) {
      refs.add(assertSecretRefValue(ref, "credentialRefs"));
    }
  }
  return Object.freeze([...refs].sort());
}

function secretRefMap(value: unknown, field: string): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  const record = asRecord(value, field);
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (key.trim().length === 0) {
      throw new McpConfigError("MCP_CONFIG_INVALID", `${field} keys must be non-empty.`, field);
    }
    result[key] = assertSecretRefValue(raw, `${field}.${key}`);
  }
  return Object.freeze(result);
}

function literalEnv(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  const record = asRecord(value, "env");
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (key.trim().length === 0 || key.includes("=") || /\s/.test(key)) {
      throw new McpConfigError("MCP_CONFIG_INVALID", "env keys must be plain names.", "env");
    }
    if (typeof raw !== "string") {
      throw new McpConfigError("MCP_CONFIG_INVALID", "env values must be strings.", "env");
    }
    if (SHELL_EVALUATION.test(raw)) {
      throw new McpConfigError(
        "MCP_IMPLICIT_ENV_DENIED",
        `env.${key} must be a literal value, not a shell evaluation.`,
        "env"
      );
    }
    if (SECRET_FIELD_PATTERN.test(key) && !isMcpSecretRef(raw)) {
      throw new McpConfigError(
        "MCP_SECRET_PLAINTEXT_DENIED",
        `env.${key} looks secret; use envSecretRefs.`,
        "env"
      );
    }
    result[key] = raw;
  }
  return Object.freeze(result);
}

function assertExecutableAllowed(commandPath: string): void {
  if (commandPath.startsWith("!") || SHELL_EVALUATION.test(commandPath)) {
    throw new McpConfigError(
      "MCP_COMMAND_EVALUATION_DENIED",
      "commandPath must not use !command or shell evaluation.",
      "commandPath"
    );
  }
  const base = commandPath.split(/[\\/]/).pop() ?? "";
  if (DOWNLOAD_LAUNCHERS.has(base.toLowerCase())) {
    throw new McpConfigError(
      "MCP_COMMAND_EVALUATION_DENIED",
      `commandPath must not be the auto-downloading launcher "${base}".`,
      "commandPath"
    );
  }
  if (!isAbsolutePath(commandPath)) {
    throw new McpConfigError(
      "MCP_RELATIVE_EXECUTABLE_DENIED",
      "commandPath must be an absolute path; implicit PATH lookup is not allowed.",
      "commandPath"
    );
  }
}

function assertAllowedUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) {
    throw new McpConfigError("MCP_CONFIG_INVALID", "url must be http(s).", "url");
  }
  const withoutScheme = url.replace(/^https?:\/\//i, "");
  const authority = withoutScheme.split(/[/?#]/)[0] ?? "";
  if (authority.includes("@")) {
    throw new McpConfigError(
      "MCP_SECRET_PLAINTEXT_DENIED",
      "Credentials in the URL are not allowed; use headerSecretRefs.",
      "url"
    );
  }
  const host = (authority.split(":")[0] ?? "").toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (!url.toLowerCase().startsWith("https://") && !local) {
    throw new McpConfigError(
      "MCP_INSECURE_URL_DENIED",
      "Only https URLs (or explicit localhost) are allowed.",
      "url"
    );
  }
}

function assertSecretRefValue(value: unknown, field: string): string {
  try {
    return assertMcpSecretRef(value, field);
  } catch (thrown) {
    if (thrown instanceof McpSecretRefError) {
      const code: McpConfigErrorCode =
        thrown.code === "MCP_SECRET_PLAINTEXT_DENIED"
          ? "MCP_SECRET_PLAINTEXT_DENIED"
          : "MCP_CONFIG_INVALID";
      throw new McpConfigError(code, thrown.message, field);
    }
    throw thrown;
  }
}

function fingerprintInput(config: McpServerConfig): Readonly<Record<string, unknown>> {
  return {
    serverId: config.serverId,
    scope: config.scope,
    ...(config.projectId ? { projectId: config.projectId } : {}),
    transport: config.transport,
    toolExposure: config.toolExposure,
    credentialRefs: config.credentialRefs,
  };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
  return `{${entries.join(",")}}`;
}

function freezeDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeDeep));
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) result[key] = freezeDeep(entry);
  return Object.freeze(result);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new McpConfigError("MCP_CONFIG_INVALID", `${field} must be an object.`, field);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new McpConfigError("MCP_CONFIG_INVALID", `${field} is required.`, field);
  }
  return value.trim();
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value))
    return value as T;
  throw new McpConfigError(
    "MCP_CONFIG_INVALID",
    `${field} must be one of ${allowed.join(", ")}.`,
    field
  );
}

function optionalPositiveInt(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new McpConfigError("MCP_CONFIG_INVALID", `${field} must be a positive integer.`, field);
  }
  return value;
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new McpConfigError("MCP_CONFIG_INVALID", `${field} must be an array.`, field);
  }
  const items: readonly unknown[] = value;
  return Object.freeze(
    items.map((entry) => {
      if (typeof entry !== "string") {
        throw new McpConfigError("MCP_CONFIG_INVALID", `${field} must contain strings.`, field);
      }
      return entry;
    })
  );
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new McpConfigError("MCP_CONFIG_INVALID", "Imported MCP config is not valid JSON.");
  }
}
