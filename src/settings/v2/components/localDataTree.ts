import { t } from "@/i18n";
import type { LocalDataPaths, LocalDataStatus } from "@/services/localDataStatus";
import { requireNodeModule } from "@/utils/desktopRuntime";

export interface LocalDataTreeNodeData {
  id: string;
  name: string;
  nameTooltip?: string;
  detail?: string;
  note?: string;
  size: number | null;
  path?: string;
  badge?: "private";
  children?: readonly LocalDataTreeNodeData[];
}

export function abbreviateSessionId(id: string): string {
  return id.length > 20 ? `${id.slice(0, 13)}…${id.slice(-4)}` : id;
}

export function buildLocalDataTree(args: {
  paths: LocalDataPaths;
  status: LocalDataStatus;
  vaultName: string;
}): readonly LocalDataTreeNodeData[] {
  const { paths, status, vaultName } = args;
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const home = requireNodeModule<typeof import("node:os")>("node:os").homedir();
  const display = (target: string): string =>
    home && target.startsWith(home + path.sep) ? `~${target.slice(home.length)}` : target;
  const relativeFromRoot = (target: string): string => {
    const relative = path.relative(paths.dataRoot, target);
    return relative.length > 0 ? `${relative}/` : "";
  };
  const sessionsBytes = status.sessions.reduce((sum, session) => sum + session.bytes, 0);
  // locks/ 目录没有单独统计，分区大小按数据根减去日志与临时数据推算，供树节点展示数量级。
  // https://github.com/ItsDalk-Lane/Vault-Agent/issues/8
  const partitionBytes = Math.max(0, status.totalBytes - status.logsBytes - status.tempBytes);
  const vaultsDir = path.join(paths.dataRoot, "vaults");
  const partitionDir = path.dirname(paths.indexPath);
  const sessionGroupNodes = (
    session: LocalDataStatus["sessions"][number]
  ): LocalDataTreeNodeData[] =>
    [
      {
        id: "transcripts",
        name: t("localData.groupTranscripts"),
        detail:
          session.docFileCount > 0
            ? t("localData.transcriptFiles", { count: session.docFileCount })
            : "main.jsonl",
        note: t("localData.transcriptsNote"),
        size: session.transcripts,
      },
      {
        id: "recovery",
        name: t("localData.groupRecovery"),
        detail: "recovery-view.json",
        note: t("localData.recoveryNote"),
        size: session.recovery,
      },
      {
        id: "backups",
        name: t("localData.groupBackups"),
        detail: "mutations/blobs/",
        note: t("localData.backupsNote"),
        size: session.backups,
      },
      {
        id: "metadata",
        name: t("localData.groupMetadata"),
        detail: "session.json · meta.json",
        note: t("localData.metadataNote"),
        size: session.metadata,
      },
      {
        id: "children",
        name: t("localData.groupChildren"),
        detail: "children/",
        note: t("localData.childrenNote"),
        size: session.children,
      },
      {
        id: "attachments",
        name: t("localData.groupAttachments"),
        detail: "attachments/",
        note: t("localData.attachmentsNote"),
        size: session.attachments,
      },
    ].map((group) => ({ ...group, id: `${session.id}:${group.id}` }));
  const sessionNodes: LocalDataTreeNodeData[] = status.sessions.map((session) => ({
    id: `session:${session.id}`,
    name: `${abbreviateSessionId(session.id)}/`,
    nameTooltip: session.path,
    note: session.title,
    size: session.bytes,
    path: session.path,
    children: sessionGroupNodes(session),
  }));
  const versionNode: LocalDataTreeNodeData = {
    id: "version",
    name: `${path.basename(paths.dataRoot)}/`,
    nameTooltip: paths.dataRoot,
    note: t("localData.versionDirNote"),
    size: status.totalBytes,
    path: paths.dataRoot,
    children: [
      {
        id: "vaults",
        name: "vaults/",
        note: t("localData.vaultsNote"),
        size: partitionBytes,
        path: vaultsDir,
        children: [
          {
            id: "partition",
            name: `${path.basename(partitionDir)}/`,
            nameTooltip: partitionDir,
            note: t("localData.partitionNote", { vault: vaultName }),
            size: partitionBytes,
            path: partitionDir,
            children: [
              {
                id: "sessions",
                name: "sessions/",
                note: t("localData.sessionsDirNote"),
                size: sessionsBytes,
                path: paths.sessionsRoot,
                children: sessionNodes,
              },
              {
                id: "index",
                name: path.basename(paths.indexPath),
                nameTooltip: paths.indexPath,
                note: t("localData.indexNote", { count: status.indexCount }),
                size: status.indexBytes,
                path: paths.indexPath,
              },
              {
                id: "locks",
                name: "locks/",
                note: t("localData.locksNote"),
                size: null,
                path: path.join(partitionDir, "locks"),
              },
              {
                id: "deletions",
                name: "deletions/",
                note: t("localData.deletionsNote"),
                size: status.pendingBytes,
                path: paths.deletionsRoot,
              },
            ],
          },
        ],
      },
      {
        id: "logs",
        name: relativeFromRoot(paths.logsRoot),
        nameTooltip: paths.logsRoot,
        note: t("localData.logsNote"),
        size: status.logsBytes,
        path: paths.logsRoot,
      },
      {
        id: "temp",
        name: relativeFromRoot(paths.tempRoot),
        nameTooltip: paths.tempRoot,
        note: t("localData.tempNote"),
        size: status.tempBytes,
        path: paths.tempRoot,
      },
    ],
  };
  const legacyNodes: LocalDataTreeNodeData[] = status.legacyPaths.map((legacy) => ({
    id: `legacy:${legacy.name}`,
    name: `${legacy.name}/`,
    nameTooltip: legacy.path,
    note: t("localData.legacyNote"),
    size: null,
    path: legacy.path,
  }));
  const dataParent = path.dirname(paths.dataRoot);
  return [
    {
      id: "root",
      name: `${display(dataParent)}/`,
      nameTooltip: dataParent,
      note: t("localData.rootNote"),
      size: status.totalBytes,
      path: dataParent,
      badge: "private",
      children: [versionNode, ...legacyNodes],
    },
  ];
}
