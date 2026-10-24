import { sha256 } from "@/utils/hash";

// A selection is bound to the exact view and range that will be replaced: leaf id, file path, full
// editor content hash, selection range and selection hash, plus when it was taken. Approval never
// carries a bare range that could apply to a different file or an edited buffer:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface EditorPosition {
  readonly line: number;
  readonly ch: number;
}

export interface EditorRange {
  readonly from: EditorPosition;
  readonly to: EditorPosition;
}

export interface SelectionSnapshot {
  readonly leafId: string;
  readonly filePath: string;
  readonly contentHash: string;
  readonly from: EditorPosition;
  readonly to: EditorPosition;
  readonly selectionHash: string;
  readonly takenAtMs: number;
}

export interface SelectionState {
  readonly leafId: string;
  readonly filePath: string;
  readonly content: string;
  readonly selection: EditorRange;
  readonly selectedText: string;
}

export function captureSelectionSnapshot(state: SelectionState, now: number): SelectionSnapshot {
  return Object.freeze({
    leafId: state.leafId,
    filePath: state.filePath,
    contentHash: sha256(state.content),
    from: Object.freeze({ ...state.selection.from }),
    to: Object.freeze({ ...state.selection.to }),
    selectionHash: selectionHashOf(state.selection, state.selectedText),
    takenAtMs: now,
  });
}

export function selectionStillMatches(snapshot: SelectionSnapshot, state: SelectionState): boolean {
  // 模型可能改动可读凭据中的位置，须同时核对原范围，避免批准后替换到其他文字。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  return (
    snapshot.leafId === state.leafId &&
    snapshot.filePath === state.filePath &&
    snapshot.contentHash === sha256(state.content) &&
    snapshot.from.line === state.selection.from.line &&
    snapshot.from.ch === state.selection.from.ch &&
    snapshot.to.line === state.selection.to.line &&
    snapshot.to.ch === state.selection.to.ch &&
    snapshot.selectionHash === selectionHashOf(state.selection, state.selectedText)
  );
}

export function encodeSelectionToken(snapshot: SelectionSnapshot): string {
  // 无引号凭据避免模型回传时重复转义 JSON，导致真实选区无法进入审批。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  return `selection:v1:${encodeURIComponent(JSON.stringify(snapshot))}`;
}

export function decodeSelectionToken(token: string): SelectionSnapshot | null {
  if (!token.startsWith("selection:")) return null;
  try {
    const serialized = token.startsWith("selection:v1:")
      ? decodeURIComponent(token.slice("selection:v1:".length))
      : token.slice("selection:".length);
    const parsed = JSON.parse(serialized) as Partial<SelectionSnapshot>;
    if (
      typeof parsed.leafId !== "string" ||
      typeof parsed.filePath !== "string" ||
      typeof parsed.contentHash !== "string" ||
      typeof parsed.selectionHash !== "string" ||
      typeof parsed.takenAtMs !== "number" ||
      !isEditorPosition(parsed.from) ||
      !isEditorPosition(parsed.to)
    ) {
      return null;
    }
    return {
      leafId: parsed.leafId,
      filePath: parsed.filePath,
      contentHash: parsed.contentHash,
      from: parsed.from,
      to: parsed.to,
      selectionHash: parsed.selectionHash,
      takenAtMs: parsed.takenAtMs,
    };
  } catch {
    return null;
  }
}

function isEditorPosition(value: unknown): value is EditorPosition {
  // 外来凭据的位置必须有效，避免审批预览处理无效位置时发生异常。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const position = value as Partial<EditorPosition> | null;
  return (
    typeof position?.line === "number" &&
    Number.isSafeInteger(position.line) &&
    position.line >= 0 &&
    typeof position.ch === "number" &&
    Number.isSafeInteger(position.ch) &&
    position.ch >= 0
  );
}

export function textAtRange(content: string, from: EditorPosition, to: EditorPosition): string {
  const start = offsetOf(content, from);
  const end = offsetOf(content, to);
  return content.slice(Math.min(start, end), Math.max(start, end));
}

export function offsetOf(content: string, position: EditorPosition): number {
  const lines = content.split("\n");
  let offset = 0;
  for (let index = 0; index < position.line && index < lines.length; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset + position.ch;
}

function selectionHashOf(selection: EditorRange, selectedText: string): string {
  return sha256(
    JSON.stringify({
      from: selection.from,
      to: selection.to,
      selectedText,
    })
  );
}
