import { requireNodeModule } from "@/utils/desktopRuntime";
import { secretMetaId, type SecretMetaEntry } from "@/services/keychainService";

export interface LocalDataPaths {
  dataRoot: string;
  sessionsRoot: string;
  indexPath: string;
  deletionsRoot: string;
  logsRoot: string;
  tempRoot: string;
}

export interface LocalDataLegacyPath {
  name: string;
  path: string;
}

interface FileSizes {
  bytes: number;
  attachments: number;
  backups: number;
  transcripts: number;
  recovery: number;
  metadata: number;
  children: number;
  docFileCount: number;
}

export interface LocalDataEntry extends FileSizes {
  id: string;
  title: string;
  path: string;
}

export interface LocalDataStatus {
  totalBytes: number;
  totalSessionCount: number;
  sessions: LocalDataEntry[];
  indexBytes: number;
  indexCount: number;
  settingsBytes: number;
  logsBytes: number;
  tempBytes: number;
  pendingBytes: number;
  legacyPaths: readonly LocalDataLegacyPath[];
}

export interface LocalKeychainCounts {
  providers: number;
  mcp: number;
  other: number;
}

const EMPTY_FILE_SIZES: Readonly<FileSizes> = Object.freeze({
  bytes: 0,
  attachments: 0,
  backups: 0,
  transcripts: 0,
  recovery: 0,
  metadata: 0,
  children: 0,
  docFileCount: 0,
});
const SESSION_ID = /^root-[A-Za-z0-9_-]+$/;
const EMPTY_DIRECTORY_ENTRIES: readonly import("node:fs").Dirent[] = Object.freeze([]);
const EMPTY_LEGACY_PATHS: readonly LocalDataLegacyPath[] = Object.freeze([]);

async function findLegacyDataSiblings(dataRoot: string): Promise<readonly LocalDataLegacyPath[]> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  // 旧版目录与统计根同级，只列出不测量：读取它们的大小会违背“仅统计本版本”的口径，
  // 而同级链接可能指向任意位置，所以链接与隐藏条目一律跳过，目录读取失败按无遗留处理。
  // https://github.com/ItsDalk-Lane/Vault-Agent/issues/8
  let entries: readonly import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(path.dirname(dataRoot), { withFileTypes: true });
  } catch {
    return EMPTY_LEGACY_PATHS;
  }
  const current = path.basename(dataRoot);
  const parent = path.dirname(dataRoot);
  const siblings = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        entry.name !== current &&
        !entry.name.startsWith(".")
    )
    .map((entry) => ({ name: entry.name, path: path.join(parent, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return Object.freeze(siblings);
}

async function statLocalData(
  target: string,
  dataRoot: string
): Promise<import("node:fs").Stats | undefined> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const relative = path.relative(dataRoot, target);
  // 必须从管理根逐层检查，不能先穿过上层链接再检查最终文件。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  if (path.isAbsolute(relative) || relative.split(path.sep).includes("..")) return undefined;
  let current = dataRoot;
  let info: import("node:fs").Stats | undefined;
  try {
    for (const part of ["", ...relative.split(path.sep)]) {
      current = path.join(current, part);
      info = await fs.lstat(current);
      if (info.isSymbolicLink()) return undefined;
    }
    return info;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readLocalDirectory(
  target: string,
  dataRoot: string
): Promise<readonly import("node:fs").Dirent[]> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  try {
    // 目录快捷链接不能把其他位置的数据带入本地统计。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (!(await statLocalData(target, dataRoot))?.isDirectory()) return EMPTY_DIRECTORY_ENTRIES;
    return await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_DIRECTORY_ENTRIES;
    throw error;
  }
}

async function readLocalJson<T>(target: string, dataRoot: string): Promise<T | undefined> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  try {
    // 元信息与索引遵循同一统计口径，不能读取快捷链接指向的原件。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (!(await statLocalData(target, dataRoot))?.isFile()) return undefined;
    return JSON.parse(await fs.readFile(target, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function measureFileTree(target: string, relative = ""): Promise<Readonly<FileSizes>> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  try {
    const info = await fs.lstat(target);
    // 统计期间允许删除会话，符号链接也不能把库外无关文件算进来。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (info.isSymbolicLink()) return EMPTY_FILE_SIZES;
    if (info.isFile()) {
      // 会话内容按相对路径归类：attachments 与 blobs 优先于 children 判定，剩余文件都算对话记录。
      // https://github.com/ItsDalk-Lane/Vault-Agent/issues/8
      const attachments = /^(?:children\/root-[A-Za-z0-9_-]+\/)*attachments\//.test(relative)
        ? info.size
        : 0;
      const backups = /^(?:children\/root-[A-Za-z0-9_-]+\/)*mutations\/blobs\//.test(relative)
        ? info.size
        : 0;
      const recovery = /(?:^|\/)recovery-view\.json\/?$/.test(relative) ? info.size : 0;
      const metadata = /(?:^|\/)(?:session|meta)\.json\/?$/.test(relative) ? info.size : 0;
      const children = /^children\//.test(relative)
        ? info.size - attachments - backups - recovery - metadata
        : 0;
      return {
        bytes: info.size,
        attachments,
        backups,
        transcripts: info.size - attachments - backups - recovery - metadata - children,
        recovery,
        metadata,
        children,
        docFileCount: /(?:^|\/)doc-\d+\.jsonl\/?$/.test(relative) ? 1 : 0,
      };
    }
    if (!info.isDirectory()) return EMPTY_FILE_SIZES;
    const entries = await fs.readdir(target);
    const sizes = { ...EMPTY_FILE_SIZES };
    for (const entry of entries) {
      const value = await measureFileTree(path.join(target, entry), `${relative}${entry}/`);
      for (const key of Object.keys(sizes) as readonly (keyof FileSizes)[]) {
        sizes[key] += value[key];
      }
    }
    return sizes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_FILE_SIZES;
    throw error;
  }
}

export async function measureLocalFiles(target: string): Promise<number> {
  return (await measureFileTree(target)).bytes;
}

export async function collectLocalData(
  paths: LocalDataPaths,
  settingsPath: string
): Promise<LocalDataStatus> {
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const directories = await readLocalDirectory(paths.sessionsRoot, paths.dataRoot);
  const sessions: LocalDataEntry[] = [];
  for (const directory of directories) {
    // 仅列出新版会话记录，不扫描旧格式或尚未完成的分叉。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    if (!directory.isDirectory() || !SESSION_ID.test(directory.name)) continue;
    const target = path.join(paths.sessionsRoot, directory.name);
    const metadata = await readLocalJson<{ title?: string | null }>(
      path.join(target, "session.json"),
      paths.dataRoot
    );
    if (!metadata) continue;
    const sizes = await measureFileTree(target);
    sessions.push({
      id: directory.name,
      title: metadata.title ?? directory.name,
      path: target,
      ...sizes,
    });
  }
  sessions.sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
  const vaultsRoot = path.join(paths.dataRoot, "vaults");
  let totalSessionCount = 0;
  for (const vault of await readLocalDirectory(vaultsRoot, paths.dataRoot)) {
    if (!vault.isDirectory()) continue;
    const root = path.join(vaultsRoot, vault.name, "sessions");
    for (const session of await readLocalDirectory(root, paths.dataRoot)) {
      if (!session.isDirectory() || !SESSION_ID.test(session.name)) continue;
      if (await readLocalJson(path.join(root, session.name, "session.json"), paths.dataRoot))
        totalSessionCount++;
    }
  }
  const index = await readLocalJson<{ entries?: unknown[] }>(paths.indexPath, paths.dataRoot);
  const indexCount = Array.isArray(index?.entries) ? index.entries.length : 0;
  const measureDataPath = async (target: string) =>
    (await statLocalData(target, paths.dataRoot)) ? measureLocalFiles(target) : 0;
  const [totalBytes, indexBytes, settingsBytes, logsBytes, tempBytes, pendingBytes, legacyPaths] =
    await Promise.all([
      measureDataPath(paths.dataRoot),
      measureDataPath(paths.indexPath),
      measureLocalFiles(settingsPath),
      measureDataPath(paths.logsRoot),
      measureDataPath(paths.tempRoot),
      measureDataPath(paths.deletionsRoot),
      findLegacyDataSiblings(paths.dataRoot),
    ]);
  return {
    totalBytes,
    totalSessionCount,
    sessions,
    indexBytes,
    indexCount,
    settingsBytes,
    logsBytes,
    tempBytes,
    pendingBytes,
    legacyPaths,
  };
}

export interface LocalKeychainEntryDetail {
  id: string;
  label?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface LocalKeychainEntryGroups {
  providers: readonly LocalKeychainEntryDetail[];
  mcp: readonly LocalKeychainEntryDetail[];
  other: readonly LocalKeychainEntryDetail[];
}

export interface LocalKeychainProviderRef {
  apiKeyKeychainId?: string | null;
  displayName: string;
}

export type LocalKeychainSecretMeta = Readonly<Record<string, SecretMetaEntry>>;

function detailFor(
  id: string,
  label: string | undefined,
  secretMeta: LocalKeychainSecretMeta
): LocalKeychainEntryDetail {
  const meta = secretMeta[id];
  return {
    id,
    ...(label === undefined ? {} : { label }),
    ...(meta?.createdAt === undefined ? {} : { createdAt: meta.createdAt }),
    ...(meta?.updatedAt === undefined ? {} : { updatedAt: meta.updatedAt }),
  };
}

export function describeLocalKeychainEntries(
  ids: readonly string[],
  vaultId: string,
  providers: readonly LocalKeychainProviderRef[] = [],
  mcpServers: readonly unknown[] = [],
  secretMeta: LocalKeychainSecretMeta = {}
): LocalKeychainEntryGroups {
  const vaultPrefix = `copilot-v${vaultId}-`;
  const providerLabels = new Map(
    providers
      .filter((provider) => typeof provider.apiKeyKeychainId === "string")
      .map((provider) => [provider.apiKeyKeychainId as string, provider.displayName])
  );
  const mcpLabels = new Map<string, string>();
  const referencedMcpSecrets = new Set<string>();
  // 共享令牌没有库前缀，只统计当前库明确引用的条目，且不读取密钥值。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  for (const server of mcpServers) {
    if (!server || typeof server !== "object") continue;
    const displayName = (server as { displayName?: unknown }).displayName;
    const transport = (server as { transport?: unknown }).transport;
    if (!transport || typeof transport !== "object") continue;
    for (const key of ["headerSecretRefs", "envSecretRefs"] as const) {
      const refs = (transport as Record<string, unknown>)[key];
      if (!refs || typeof refs !== "object") continue;
      for (const [refKey, ref] of Object.entries(refs)) {
        if (typeof ref !== "string") continue;
        referencedMcpSecrets.add(ref);
        if (typeof displayName === "string" && !mcpLabels.has(ref)) {
          mcpLabels.set(ref, `${displayName} · ${refKey}`);
        }
      }
    }
    const oauth = (transport as { oauth?: unknown }).oauth;
    const tokenSecretRef =
      oauth && typeof oauth === "object"
        ? (oauth as { tokenSecretRef?: unknown }).tokenSecretRef
        : undefined;
    if (typeof tokenSecretRef === "string" && typeof displayName === "string") {
      mcpLabels.set(tokenSecretRef, `${displayName} · oauth`);
    }
  }
  const metaId = secretMetaId(vaultId);
  const groups: {
    providers: LocalKeychainEntryDetail[];
    mcp: LocalKeychainEntryDetail[];
    other: LocalKeychainEntryDetail[];
  } = { providers: [], mcp: [], other: [] };
  for (const id of ids) {
    if (id === metaId) continue;
    if (
      id.startsWith(`mcp-oauth-${vaultId}:`) ||
      (id.startsWith("mcp:") && referencedMcpSecrets.has(id))
    ) {
      groups.mcp.push(detailFor(id, mcpLabels.get(id), secretMeta));
    } else if (id.startsWith(vaultPrefix)) {
      const name = id.slice(vaultPrefix.length);
      if (
        /api-key(?:-\d+)?$/.test(name) ||
        name.startsWith("model-api-key-") ||
        (name.startsWith("pi-credential-") && name !== "pi-credential-index")
      ) {
        groups.providers.push(detailFor(id, providerLabels.get(id), secretMeta));
      } else {
        groups.other.push(detailFor(id, undefined, secretMeta));
      }
    }
  }
  const byLabel = (a: LocalKeychainEntryDetail, b: LocalKeychainEntryDetail) =>
    (a.label ?? "\uffff").localeCompare(b.label ?? "\uffff") || a.id.localeCompare(b.id);
  groups.providers.sort(byLabel);
  groups.mcp.sort(byLabel);
  groups.other.sort(byLabel);
  return groups;
}
