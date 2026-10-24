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
  readonly legacyJournalImport?: {
    readonly source: "mutations/journal.json";
    readonly sha256: string;
    readonly schemaVersion: number;
    readonly mutationCount: number;
    readonly revertCount: number;
    readonly status: "imported";
    readonly importedAtMs: number;
  };
  readonly operationIdentityVersion?: 2;
  readonly legacyTaskOperations?: Record<
    string,
    { readonly operationId: string; readonly toolId: string; readonly arguments: unknown }
  >;
  readonly ambiguousLegacyTasks?: readonly string[];
}

export interface MutationJournalStore {
  load(): Promise<MutationJournal | null>;
  save(journal: MutationJournal): Promise<void>;
  migrateOperationIdentities?(journal: MutationJournal): Promise<MutationJournal>;
}
