import type { MutationState } from "@/agentMode/sdk/pi/tools/MutationCoordinator";
import type { RevertReceipt, RevertSourceReceipt } from "@/agentMode/sdk/pi/tools/RevertMutation";

export type MutationEffect = "not_applied" | "applied" | "partially_applied" | "unknown";

export interface StoredMutation extends RevertSourceReceipt {
  readonly beforeHash: string | null;
  readonly committed: boolean;
  readonly state?: MutationState;
  readonly effect?: MutationEffect;
  readonly errorCode?: string;
  readonly createdFolders?: readonly string[];
  readonly linkedAfterBlobs?: Readonly<Record<string, string>>;
  readonly runId?: string;
  readonly commitOrder?: number;
}

export interface MutationJournal {
  readonly version: 1;
  readonly mutations: Record<string, StoredMutation>;
  readonly reverts: Record<string, RevertReceipt>;
}

export interface MutationJournalStore {
  load(): Promise<MutationJournal | null>;
  save(journal: MutationJournal): Promise<void>;
}
