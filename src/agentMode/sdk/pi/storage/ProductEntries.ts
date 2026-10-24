import {
  PRODUCT_DOC_VERSION,
  parseProductDoc,
  type ProductDoc,
  type ProductDocKind,
} from "./ProductDocs";

// Product state changes are committed with their va.state passive entry in one durable
// commit: reads happen first, the entry revision always matches the document revision, and
// a failed commit leaves no half state: https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface ProductStateEntry {
  readonly kind: "va.state";
  readonly data: {
    readonly docKind: ProductDocKind;
    readonly revision: number;
    readonly change: "created" | "updated";
    readonly atMs: number;
  };
}

export type ProductDocReader = (kind: ProductDocKind) => Promise<ProductDoc | null>;

export type ProductCommitPort = (change: {
  readonly doc: ProductDoc;
  readonly entry: ProductStateEntry;
}) => Promise<void>;

export interface CommitProductDocChangeOptions {
  kind: ProductDocKind;
  reader: ProductDocReader;
  commit: ProductCommitPort;
  build: (previous: ProductDoc | null) => ProductDoc;
  now: () => number;
}

export interface CommittedProductChange {
  readonly doc: ProductDoc;
  readonly entry: ProductStateEntry;
}

export type ProductEntryErrorCode = "INVALID_STATE_CHANGE";

export class ProductEntryError extends Error {
  readonly code: ProductEntryErrorCode;

  constructor(code: ProductEntryErrorCode, message: string) {
    super(message);
    this.name = "ProductEntryError";
    this.code = code;
  }
}

export async function commitProductDocChange(
  options: CommitProductDocChangeOptions
): Promise<CommittedProductChange> {
  const previous = await options.reader(options.kind);

  const built = options.build(previous);
  if (built.kind !== options.kind) {
    throw new ProductEntryError(
      "INVALID_STATE_CHANGE",
      `The builder returned ${built.kind} while committing ${options.kind}.`
    );
  }

  const atMs = options.now();
  const candidate: ProductDoc = {
    ...built,
    version: PRODUCT_DOC_VERSION,
    revision: (previous?.revision ?? 0) + 1,
    updatedAtMs: atMs,
  };
  const parsed = parseProductDoc(candidate);
  if (parsed.kind !== "ok") {
    throw new ProductEntryError(
      "INVALID_STATE_CHANGE",
      `The next ${options.kind} document is not a valid version 1 document.`
    );
  }
  const doc = parsed.doc;

  const entry: ProductStateEntry = {
    kind: "va.state",
    data: {
      docKind: doc.kind,
      revision: doc.revision,
      change: previous === null ? "created" : "updated",
      atMs,
    },
  };

  await options.commit({ doc, entry });
  return { doc, entry };
}
