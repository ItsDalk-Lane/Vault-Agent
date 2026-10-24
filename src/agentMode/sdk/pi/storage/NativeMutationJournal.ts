import type { JsonObject } from "@earendil-works/pi-durable";

export interface NativeMutationJournal {
  readonly version: 1;
  readonly records: Record<string, JsonObject>;
  readonly imports: Record<string, string>;
}

export interface NativeMutationJournalStore {
  load(): Promise<NativeMutationJournal | null>;
  save(journal: NativeMutationJournal): Promise<void>;
}
