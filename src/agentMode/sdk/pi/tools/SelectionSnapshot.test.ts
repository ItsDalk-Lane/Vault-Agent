import {
  captureSelectionSnapshot,
  decodeSelectionToken,
  encodeSelectionToken,
  offsetOf,
  selectionStillMatches,
  textAtRange,
  type SelectionState,
} from "@/agentMode/sdk/pi/tools/SelectionSnapshot";
import { sha256 } from "@/utils/hash";

const state: SelectionState = {
  leafId: "leaf-selected",
  filePath: "Notes/selected.md",
  content: "保留\n紫色文字",
  selection: { from: { line: 1, ch: 0 }, to: { line: 1, ch: 2 } },
  selectedText: "紫色",
};

describe("SelectionSnapshot", () => {
  describe("captureSelectionSnapshot()", () => {
    it("freezes the view, file, full text and selected range independently of later editor changes", () => {
      const snapshot = captureSelectionSnapshot(state, 100);
      expect(snapshot).toMatchObject({
        leafId: state.leafId,
        filePath: state.filePath,
        contentHash: sha256(state.content),
        from: state.selection.from,
        to: state.selection.to,
        takenAtMs: 100,
      });
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.from)).toBe(true);
      expect(snapshot.from).not.toBe(state.selection.from);
    });
  });

  describe("selectionStillMatches()", () => {
    it("accepts the same editor, file, content and selected range", () => {
      expect(selectionStillMatches(captureSelectionSnapshot(state, 100), state)).toBe(true);
    });

    it.each([
      { leafId: "other-leaf" },
      { filePath: "Notes/other.md" },
      { contentHash: sha256("different") },
      { selectionHash: sha256("different") },
      { from: { line: 0, ch: 0 } },
      { from: { line: 1, ch: 1 } },
      { to: { line: 0, ch: 2 } },
      { to: { line: 1, ch: 3 } },
    ])(
      "rejects a token with altered bound fields %p https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      (changed) => {
        const snapshot = { ...captureSelectionSnapshot(state, 100), ...changed };
        expect(selectionStillMatches(snapshot, state)).toBe(false);
      }
    );
  });

  describe("encodeSelectionToken()", () => {
    it("keeps the complete snapshot without JSON quotes that models can double escape https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const snapshot = captureSelectionSnapshot(state, 100);
      const token = encodeSelectionToken(snapshot);
      expect(token).toMatch(/^selection:v1:/);
      expect(token).not.toMatch(/["\\\\\s]/);
      expect(decodeSelectionToken(token)).toEqual(snapshot);
    });
  });

  describe("decodeSelectionToken()", () => {
    it("restores every field of a valid token", () => {
      const snapshot = captureSelectionSnapshot(state, 100);
      expect(decodeSelectionToken(encodeSelectionToken(snapshot))).toEqual(snapshot);
    });

    it("still reads earlier JSON tokens for a pending selection approval https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const snapshot = captureSelectionSnapshot(state, 100);
      expect(decodeSelectionToken(`selection:${JSON.stringify(snapshot)}`)).toEqual(snapshot);
    });

    it.each(["invalid", "selection:{", "selection:null", "selection:{}", "selection:v1:%"])(
      "refuses malformed or incomplete input %p",
      (token) => {
        expect(decodeSelectionToken(token)).toBeNull();
      }
    );

    it.each([null, "invalid", { line: -1, ch: 0 }, { line: 0, ch: 0.5 }])(
      "refuses invalid ranges %p https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      (position) => {
        const snapshot = captureSelectionSnapshot(state, 100);
        const token = `selection:${JSON.stringify({ ...snapshot, from: position })}`;
        expect(decodeSelectionToken(token)).toBeNull();
      }
    );
  });

  describe("textAtRange()", () => {
    it("extracts the same Unicode text for either direction of a multiline range", () => {
      expect(textAtRange(state.content, state.selection.from, state.selection.to)).toBe("紫色");
      expect(textAtRange(state.content, state.selection.to, state.selection.from)).toBe("紫色");
      expect(textAtRange(state.content, { line: 0, ch: 1 }, { line: 1, ch: 1 })).toBe("留\n紫");
    });
  });

  describe("offsetOf()", () => {
    it("counts editor character positions across newlines", () => {
      expect(offsetOf(state.content, { line: 0, ch: 1 })).toBe(1);
      expect(offsetOf(state.content, { line: 1, ch: 2 })).toBe(5);
    });
  });
});
