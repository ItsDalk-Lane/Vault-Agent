import { EventEmitter } from "node:events";
import type { IncomingMessage, RequestOptions } from "node:http";
import type { LookupAddress } from "node:dns";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { createPiWebFetchPorts } from "@/agentMode/sdk/pi/runtime/PiWebFetch";

jest.mock("@/utils/desktopRuntime", () => ({ requireNodeModule: jest.fn() }));

interface Fixture {
  readonly lookup: jest.Mock<Promise<LookupAddress[]>, [string, unknown]>;
  readonly request: jest.Mock;
  readonly response: {
    statusCode: number;
    headers: Record<string, string | string[]>;
    destroy: jest.Mock;
  };
  readonly stream: ReadableStream<Uint8Array>;
}

function fixture(addresses: LookupAddress[] = [{ address: "203.0.113.8", family: 4 }]): Fixture {
  const lookup = jest
    .fn<Promise<LookupAddress[]>, [string, unknown]>()
    .mockResolvedValue(addresses);
  const response = {
    statusCode: 200,
    headers: { "content-type": "text/plain" } as Record<string, string | string[]>,
    destroy: jest.fn(),
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("test material"));
      controller.close();
    },
  });
  const request = jest.fn(
    (_target: URL, _options: RequestOptions, reply: (response: IncomingMessage) => void) =>
      Object.assign(new EventEmitter(), {
        end: () => reply(response as unknown as IncomingMessage),
      })
  );
  jest.mocked(requireNodeModule).mockImplementation((id: string) => {
    if (id === "node:dns/promises") return { lookup };
    if (id === "node:net")
      return {
        isIP: (host: string) =>
          host.includes(":") ? 6 : /^\d+\.\d+\.\d+\.\d+$/.test(host) ? 4 : 0,
      };
    if (id === "node:stream") return { Readable: { toWeb: () => stream } };
    if (id === "node:timers") return { setTimeout, clearTimeout };
    if (id === "node:http" || id === "node:https") return { request };
    throw new Error(`unexpected module ${id}`);
  });
  return { lookup, request, response, stream };
}

function input(url = "https://example.test/page", signal = new AbortController().signal) {
  return {
    url,
    method: "GET" as const,
    redirect: "manual" as const,
    signal,
    headers: { accept: "text/plain" },
  };
}

describe("PiWebFetch", () => {
  describe("createPiWebFetchPorts()", () => {
    it("does not start DNS or a socket for an already cancelled request https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const io = fixture();
      const controller = new AbortController();
      controller.abort();
      await expect(
        createPiWebFetchPorts().fetch(input("https://example.test/", controller.signal))
      ).rejects.toThrow("cancelled");
      expect(io.lookup).not.toHaveBeenCalled();
      expect(io.request).not.toHaveBeenCalled();
    });

    it("surfaces DNS failures as errors without opening a socket https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const io = fixture();
      io.lookup.mockRejectedValue("DNS unavailable");
      await expect(createPiWebFetchPorts().fetch(input())).rejects.toThrow("DNS unavailable");
      expect(io.request).not.toHaveBeenCalled();
    });

    it("provides cancellable timeout handles to the bounded fetch service https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      jest.useFakeTimers();
      try {
        fixture();
        const ports = createPiWebFetchPorts();
        const callback = jest.fn();
        const cancelled = ports.setTimeout?.(callback, 5);
        ports.clearTimeout?.(cancelled);
        jest.advanceTimersByTime(5);
        expect(callback).not.toHaveBeenCalled();
        ports.setTimeout?.(callback, 5);
        jest.advanceTimersByTime(5);
        expect(callback).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
    it("pins a reviewed public address while preserving the original hostname and streamed response https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const io = fixture();
      const response = await createPiWebFetchPorts().fetch(input());
      const [url, options] = io.request.mock.calls[0] as [URL, RequestOptions];
      expect(url.hostname).toBe("example.test");
      expect(options).toMatchObject({
        family: 4,
        method: "GET",
        headers: { "accept-encoding": "identity" },
      });
      const pinned = jest.fn();
      options.lookup?.("example.test", {}, pinned);
      expect(pinned).toHaveBeenCalledWith(null, "203.0.113.8", 4);
      expect(io.lookup).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
      expect(response.body).toBe(io.stream);
      expect(response.headers.get("content-type")).toBe("text/plain");
    });

    it("returns redirects to the guarded caller without automatically following them https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const io = fixture();
      io.response.statusCode = 302;
      io.response.headers.location = "http://127.0.0.1/private";
      io.response.headers["set-cookie"] = ["a=1", "b=2"];
      const response = await createPiWebFetchPorts().fetch(input("http://example.test/page"));
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("http://127.0.0.1/private");
      expect(response.headers.get("set-cookie")).toBe("a=1, b=2");
      expect(io.request).toHaveBeenCalledTimes(1);
    });

    it.each([
      "10.0.0.1",
      "127.0.0.1",
      "100.64.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "::",
      "::1",
      "::ffff:7f00:1",
      "fe80::1",
      "ff02::1",
    ])(
      "refuses the DNS result %s before opening a socket https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (address) => {
        const io = fixture([{ address, family: address.includes(":") ? 6 : 4 }]);
        await expect(createPiWebFetchPorts().fetch(input())).rejects.toThrow(
          "private or unsupported network"
        );
        expect(io.request).not.toHaveBeenCalled();
      }
    );

    it("checks literal IP addresses without permitting a second DNS lookup https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const io = fixture();
      await expect(createPiWebFetchPorts().fetch(input("http://127.0.0.1/"))).rejects.toThrow(
        "private or unsupported network"
      );
      expect(io.lookup).not.toHaveBeenCalled();
      expect(io.request).not.toHaveBeenCalled();
    });

    it("cancels a pending DNS lookup without letting its late result open a socket https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const io = fixture();
      let finish!: (addresses: LookupAddress[]) => void;
      const lookup = new Promise<LookupAddress[]>((resolve) => {
        finish = resolve;
      });
      io.lookup.mockReturnValue(lookup);
      const controller = new AbortController();
      const response = createPiWebFetchPorts().fetch(
        input("https://example.test/", controller.signal)
      );
      controller.abort();
      await expect(response).rejects.toThrow("cancelled");
      finish([{ address: "203.0.113.8", family: 4 }]);
      await lookup;
      expect(io.request).not.toHaveBeenCalled();
    });

    it("refuses authenticated and unsupported URL schemes before any network operation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const io = fixture();
      const ports = createPiWebFetchPorts();
      await expect(ports.fetch(input("https://user:secret@example.test/"))).rejects.toThrow(
        "credentials"
      );
      await expect(ports.fetch(input("file:///private/note"))).rejects.toThrow("Only HTTP");
      expect(io.lookup).not.toHaveBeenCalled();
      expect(io.request).not.toHaveBeenCalled();
    });

    it("refuses unsolicited compressed responses rather than treating compressed bytes as text https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const io = fixture();
      io.response.headers["content-encoding"] = "gzip";
      await expect(createPiWebFetchPorts().fetch(input())).rejects.toThrow("Compressed");
      expect(io.response.destroy).toHaveBeenCalledTimes(1);
    });
  });
});
