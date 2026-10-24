import { sha256 } from "@/utils/hash";

// Deterministic patch preparation: every edit resolves against the same before content, a
// non-unique oldText requires an explicit occurrence, overlapping ranges are rejected before any
// content is produced, hashes use UTF-8 bytes, and oversize input/output fails instead of
// truncating what would be written:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface ExactPatchEdit {
  readonly oldText: string;
  readonly newText: string;
  readonly occurrence?: number;
}

export interface ExactPatchInput {
  readonly before: string;
  readonly edits: readonly ExactPatchEdit[];
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxEdits?: number;
}

export interface AppliedEdit {
  readonly editIndex: number;
  readonly start: number;
  readonly end: number;
  readonly startLine: number;
  readonly oldText: string;
  readonly newText: string;
}

export interface PatchHunk {
  readonly editIndex: number;
  readonly startLine: number;
  readonly newStartLine: number;
  readonly oldLineCount: number;
  readonly newLineCount: number;
  readonly oldText: string;
  readonly newText: string;
}

export interface ExactPatchProposal {
  readonly before: string;
  readonly after: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  readonly edits: readonly AppliedEdit[];
  readonly hunks: readonly PatchHunk[];
  readonly unifiedDiff: string;
}

export type ExactPatchErrorCode =
  | "INVALID_ARGUMENT"
  | "NO_MATCH"
  | "MULTIPLE_MATCHES"
  | "OVERLAP"
  | "OVERSIZE";

export type ExactPatchResult =
  | { readonly ok: true; readonly proposal: ExactPatchProposal }
  | {
      readonly ok: false;
      readonly code: ExactPatchErrorCode;
      readonly message: string;
      readonly editIndex?: number;
    };

const DEFAULT_MAX_INPUT_BYTES = 1 * 1_024 * 1_024;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1_024 * 1_024;
const DEFAULT_MAX_EDITS = 50;

interface ResolvedEdit {
  readonly editIndex: number;
  readonly start: number;
  readonly end: number;
  readonly oldText: string;
  readonly newText: string;
}

export function prepareExactPatch(input: ExactPatchInput): ExactPatchResult {
  if (typeof input.before !== "string") return invalid("before must be a string.");
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    return invalid("edits must contain at least one edit.");
  }
  const maxEdits = input.maxEdits ?? DEFAULT_MAX_EDITS;
  if (input.edits.length > maxEdits) {
    return oversize(`At most ${maxEdits} edits are allowed per call.`);
  }
  const bytesBefore = utf8Bytes(input.before);
  const maxInputBytes = input.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  if (bytesBefore > maxInputBytes) {
    return oversize(`The before content exceeds ${maxInputBytes} bytes.`);
  }

  const resolved: ResolvedEdit[] = [];
  for (let editIndex = 0; editIndex < input.edits.length; editIndex += 1) {
    const edit: ExactPatchEdit | undefined = input.edits[editIndex];
    if (edit === undefined) return invalid(`Edit ${editIndex} is missing.`, editIndex);
    if (typeof edit.oldText !== "string" || edit.oldText.length === 0) {
      return invalid(`Edit ${editIndex} has an empty oldText.`, editIndex);
    }
    if (typeof edit.newText !== "string") {
      return invalid(`Edit ${editIndex} has a non-string newText.`, editIndex);
    }
    if (
      edit.occurrence !== undefined &&
      (!Number.isInteger(edit.occurrence) || edit.occurrence < 1)
    ) {
      return invalid(`Edit ${editIndex} has an invalid occurrence.`, editIndex);
    }
    const matches = findMatches(input.before, edit.oldText);
    if (matches.length === 0) {
      return {
        ok: false,
        code: "NO_MATCH",
        message: `Edit ${editIndex} did not match any text.`,
        editIndex,
      };
    }
    let start: number;
    if (edit.occurrence !== undefined) {
      if (edit.occurrence > matches.length) {
        return {
          ok: false,
          code: "NO_MATCH",
          message: `Edit ${editIndex} occurrence ${edit.occurrence} exceeds ${matches.length} matches.`,
          editIndex,
        };
      }
      start = matches[edit.occurrence - 1];
    } else if (matches.length > 1) {
      return {
        ok: false,
        code: "MULTIPLE_MATCHES",
        message: `Edit ${editIndex} matched ${matches.length} times; set an explicit occurrence.`,
        editIndex,
      };
    } else {
      start = matches[0];
    }
    resolved.push({
      editIndex,
      start,
      end: start + edit.oldText.length,
      oldText: edit.oldText,
      newText: edit.newText,
    });
  }

  const byStart = [...resolved].sort((left, right) => left.start - right.start);
  for (let index = 1; index < byStart.length; index += 1) {
    if (byStart[index].start < byStart[index - 1].end) {
      return {
        ok: false,
        code: "OVERLAP",
        message: `Edits ${byStart[index - 1].editIndex} and ${byStart[index].editIndex} overlap.`,
        editIndex: byStart[index].editIndex,
      };
    }
  }

  let after = input.before;
  for (const edit of [...resolved].sort((left, right) => right.start - left.start)) {
    after = `${after.slice(0, edit.start)}${edit.newText}${after.slice(edit.end)}`;
  }
  const bytesAfter = utf8Bytes(after);
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (bytesAfter > maxOutputBytes) {
    return oversize(`The proposed content exceeds ${maxOutputBytes} bytes.`);
  }

  const edits: AppliedEdit[] = byStart.map((edit) => ({
    editIndex: edit.editIndex,
    start: edit.start,
    end: edit.end,
    startLine: lineOf(input.before, edit.start),
    oldText: edit.oldText,
    newText: edit.newText,
  }));
  const hunks = buildHunks(byStart, input.before);
  return {
    ok: true,
    proposal: {
      before: input.before,
      after,
      beforeHash: sha256(input.before),
      afterHash: sha256(after),
      bytesBefore,
      bytesAfter,
      edits: Object.freeze(edits),
      hunks: Object.freeze(hunks),
      unifiedDiff: renderUnifiedDiff(hunks),
    },
  };
}

function findMatches(before: string, oldText: string): readonly number[] {
  const matches: number[] = [];
  let cursor = 0;
  while (cursor <= before.length - oldText.length) {
    const found = before.indexOf(oldText, cursor);
    if (found === -1) break;
    matches.push(found);
    cursor = found + 1;
  }
  return matches;
}

function buildHunks(edits: readonly ResolvedEdit[], before: string): readonly PatchHunk[] {
  let lineDelta = 0;
  return edits.map((edit) => {
    const startLine = lineOf(before, edit.start);
    const oldLineCount = edit.oldText.split("\n").length;
    const newLineCount = edit.newText.split("\n").length;
    const hunk: PatchHunk = {
      editIndex: edit.editIndex,
      startLine,
      newStartLine: startLine + lineDelta,
      oldLineCount,
      newLineCount,
      oldText: edit.oldText,
      newText: edit.newText,
    };
    lineDelta += newLineCount - oldLineCount;
    return hunk;
  });
}

function renderUnifiedDiff(hunks: readonly PatchHunk[]): string {
  const lines = ["--- before", "+++ after"];
  for (const hunk of hunks) {
    lines.push(
      `@@ -${hunk.startLine},${hunk.oldLineCount} +${hunk.newStartLine},${hunk.newLineCount} @@`
    );
    for (const line of hunk.oldText.split("\n")) lines.push(`-${line}`);
    for (const line of hunk.newText.split("\n")) lines.push(`+${line}`);
  }
  return `${lines.join("\n")}\n`;
}

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (content[index] === "\n") line += 1;
  }
  return line;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function invalid(message: string, editIndex?: number): ExactPatchResult {
  return {
    ok: false,
    code: "INVALID_ARGUMENT",
    message,
    ...(editIndex !== undefined ? { editIndex } : {}),
  };
}

function oversize(message: string): ExactPatchResult {
  return { ok: false, code: "OVERSIZE", message };
}
