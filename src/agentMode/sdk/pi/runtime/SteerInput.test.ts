import { assertSteerText } from "./SteerInput";

describe("SteerInput", () => {
  describe("assertSteerText()", () => {
    it("accepts exact ordinary text and refuses blank text or commands without interpreting their contents https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(() => assertSteerText("保留原文；补充新的要求")).not.toThrow();
      for (const input of ["", "  ", "/compact", "  /model another", "/stop"])
        expect(() => assertSteerText(input)).toThrow("普通文字");
    });
  });
});
