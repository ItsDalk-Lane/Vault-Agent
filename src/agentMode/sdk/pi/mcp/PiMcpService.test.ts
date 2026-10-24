import { desktopProviderFetch } from "@/utils/desktopProviderFetch";

jest.mock("@/utils/desktopProviderFetch", () => ({ desktopProviderFetch: jest.fn() }));
jest.mock(
  "@earendil-works/pi-mcp",
  () => ({
    McpClient: jest.fn(),
    StreamableHttpTransport: jest.fn(() => ({ close: async () => undefined })),
    McpAuthRequiredError: class extends Error {},
  }),
  { virtual: true }
);

import { PiMcpService } from "./PiMcpService";
import { piMcpFixture, mcpConfig } from "./__tests__/piMcpFixture";

jest.mock("./McpOAuth", () => {
  const actual = jest.requireActual<typeof import("./McpOAuth")>("./McpOAuth");
  return { ...actual, createPiMcpOAuthFlow: jest.fn() };
});

import { createPiMcpOAuthFlow } from "./McpOAuth";

describe("PiMcpService", () => {
  describe("PiMcpService", () => {
    describe("connect()", () => {
      it("routes production HTTP transport through the desktop streaming network instead of page fetch https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const fixture = piMcpFixture();
        const sdk = jest.requireMock<{ McpClient: jest.Mock; StreamableHttpTransport: jest.Mock }>(
          "@earendil-works/pi-mcp"
        );
        sdk.McpClient.mockImplementation(() => fixture.options.sdk!.createClient(mcpConfig()));
        const service = new PiMcpService({ ...fixture.options, sdk: undefined });
        await service.connect("docs");
        const transportOptions = sdk.StreamableHttpTransport.mock.calls.at(-1)![0] as {
          fetch: typeof window.fetch;
        };
        const response = { status: 200 } as Response;
        jest.mocked(desktopProviderFetch).mockResolvedValueOnce(response);
        expect(await transportOptions.fetch("https://mcp.example.com/mcp")).toBe(response);
        expect(desktopProviderFetch).toHaveBeenCalledWith(
          expect.any(URL),
          expect.objectContaining({ redirect: "manual" })
        );
        await service.dispose();
      });

      it("loads actual client tools and reuses the connected catalog https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const fixture = piMcpFixture();
        const service = new PiMcpService(fixture.options);
        const changed = jest.fn();
        const unsubscribe = service.subscribe(changed);
        expect(service.getSnapshot()).toBe(service.getSnapshot());
        const catalog = await service.connect("docs");
        expect(catalog.snapshot.tools[0]?.toolName).toBe("echo");
        expect(await service.connect("docs")).toBe(catalog);
        expect(service.getClient("docs")).toBe(fixture.clients[0]);
        expect(service.getSnapshot()[0]).toMatchObject({ connection: "connected", toolCount: 1 });
        expect(changed).toHaveBeenCalled();
        unsubscribe();
        await service.dispose();
        expect(fixture.clients[0]?.close).toHaveBeenCalledTimes(1);
      });

      it("blocks disabled, unreviewed, removed and other-project servers https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const fixture = piMcpFixture([
          mcpConfig({ enabled: false }),
          mcpConfig({ serverId: "unreviewed", trusted: false }),
          mcpConfig({ serverId: "project", scope: "project", projectId: "other" }),
        ]);
        const service = new PiMcpService(fixture.options);
        for (const id of ["docs", "unreviewed", "project", "removed"])
          await expect(service.connect(id)).rejects.toThrow();
        expect(fixture.clients).toHaveLength(0);
        await service.dispose();
      });

      it("invalidates a disabled connection and prevents stale use before asynchronous close finishes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const fixture = piMcpFixture();
        const service = new PiMcpService(fixture.options);
        await service.connect("docs");
        const config = service.configs()[0];
        fixture.change([mcpConfig({ enabled: false })]);
        expect(service.isCurrent(config)).toBe(false);
        expect(service.getClient("docs")).toBeUndefined();
        await service.dispose();
        await expect(service.connect("docs")).rejects.toThrow();
      });
    });

    describe("disconnect()", () => {
      it("closes the client and removes its catalog https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const fixture = piMcpFixture();
        const service = new PiMcpService(fixture.options);
        await service.connect("docs");
        await service.disconnect("docs");
        expect(service.getClient("docs")).toBeUndefined();
        expect(service.getSnapshot()[0]).toMatchObject({ connection: "closed", toolCount: 0 });
        await service.dispose();
      });
    });

    describe("test()", () => {
      it("only connects, lists and closes without executing any external tool https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const fixture = piMcpFixture();
        const service = new PiMcpService(fixture.options);
        expect(await service.test("docs")).toMatchObject({ status: "connected", toolCount: 1 });
        expect(fixture.clients[0]?.callTool).not.toHaveBeenCalled();
        expect(fixture.clients[0]?.close).toHaveBeenCalledTimes(1);
        expect(service.getSnapshot()[0]?.test?.toolCount).toBe(1);
        await service.dispose();
      });
    });

    describe("authorize()", () => {
      it("saves browser authorization only in the keychain and removes it on signOut https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const fixture = piMcpFixture();
        jest.mocked(createPiMcpOAuthFlow).mockResolvedValue({
          begin: async () => ({
            redirectUrl: "http://127.0.0.1/callback",
            start: async () => ({ status: "AUTHORIZED", state: "state" }),
            tokens: async () => ({ accessToken: "private-token" }),
            waitForCallback: async () => ({ code: "code", state: "state" }),
            exchange: async () => ({ accessToken: "private-token" }),
            refresh: async () => undefined,
            close: async () => undefined,
          }),
        });
        const service = new PiMcpService(fixture.options);
        await service.authorize("docs");
        expect(service.getSnapshot()[0]?.oauth).toBe("authorized");
        expect([...fixture.secrets.values()].join()).toContain("private-token");
        expect(JSON.stringify(fixture.settings)).not.toContain("private-token");
        await service.signOut("docs");
        expect(fixture.secrets.size).toBe(0);
        await service.dispose();
      });
    });

    describe("cancelAuthorize()", () => {
      it("cancels a pending browser callback and leaves authorization actionable https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const fixture = piMcpFixture();
        let started!: () => void;
        const pending = new Promise<void>((resolve) => {
          started = resolve;
        });
        const closed = jest.fn(async () => undefined);
        jest.mocked(createPiMcpOAuthFlow).mockResolvedValue({
          begin: async () => ({
            redirectUrl: "http://127.0.0.1/callback",
            start: async () => {
              started();
              return { status: "REDIRECT", state: "state" };
            },
            tokens: async () => undefined,
            waitForCallback: () => new Promise(() => undefined),
            exchange: async () => ({ accessToken: "late" }),
            refresh: async () => undefined,
            close: closed,
          }),
        });
        const service = new PiMcpService(fixture.options);
        const run = service.authorize("docs");
        await pending;
        service.cancelAuthorize("docs");
        await run;
        expect(service.getSnapshot()[0]?.oauth).toBe("cancelled");
        expect(closed).toHaveBeenCalledTimes(1);
        expect(fixture.secrets.size).toBe(0);
        await service.dispose();
      });
    });
  });
});
