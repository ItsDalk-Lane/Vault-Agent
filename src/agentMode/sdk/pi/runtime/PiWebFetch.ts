import { requireNodeModule } from "@/utils/desktopRuntime";
import { isPrivateHost, type WebFetchPorts } from "@/agentMode/sdk/pi/tools/WebFetch";

type LookupAddress = import("node:dns").LookupAddress;
type IncomingMessage = import("node:http").IncomingMessage;

// 每一跳固定到已检查的公网地址，防止 DNS 二次解析把已批准的网页请求转到私网：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export function createPiWebFetchPorts(): WebFetchPorts {
  const dns = requireNodeModule<typeof import("node:dns/promises")>("node:dns/promises");
  const net = requireNodeModule<typeof import("node:net")>("node:net");
  const http = requireNodeModule<typeof import("node:http")>("node:http");
  const https = requireNodeModule<typeof import("node:https")>("node:https");
  const timers = requireNodeModule<typeof import("node:timers")>("node:timers");
  const stream = requireNodeModule<{
    Readable: { toWeb(input: IncomingMessage): ReadableStream<Uint8Array> };
  }>("node:stream");
  return {
    setTimeout: (callback, ms) => timers.setTimeout(callback, ms),
    clearTimeout: (handle) => timers.clearTimeout(handle as ReturnType<typeof timers.setTimeout>),
    fetch: async (input) => {
      if (input.signal.aborted) throw new Error("The web request was cancelled.");
      const target = new URL(input.url);
      if (target.protocol !== "http:" && target.protocol !== "https:")
        throw new Error("Only HTTP and HTTPS material is allowed.");
      if (target.username || target.password)
        throw new Error("Web material URLs cannot contain credentials.");
      const hostname = target.hostname.replace(/^\[|\]$/g, "");
      const literalFamily = net.isIP(hostname);
      const addresses = literalFamily
        ? [{ address: hostname, family: literalFamily }]
        : await abortableLookup(dns.lookup(hostname, { all: true, verbatim: true }), input.signal);
      if (input.signal.aborted) throw new Error("The web request was cancelled.");
      if (
        addresses.length === 0 ||
        addresses.some((address) => isPrivateNetworkAddress(address.address))
      )
        throw new Error("The web address resolves to a private or unsupported network.");
      const pinned = addresses[0];
      const transport = target.protocol === "https:" ? https : http;
      return new Promise((resolve, reject) => {
        const request = transport.request(
          target,
          {
            method: "GET",
            headers: { ...input.headers, "accept-encoding": "identity" },
            signal: input.signal,
            family: pinned.family,
            lookup: (_hostname, _options, callback) =>
              callback(null, pinned.address, pinned.family),
          },
          (response) => {
            const encoding = response.headers["content-encoding"];
            if (encoding && encoding !== "identity") {
              response.destroy();
              reject(new Error("Compressed web material is not supported."));
              return;
            }
            resolve({
              status: response.statusCode ?? 0,
              url: target.toString(),
              headers: {
                get: (name) => {
                  const value = response.headers[name.toLowerCase()];
                  return Array.isArray(value) ? value.join(", ") : (value ?? null);
                },
              },
              body: stream.Readable.toWeb(response),
            });
          }
        );
        request.once("error", reject);
        request.end();
      });
    },
  };
}

function isPrivateNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (
    isPrivateHost(normalized) ||
    normalized === "::" ||
    normalized.startsWith("::ffff:") ||
    /^fe[89ab][0-9a-f]:/.test(normalized) ||
    /^ff[0-9a-f]{2}:/.test(normalized)
  )
    return true;
  const pieces = normalized.split(".");
  if (pieces.length !== 4) return false;
  const first = Number(pieces[0]);
  const second = Number(pieces[1]);
  return (
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function abortableLookup(
  lookup: Promise<LookupAddress[]>,
  signal: AbortSignal
): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("The web request was cancelled."));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    lookup.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}
