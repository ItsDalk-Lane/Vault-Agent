import { v4 as uuidv4 } from "uuid";

// Go 网关要求 x-opencode-session 才能把请求路由到同一会话；缺失时直接 400 MissingSessionID。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
const OPENCODE_SESSION_HEADER = "x-opencode-session";
const OPENCODE_HOST = "opencode.ai";
const OPENCODE_HOST_SUFFIX = ".opencode.ai";

interface SessionHeaderRequest {
  readonly headers?: Record<string, string | null>;
  readonly sessionId?: string;
}

export function isOpenCodeEndpoint(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === OPENCODE_HOST || hostname.endsWith(OPENCODE_HOST_SUFFIX);
  } catch {
    return false;
  }
}

export function createOpenCodeSessionId(): string {
  return uuidv4();
}

export function openCodeSessionHeaders(
  baseUrl: string | undefined,
  sessionId: string | undefined,
  fallbackSessionId: string
): Record<string, string> | undefined {
  if (!isOpenCodeEndpoint(baseUrl)) return undefined;
  return { [OPENCODE_SESSION_HEADER]: sessionId ?? fallbackSessionId };
}

export function withOpenCodeSessionHeaders<T extends SessionHeaderRequest>(
  request: T | undefined,
  baseUrl: string | undefined,
  fallbackSessionId: string
): T | undefined {
  const headers = openCodeSessionHeaders(baseUrl, request?.sessionId, fallbackSessionId);
  if (!headers) return request;
  return { ...request, headers: { ...request?.headers, ...headers } } as T;
}
