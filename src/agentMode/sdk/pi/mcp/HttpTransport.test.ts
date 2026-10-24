import type { McpFetch } from "@earendil-works/pi-mcp";
import {
  McpTransportError,
  createCredentialGuardedFetch,
  createHttpMcpTransport,
  resolveHttpHeaders,
  type HttpTransportConstructorOptions,
} from "@/agentMode/sdk/pi/mcp/HttpTransport";
import { normalizeMcpServerConfig } from "@/agentMode/sdk/pi/mcp/McpConfig";
import { FakeMcpTransport } from "@/agentMode/sdk/pi/mcp/__tests__/fakeMcpSdk";

// Credentials resolved from secretRefs go only to the configured origin, and every redirect hop is
// re-checked, so a redirect cannot move the token to another host. The StreamableHttpTransport
// class comes from the ESM-only package, so the constructor is injected here and loaded with a
// dynamic import in production:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function httpConfig(headers: Record<string, string> = {}) {
  const config = normalizeMcpServerConfig({
    serverId: "docs",
    scope: "this-vault",
    transport: { kind: "http", url: "https://mcp.example.com/mcp", headerSecretRefs: headers },
  });
  if (config.transport.kind !== "http") throw new Error("expected http transport");
  return config.transport;
}

function fakeResponse(status: number, location?: string): Response {
  return {
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "location" ? (location ?? null) : null),
    },
  } as unknown as Response;
}

function recordingFetch(responder: (url: string, init: RequestInit | undefined) => Response): {
  fetch: McpFetch;
  calls: Array<{ url: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch: McpFetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return responder(url, init);
  };
  return { fetch, calls };
}

describe("HttpTransport", () => {
  describe("createCredentialGuardedFetch()", () => {
    it.each([
      {
        name: "successful same-origin redirect",
        location: "/next",
        limit: 3,
        code: null,
        discardFails: false,
      },
      {
        name: "cross-origin denial",
        location: "https://other.test/mcp",
        limit: 3,
        code: "MCP_CREDENTIAL_ORIGIN_DENIED",
        discardFails: false,
      },
      {
        name: "missing Location denial",
        location: undefined,
        limit: 3,
        code: "MCP_REDIRECT_DENIED",
        discardFails: false,
      },
      {
        name: "redirect limit denial",
        location: "/next",
        limit: 0,
        code: "MCP_REDIRECT_DENIED",
        discardFails: false,
      },
      {
        name: "discard failure before cross-origin denial",
        location: "https://other.test/mcp",
        limit: 3,
        code: "MCP_CREDENTIAL_ORIGIN_DENIED",
        discardFails: true,
      },
    ])(
      "releases the redirect body for $name without changing the final result https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async ({ location, limit, code, discardFails }) => {
        const cancel = jest.fn(async () => {
          if (discardFails) throw new Error("discard failed");
        });
        const finalCancel = jest.fn();
        const redirected = {
          ...fakeResponse(302, location),
          body: { cancel },
        } as unknown as Response;
        const final = {
          ...fakeResponse(200),
          body: { cancel: finalCancel },
        } as unknown as Response;
        const fetch = jest.fn(async () => redirected);
        fetch.mockImplementationOnce(async () => redirected);
        fetch.mockImplementation(async () => {
          expect(cancel).toHaveBeenCalledTimes(1);
          return final;
        });
        const guarded = createCredentialGuardedFetch({
          allowedOrigin: "https://mcp.example.com",
          headers: async () => ({ Authorization: "Bearer kept" }),
          fetch,
          maxRedirects: limit,
        });
        if (code)
          await expect(guarded("https://mcp.example.com/mcp")).rejects.toMatchObject({ code });
        else expect(await guarded("https://mcp.example.com/mcp")).toBe(final);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(finalCancel).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(code ? 1 : 2);
      }
    );

    it("attaches credential headers to the allowed origin", async () => {
      const recorder = recordingFetch(() => fakeResponse(200));
      const guarded = createCredentialGuardedFetch({
        allowedOrigin: "https://mcp.example.com",
        headers: async () => ({ Authorization: "Bearer sk-live-123" }),
        fetch: recorder.fetch,
      });

      const response = await guarded("https://mcp.example.com/mcp", { method: "POST" });

      expect(response.status).toBe(200);
      expect(recorder.calls).toHaveLength(1);
      expect(recorder.calls[0]?.headers.authorization).toBe("Bearer sk-live-123");
      expect(recorder.calls[0]?.url).toBe("https://mcp.example.com/mcp");
    });

    it("replaces a differently cased authorization header instead of joining two bearer values https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const recorder = recordingFetch(() => fakeResponse(200));
      const guarded = createCredentialGuardedFetch({
        allowedOrigin: "https://mcp.example.com",
        headers: async () => ({ Authorization: "Bearer trusted" }),
        fetch: recorder.fetch,
      });
      await guarded("https://mcp.example.com/mcp", {
        headers: new Headers({ authorization: "Bearer stale", "Content-Type": "application/json" }),
      });
      expect(recorder.calls[0]?.headers).toMatchObject({
        authorization: "Bearer trusted",
        "content-type": "application/json",
      });
    });

    it("refuses another origin before any request is sent", async () => {
      const recorder = recordingFetch(() => fakeResponse(200));
      const guarded = createCredentialGuardedFetch({
        allowedOrigin: "https://mcp.example.com",
        headers: async () => ({ Authorization: "Bearer sk-live-123" }),
        fetch: recorder.fetch,
      });

      await expect(guarded("https://evil.example.com/mcp")).rejects.toMatchObject({
        code: "MCP_CREDENTIAL_ORIGIN_DENIED",
      });
      expect(recorder.calls).toEqual([]);
    });

    it("follows a same-origin redirect with the credentials re-attached", async () => {
      const recorder = recordingFetch((url) =>
        url === "https://mcp.example.com/mcp" ? fakeResponse(307, "/moved/mcp") : fakeResponse(200)
      );
      const guarded = createCredentialGuardedFetch({
        allowedOrigin: "https://mcp.example.com",
        headers: async () => ({ Authorization: "Bearer sk-live-123" }),
        fetch: recorder.fetch,
      });

      const response = await guarded("https://mcp.example.com/mcp");

      expect(response.status).toBe(200);
      expect(recorder.calls.map((call) => call.url)).toEqual([
        "https://mcp.example.com/mcp",
        "https://mcp.example.com/moved/mcp",
      ]);
      expect(recorder.calls[1]?.headers.authorization).toBe("Bearer sk-live-123");
    });

    it("denies a cross-origin redirect before the credential can move hosts", async () => {
      const recorder = recordingFetch(() => fakeResponse(302, "https://evil.example.com/mcp"));
      const guarded = createCredentialGuardedFetch({
        allowedOrigin: "https://mcp.example.com",
        headers: async () => ({ Authorization: "Bearer sk-live-123" }),
        fetch: recorder.fetch,
      });

      await expect(guarded("https://mcp.example.com/mcp")).rejects.toMatchObject({
        code: "MCP_CREDENTIAL_ORIGIN_DENIED",
      });
      expect(recorder.calls).toHaveLength(1);
      expect(recorder.calls[0]?.url).toBe("https://mcp.example.com/mcp");
    });

    it("stops after the redirect limit and passes non-redirect responses through", async () => {
      const recorder = recordingFetch(() => fakeResponse(301, "/again"));
      const guarded = createCredentialGuardedFetch({
        allowedOrigin: "https://mcp.example.com",
        headers: async () => ({}),
        fetch: recorder.fetch,
        maxRedirects: 2,
      });
      await expect(guarded("https://mcp.example.com/mcp")).rejects.toMatchObject({
        code: "MCP_REDIRECT_DENIED",
      });
      expect(recorder.calls).toHaveLength(3);

      const unauthorized = recordingFetch(() => fakeResponse(401));
      const passthrough = createCredentialGuardedFetch({
        allowedOrigin: "https://mcp.example.com",
        headers: async () => ({}),
        fetch: unauthorized.fetch,
      });
      await expect(passthrough("https://mcp.example.com/mcp")).resolves.toMatchObject({
        status: 401,
      });
    });
  });

  describe("resolveHttpHeaders()", () => {
    it("resolves every secretRef and fails explicitly when a credential is missing", async () => {
      const headers = await resolveHttpHeaders(
        httpConfig({ Authorization: "mcp:docs:authorization", "X-Api-Key": "mcp:docs:api-key" }),
        async (ref) => (ref.endsWith("authorization") ? "Bearer sk-live-123" : "key-456")
      );

      expect(headers).toEqual({
        Authorization: "Bearer sk-live-123",
        "X-Api-Key": "key-456",
      });
      await expect(
        resolveHttpHeaders(
          httpConfig({ Authorization: "mcp:docs:authorization" }),
          async () => undefined
        )
      ).rejects.toMatchObject({ code: "MCP_CREDENTIAL_REQUIRED" });
    });
  });

  describe("createHttpMcpTransport()", () => {
    it("builds the transport through the injected constructor with the guarded fetch", async () => {
      const recorder = recordingFetch(() => fakeResponse(200));
      const captured: { options: HttpTransportConstructorOptions | null } = { options: null };
      const fake = new FakeMcpTransport();
      const handle = await createHttpMcpTransport(
        httpConfig({ Authorization: "mcp:docs:authorization" }),
        {
          resolveCredential: async () => "Bearer sk-live-123",
          fetch: recorder.fetch,
          createTransport: (options) => {
            captured.options = options;
            return fake;
          },
        }
      );

      expect(handle.transport).toBe(fake);
      expect(handle.origin).toBe("https://mcp.example.com");
      expect(handle.headerNames).toEqual(["Authorization"]);
      expect(captured.options).toMatchObject({
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer sk-live-123" },
        openGetStream: false,
      });
      await expect(captured.options?.fetch("https://evil.example.com/mcp")).rejects.toMatchObject({
        code: "MCP_CREDENTIAL_ORIGIN_DENIED",
      });
    });

    it("reports a missing credential as a transport error", async () => {
      await expect(
        createHttpMcpTransport(httpConfig({ Authorization: "mcp:docs:authorization" }), {
          resolveCredential: async () => undefined,
        })
      ).rejects.toBeInstanceOf(McpTransportError);
    });
  });
});
