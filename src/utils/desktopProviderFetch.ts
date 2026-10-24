import { requireNodeModule } from "@/utils/desktopRuntime";

interface DesktopNetwork {
  fetch: typeof window.fetch;
}

interface ElectronNetwork {
  net?: DesktopNetwork;
  remote: {
    net: DesktopNetwork;
    getGlobal(name: "AbortController"): typeof AbortController;
  };
}

// 聊天需要宿主网络避开页面跨域限制，同时保留逐块读取和停止请求的能力。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
export const desktopProviderFetch: typeof window.fetch = async (input, init) => {
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  signal?.throwIfAborted();
  const electron = requireNodeModule<ElectronNetwork>("electron");
  if (electron.net?.fetch) return electron.net.fetch(input, init);
  const remote = electron.remote;
  const HostAbortController = remote.getGlobal("AbortController");
  const controller = new HostAbortController();
  const abort = () => controller.abort();
  const cleanup = () => signal?.removeEventListener("abort", abort);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const request = new Request(input, init);
    const headers = Object.fromEntries(request.headers.entries());
    const body = request.body === null ? undefined : await request.arrayBuffer();
    signal?.throwIfAborted();
    const upstream = await remote.net.fetch(request.url, {
      method: request.method,
      headers,
      body,
      redirect: request.redirect,
      signal: controller.signal,
    });
    const responseHeaders = new Headers();
    const iterator = upstream.headers.entries();
    // 宿主返回的迭代器跨进程后不具备页面的迭代协议，必须显式读取。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
    for (let entry = iterator.next(); !entry.done; entry = iterator.next()) {
      responseHeaders.append(entry.value[0], entry.value[1]);
    }
    const reader = upstream.body?.getReader();
    if (!reader) cleanup();
    const stream = reader
      ? new ReadableStream<Uint8Array>({
          async pull(output) {
            try {
              const chunk = await reader.read();
              if (chunk.done) {
                cleanup();
                output.close();
              } else {
                output.enqueue(new Uint8Array(chunk.value));
              }
            } catch (error) {
              cleanup();
              output.error(error);
            }
          },
          async cancel(reason) {
            try {
              await reader.cancel(reason);
            } finally {
              cleanup();
            }
          },
        })
      : null;
    return new Response(stream, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    cleanup();
    throw error;
  }
};
