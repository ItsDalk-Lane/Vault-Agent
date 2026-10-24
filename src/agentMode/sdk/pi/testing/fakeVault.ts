// In-memory Vault stand-in for tests: it never touches the real filesystem, and it only
// accepts paths inside the fixture root: https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface FakeVaultReceipt {
  readonly path: string;
  readonly before: string | null;
  readonly after: string;
  readonly status: "created" | "modified";
}

export interface FakeVaultOptions {
  vaultRoot?: string;
  files?: Readonly<Record<string, string>>;
}

const DEFAULT_VAULT_ROOT = "/fixture/vault";

function normalizeFixturePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (normalized.length === 0 || normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error(`Refusing a path outside the fixture vault: ${path}`);
  }
  return normalized;
}

export class FakeVault {
  readonly vaultRoot: string;
  readonly reads: string[] = [];
  readonly writes: FakeVaultReceipt[] = [];
  private readonly notes = new Map<string, string>();

  constructor(options: FakeVaultOptions = {}) {
    this.vaultRoot = options.vaultRoot ?? DEFAULT_VAULT_ROOT;
    for (const [path, content] of Object.entries(options.files ?? {})) {
      this.notes.set(normalizeFixturePath(path), content);
    }
  }

  readNote(path: string): string | null {
    const normalized = normalizeFixturePath(path);
    this.reads.push(normalized);
    return this.notes.get(normalized) ?? null;
  }

  writeNote(path: string, content: string): FakeVaultReceipt {
    const normalized = normalizeFixturePath(path);
    const before = this.notes.get(normalized) ?? null;
    this.notes.set(normalized, content);
    const receipt: FakeVaultReceipt = {
      path: normalized,
      before,
      after: content,
      status: before === null ? "created" : "modified",
    };
    this.writes.push(receipt);
    return receipt;
  }

  listNotes(): string[] {
    return [...this.notes.keys()].sort();
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries([...this.notes.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}
