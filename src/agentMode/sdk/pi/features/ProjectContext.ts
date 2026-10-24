// An agent session is bound to one projectId and scope for its whole life: the binding is created
// once, a project switch only affects a new root session (or an explicitly idle one) and never
// retargets an existing session's writes, a configuration that fails to save reports the failure
// instead of claiming the switch happened, and an approval keeps the scope it was created under:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface ProjectScopeBinding {
  readonly sessionId: string;
  readonly projectId: string;
  readonly rootId: string;
  readonly scopeId: string;
}

export interface ProjectContextPorts {
  readBinding(sessionId: string): Promise<ProjectScopeBinding | undefined>;
  createRoot(input: {
    readonly sessionId: string;
    readonly projectId: string;
    readonly scopeId: string;
  }): Promise<ProjectScopeBinding>;
  adjustScope(input: {
    readonly sessionId: string;
    readonly projectId: string;
    readonly scopeId: string;
  }): Promise<{ readonly ok: boolean; readonly error?: string }>;
  saveConfig(input: {
    readonly projectId: string;
    readonly scopeId: string;
  }): Promise<{ readonly ok: boolean; readonly error?: string }>;
  sessionState(sessionId: string): Promise<"idle" | "running">;
}

export type ProjectContextErrorCode =
  | "PROJECT_CONFIG_SAVE_FAILED"
  | "PROJECT_SWITCH_REQUIRES_IDLE"
  | "PROJECT_SCOPE_FAILED"
  | "PROJECT_UNKNOWN_SESSION";

export interface ProjectSwitchResult {
  readonly ok: boolean;
  readonly binding?: ProjectScopeBinding;
  readonly errorCode?: ProjectContextErrorCode;
  readonly message?: string;
}

export class ProjectContext {
  readonly #ports: ProjectContextPorts;
  readonly #bindings = new Map<string, ProjectScopeBinding>();
  readonly #approvals = new Map<string, ProjectScopeBinding>();

  constructor(options: { readonly ports: ProjectContextPorts }) {
    this.#ports = options.ports;
  }

  async bindingFor(sessionId: string): Promise<ProjectScopeBinding> {
    const cached = this.#bindings.get(sessionId);
    if (cached !== undefined) return cached;
    const stored = await this.#ports.readBinding(sessionId);
    if (stored !== undefined) {
      this.#bindings.set(sessionId, stored);
      return stored;
    }
    const created = await this.#ports.createRoot({
      sessionId,
      projectId: this.#currentProjectId ?? sessionId,
      scopeId: this.#currentScopeId ?? sessionId,
    });
    this.#bindings.set(sessionId, created);
    return created;
  }

  async switchProject(input: {
    readonly sessionId: string;
    readonly projectId: string;
    readonly scopeId: string;
  }): Promise<ProjectSwitchResult> {
    const state = await this.#ports.sessionState(input.sessionId);
    if (state !== "idle") {
      return Object.freeze({
        ok: false,
        errorCode: "PROJECT_SWITCH_REQUIRES_IDLE" as const,
        message: "A running session keeps its project and scope until it is idle.",
      });
    }
    const saved = await this.#ports.saveConfig({
      projectId: input.projectId,
      scopeId: input.scopeId,
    });
    if (!saved.ok) {
      return Object.freeze({
        ok: false,
        errorCode: "PROJECT_CONFIG_SAVE_FAILED" as const,
        message: saved.error ?? "The project configuration could not be saved.",
      });
    }
    const adjusted = await this.#ports.adjustScope({
      sessionId: input.sessionId,
      projectId: input.projectId,
      scopeId: input.scopeId,
    });
    if (!adjusted.ok) {
      return Object.freeze({
        ok: false,
        errorCode: "PROJECT_SCOPE_FAILED" as const,
        message: adjusted.error ?? "The session scope could not be adjusted.",
      });
    }
    this.#currentProjectId = input.projectId;
    this.#currentScopeId = input.scopeId;
    const cached = this.#bindings.get(input.sessionId);
    const binding =
      cached === undefined
        ? undefined
        : Object.freeze({
            ...cached,
            projectId: input.projectId,
            scopeId: input.scopeId,
          });
    if (binding !== undefined) this.#bindings.set(input.sessionId, binding);
    return Object.freeze({ ok: true, ...(binding !== undefined ? { binding } : {}) });
  }

  /** Records the scope an approval was created under; a later project switch cannot move it.
   * https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
   */
  async registerApproval(input: {
    readonly sessionId: string;
    readonly approvalId: string;
  }): Promise<ProjectScopeBinding> {
    const binding = await this.bindingFor(input.sessionId);
    this.#approvals.set(input.approvalId, binding);
    return binding;
  }

  approvalTarget(approvalId: string): ProjectScopeBinding | undefined {
    return this.#approvals.get(approvalId);
  }

  binding(sessionId: string): ProjectScopeBinding | undefined {
    return this.#bindings.get(sessionId);
  }

  #currentProjectId: string | undefined;
  #currentScopeId: string | undefined;
}
