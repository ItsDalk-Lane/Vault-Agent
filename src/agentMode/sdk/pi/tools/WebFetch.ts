// Web material is fetched under strict limits: http/https only, private networks and the cloud
// metadata endpoint are refused unless the host was explicitly authorized, every redirect hop is
// re-validated, the request is capped at 30 seconds and 1 MiB and can be cancelled, and the response is
// returned as untrusted text — page content never becomes policy and no script is ever executed:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const WEB_FETCH_TIMEOUT_MS = 30_000;
export const WEB_FETCH_MAX_BYTES = 1024 * 1024;
export const WEB_FETCH_MAX_REDIRECTS = 5;

export type WebFetchErrorCode =
  | "WEB_FETCH_SCHEME_DENIED"
  | "WEB_FETCH_PRIVATE_HOST_DENIED"
  | "WEB_FETCH_REDIRECT_DENIED"
  | "WEB_FETCH_TIMEOUT"
  | "WEB_FETCH_CANCELLED"
  | "WEB_FETCH_TOO_LARGE"
  | "WEB_FETCH_UNSUPPORTED_CONTENT"
  | "WEB_FETCH_FAILED";

export interface WebFetchResponse {
  readonly status: number;
  readonly url?: string;
  readonly headers: { get(name: string): string | null };
  readonly body?: ReadableStream<Uint8Array> | null;
  text?(): Promise<string>;
}

export interface WebFetchPorts {
  fetch(input: {
    readonly url: string;
    readonly method: "GET";
    readonly redirect: "manual";
    readonly signal: AbortSignal;
    readonly headers: Readonly<Record<string, string>>;
  }): Promise<WebFetchResponse>;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface WebFetchResult {
  readonly isError: boolean;
  readonly output: readonly { readonly type: "text"; readonly text: string }[];
  readonly details: Readonly<Record<string, unknown>>;
}

export interface WebFetchOptions {
  readonly ports: WebFetchPorts;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
  readonly allowPrivateHosts?: boolean;
  readonly allowedHosts?: readonly string[];
}

const TEXTUAL_CONTENT =
  /^(text\/|application\/(?:json|xml|xhtml\+xml|javascript)|application\/[a-z0-9.+-]*\+json)/i;
const METADATA_HOSTS = new Set(["169.254.169.254", "metadata.google.internal", "metadata"]);

export class WebFetch {
  readonly #options: WebFetchOptions;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;
  readonly #maxRedirects: number;

  constructor(options: WebFetchOptions) {
    this.#options = options;
    this.#timeoutMs = options.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
    this.#maxBytes = options.maxBytes ?? WEB_FETCH_MAX_BYTES;
    this.#maxRedirects = options.maxRedirects ?? WEB_FETCH_MAX_REDIRECTS;
  }

  async fetchMaterial(input: {
    readonly url: string;
    readonly signal?: AbortSignal;
  }): Promise<WebFetchResult> {
    const requested = input.url;
    let current = requested;
    const redirects: string[] = [];
    // 停止可能早于网络工具接管信号，不能漏掉已发生的取消再发起请求。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (input.signal?.aborted)
      return this.#error("WEB_FETCH_CANCELLED", "The fetch was cancelled.", {
        url: requested,
        finalUrl: current,
        redirects,
      });
    const timer =
      this.#options.ports.setTimeout ?? ((callback, ms) => window.setTimeout(callback, ms));
    const clear =
      this.#options.ports.clearTimeout ??
      ((handle: unknown) => window.clearTimeout(handle as number));
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const handle = timer(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    try {
      for (let hop = 0; hop <= this.#maxRedirects; hop += 1) {
        const denied = this.#validateTarget(current, hop > 0);
        if (denied !== undefined) {
          return this.#error(denied.code, denied.message, {
            url: requested,
            finalUrl: current,
            redirects,
          });
        }
        let response: WebFetchResponse;
        try {
          response = await this.#options.ports.fetch({
            url: current,
            method: "GET",
            redirect: "manual",
            signal: controller.signal,
            headers: { accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.1" },
          });
        } catch (thrown) {
          if (timedOut) {
            return this.#error("WEB_FETCH_TIMEOUT", "The fetch exceeded its 30 second limit.", {
              url: requested,
              finalUrl: current,
              redirects,
            });
          }
          if (controller.signal.aborted) {
            return this.#error("WEB_FETCH_CANCELLED", "The fetch was cancelled.", {
              url: requested,
              finalUrl: current,
              redirects,
            });
          }
          return this.#error(
            "WEB_FETCH_FAILED",
            thrown instanceof Error ? thrown.message : "The fetch failed.",
            { url: requested, finalUrl: current, redirects }
          );
        }
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location !== null) {
          const next = resolveRedirect(current, location);
          if (next === undefined) {
            return this.#error("WEB_FETCH_REDIRECT_DENIED", "The redirect target is invalid.", {
              url: requested,
              finalUrl: current,
              redirects,
              status: response.status,
            });
          }
          redirects.push(next);
          current = next;
          continue;
        }
        if (response.status >= 400) {
          return this.#error("WEB_FETCH_FAILED", `The server answered ${response.status}.`, {
            url: requested,
            finalUrl: response.url ?? current,
            redirects,
            status: response.status,
          });
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.length > 0 && !TEXTUAL_CONTENT.test(contentType)) {
          return this.#error(
            "WEB_FETCH_UNSUPPORTED_CONTENT",
            `The response type "${contentType}" is not text material.`,
            {
              url: requested,
              finalUrl: response.url ?? current,
              redirects,
              status: response.status,
            }
          );
        }
        const read = await this.#readText(response, controller.signal);
        if (read.kind === "too_large") {
          return this.#error(
            "WEB_FETCH_TOO_LARGE",
            `The response exceeds ${this.#maxBytes} bytes.`,
            {
              url: requested,
              finalUrl: response.url ?? current,
              redirects,
              status: response.status,
            }
          );
        }
        if (read.kind === "aborted") {
          return this.#error(
            timedOut ? "WEB_FETCH_TIMEOUT" : "WEB_FETCH_CANCELLED",
            timedOut ? "The fetch exceeded its 30 second limit." : "The fetch was cancelled.",
            {
              url: requested,
              finalUrl: response.url ?? current,
              redirects,
              status: response.status,
            }
          );
        }
        return Object.freeze({
          isError: false,
          output: Object.freeze([{ type: "text" as const, text: read.text }]),
          details: Object.freeze({
            url: requested,
            finalUrl: response.url ?? current,
            status: response.status,
            bytes: utf8Bytes(read.text),
            contentType: contentType.length > 0 ? contentType : "text/plain",
            redirects: Object.freeze([...redirects]),
            truncated: read.truncated,
            untrusted: true,
            executedScripts: false,
          }),
        });
      }
      return this.#error("WEB_FETCH_REDIRECT_DENIED", "Too many redirects.", {
        url: requested,
        finalUrl: current,
        redirects,
      });
    } finally {
      clear(handle);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }

  #validateTarget(
    url: string,
    isRedirect: boolean
  ): { readonly code: WebFetchErrorCode; readonly message: string } | undefined {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { code: "WEB_FETCH_FAILED", message: `"${url}" is not a valid URL.` };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        code: "WEB_FETCH_SCHEME_DENIED",
        message: `The scheme "${parsed.protocol}" is not allowed; use http or https.`,
      };
    }
    const host = parsed.hostname.toLowerCase();
    const authorized = (this.#options.allowedHosts ?? []).includes(host);
    if (authorized || this.#options.allowPrivateHosts === true) return undefined;
    if (isPrivateHost(host)) {
      return {
        code: isRedirect ? "WEB_FETCH_REDIRECT_DENIED" : "WEB_FETCH_PRIVATE_HOST_DENIED",
        message: `The host "${host}" is a private, loopback or metadata address and is not authorized.`,
      };
    }
    return undefined;
  }

  async #readText(
    response: WebFetchResponse,
    signal: AbortSignal
  ): Promise<
    | { readonly kind: "ok"; readonly text: string; readonly truncated: boolean }
    | { readonly kind: "too_large" }
    | { readonly kind: "aborted" }
  > {
    const body = response.body;
    if (body === undefined || body === null) {
      const text = (await response.text?.()) ?? "";
      if (utf8Bytes(text) > this.#maxBytes) return { kind: "too_large" };
      return { kind: "ok", text, truncated: false };
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    let truncated = false;
    try {
      for (;;) {
        if (signal.aborted) return { kind: "aborted" };
        const chunk = await reader.read();
        if (chunk.done) break;
        const value = chunk.value ?? new Uint8Array();
        bytes += value.byteLength;
        if (bytes > this.#maxBytes) {
          truncated = true;
          break;
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (signal.aborted) return { kind: "aborted" };
    return { kind: "ok", text: text + decoder.decode(), truncated };
  }

  #error(
    code: WebFetchErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>>
  ): WebFetchResult {
    return Object.freeze({
      isError: true,
      output: Object.freeze([{ type: "text" as const, text: message }]),
      details: Object.freeze({ errorCode: code, untrusted: true, ...details }),
    });
  }
}

export function isPrivateHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized.endsWith(".internal") || normalized.endsWith(".local")) return true;
  if (METADATA_HOSTS.has(normalized)) return true;
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (ipv4 === null) return false;
  const [first, second] = [Number(ipv4[1]), Number(ipv4[2])];
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

function resolveRedirect(base: string, location: string): string | undefined {
  try {
    return new URL(location, base).toString();
  } catch {
    return undefined;
  }
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
