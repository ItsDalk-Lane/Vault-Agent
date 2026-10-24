import { toVaultRelative } from "@/utils/vaultPath";

export interface EditTargetSource {
  locations?: ReadonlyArray<{ path?: string | null }> | null;
  input?: unknown;
  diffPaths?: readonly string[];
}

export function diffTargetPaths(
  outputs: ReadonlyArray<{ type: string; path?: string | null }> | null | undefined
): string[] {
  const paths = new Set<string>();
  for (const output of outputs ?? []) {
    if (output.type === "diff" && typeof output.path === "string" && output.path.length > 0) {
      paths.add(output.path);
    }
  }
  return [...paths];
}

// 同一文件的展示路径需要统一分隔符，避免工具卡片显示重复位置。
// https://github.com/Brevilabs/obsidian-copilot-private/issues/347
export function toVaultTargetPath(path: string, vaultBase: string | null): string {
  return toVaultRelative(path, vaultBase).replace(/\\/g, "/");
}

export function primaryEditTargetPath(
  source: EditTargetSource,
  vaultBase: string | null
): string | null {
  const loc = source.locations?.[0]?.path;
  if (typeof loc === "string" && loc.length > 0) return toVaultTargetPath(loc, vaultBase);
  const input = source.input as
    | { file_path?: unknown; filePath?: unknown; path?: unknown }
    | null
    | undefined;
  if (typeof input?.file_path === "string") return toVaultTargetPath(input.file_path, vaultBase);
  if (typeof input?.filePath === "string") return toVaultTargetPath(input.filePath, vaultBase);
  if (typeof input?.path === "string") return toVaultTargetPath(input.path, vaultBase);
  const diffPaths = source.diffPaths ?? [];
  if (diffPaths.length === 1) return toVaultTargetPath(diffPaths[0], vaultBase);
  return null;
}
