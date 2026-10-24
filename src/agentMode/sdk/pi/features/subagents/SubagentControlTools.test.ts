import {
  SubagentControlTools,
  type SubagentControlPort,
  type SubagentStatusView,
} from "@/agentMode/sdk/pi/features/subagents/SubagentControlTools";

const VIEW: SubagentStatusView = {
  taskId: "child",
  rootId: "root-1",
  profileId: "researcher",
  status: "queued",
  childConversationId: "conversation-2",
  startedAtMs: 1000,
};

function controlPort() {
  return {
    start: jest.fn<
      ReturnType<SubagentControlPort["start"]>,
      Parameters<SubagentControlPort["start"]>
    >(),
    status: jest.fn<
      ReturnType<SubagentControlPort["status"]>,
      Parameters<SubagentControlPort["status"]>
    >(async () => VIEW),
    list: jest.fn<ReturnType<SubagentControlPort["list"]>, Parameters<SubagentControlPort["list"]>>(
      async () => []
    ),
    result: jest.fn<
      ReturnType<SubagentControlPort["result"]>,
      Parameters<SubagentControlPort["result"]>
    >(async () => undefined),
    stop: jest.fn<ReturnType<SubagentControlPort["stop"]>, Parameters<SubagentControlPort["stop"]>>(
      async () => ({ ...VIEW, status: "terminal", endedAtMs: 2000 })
    ),
  };
}

function tools(port: SubagentControlPort): SubagentControlTools {
  return new SubagentControlTools({ port, rootId: "root-1" });
}

describe("SubagentControlTools", () => {
  describe("SubagentControlTools", () => {
    describe("registrations()", () => {
      it("exposes the same named configured model choices in the background schema https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const registration = new SubagentControlTools({
          port: controlPort(),
          rootId: "root",
          knownModels: [
            { modelKey: "model-uuid", displayName: "Review", providerDisplayName: "Local Studio" },
          ],
        })
          .registrations()
          .find((item) => item.toolId === "start_background_task");
        expect(registration?.parameters).toMatchObject({
          properties: {
            modelKey: {
              enum: ["model-uuid"],
              description: expect.stringContaining("Local Studio"),
            },
          },
        });
      });
      it("offers the same enabled role schema as foreground delegation without exposing disabled writer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const port = controlPort();
        expect(
          tools(port)
            .registrations()
            .find((item) => item.toolId === "start_background_task")?.parameters
        ).toMatchObject({
          properties: {
            profileId: {
              enum: ["researcher", "reviewer"],
              description: expect.stringContaining("Read-only"),
            },
          },
        });
        const enabled = new SubagentControlTools({
          port,
          rootId: "root",
          enabledProfiles: ["writer"],
        });
        expect(
          enabled.registrations().find((item) => item.toolId === "start_background_task")
            ?.parameters
        ).toMatchObject({
          properties: {
            profileId: {
              enum: ["writer"],
              description: expect.stringContaining("explicit user enablement"),
            },
          },
        });
      });

      it("declares the five control tools with safe start/send and unsafe stop", () => {
        const registrations = tools(controlPort()).registrations();

        expect(registrations.map((entry) => entry.toolId)).toEqual([
          "start_background_task",
          "get_subagent_result",
          "send_subagent_message",
          "stop_subagent",
          "list_subagents",
        ]);
        expect(registrations.find((entry) => entry.toolId === "stop_subagent")?.replayPolicy).toBe(
          "unsafe"
        );
        expect(
          registrations.find((entry) => entry.toolId === "start_background_task")?.replayPolicy
        ).toBe("idempotent");
        expect(
          registrations.find((entry) => entry.toolId === "get_subagent_result")?.replayPolicy
        ).toBe("read_only");
        expect(
          registrations.find((entry) => entry.toolId === "start_background_task")?.manifest
            .allowedCallers
        ).toEqual(["root"]);
      });
    });

    describe("getSubagentResult()", () => {
      it("returns the stored answer and its reference only after the owned task answered", async () => {
        const port = controlPort();
        const subject = new SubagentControlTools({ port, rootId: "root-1" });
        const missing = await subject.getSubagentResult({ taskId: "child" });
        expect(missing.details.errorCode).toBe("SUBAGENT_CONTROL_RESULT_NOT_READY");
        port.result.mockResolvedValue({
          answered: true,
          text: "Stored answer",
          entryId: "answer-1",
        });
        expect(await subject.getSubagentResult({ taskId: "child" })).toMatchObject({
          isError: false,
          output: [{ type: "text", text: "Stored answer" }],
          details: { taskId: "child", answerEntryId: "answer-1" },
        });
      });
      it("refuses unknown and foreign tasks before reading their answer", async () => {
        const port = controlPort();
        const subject = new SubagentControlTools({ port, rootId: "root-1" });
        port.status.mockResolvedValueOnce(undefined);
        expect((await subject.getSubagentResult({ taskId: "missing" })).details.errorCode).toBe(
          "SUBAGENT_CONTROL_UNKNOWN_TASK"
        );
        port.status.mockResolvedValueOnce({ ...VIEW, rootId: "other-root" });
        expect((await subject.getSubagentResult({ taskId: "foreign" })).details.errorCode).toBe(
          "SUBAGENT_CONTROL_FOREIGN_ROOT"
        );
        expect(port.result).not.toHaveBeenCalled();
      });
    });
    describe("listSubagents()", () => {
      it("lists only owned tasks and reports an empty list truthfully", async () => {
        const port = controlPort();
        const subject = new SubagentControlTools({ port, rootId: "root-1" });
        expect((await subject.listSubagents()).details.count).toBe(0);
        port.list.mockResolvedValue([VIEW, { ...VIEW, taskId: "foreign", rootId: "other-root" }]);
        expect((await subject.listSubagents()).details).toMatchObject({
          count: 1,
          subagents: [{ taskId: "child", status: "queued" }],
        });
      });
    });
    describe("stopSubagent()", () => {
      it("uses the actual owned-task stop result without inventing another run identity https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const port = controlPort();
        const subject = new SubagentControlTools({ port, rootId: "root-1" });
        const result = await subject.stopSubagent({ taskId: "child" });
        expect(port.stop).toHaveBeenCalledWith("child");
        expect(result).toMatchObject({
          isError: false,
          details: { taskId: "child", status: "terminal", endedAtMs: 2000 },
        });
        expect(JSON.stringify(result)).not.toContain("new run");
      });
    });
  });
});
