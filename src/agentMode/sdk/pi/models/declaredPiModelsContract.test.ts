import { execFileSync } from "node:child_process";
import path from "node:path";

describe("declaredPiModelsContract", () => {
  describe("generateDeclaredModels", () => {
    it("matches every generated declaration to the locked SDK public catalog so changes cannot silently drift https://github.com/ItsDalk-Lane/Vault-Agent/issues/2", () => {
      const report = JSON.parse(
        execFileSync(
          process.execPath,
          [path.resolve(__dirname, "generateDeclaredModels.mjs"), "--check"],
          { encoding: "utf8" }
        )
      );
      expect(report).toEqual({
        providers: 42,
        models: 1614,
        endpointProviders: 35,
        status: "matched",
      });
    });
  });
});
