import {
  recordToolProgress,
  type ProgressGuardState,
  type ToolProgressObservation,
} from "./ProgressGuard";

const observation = (
  executionId: string,
  overrides: Partial<ToolProgressObservation> = {}
): ToolProgressObservation => ({
  executionId,
  conversationId: "root",
  toolId: "vault_edit",
  arguments: { path: "note.md", fileVersion: "version-one" },
  errorCode: "STALE_BASELINE",
  ...overrides,
});
const initial = (): ProgressGuardState => ({ fingerprint: "", consecutive: 0, seen: {} });

describe("ProgressGuard", () => {
  describe("recordToolProgress()", () => {
    it("admits progress before pausing three repeated failures for unchanged inputs https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const state = initial();
      expect(recordToolProgress(state, observation("1"))).toBe(false);
      expect(recordToolProgress(state, observation("2"))).toBe(false);
      expect(recordToolProgress(state, observation("3"))).toBe(true);
    });
    it("does not count replayed observations twice and survives serialized recovery https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const state = initial();
      recordToolProgress(state, observation("1"));
      recordToolProgress(state, observation("1"));
      const restored = JSON.parse(JSON.stringify(state)) as ProgressGuardState;
      expect(recordToolProgress(restored, observation("2"))).toBe(false);
      expect(recordToolProgress(restored, observation("3"))).toBe(true);
    });
    it.each([
      { errorCode: undefined },
      { errorCode: "PERMISSION_DENIED" },
      { arguments: { path: "note.md", fileVersion: "version-two" } },
      { conversationId: "child" },
    ])(
      "resets the consecutive failure streak when facts change: %j https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      (changed) => {
        const state = initial();
        recordToolProgress(state, observation("1"));
        recordToolProgress(state, observation("2"));
        expect(recordToolProgress(state, observation("3", changed))).toBe(false);
        expect(recordToolProgress(state, observation("4"))).toBe(false);
      }
    );
    it("uses semantic argument identity independently of nested object key order https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const state = initial();
      recordToolProgress(state, observation("1", { arguments: { a: { c: 2, b: 1 }, z: [1, 2] } }));
      recordToolProgress(state, observation("2", { arguments: { z: [1, 2], a: { b: 1, c: 2 } } }));
      expect(
        recordToolProgress(state, observation("3", { arguments: { a: { c: 2, b: 1 }, z: [1, 2] } }))
      ).toBe(true);
    });
  });
});
