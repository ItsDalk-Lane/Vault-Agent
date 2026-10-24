import {
  COMMAND_NAMES,
  CommandDispatcher,
  type CommandPorts,
} from "@/agentMode/sdk/pi/features/CommandDispatcher";

// Slash commands dispatch explicitly to their real API: /compact compacts, /skill loads a skill,
// /stop stops, /model switches, an unknown command returns a readable error and nothing is ever
// handed to a shell:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeCommandPorts implements CommandPorts {
  readonly calls: string[] = [];
  compactOk = true;
  compactError: string | undefined;
  skillOk = true;

  compact = async (input: { sessionId: string }): Promise<{ ok: boolean; error?: string }> => {
    this.calls.push(`compact:${input.sessionId}`);
    return this.compactOk
      ? { ok: true }
      : { ok: false, ...(this.compactError !== undefined ? { error: this.compactError } : {}) };
  };

  loadSkill = async (input: {
    sessionId: string;
    skillId: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    this.calls.push(`skill:${input.sessionId}:${input.skillId}`);
    return { ok: this.skillOk };
  };

  stop = async (input: { sessionId: string }): Promise<void> => {
    this.calls.push(`stop:${input.sessionId}`);
  };

  switchModel = async (input: {
    sessionId: string;
    modelKey: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    this.calls.push(`model:${input.sessionId}:${input.modelKey}`);
    return { ok: true };
  };
}

function harness(): { ports: FakeCommandPorts; dispatcher: CommandDispatcher } {
  const ports = new FakeCommandPorts();
  return { ports, dispatcher: new CommandDispatcher({ ports }) };
}

describe("CommandDispatcher", () => {
  describe("CommandDispatcher", () => {
    describe("dispatch()", () => {
      it("reaches the real compaction API for /compact", async () => {
        const { ports, dispatcher } = harness();

        const result = await dispatcher.dispatch({ sessionId: "session-1", text: "/compact" });

        expect(result).toMatchObject({ handled: true, ok: true, command: "compact" });
        expect(ports.calls).toEqual(["compact:session-1"]);
      });

      it("reports a failing command with its message", async () => {
        const { ports, dispatcher } = harness();
        ports.compactOk = false;
        ports.compactError = "nothing to compact";

        const result = await dispatcher.dispatch({ sessionId: "session-1", text: "/compact" });

        expect(result).toMatchObject({ handled: true, ok: false, errorCode: "COMMAND_FAILED" });
        expect(result.message).toBe("nothing to compact");
      });

      it("dispatches skill, stop and model commands to their own ports", async () => {
        const { ports, dispatcher } = harness();

        const skill = await dispatcher.dispatch({
          sessionId: "session-1",
          text: "/skill canonical:summarize",
        });
        const stop = await dispatcher.dispatch({ sessionId: "session-1", text: "/stop" });
        const model = await dispatcher.dispatch({
          sessionId: "session-1",
          text: "/model anthropic/claude",
        });

        expect(skill).toMatchObject({ ok: true, command: "skill" });
        expect(stop).toMatchObject({ ok: true, command: "stop" });
        expect(model).toMatchObject({ ok: true, command: "model" });
        expect(ports.calls).toEqual([
          "skill:session-1:canonical:summarize",
          "stop:session-1",
          "model:session-1:anthropic/claude",
        ]);
      });

      it("asks for the missing argument instead of calling anything", async () => {
        const { ports, dispatcher } = harness();

        const skill = await dispatcher.dispatch({ sessionId: "session-1", text: "/skill" });
        const model = await dispatcher.dispatch({ sessionId: "session-1", text: "/model" });

        expect(skill).toMatchObject({ ok: false, errorCode: "COMMAND_ARGUMENT_MISSING" });
        expect(model).toMatchObject({ ok: false, errorCode: "COMMAND_ARGUMENT_MISSING" });
        expect(ports.calls).toEqual([]);
      });

      it("returns a readable error for an unknown slash command without running anything", async () => {
        const { ports, dispatcher } = harness();

        const result = await dispatcher.dispatch({
          sessionId: "session-1",
          text: "/rm -rf /",
        });

        expect(result).toMatchObject({ handled: true, ok: false, errorCode: "UNKNOWN_COMMAND" });
        expect(result.message).toContain('Unknown command "/rm"');
        expect(result.message).toContain("/compact");
        expect(COMMAND_NAMES).toEqual(["compact", "skill", "stop", "model"]);
        expect(ports.calls).toEqual([]);
      });

      it("passes ordinary text through instead of treating it as a command", async () => {
        const { ports, dispatcher } = harness();

        const result = await dispatcher.dispatch({
          sessionId: "session-1",
          text: "summarize my note",
        });

        expect(result).toEqual({ handled: false, ok: false });
        expect(ports.calls).toEqual([]);
      });
    });
  });
});
