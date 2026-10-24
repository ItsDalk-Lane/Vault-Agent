import { sha256 } from "@/utils/hash";

// Captures the Vault events that happen during a rename/trash and compares each touched file with
// its pre-operation baseline. Only the paths this operation is expected to touch are attributed to
// the Agent; concurrent edits stay in the unattributed list for manual review:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type MoveFileEventType = "create" | "modify" | "delete" | "rename";

export interface MoveFileEvent {
  readonly type: MoveFileEventType;
  readonly path: string;
  readonly oldPath?: string;
}

export interface MoveEventSource {
  subscribe(listener: (event: MoveFileEvent) => void): () => void;
}

export interface CaptureVault {
  read(path: string): Promise<string>;
}

export interface CapturedFileChange {
  readonly path: string;
  readonly types: readonly MoveFileEventType[];
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly attributed: boolean;
}

export interface CaptureResult {
  readonly attributed: readonly CapturedFileChange[];
  readonly unattributed: readonly CapturedFileChange[];
}

export class LinkedChangeCapture {
  private readonly events: MoveEventSource;
  private readonly vault: CaptureVault;
  private unsubscribe: (() => void) | undefined;
  private captured: MoveFileEvent[] = [];
  private baselines: ReadonlyMap<string, string> = new Map();

  constructor(options: { readonly events: MoveEventSource; readonly vault: CaptureVault }) {
    this.events = options.events;
    this.vault = options.vault;
  }

  start(baselines: ReadonlyMap<string, string>): void {
    this.baselines = new Map(baselines);
    this.captured = [];
    this.unsubscribe?.();
    this.unsubscribe = this.events.subscribe((event) => {
      this.captured.push(event);
    });
  }

  async stop(expectedPaths: readonly string[]): Promise<CaptureResult> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    const paths = [...new Set(this.captured.map((event) => event.path))].sort();
    const changes: CapturedFileChange[] = [];
    for (const path of paths) {
      const types = [
        ...new Set(this.captured.filter((event) => event.path === path).map((event) => event.type)),
      ];
      let afterHash: string | null;
      try {
        afterHash = sha256(await this.vault.read(path));
      } catch {
        afterHash = null;
      }
      changes.push({
        path,
        types,
        beforeHash: this.baselines.get(path) ?? null,
        afterHash,
        attributed: expectedPaths.includes(path),
      });
    }
    return {
      attributed: changes.filter((change) => change.attributed),
      unattributed: changes.filter((change) => !change.attributed),
    };
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
