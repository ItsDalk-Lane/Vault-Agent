import { runInThisContext } from "node:vm";
import { desktopProviderFetch } from "./desktopProviderFetch";
import { requireNodeModule } from "./desktopRuntime";

jest.mock("./desktopRuntime", () => ({ requireNodeModule: jest.fn() }));

const mockModule = jest.mocked(requireNodeModule);
Object.assign(
  window,
  runInThisContext("({ Request, Response, Headers, ReadableStream, AbortController })") as Record<
    string,
    unknown
  >
);

describe("desktopProviderFetch", () => {
  describe("desktopProviderFetch()", () => {
    it("streams the desktop response before completion and forwards the request https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
      let source!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          source = controller;
        },
      });
      const upstream = new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
      const fetch = jest.fn().mockResolvedValue(upstream);
      mockModule.mockReturnValue({ remote: { net: { fetch }, getGlobal: () => AbortController } });
      const requestBody = JSON.stringify({ messages: [{ role: "system", content: "项目口令乙" }] });
      const response = await desktopProviderFetch("https://example.com/v1/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer fixture" },
        body: requestBody,
      });
      const reader = response.body!.getReader();
      source.enqueue(new TextEncoder().encode("data: first\n\n"));
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
      source.close();
      expect((await reader.read()).done).toBe(true);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://example.com/v1/chat/completions");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        authorization: "Bearer fixture",
        "content-type": "text/plain;charset=UTF-8",
      });
      expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(requestBody);
    });

    it("bridges abort to the host signal while the body is streaming and releases its listener https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
      let hostSignal!: AbortSignal;
      const fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        hostSignal = init!.signal!;
        return new Response(
          new ReadableStream({
            start(controller) {
              hostSignal.addEventListener("abort", () => controller.error(hostSignal.reason), {
                once: true,
              });
            },
          })
        );
      });
      mockModule.mockReturnValue({ remote: { net: { fetch }, getGlobal: () => AbortController } });
      const controller = new AbortController();
      const remove = jest.spyOn(controller.signal, "removeEventListener");
      const response = await desktopProviderFetch("https://example.com", {
        signal: controller.signal,
      });
      const pending = response.body!.getReader().read();
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(hostSignal).not.toBe(controller.signal);
      expect(hostSignal.aborted).toBe(true);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    });

    it("does not send a request after cancellation and removes listeners on a connection failure https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
      const fetch = jest.fn().mockRejectedValue(new Error("offline"));
      mockModule.mockReturnValue({ remote: { net: { fetch }, getGlobal: () => AbortController } });
      const cancelled = new AbortController();
      cancelled.abort();
      await expect(
        desktopProviderFetch("https://example.com", { signal: cancelled.signal })
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(fetch).not.toHaveBeenCalled();
      const controller = new AbortController();
      const remove = jest.spyOn(controller.signal, "removeEventListener");
      await expect(
        desktopProviderFetch("https://example.com", { signal: controller.signal })
      ).rejects.toThrow("offline");
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    });

    it("cancels the source reader and frees the signal listener when the consumer stops https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
      const cancel = jest.fn();
      const fetch = jest.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
      mockModule.mockReturnValue({ remote: { net: { fetch }, getGlobal: () => AbortController } });
      const controller = new AbortController();
      const remove = jest.spyOn(controller.signal, "removeEventListener");
      const response = await desktopProviderFetch("https://example.com", {
        signal: controller.signal,
      });
      await response.body!.cancel("stop");
      expect(cancel).toHaveBeenCalledWith("stop");
      expect(remove).toHaveBeenCalled();
    });

    it("preserves responses without a body and uses the direct desktop API when available https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", async () => {
      const upstream = new Response(null, { status: 204 });
      const fetch = jest.fn().mockResolvedValue(upstream);
      mockModule.mockReturnValue({ remote: { net: { fetch }, getGlobal: () => AbortController } });
      expect((await desktopProviderFetch("https://example.com")).status).toBe(204);
      mockModule.mockReturnValue({ net: { fetch } });
      expect(await desktopProviderFetch("https://example.com")).toBe(upstream);
    });
  });
});
