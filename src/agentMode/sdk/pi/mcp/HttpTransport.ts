import type { McpFetch, McpTransport } from "@earendil-works/pi-mcp";
import type { McpHttpTransport } from "@/agentMode/sdk/pi/mcp/McpConfig";

// Credentials resolved from secretRefs are attached only to the configured origin, and every
// redirect hop is re-checked before the request continues, so a redirect cannot move the token to
// another host. A missing credential is an explicit error instead of an anonymous request. The
// StreamableHttpTransport class itself comes from the locked ESM package, so it is created through
// an injected constructor (production loads it with a dynamic import):
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type McpTransportErrorCode =
  | "MCP_CREDENTIAL_ORIGIN_DENIED"
  | "MCP_CREDENTIAL_REQUIRED"
  | "MCP_FETCH_REQUIRED"
  | "MCP_REDIRECT_DENIED";

export class McpTransportError extends Error {
  readonly code: McpTransportErrorCode;
  readonly url: string | undefined;

  constructor(code: McpTransportErrorCode, message: string, url?: string) {
    super(message);
    this.name = "McpTransportError";
    this.code = code;
    this.url = url;
  }
}

export type McpCredentialResolver = (ref: string) => Promise<string | undefined>;

export interface HttpTransportConstructorOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly fetch: McpFetch;
  readonly openGetStream: boolean;
  readonly maxMessageBytes?: number;
}

export type HttpTransportConstructor = (options: HttpTransportConstructorOptions) => McpTransport;

export async function loadHttpTransportConstructor(): Promise<HttpTransportConstructor> {
  const sdk = await import("@earendil-works/pi-mcp");
  return (options) =>
    new sdk.StreamableHttpTransport({
      url: options.url,
      headers: { ...options.headers },
      fetch: options.fetch,
      openGetStream: options.openGetStream,
      ...(options.maxMessageBytes !== undefined
        ? { maxMessageBytes: options.maxMessageBytes }
        : {}),
    });
}

export interface CredentialGuardedFetchOptions {
  readonly allowedOrigin: string;
  readonly headers: () => Promise<Readonly<Record<string, string>>>;
  readonly fetch: McpFetch;
  readonly maxRedirects?: number;
}

export interface HttpMcpTransportOptions {
  readonly resolveCredential: McpCredentialResolver;
  readonly createTransport?: HttpTransportConstructor;
  readonly fetch?: McpFetch;
  readonly openGetStream?: boolean;
  readonly maxMessageBytes?: number;
  readonly maxRedirects?: number;
}

export interface HttpMcpTransportHandle {
  readonly transport: McpTransport;
  readonly origin: string;
  readonly headerNames: readonly string[];
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 3;

export function createCredentialGuardedFetch(options: CredentialGuardedFetchOptions): McpFetch {
  const inner = options.fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  return async (input, init) => {
    let target = input instanceof URL ? input : new URL(String(input));
    const credentialHeaders = await options.headers();
    for (let redirects = 0; ; redirects += 1) {
      if (target.origin !== options.allowedOrigin) {
        throw new McpTransportError(
          "MCP_CREDENTIAL_ORIGIN_DENIED",
          `Refusing to send MCP credentials to ${target.origin}.`,
          target.href
        );
      }
      const headers = new Headers(init?.headers);
      // HTTP 头名不区分大小写；覆盖旧凭据，避免合并成两个 Bearer 导致真实鉴权失败。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      for (const [name, value] of Object.entries(credentialHeaders)) headers.set(name, value);
      const response = await inner(target, {
        ...(init ?? {}),
        headers,
        redirect: "manual",
      });
      if (!REDIRECT_STATUSES.has(response.status)) return response;
      // 废弃重定向响应必须释放宿主流，清理失败不能遮蔽原有拒绝原因。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
      await response.body?.cancel().catch(() => undefined);
      if (redirects >= maxRedirects) {
        throw new McpTransportError(
          "MCP_REDIRECT_DENIED",
          `MCP request exceeded ${maxRedirects} redirects.`,
          target.href
        );
      }
      const location = response.headers.get("location");
      if (location === null || location.length === 0) {
        throw new McpTransportError(
          "MCP_REDIRECT_DENIED",
          "MCP redirect response had no Location header.",
          target.href
        );
      }
      target = new URL(location, target);
    }
  };
}

export async function resolveHttpHeaders(
  config: McpHttpTransport,
  resolveCredential: McpCredentialResolver
): Promise<Readonly<Record<string, string>>> {
  const headers: Record<string, string> = {};
  for (const [name, ref] of Object.entries(config.headerSecretRefs)) {
    const value = await resolveCredential(ref);
    if (typeof value !== "string" || value.length === 0) {
      throw new McpTransportError(
        "MCP_CREDENTIAL_REQUIRED",
        `No credential is stored for MCP header ${name}.`
      );
    }
    headers[name] = value;
  }
  return Object.freeze(headers);
}

export async function createHttpMcpTransport(
  config: McpHttpTransport,
  options: HttpMcpTransportOptions
): Promise<HttpMcpTransportHandle> {
  const url = new URL(config.url);
  const headers = await resolveHttpHeaders(config, options.resolveCredential);
  if (options.fetch === undefined) {
    throw new McpTransportError(
      "MCP_FETCH_REQUIRED",
      "An explicit fetch implementation is required for MCP HTTP requests."
    );
  }
  const guardedFetch = createCredentialGuardedFetch({
    allowedOrigin: url.origin,
    headers: async () => headers,
    fetch: options.fetch,
    ...(options.maxRedirects !== undefined ? { maxRedirects: options.maxRedirects } : {}),
  });
  const createTransport = options.createTransport ?? (await loadHttpTransportConstructor());
  const transport = createTransport({
    url: config.url,
    headers,
    fetch: guardedFetch,
    openGetStream: options.openGetStream ?? false,
    ...(options.maxMessageBytes !== undefined ? { maxMessageBytes: options.maxMessageBytes } : {}),
  });
  return Object.freeze({
    transport,
    origin: url.origin,
    headerNames: Object.freeze(Object.keys(headers)),
  });
}
