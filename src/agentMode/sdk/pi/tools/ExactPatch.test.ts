import { sha256 } from "@/utils/hash";
import { prepareExactPatch, type ExactPatchEdit } from "@/agentMode/sdk/pi/tools/ExactPatch";

// The patch preparer is deterministic and pure: every edit is resolved against the same before
// content, a non-unique oldText needs an explicit occurrence, overlapping ranges are rejected
// without changing content, Unicode hashes use UTF-8 bytes, and oversize input/output returns an
// error instead of truncating:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
function edit(oldText: string, newText: string, occurrence?: number): ExactPatchEdit {
  return { oldText, newText, ...(occurrence !== undefined ? { occurrence } : {}) };
}

describe("prepareExactPatch", () => {
  it("rejects a missing match and a non-unique match unless occurrence is explicit", () => {
    const missing = prepareExactPatch({ before: "alpha beta", edits: [edit("gamma", "x")] });
    const multiple = prepareExactPatch({ before: "alpha beta", edits: [edit("a", "x")] });
    const explicit = prepareExactPatch({ before: "alpha beta", edits: [edit("a", "x", 2)] });
    const beyond = prepareExactPatch({ before: "alpha beta", edits: [edit("a", "x", 99)] });

    expect(missing).toMatchObject({ ok: false, code: "NO_MATCH" });
    expect(multiple).toMatchObject({ ok: false, code: "MULTIPLE_MATCHES" });
    expect(explicit.ok).toBe(true);
    expect(explicit.ok && explicit.proposal.after).toBe("alphx beta");
    expect(beyond).toMatchObject({ ok: false, code: "NO_MATCH" });
  });

  it("rejects overlapping edits without changing content", () => {
    const result = prepareExactPatch({
      before: "abcdef",
      edits: [edit("abc", "X"), edit("bcd", "Y")],
    });

    expect(result).toMatchObject({ ok: false, code: "OVERLAP" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result).not.toHaveProperty("proposal");
  });

  it("applies multiple non-overlapping edits from the same before content", () => {
    const result = prepareExactPatch({
      before: "abcdef",
      edits: [edit("abc", "X"), edit("def", "Z")],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.after).toBe("XZ");
    expect(result.proposal.before).toBe("abcdef");
    expect(result.proposal.edits).toHaveLength(2);
  });

  it("uses UTF-8 byte hashes and byte counts for Unicode content", () => {
    const before = "你好，世界";
    const result = prepareExactPatch({ before, edits: [edit("世界", "Vault")] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.beforeHash).toBe(sha256(before));
    expect(result.proposal.afterHash).toBe(sha256("你好，Vault"));
    expect(result.proposal.bytesBefore).toBe(15);
    expect(result.proposal.bytesAfter).toBe(14);
    expect(result.proposal.after).toBe("你好，Vault");
  });

  it("generates a complete proposed diff with line numbers", () => {
    const result = prepareExactPatch({
      before: "one\ntwo\nthree",
      edits: [edit("two", "TWO")],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.hunks).toHaveLength(1);
    expect(result.proposal.hunks[0]).toMatchObject({
      startLine: 2,
      oldText: "two",
      newText: "TWO",
    });
    expect(result.proposal.unifiedDiff).toContain("@@ -2,1 +2,1 @@");
    expect(result.proposal.unifiedDiff).toContain("-two");
    expect(result.proposal.unifiedDiff).toContain("+TWO");
    expect(result.proposal.beforeHash).toBe(sha256("one\ntwo\nthree"));
    expect(result.proposal.afterHash).toBe(sha256("one\nTWO\nthree"));
  });

  it("rejects oversize input, output and edit counts without producing a proposal", () => {
    const inputTooLarge = prepareExactPatch({
      before: "x".repeat(20),
      edits: [edit("x", "y")],
      maxInputBytes: 10,
    });
    const outputTooLarge = prepareExactPatch({
      before: "abc",
      edits: [edit("abc", "x".repeat(20))],
      maxOutputBytes: 10,
    });
    const tooManyEdits = prepareExactPatch({
      before: "abcdef",
      edits: [edit("a", "z"), edit("b", "z"), edit("c", "z")],
      maxEdits: 2,
    });

    expect(inputTooLarge).toMatchObject({ ok: false, code: "OVERSIZE" });
    expect(outputTooLarge).toMatchObject({ ok: false, code: "OVERSIZE" });
    expect(tooManyEdits).toMatchObject({ ok: false, code: "OVERSIZE" });
  });

  it("rejects an empty edit list and empty oldText", () => {
    expect(prepareExactPatch({ before: "abc", edits: [] })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
    });
    expect(prepareExactPatch({ before: "abc", edits: [edit("", "x")] })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
    });
  });
});
