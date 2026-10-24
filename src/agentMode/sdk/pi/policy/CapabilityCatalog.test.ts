import { CapabilityCatalog, type CapabilityDefinition } from "./CapabilityCatalog";
import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";

const read: CapabilityDefinition = {
  toolId: "custom_read",
  family: "vault",
  effects: ["read"],
  allowedCallers: ["root", "subagent", "fanout"],
};
const write: CapabilityDefinition = {
  toolId: "custom_change",
  family: "vault",
  effects: ["write"],
  allowedCallers: ["root", "subagent"],
};

describe("CapabilityCatalog", () => {
  describe("CapabilityCatalog", () => {
    describe("setExecutionGate()", () => {
      it("replaces the current host boundary for existing tool definitions without retaining old authorization https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const catalog = new CapabilityCatalog();
        const api = { conversationId: 1, taskId: 2 } as ToolExecutionApi;
        catalog.setExecutionGate(async () => ({ caller: "root" }));
        expect(await catalog.checkExecution("read", {}, api, {} as Context)).toEqual({
          caller: "root",
        });
        catalog.setExecutionGate(async () => ({ caller: "root", block: "Recovery required" }));
        expect(await catalog.checkExecution("read", {}, api, {} as Context)).toEqual({
          caller: "root",
          block: "Recovery required",
        });
      });
    });
    describe("checkExecution()", () => {
      it("passes real task identity, arguments and cancellation context to the current execution gate https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const catalog = new CapabilityCatalog();
        const api = { conversationId: 1, taskId: 2 } as ToolExecutionApi;
        const context = { abortSignal: AbortSignal.abort() } as Context;
        expect(await catalog.checkExecution("read", {}, api, context)).toEqual({});
        const gate = jest.fn(async () => ({ block: "Cancelled" }));
        catalog.setExecutionGate(gate);
        expect(await catalog.checkExecution("read", { path: "note.md" }, api, context)).toEqual({
          block: "Cancelled",
        });
        expect(gate).toHaveBeenCalledWith("read", { path: "note.md" }, api, context);
      });
    });
    describe("register()", () => {
      it("uses the newest host definition instead of retaining old roles or effects https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const catalog = new CapabilityCatalog();
        catalog.register(read);
        expect(catalog.filter("custom_read", { caller: "fanout", mode: "plan" })).toBe(true);
        catalog.register({ ...read, effects: ["write"] });
        expect(catalog.filter("custom_read", { caller: "fanout", mode: "plan" })).toBe(false);
      });
    });
    describe("evaluate()", () => {
      it("derives plan and candidate visibility from actual effects and caller roles, regardless of names https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const catalog = new CapabilityCatalog();
        catalog.register(read);
        catalog.register(write);
        catalog.register({ ...write, toolId: "misleading_read_name" });
        expect(catalog.evaluate("custom_read", { caller: "fanout", mode: "plan" })).toEqual({
          available: true,
        });
        expect(
          catalog.evaluate("misleading_read_name", { caller: "root", mode: "plan" }).available
        ).toBe(false);
        expect(
          catalog.evaluate("custom_change", { caller: "root", mode: "default" }).available
        ).toBe(true);
      });

      it("rechecks service and scope availability whenever a nested or direct caller asks https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        let connected = true;
        const catalog = new CapabilityCatalog();
        catalog.register({
          ...read,
          checkAvailability: () => ({ available: connected, reason: "Service is disconnected" }),
        });
        expect(catalog.filter("custom_read", { caller: "subagent", mode: "default" })).toBe(true);
        connected = false;
        expect(catalog.evaluate("custom_read", { caller: "subagent", mode: "default" })).toEqual({
          available: false,
          reason: "Service is disconnected",
        });
      });
    });
    describe("filter()", () => {
      it("keeps unregistered tools and capabilities outside a profile intersection unavailable https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const catalog = new CapabilityCatalog();
        catalog.register(read);
        expect(catalog.filter("missing", { caller: "root", mode: "auto" })).toBe(false);
        expect(
          catalog.filter("custom_read", {
            caller: "subagent",
            mode: "default",
            allowedToolNames: [],
          })
        ).toBe(false);
      });
    });
    describe("snapshot()", () => {
      it("lists executable definitions and explicit unavailability reasons with shared empty slices https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const catalog = new CapabilityCatalog();
        catalog.register(read);
        catalog.register(write);
        const context = { caller: "root", mode: "plan" } as const;
        expect(
          catalog.snapshot(["custom_read", "custom_change", "custom_read"], context)
        ).toMatchObject({
          offeredTools: ["custom_read"],
          unavailableTools: [{ name: "custom_change", reason: expect.any(String) }],
        });
        expect(catalog.snapshot([], context).offeredTools).toBe(
          catalog.snapshot([], context).offeredTools
        );
      });
    });
  });
});
