import type { BackendId } from "@/agentMode/session/types";

export type { BackendId };

export interface SkillLocation {
  kind: "canonical";
}

export interface Skill {
  builtin?: boolean;
  name: string;
  description: string;
  filePath: string;
  dirPath: string;
  body: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string;
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  enabledAgents: BackendId[];
  location: SkillLocation;
  contentHash?: string;
  displayNameSuffix?: string;
}

export interface RejectedSkill {
  name: string;
  filePath: string;
  dirPath: string;
  reason: string;
  offendingText?: string;
}

export interface SkillDiscoveryResult<T> {
  accepted: T[];
  rejected: RejectedSkill[];
}
