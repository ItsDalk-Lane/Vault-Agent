import { STRICT_NO_AMBIENT_AUTH } from "./ModelAuth";

describe("ModelAuth", () => {
  describe("STRICT_NO_AMBIENT_AUTH", () => {
    it("never exposes ambient keys or credential files to the provider https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      await expect(STRICT_NO_AMBIENT_AUTH.env("ANTHROPIC_API_KEY")).resolves.toBeUndefined();
      await expect(STRICT_NO_AMBIENT_AUTH.fileExists("~/.aws/credentials")).resolves.toBe(false);
      expect(Object.isFrozen(STRICT_NO_AMBIENT_AUTH)).toBe(true);
    });
  });
});
