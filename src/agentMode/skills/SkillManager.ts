import type { BuiltinPreferences } from "./builtin/reconcileBuiltinSkills";
import { ALL_MANAGED_SKILLS, isBuiltinSkillEnabledFor } from "@/builtinSkills/builtinSkills";
import { t } from "@/i18n";
import { logError, logInfo, logWarn } from "@/logger";
import { getSettings } from "@/settings/model";
import { getEffectiveSkillsFolder } from "@/settings/vaultAgentFolder";
import { publishSkillLoadErrorCount } from "@/settings/skillLoadErrorState";
import { atom, createStore, useAtomValue } from "jotai";
import { FileSystemAdapter, type App, type EventRef, type TAbstractFile } from "obsidian";
import { normalizeAbsPath } from "@/utils/pathUtils";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { DEFAULT_SKILLS_FOLDER } from "@/constants";
import { discoverManagedSkills, type SkillsFsAdapter } from "./discoverManagedSkills";
import { discoverProjectSkills, type ProjectSkillCandidate } from "./discoverProjectSkills";
import { compareSkills, mergeDiscovery } from "./mergeDiscovery";
import { createNodeProjectDiscoveryFs } from "./nodeFsAdapters";
import type { SkillFrontmatterPatch } from "./skillFormat";
import { runDeleteSkill, runToggleAgent } from "./toggleAgent";
import type { BackendId, RejectedSkill, Skill } from "./types";
import { runRenameSkill, runUpdateProperties } from "./updateProperties";

export interface BuiltinSkillRuntime {
  prepare(folder: string): Promise<void>;
  availableAgents(): readonly string[];
  savePreferences(
    update: (current: BuiltinPreferences) => BuiltinPreferences
  ): Promise<BuiltinPreferences>;
}

const RECONCILE_DEBOUNCE_MS = 250;

const skillManagerStore = createStore();
const skillsAtom = atom<Skill[]>([]);
const EMPTY_REJECTED_SKILLS = Object.freeze([]) as unknown as RejectedSkill[];
const rejectedSkillsAtom = atom<RejectedSkill[]>(EMPTY_REJECTED_SKILLS);
const lastScannedFolderAtom = atom<string>(DEFAULT_SKILLS_FOLDER);

export type SkillOperationFailureCode =
  | "no-vault-path"
  | "invalid"
  | "collision"
  | "eperm"
  | "fs-error";

export type SkillOperationResult<
  TCode extends SkillOperationFailureCode = SkillOperationFailureCode,
> = { ok: true } | { ok: false; code: TCode; message: string };

export type ToggleAgentResult = SkillOperationResult<"no-vault-path" | "eperm" | "fs-error">;

export type DeleteSkillResult = SkillOperationResult<"no-vault-path" | "fs-error">;

export type SavePropertiesResult = SkillOperationResult<
  "no-vault-path" | "invalid" | "collision" | "eperm" | "fs-error"
>;

export interface RefreshResult {
  ok: boolean;
  folder: string;
  skillCount: number;
  reconcileErrorCount: number;
  discoveryError?: string;
  reconcileError?: string;
}

export type SkillSetChangeListener = (backendId: BackendId, signature: string) => void;

export class SkillManager {
  private static instance: SkillManager | null = null;
  private inFlight: Promise<RefreshResult> | null = null;
  private inFlightFolder: string | null = null;
  private queuedRefresh = false;

  private vaultEventRefs: EventRef[] = [];
  private refreshDebounceTimer: number | null = null;
  private readonly skillSetSignatures = new Map<BackendId, string>();
  private readonly skillSetListeners = new Set<SkillSetChangeListener>();

  private constructor(
    private readonly app: App,
    private readonly builtinRuntime?: BuiltinSkillRuntime
  ) {}

  static initialize(app: App, builtinRuntime?: BuiltinSkillRuntime): SkillManager {
    if (SkillManager.instance === null) {
      SkillManager.instance = new SkillManager(app, builtinRuntime);
      SkillManager.instance.subscribeToVaultEvents();
    }
    return SkillManager.instance;
  }

  static getInstance(): SkillManager {
    if (SkillManager.instance === null) {
      throw new Error("SkillManager.getInstance called before initialize");
    }
    return SkillManager.instance;
  }

  static hasInstance(): boolean {
    return SkillManager.instance !== null;
  }

  static resetForTesting(): void {
    if (SkillManager.instance !== null) {
      SkillManager.instance.dispose();
    }
    SkillManager.instance = null;
    skillManagerStore.set(skillsAtom, []);
    skillManagerStore.set(rejectedSkillsAtom, EMPTY_REJECTED_SKILLS);
    publishSkillLoadErrorCount(0);
    skillManagerStore.set(lastScannedFolderAtom, DEFAULT_SKILLS_FOLDER);
  }

  dispose(): void {
    for (const ref of this.vaultEventRefs) {
      this.app.vault.offref(ref);
    }
    this.vaultEventRefs = [];
    if (this.refreshDebounceTimer !== null) {
      window.clearTimeout(this.refreshDebounceTimer);
      this.refreshDebounceTimer = null;
    }
    this.skillSetListeners.clear();
    this.skillSetSignatures.clear();
    this.inFlight = null;
    this.inFlightFolder = null;
    this.queuedRefresh = false;
    // The host-side error count outlives this manager across a hot reload. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
    publishSkillLoadErrorCount(0);
    if (SkillManager.instance === this) {
      SkillManager.instance = null;
    }
  }

  async refresh(force = false): Promise<RefreshResult> {
    const folder = resolveSkillsFolder();
    if (this.inFlight !== null) {
      if (force || this.inFlightFolder !== folder) {
        this.queuedRefresh = true;
      }
      return this.inFlight;
    }
    this.inFlight = Promise.resolve()
      .then(() => this.runRefreshLoop(folder))
      .finally(() => {
        this.inFlight = null;
        this.inFlightFolder = null;
        this.queuedRefresh = false;
      });
    return this.inFlight;
  }

  subscribeToSkillSetChange(listener: SkillSetChangeListener): () => void {
    this.skillSetListeners.add(listener);
    return () => this.skillSetListeners.delete(listener);
  }

  private async runRefreshLoop(initialFolder: string): Promise<RefreshResult> {
    let folder = initialFolder;
    let result: RefreshResult;
    do {
      this.queuedRefresh = false;
      this.inFlightFolder = folder;
      result = await this.runOnce(folder);
      if (this.queuedRefresh) {
        folder = resolveSkillsFolder();
      }
    } while (this.queuedRefresh);
    return result;
  }

  private async runOnce(folder: string): Promise<RefreshResult> {
    const absRoot = resolveAbsolutePath(this.app, folder);
    const adapter = createFsAdapter(this.app);
    const vaultRoot = resolveVaultRootAbs(this.app);

    try {
      let builtinError: string | undefined;
      try {
        if (this.builtinRuntime) await this.builtinRuntime.prepare(folder);
      } catch (error) {
        builtinError = error instanceof Error ? error.message : String(error);
      }
      const canonicalDiscovery = await discoverManagedSkills({
        skillsFolderRelPath: folder,
        skillsFolderAbsPath: absRoot,
        adapter,
      });

      let projectCandidates: ProjectSkillCandidate[] = [];
      let rejectedProjectSkills: RejectedSkill[] = [];
      if (vaultRoot !== null) {
        try {
          const projectDiscovery = await discoverProjectSkills({
            vaultRootAbsPath: vaultRoot,
            fs: createNodeProjectDiscoveryFs(),
          });
          projectCandidates = projectDiscovery.accepted;
          rejectedProjectSkills = projectDiscovery.rejected;
        } catch (err) {
          logWarn(
            `[skills] Project-skill walk failed: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      const settings = getSettings();
      const availableAgents = this.builtinRuntime?.availableAgents();
      const skills = mergeDiscovery(canonicalDiscovery.accepted, projectCandidates).map((skill) => {
        // Failed cleanup must not reactivate an opted-out skill through stale metadata. https://github.com/logancyang/obsidian-copilot/issues/3022
        if (!skill.builtin || !availableAgents) return skill;
        return {
          ...skill,
          enabledAgents: availableAgents.filter((agent) =>
            isBuiltinSkillEnabledFor(settings, skill.name, agent)
          ),
        };
      });
      const rejectedSkills =
        canonicalDiscovery.rejected.length === 0 && rejectedProjectSkills.length === 0
          ? EMPTY_REJECTED_SKILLS
          : canonicalDiscovery.rejected
              .concat(rejectedProjectSkills)
              .sort((a, b) => a.dirPath.localeCompare(b.dirPath));

      const reconcileErrorCount = builtinError ? 1 : 0;
      const reconcileError: string | undefined = builtinError;

      skillManagerStore.set(skillsAtom, skills);
      skillManagerStore.set(rejectedSkillsAtom, rejectedSkills);
      publishSkillLoadErrorCount(rejectedSkills.length);
      skillManagerStore.set(lastScannedFolderAtom, folder);
      this.publishSkillSetChanges(skills);
      logInfo(`[skills] Discovered ${skills.length} managed skill(s) under "${folder}"`);
      return {
        ok: true,
        folder,
        skillCount: skills.length,
        reconcileErrorCount,
        ...(reconcileError !== undefined ? { reconcileError } : {}),
      };
    } catch (err) {
      logError("[skills] Discovery pass failed", err);
      return {
        ok: false,
        folder,
        skillCount: 0,
        reconcileErrorCount: 0,
        discoveryError: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async setBuiltinSkillEnabled(
    name: string,
    enabled: boolean
  ): Promise<SkillOperationResult<"fs-error">> {
    // 单一启用开关恢复当前引擎，保留旧版本的其他代理偏好。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    return this.updateBuiltinPreference(name, (pref) => ({
      ...pref,
      disabled: !enabled,
      ...(enabled && pref.disabledAgents?.includes("pi")
        ? { disabledAgents: pref.disabledAgents.filter((agent) => agent !== "pi") }
        : {}),
    }));
  }

  private builtinMutation: Promise<unknown> = Promise.resolve();

  private async updateBuiltinPreference(
    name: string,
    update: (pref: BuiltinPreferences[string]) => BuiltinPreferences[string]
  ): Promise<SkillOperationResult<"fs-error">> {
    const operation = this.builtinMutation.then(
      async (): Promise<SkillOperationResult<"fs-error">> => {
        if (!this.builtinRuntime || !ALL_MANAGED_SKILLS.some((skill) => skill.name === name))
          return fsFailure(t("agentInfra.skills.manager.unknownBuiltin"));
        try {
          await this.inFlight;
          await this.builtinRuntime.savePreferences((preferences) => ({
            ...preferences,
            [name]: update(preferences[name] ?? {}),
          }));
          // A preference changed mid-discovery still needs a final pass. https://github.com/logancyang/obsidian-copilot/issues/3022
          if (this.inFlight) this.queuedRefresh = true;
          const result = await this.refresh();
          return result.ok && result.reconcileErrorCount === 0
            ? { ok: true }
            : fsFailure(
                result.reconcileError ??
                  result.discoveryError ??
                  t("agentInfra.skills.manager.builtinUpdateFailed")
              );
        } catch (error) {
          return fsFailure(error instanceof Error ? error.message : String(error));
        }
      }
    );
    this.builtinMutation = operation;
    return operation;
  }

  async setSkillEnabled(skill: Skill, enabled: boolean): Promise<ToggleAgentResult> {
    // 旧来源只供读取，启用与编辑只写当前技能库。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (skill.location.kind === "project")
      return fsFailure(t("agentInfra.skills.manager.legacyReadOnly"));
    if (skill.builtin) return this.setBuiltinSkillEnabled(skill.name, enabled);
    const agent = "pi";
    const vaultRoot = resolveVaultRootAbs(this.app);
    if (vaultRoot === null) {
      return noVaultPathFailure();
    }
    const folder = resolveSkillsFolder();
    if (resolveAbsolutePath(this.app, folder) === null) {
      return noVaultPathFailure();
    }

    const fs = createSkillFs();
    const result = await runToggleAgent({ skill, agent, enabled, fs });

    if (result.ok) {
      this.replaceManagedSkill(skill, {
        ...skill,
        enabledAgents: computeNextAgents(skill.enabledAgents, agent, enabled),
      });
    }
    return result.ok ? { ok: true } : failureFromReason(result.reason);
  }

  async deleteSkill(skill: Skill): Promise<DeleteSkillResult> {
    if (skill.builtin) return fsFailure(t("agentInfra.skills.manager.builtinImmutable"));
    // 旧来源保持只读，不能通过列表操作修改或删除原文件。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (skill.location.kind === "project")
      return fsFailure(t("agentInfra.skills.manager.legacyReadOnly"));
    const vaultRoot = resolveVaultRootAbs(this.app);
    if (vaultRoot === null) {
      return noVaultPathFailure();
    }
    const fs = createSkillFs();
    const result = await runDeleteSkill({ skill, fs });
    if (result.ok) {
      this.removeManagedSkill(skill);
    }
    return result.ok
      ? { ok: true }
      : fsFailure(result.reason ?? t("agentInfra.skills.manager.fsUnknown"));
  }

  async saveProperties(
    skill: Skill,
    req: {
      newName?: string;
      patch: Omit<SkillFrontmatterPatch, "name" | "enabledAgents">;
    }
  ): Promise<SavePropertiesResult> {
    if (skill.builtin) return fsFailure(t("agentInfra.skills.manager.builtinImmutable"));
    // 旧来源保持只读，不能通过列表操作修改或删除原文件。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (skill.location.kind === "project")
      return fsFailure(t("agentInfra.skills.manager.legacyReadOnly"));
    const fs = createSkillFs();
    const newName =
      req.newName !== undefined && req.newName !== skill.name ? req.newName : undefined;
    const vaultRoot = resolveVaultRootAbs(this.app);
    let activeSkill = skill;

    if (newName !== undefined) {
      if (vaultRoot === null) {
        return noVaultPathFailure();
      }
      const folder = resolveSkillsFolder();
      const canonical = resolveAbsolutePath(this.app, folder);
      if (canonical === null) {
        return noVaultPathFailure();
      }

      const renameResult = await runRenameSkill({
        skill,
        newName,
        canonicalAbsRoot: canonical,
        fs,
      });

      if (!renameResult.ok) {
        if (renameResult.reason === "invalid") {
          return {
            ok: false,
            code: "invalid",
            message: t("agentInfra.skills.manager.invalidName"),
          };
        }
        if (renameResult.reason === "collision") {
          return {
            ok: false,
            code: "collision",
            message: t("agentInfra.skills.manager.nameCollision"),
          };
        }
        if (renameResult.mutated === true) {
          void this.refresh();
        }
        return fsFailure(renameResult.reason);
      }

      activeSkill = buildRenamedSkill(skill, newName, canonical);
    }

    const patchResult = await runUpdateProperties({ skill: activeSkill, patch: req.patch, fs });
    if (!patchResult.ok) {
      if (newName !== undefined) {
        this.replaceManagedSkill(skill, activeSkill);
      }
      return fsFailure(patchResult.reason);
    }

    this.replaceManagedSkill(skill, applyPropertiesPatch(activeSkill, req.patch));
    return { ok: true };
  }

  private replaceManagedSkill(previous: Skill, next: Skill): void {
    const skills = skillManagerStore.get(skillsAtom);
    const index = skills.findIndex((s) => sameSkillIdentity(s, previous));
    const nextSkills =
      index === -1
        ? [...skills, next]
        : [...skills.slice(0, index), next, ...skills.slice(index + 1)];
    this.publishManagedSkills(sortSkills(nextSkills));
  }

  private removeManagedSkill(skill: Skill): void {
    const skills = skillManagerStore.get(skillsAtom);
    this.publishManagedSkills(skills.filter((s) => !sameSkillIdentity(s, skill)));
  }

  private publishManagedSkills(skills: Skill[]): void {
    skillManagerStore.set(skillsAtom, skills);
    this.publishSkillSetChanges(skills);
  }

  private subscribeToVaultEvents(): void {
    const handler = (file: TAbstractFile): void => {
      this.handleVaultEvent(file.path);
    };

    this.vaultEventRefs.push(this.app.vault.on("create", handler));
    this.vaultEventRefs.push(this.app.vault.on("delete", handler));
    this.vaultEventRefs.push(this.app.vault.on("modify", handler));
    this.vaultEventRefs.push(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        this.handleVaultEvent(file.path, oldPath);
      })
    );
  }

  private handleVaultEvent(newPath: string, oldPath?: string): void {
    if (this.isWatchedPath(newPath) || (oldPath !== undefined && this.isWatchedPath(oldPath))) {
      this.scheduleRefresh();
    }
  }

  private isWatchedPath(relPath: string): boolean {
    const path = normalizeRelPath(relPath);
    const folder = normalizeRelPath(resolveSkillsFolder());
    return path === folder || path.startsWith(`${folder}/`);
  }

  private clearScheduledRefresh(): void {
    if (this.refreshDebounceTimer === null) return;
    window.clearTimeout(this.refreshDebounceTimer);
    this.refreshDebounceTimer = null;
  }

  private scheduleRefresh(): void {
    this.clearScheduledRefresh();
    this.refreshDebounceTimer = window.setTimeout(() => {
      this.refreshDebounceTimer = null;
      void this.refresh();
    }, RECONCILE_DEBOUNCE_MS);
  }

  private publishSkillSetChanges(skills: Skill[]): void {
    const backendId = "pi";
    const signature = computeSkillSetSignature(skills, backendId);
    const prev = this.skillSetSignatures.get(backendId);
    if (prev === signature) return;
    this.skillSetSignatures.set(backendId, signature);
    if (prev === undefined && signature === EMPTY_SKILL_SET_SIGNATURE) return;
    logInfo(`[skills] Skill set changed for ${backendId}; signature=${signature}`);
    for (const listener of this.skillSetListeners) {
      try {
        listener(backendId, signature);
      } catch (err) {
        logError(`[skills] Skill-set listener failed for ${backendId}`, err);
      }
    }
  }
}

function resolveVaultRootAbs(app: App): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  return normalizeAbsPath(adapter.getBasePath());
}

export function useManagedSkills(): Skill[] {
  return useAtomValue(skillsAtom, { store: skillManagerStore });
}

export function useRejectedSkills(): RejectedSkill[] {
  return useAtomValue(rejectedSkillsAtom, { store: skillManagerStore });
}

export function getManagedSkills(): Skill[] {
  return skillManagerStore.get(skillsAtom);
}

function computeNextAgents(current: BackendId[], agent: BackendId, enabled: boolean): BackendId[] {
  const has = current.includes(agent);
  if (enabled && !has) return [...current, agent];
  if (!enabled && has) return current.filter((a) => a !== agent);
  return current;
}

function applyPropertiesPatch(
  skill: Skill,
  patch: Omit<SkillFrontmatterPatch, "name" | "enabledAgents">
): Skill {
  const next: Skill = { ...skill };
  if ("description" in patch && typeof patch.description === "string") {
    next.description = patch.description;
  }
  if ("license" in patch) next.license = patch.license;
  if ("compatibility" in patch) next.compatibility = patch.compatibility;
  if ("allowedTools" in patch) next.allowedTools = patch.allowedTools;
  if ("model" in patch) next.model = patch.model;
  if ("disableModelInvocation" in patch) {
    next.disableModelInvocation = patch.disableModelInvocation;
  }
  if ("userInvocable" in patch) next.userInvocable = patch.userInvocable;
  return next;
}

function buildRenamedSkill(skill: Skill, newName: string, canonicalAbsRoot: string): Skill {
  const root = normalizeAbsPath(canonicalAbsRoot);
  const dirPath = `${root}/${newName}`;
  return {
    ...skill,
    name: newName,
    dirPath,
    filePath: `${dirPath}/SKILL.md`,
  };
}

function sameSkillIdentity(a: Skill, b: Skill): boolean {
  return a.dirPath === b.dirPath;
}

function sortSkills(skills: Skill[]): Skill[] {
  return [...skills].sort(compareSkills);
}

const EMPTY_SKILL_SET_SIGNATURE = "skills:v1:0";

export function computeSkillSetSignature(skills: readonly Skill[], backendId: BackendId): string {
  if (skills.length === 0) return EMPTY_SKILL_SET_SIGNATURE;
  const rows = skills
    .map((skill) => {
      const enabled = skill.enabledAgents.includes(backendId) ? "1" : "0";
      return [
        skill.name,
        enabled,
        skill.description,
        skill.allowedTools ?? "",
        skill.model ?? "",
        String(skill.disableModelInvocation ?? false),
        String(skill.userInvocable ?? true),
        stableHash(skill.body),
      ].join("\u001f");
    })
    .sort();
  return `skills:v1:${stableHash(rows.join("\u001e"))}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function resolveSkillsFolder(): string {
  return getEffectiveSkillsFolder();
}

function resolveAbsolutePath(app: App, relFolder: string): string | null {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  const base = adapter.getBasePath().replace(/[/\\]+$/, "");
  return `${base}/${relFolder}`;
}

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function createFsAdapter(app: App): SkillsFsAdapter {
  const adapter = app.vault.adapter;
  return {
    exists: (rel) => adapter.exists(rel),
    list: (rel) => adapter.list(rel),
    read: (rel) => adapter.read(rel),
  };
}

function noVaultPathFailure(): { ok: false; code: "no-vault-path"; message: string } {
  return {
    ok: false,
    code: "no-vault-path",
    message: t("agentInfra.skills.manager.noVaultPath"),
  };
}

function createSkillFs(): {
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, content: string) => Promise<void>;
  exists: (p: string) => Promise<boolean>;
  rmRecursive: (p: string) => Promise<void>;
} {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  return {
    readFile: (p) => fs.promises.readFile(p, "utf-8"),
    writeFile: async (p, content) => {
      await fs.promises.writeFile(p, content, "utf-8");
    },
    exists: async (p) => {
      try {
        await fs.promises.lstat(p);
        return true;
      } catch {
        return false;
      }
    },
    rmRecursive: async (p) => {
      await fs.promises.rm(p, { recursive: true, force: true });
    },
  };
}

function fsFailure(message: string): { ok: false; code: "fs-error"; message: string } {
  return { ok: false, code: "fs-error", message };
}

function failureFromReason(reason: string): {
  ok: false;
  code: "eperm" | "fs-error";
  message: string;
} {
  if (reason === "eperm") {
    return { ok: false, code: "eperm", message: t("agentInfra.skills.manager.eperm") };
  }
  return fsFailure(reason);
}
