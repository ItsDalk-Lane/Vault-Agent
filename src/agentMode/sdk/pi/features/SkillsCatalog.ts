import type { BackendId } from "@/agentMode/session/types";
import { sha256 } from "@/utils/hash";

// The Pi skills catalog indexes the existing canonical skill store instead of creating a second one:
// it reads metadata only, derives a stable skillId plus content hash, scope and trust, keeps the
// user's enable/disable choices (a disabled skill is listed but never injected), reports a same-name
// conflict with an explicit source marker, loads the full instructions only when a skill is really
// used, and never creates an agent install directory or a symlink:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type SkillScope = "canonical" | "project";
export type SkillTrust = "builtin" | "user" | "project" | "third_party";

export interface SkillCatalogSource {
  readonly name: string;
  readonly description: string;
  readonly filePath: string;
  readonly dirPath: string;
  readonly body?: string;
  readonly builtin?: boolean;
  readonly enabledAgents: readonly BackendId[];
  readonly contentHash?: string;
  readonly location:
    | { readonly kind: "canonical" }
    | { readonly kind: "project"; readonly agentDirs: readonly BackendId[] };
}

export interface SkillCatalogSourcePort {
  listSkills(): Promise<readonly SkillCatalogSource[]>;
  readBody(skillPath: string): Promise<string>;
}

export interface SkillIndexEntry {
  readonly skillId: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly sourcePath: string;
  readonly dirPath: string;
  readonly contentHash: string;
  readonly scope: SkillScope;
  readonly trust: SkillTrust;
  readonly enabled: boolean;
  readonly builtin: boolean;
  readonly collision: boolean;
}

export interface SkillConflict {
  readonly name: string;
  readonly skillIds: readonly string[];
}

export interface SkillsCatalogSnapshot {
  readonly revision: number;
  readonly entries: readonly SkillIndexEntry[];
  readonly conflicts: readonly SkillConflict[];
}

export interface SkillsCatalogOptions {
  readonly source: SkillCatalogSourcePort;
  readonly engineId?: BackendId;
  readonly now?: () => number;
}

export interface LoadedSkillInstructions {
  readonly skillId: string;
  readonly contentHash: string;
  readonly text: string;
}

export class SkillsCatalogError extends Error {
  readonly code: "SKILL_UNKNOWN" | "SKILL_DISABLED";

  constructor(code: "SKILL_UNKNOWN" | "SKILL_DISABLED", message: string) {
    super(message);
    this.name = "SkillsCatalogError";
    this.code = code;
  }
}

export class SkillsCatalog {
  readonly #source: SkillCatalogSourcePort;
  readonly #engineId: BackendId;
  #snapshot: SkillsCatalogSnapshot = Object.freeze({
    revision: 0,
    entries: Object.freeze([]),
    conflicts: Object.freeze([]),
  });
  #revision = 0;

  constructor(options: SkillsCatalogOptions) {
    this.#source = options.source;
    this.#engineId = options.engineId ?? "pi";
  }

  get snapshot(): SkillsCatalogSnapshot {
    return this.#snapshot;
  }

  async refresh(): Promise<SkillsCatalogSnapshot> {
    const skills = await this.#source.listSkills();
    const nameCounts = new Map<string, number>();
    for (const skill of skills) {
      nameCounts.set(skill.name, (nameCounts.get(skill.name) ?? 0) + 1);
    }
    const entries: SkillIndexEntry[] = [];
    const usedIds = new Set<string>();
    for (const skill of skills) {
      const scope: SkillScope = skill.location.kind === "project" ? "project" : "canonical";
      const trust: SkillTrust = skill.builtin
        ? "builtin"
        : scope === "project"
          ? "project"
          : skill.enabledAgents.length > 0
            ? "user"
            : "third_party";
      const baseId = `${scope}:${slug(skill.name)}`;
      let skillId = baseId;
      let suffix = 2;
      while (usedIds.has(skillId)) {
        skillId = `${baseId}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(skillId);
      const collision = (nameCounts.get(skill.name) ?? 0) > 1;
      entries.push(
        Object.freeze({
          skillId,
          name: skill.name,
          displayName: collision ? `${skill.name} (${scope})` : skill.name,
          description: skill.description,
          sourcePath: skill.filePath,
          dirPath: skill.dirPath,
          contentHash: skill.contentHash ?? sha256(skill.body ?? ""),
          scope,
          trust,
          enabled: skill.enabledAgents.includes(this.#engineId),
          builtin: skill.builtin === true,
          collision,
        })
      );
    }
    const conflicts: SkillConflict[] = [];
    for (const [name, count] of nameCounts) {
      if (count < 2) continue;
      conflicts.push(
        Object.freeze({
          name,
          skillIds: Object.freeze(
            entries.filter((entry) => entry.name === name).map((entry) => entry.skillId)
          ),
        })
      );
    }
    this.#revision += 1;
    this.#snapshot = Object.freeze({
      revision: this.#revision,
      entries: Object.freeze(entries),
      conflicts: Object.freeze(conflicts),
    });
    return this.#snapshot;
  }

  enabledEntries(): readonly SkillIndexEntry[] {
    return Object.freeze(this.#snapshot.entries.filter((entry) => entry.enabled));
  }

  entry(skillId: string): SkillIndexEntry | undefined {
    return this.#snapshot.entries.find((entry) => entry.skillId === skillId);
  }

  async loadInstructions(skillId: string): Promise<LoadedSkillInstructions> {
    const entry = this.entry(skillId);
    if (entry === undefined) {
      throw new SkillsCatalogError("SKILL_UNKNOWN", `No indexed skill "${skillId}".`);
    }
    if (!entry.enabled) {
      throw new SkillsCatalogError(
        "SKILL_DISABLED",
        `The skill "${skillId}" is disabled for ${this.#engineId} and is not injected.`
      );
    }
    const text = await this.#source.readBody(entry.sourcePath);
    const contentHash = sha256(text);
    return Object.freeze({ skillId: entry.skillId, contentHash, text });
  }

  isStale(skillId: string, boundHash: string): boolean {
    const entry = this.entry(skillId);
    return entry === undefined || entry.contentHash !== boundHash;
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
