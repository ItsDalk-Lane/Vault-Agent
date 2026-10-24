import { isProviderEnabled } from "./providerAvailability";

describe("providerAvailability", () => {
  describe("isProviderEnabled()", () => {
    it("keeps old providers without an enabled field available https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      expect(isProviderEnabled({})).toBe(true);
      expect(isProviderEnabled({ enabled: true })).toBe(true);
    });
    it("makes an explicitly disabled provider unavailable https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      expect(isProviderEnabled({ enabled: false })).toBe(false);
    });
  });
});
