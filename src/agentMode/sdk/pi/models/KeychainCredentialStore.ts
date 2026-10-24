import type {
  ApiKeyCredential,
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";

import { md5 } from "@/utils/hash";

// Pi's CredentialStore over the plugin's existing KeychainService: one credential per
// provider instance, serialized read-modify-write for OAuth refresh, metadata-only
// listing, and explicit failures instead of JSON or environment fallbacks:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface KeychainPort {
  isAvailable(): boolean;
  getVaultId(): string;
  getSecretById(id: string): string | null;
  setSecretById(id: string, value: string): void;
  deleteSecretById(id: string): void;
}

export type CredentialStoreErrorCode =
  | "KEYCHAIN_UNAVAILABLE"
  | "INVALID_PROVIDER_ID"
  | "INVALID_CREDENTIAL_DATA"
  | "INVALID_INDEX_DATA";

export class CredentialStoreError extends Error {
  readonly code: CredentialStoreErrorCode;

  constructor(code: CredentialStoreErrorCode, message: string) {
    super(message);
    this.name = "CredentialStoreError";
    this.code = code;
  }
}

export interface KeychainCredentialStoreOptions {
  keychain: KeychainPort;
  namespace?: string;
}

interface CredentialIndex {
  readonly version: 1;
  readonly providers: Record<string, { readonly type: Credential["type"] }>;
}

const MAX_KEYCHAIN_ID_LENGTH = 64;
const INDEX_SUFFIX = "-credential-index";
const CREDENTIAL_SEGMENT = "-credential-";
const DEFAULT_NAMESPACE = "pi";

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function credentialKeychainId(
  vaultId: string,
  namespace: string,
  providerId: string
): string {
  const prefix = `copilot-v${vaultId}-${namespace}${CREDENTIAL_SEGMENT}`;
  const hash = md5(providerId).slice(0, 8);
  const budget = MAX_KEYCHAIN_ID_LENGTH - prefix.length - hash.length - 1;
  const slug = slugify(providerId).slice(0, Math.max(0, budget)).replace(/-+$/, "");
  return slug.length === 0 ? `${prefix}${hash}` : `${prefix}${slug}-${hash}`;
}

export function credentialIndexKeychainId(vaultId: string, namespace: string): string {
  return `copilot-v${vaultId}-${namespace}${INDEX_SUFFIX}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateCredential(value: unknown): Credential {
  if (!isRecord(value)) {
    throw new CredentialStoreError("INVALID_CREDENTIAL_DATA", "A credential must be an object.");
  }
  if (value.type === "api_key") {
    if (!isNonEmptyString(value.key)) {
      throw new CredentialStoreError(
        "INVALID_CREDENTIAL_DATA",
        "An api-key credential needs a non-empty key."
      );
    }
    if (value.env !== undefined) {
      if (!isRecord(value.env)) {
        throw new CredentialStoreError(
          "INVALID_CREDENTIAL_DATA",
          "The api-key credential env must be a record of strings."
        );
      }
      for (const envValue of Object.values(value.env)) {
        if (typeof envValue !== "string") {
          throw new CredentialStoreError(
            "INVALID_CREDENTIAL_DATA",
            "The api-key credential env must be a record of strings."
          );
        }
      }
    }
    const credential: ApiKeyCredential = { type: "api_key", key: value.key };
    if (isRecord(value.env)) {
      credential.env = value.env as ApiKeyCredential["env"];
    }
    return credential;
  }
  if (value.type === "oauth") {
    if (!isNonEmptyString(value.refresh) || !isNonEmptyString(value.access)) {
      throw new CredentialStoreError(
        "INVALID_CREDENTIAL_DATA",
        "An OAuth credential needs refresh and access tokens."
      );
    }
    if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) {
      throw new CredentialStoreError(
        "INVALID_CREDENTIAL_DATA",
        "An OAuth credential needs a finite expiry."
      );
    }
    return {
      ...value,
      type: "oauth",
      refresh: value.refresh,
      access: value.access,
      expires: value.expires,
    };
  }
  throw new CredentialStoreError(
    "INVALID_CREDENTIAL_DATA",
    "The credential type is not supported."
  );
}

function throwIfAborted(options: AuthOperationOptions | undefined): void {
  if (options?.signal?.aborted) {
    const error = new Error("The credential operation was aborted.");
    error.name = "AbortError";
    throw error;
  }
}

export class KeychainCredentialStore implements CredentialStore {
  private readonly keychain: KeychainPort;
  private readonly namespace: string;
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(options: KeychainCredentialStoreOptions) {
    const namespace = options.namespace ?? DEFAULT_NAMESPACE;
    if (!/^[a-z0-9-]+$/.test(namespace)) {
      throw new CredentialStoreError(
        "INVALID_PROVIDER_ID",
        "The credential namespace is not valid."
      );
    }
    this.keychain = options.keychain;
    this.namespace = namespace;
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    this.assertAvailable();
    throwIfAborted(options);
    return this.readStored(providerId);
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    this.assertAvailable();
    throwIfAborted(options);
    const index = this.readIndex();
    return Object.entries(index.providers).map(([providerId, info]) => ({
      providerId,
      type: info.type,
    }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions
  ): Promise<Credential | undefined> {
    return this.serialize(providerId, async () => {
      this.assertAvailable();
      throwIfAborted(options);
      const current = this.readStored(providerId);
      const next = await fn(current);
      if (next === undefined) return current;
      const credential = validateCredential(next);
      const index = this.readIndex();
      index.providers[providerId] = { type: credential.type };
      this.keychain.setSecretById(
        credentialKeychainId(this.keychain.getVaultId(), this.namespace, providerId),
        JSON.stringify(credential)
      );
      this.keychain.setSecretById(
        credentialIndexKeychainId(this.keychain.getVaultId(), this.namespace),
        JSON.stringify(index)
      );
      return credential;
    });
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.serialize(providerId, async () => {
      this.assertAvailable();
      throwIfAborted(options);
      this.keychain.deleteSecretById(
        credentialKeychainId(this.keychain.getVaultId(), this.namespace, providerId)
      );
      const index = this.readIndex();
      if (index.providers[providerId]) {
        delete index.providers[providerId];
        this.keychain.setSecretById(
          credentialIndexKeychainId(this.keychain.getVaultId(), this.namespace),
          JSON.stringify(index)
        );
      }
    });
  }

  private assertAvailable(): void {
    if (!this.keychain.isAvailable()) {
      throw new CredentialStoreError(
        "KEYCHAIN_UNAVAILABLE",
        "The OS keychain (SecretStorage) is unavailable; credentials cannot be stored."
      );
    }
  }

  private readStored(providerId: string): Credential | undefined {
    if (!isNonEmptyString(providerId)) {
      throw new CredentialStoreError("INVALID_PROVIDER_ID", "A provider id is required.");
    }
    const raw = this.keychain.getSecretById(
      credentialKeychainId(this.keychain.getVaultId(), this.namespace, providerId)
    );
    if (raw === null) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CredentialStoreError(
        "INVALID_CREDENTIAL_DATA",
        "The stored credential is not valid JSON."
      );
    }
    return validateCredential(parsed);
  }

  private readIndex(): CredentialIndex {
    const raw = this.keychain.getSecretById(
      credentialIndexKeychainId(this.keychain.getVaultId(), this.namespace)
    );
    if (raw === null) return { version: 1, providers: {} };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CredentialStoreError(
        "INVALID_INDEX_DATA",
        "The credential index is not valid JSON."
      );
    }
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !isRecord(parsed.providers) ||
      !Object.values(parsed.providers).every(
        (info) => isRecord(info) && (info.type === "api_key" || info.type === "oauth")
      )
    ) {
      throw new CredentialStoreError("INVALID_INDEX_DATA", "The credential index is malformed.");
    }
    return {
      version: 1,
      providers: parsed.providers as Record<string, { type: Credential["type"] }>,
    };
  }

  private serialize<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.chains.set(
      providerId,
      next.catch(() => undefined)
    );
    return next;
  }
}
