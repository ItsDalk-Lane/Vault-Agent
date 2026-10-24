export interface DiffLine {
  change: "deleted" | "inserted";
  text: string;
}

/** 逐行差异：旧文本带 `- ` 前缀，新文本带 `+ ` 前缀。https://github.com/ItsDalk-Lane/Vault-Agent/issues/10 */
export function diffLines(oldText: string | null, newText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  if (oldText !== null) {
    for (const line of oldText.split("\n")) lines.push({ change: "deleted", text: `- ${line}` });
  }
  for (const line of newText.split("\n")) lines.push({ change: "inserted", text: `+ ${line}` });
  return lines;
}

export function formatAgentInput(v: unknown): string | null {
  if (v == null) return null;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      return String(v);
    }
    return String(Object.prototype.toString.call(v));
  }
}

interface DiffContent {
  path: string;
  oldText: string | null;
  newText: string;
}

export function extractDiffContents(
  content: ReadonlyArray<{
    type: string;
    path?: string;
    oldText?: string | null;
    newText?: string;
  }> | null = null
): DiffContent[] {
  if (!content) return [];
  const out: DiffContent[] = [];
  for (const item of content) {
    if (item.type === "diff" && typeof item.path === "string" && typeof item.newText === "string") {
      out.push({ path: item.path, oldText: item.oldText ?? null, newText: item.newText });
    }
  }
  return out;
}
