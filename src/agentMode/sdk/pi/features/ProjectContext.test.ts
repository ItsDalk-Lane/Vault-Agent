import {
  ProjectContext,
  type ProjectContextPorts,
  type ProjectScopeBinding,
} from "@/agentMode/sdk/pi/features/ProjectContext";

// A session keeps one projectId/scope for its whole life, a project switch only reaches a new root or
// an idle session and never retargets existing writes, a failed configuration save is reported
// instead of a fake success, and an approval stays bound to the scope it was created under:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeProjectPorts implements ProjectContextPorts {
  readonly stored = new Map<string, ProjectScopeBinding>();
  readonly created: Array<{ sessionId: string; projectId: string; scopeId: string }> = [];
  readonly saves: Array<{ projectId: string; scopeId: string }> = [];
  readonly adjustments: Array<{ sessionId: string; projectId: string; scopeId: string }> = [];
  state: "idle" | "running" = "idle";
  saveOk = true;
  adjustOk = true;
  private nextRoot = 1;

  readBinding = async (sessionId: string): Promise<ProjectScopeBinding | undefined> =>
    this.stored.get(sessionId);

  createRoot = async (input: {
    sessionId: string;
    projectId: string;
    scopeId: string;
  }): Promise<ProjectScopeBinding> => {
    this.created.push({ ...input });
    const binding: ProjectScopeBinding = {
      sessionId: input.sessionId,
      projectId: input.projectId,
      rootId: `root-${this.nextRoot++}`,
      scopeId: input.scopeId,
    };
    this.stored.set(input.sessionId, binding);
    return binding;
  };

  adjustScope = async (input: {
    sessionId: string;
    projectId: string;
    scopeId: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    this.adjustments.push({ ...input });
    if (!this.adjustOk) return { ok: false, error: "scope denied" };
    const previous = this.stored.get(input.sessionId);
    if (previous !== undefined) {
      this.stored.set(input.sessionId, {
        ...previous,
        projectId: input.projectId,
        scopeId: input.scopeId,
      });
    }
    return { ok: true };
  };

  saveConfig = async (input: {
    projectId: string;
    scopeId: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    this.saves.push({ ...input });
    return this.saveOk ? { ok: true } : { ok: false, error: "disk full" };
  };

  sessionState = async (): Promise<"idle" | "running"> => this.state;
}

function harness(): { ports: FakeProjectPorts; context: ProjectContext } {
  const ports = new FakeProjectPorts();
  return { ports, context: new ProjectContext({ ports }) };
}

describe("ProjectContext", () => {
  describe("ProjectContext", () => {
    describe("bindingFor()", () => {
      it("creates one binding per session and keeps it afterwards", async () => {
        const { ports, context } = harness();

        const first = await context.bindingFor("session-1");
        const second = await context.bindingFor("session-1");

        expect(second).toBe(first);
        expect(ports.created).toEqual([
          { sessionId: "session-1", projectId: "session-1", scopeId: "session-1" },
        ]);
        expect(first.rootId).toBe("root-1");
      });

      it("reuses a binding that was persisted earlier", async () => {
        const { ports, context } = harness();
        ports.stored.set("session-1", {
          sessionId: "session-1",
          projectId: "project-a",
          rootId: "root-existing",
          scopeId: "scope-a",
        });

        const binding = await context.bindingFor("session-1");

        expect(binding).toMatchObject({ projectId: "project-a", rootId: "root-existing" });
        expect(ports.created).toEqual([]);
      });
    });

    describe("switchProject()", () => {
      it("keeps a running session on its original project and scope", async () => {
        const { ports, context } = harness();
        const original = await context.bindingFor("session-1");
        ports.state = "running";

        const result = await context.switchProject({
          sessionId: "session-1",
          projectId: "project-b",
          scopeId: "scope-b",
        });

        expect(result).toMatchObject({ ok: false, errorCode: "PROJECT_SWITCH_REQUIRES_IDLE" });
        expect(ports.saves).toEqual([]);
        expect(context.binding("session-1")).toBe(original);
        expect(context.approvalTarget("none")).toBeUndefined();
      });

      it("does not claim success when the configuration cannot be saved", async () => {
        const { ports, context } = harness();
        await context.bindingFor("session-1");
        ports.saveOk = false;

        const result = await context.switchProject({
          sessionId: "session-1",
          projectId: "project-b",
          scopeId: "scope-b",
        });

        expect(result).toMatchObject({ ok: false, errorCode: "PROJECT_CONFIG_SAVE_FAILED" });
        expect(result.message).toBe("disk full");
        expect(ports.adjustments).toEqual([]);
        expect(context.binding("session-1")?.projectId).toBe("session-1");
      });

      it("reports a failed scope adjustment without pretending the switch happened", async () => {
        const { ports, context } = harness();
        await context.bindingFor("session-1");
        ports.adjustOk = false;

        const result = await context.switchProject({
          sessionId: "session-1",
          projectId: "project-b",
          scopeId: "scope-b",
        });

        expect(result).toMatchObject({ ok: false, errorCode: "PROJECT_SCOPE_FAILED" });
        expect(context.binding("session-1")?.projectId).toBe("session-1");
      });

      it("switches an idle session and leaves earlier sessions on their own scope", async () => {
        const { ports, context } = harness();
        const first = await context.bindingFor("session-1");
        const second = await context.bindingFor("session-2");

        const result = await context.switchProject({
          sessionId: "session-1",
          projectId: "project-b",
          scopeId: "scope-b",
        });

        expect(result).toMatchObject({ ok: true });
        expect(ports.saves).toEqual([{ projectId: "project-b", scopeId: "scope-b" }]);
        expect(ports.adjustments).toEqual([
          { sessionId: "session-1", projectId: "project-b", scopeId: "scope-b" },
        ]);
        expect(context.binding("session-1")).toMatchObject({ projectId: "project-b" });
        expect(context.binding("session-2")).toBe(second);
        expect(context.binding("session-2")?.projectId).toBe("session-2");
        expect(first.rootId).toBe("root-1");

        const third = await context.bindingFor("session-3");
        expect(third).toMatchObject({ projectId: "project-b", scopeId: "scope-b" });
      });
    });

    describe("registerApproval()", () => {
      it("keeps an old approval bound to its original scope after a project switch", async () => {
        const { ports, context } = harness();
        await context.bindingFor("session-1");
        const approval = await context.registerApproval({
          sessionId: "session-1",
          approvalId: "approval-1",
        });
        ports.state = "idle";

        await context.switchProject({
          sessionId: "session-1",
          projectId: "project-b",
          scopeId: "scope-b",
        });

        expect(approval.projectId).toBe("session-1");
        expect(context.approvalTarget("approval-1")).toMatchObject({
          projectId: "session-1",
          scopeId: "session-1",
        });
        expect(context.approvalTarget("approval-1")?.rootId).toBe(approval.rootId);
      });
    });
  });
});
