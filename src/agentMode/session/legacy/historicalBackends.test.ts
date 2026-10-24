import {
  HISTORICAL_BACKEND_IDENTITIES,
  isHistoricalBackendId,
} from "@/agentMode/session/legacy/historicalBackends";

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/1";

describe("historicalBackends", () => {
  describe("isHistoricalBackendId()", () => {
    it("keeps the current engine outside read-only legacy handling", () => {
      expect(isHistoricalBackendId("pi")).toBe(false);
    });

    it.each(["claude", "codex", "opencode", "unknown-retired-engine"])(
      `keeps %s read-only without requiring its removed runtime ${ISSUE}`,
      (backendId) => {
        expect(isHistoricalBackendId(backendId)).toBe(true);
      }
    );
  });

  describe("HISTORICAL_BACKEND_IDENTITIES", () => {
    it(`keeps the original labels and icons with no executable descriptor ${ISSUE}`, () => {
      expect(HISTORICAL_BACKEND_IDENTITIES.map(({ id, displayName }) => [id, displayName])).toEqual(
        [
          ["claude", "Claude"],
          ["codex", "Codex"],
          ["opencode", "opencode"],
        ]
      );
      for (const identity of HISTORICAL_BACKEND_IDENTITIES) {
        expect(identity.Icon).toBeDefined();
        expect(identity).not.toHaveProperty("createBackendProcess");
        expect(identity).not.toHaveProperty("getEnabledModelEntries");
      }
    });
  });
});
