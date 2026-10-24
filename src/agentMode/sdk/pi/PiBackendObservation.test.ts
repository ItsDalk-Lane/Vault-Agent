import { PiBackendProcess } from "./PiBackendProcess";
import { PiRuntime } from "./runtime/PiRuntime";
import type { PiHostOptions } from "./runtime/PiRuntime";
import type { BackendProcess } from "@/agentMode/session/types";

jest.mock("./runtime/PiRuntime", () => ({
  PiRuntime: jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    replay: jest.fn(async () => undefined),
    shutdown: jest.fn(async () => undefined),
  })),
}));

describe("PiBackendObservation", () => {
  describe("PiBackendProcess", () => {
    beforeEach(() => jest.clearAllMocks());

    describe("registerSessionHandler()", () => {
      it("receives updates without pinning every background chat writer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const backend = new PiBackendProcess({ host: {} as PiHostOptions });
        backend.registerSessionHandler("background-before-start", jest.fn());
        await backend.start();
        const runtime = jest.mocked(PiRuntime).mock.results[0].value;
        const detach = backend.registerSessionHandler("background-after-start", jest.fn());
        detach();
        expect(runtime.observe).not.toHaveBeenCalled();
        await backend.shutdown();
      });
    });

    describe("setSessionObserved()", () => {
      it("retains explicit visibility set before startup until the UI releases it https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const backend: BackendProcess = new PiBackendProcess({ host: {} as PiHostOptions });
        backend.setSessionObserved?.({ sessionId: "visible", observed: true });
        await backend.start?.();
        const runtime = jest.mocked(PiRuntime).mock.results[0].value;
        expect(runtime.observe).toHaveBeenCalledWith("visible", true);
        const detach = backend.registerSessionHandler("visible", jest.fn());
        detach();
        expect(runtime.observe).not.toHaveBeenCalledWith("visible", false);
        backend.setSessionObserved?.({ sessionId: "visible", observed: false });
        expect(runtime.observe).toHaveBeenLastCalledWith("visible", false);
        await backend.shutdown();
      });
    });
  });
});
