import {
  diffTargetPaths,
  primaryEditTargetPath,
  toVaultTargetPath,
} from "@/agentMode/session/editTargets";

describe("editTargets", () => {
  const VAULT = "/Users/me/vault";

  describe("diffTargetPaths()", () => {
    it("collects each diff output's path once, in arrival order", () => {
      expect(
        diffTargetPaths([
          { type: "diff", path: "notes/b.md" },
          { type: "content" },
          { type: "diff", path: "notes/a.md" },
          { type: "diff", path: "notes/b.md" },
        ])
      ).toEqual(["notes/b.md", "notes/a.md"]);
    });

    it("returns nothing for a call with no outputs", () => {
      expect(diffTargetPaths(undefined)).toEqual([]);
      expect(diffTargetPaths([{ type: "diff", path: "" }])).toEqual([]);
    });
  });

  describe("toVaultTargetPath()", () => {
    it("makes an in-vault absolute path vault-relative with forward slashes", () => {
      expect(toVaultTargetPath(`${VAULT}/notes/a.md`, VAULT)).toBe("notes/a.md");
      expect(toVaultTargetPath("C:\\vault\\notes\\a.md", "C:\\vault")).toBe("notes/a.md");
    });

    it("rewrites backslashes in a relative path so each file has one key (https://github.com/Brevilabs/obsidian-copilot-private/issues/347)", () => {
      expect(toVaultTargetPath("notes\\diff-demo\\a.md", VAULT)).toBe("notes/diff-demo/a.md");
    });
  });

  describe("primaryEditTargetPath()", () => {
    it("prefers the first reported location and makes it vault-relative", () => {
      expect(
        primaryEditTargetPath(
          {
            locations: [{ path: `${VAULT}/notes/a.md` }, { path: `${VAULT}/notes/b.md` }],
            input: { file_path: `${VAULT}/other.md` },
          },
          VAULT
        )
      ).toBe("notes/a.md");
    });

    it("falls back through file_path, filePath and path in the tool input", () => {
      expect(primaryEditTargetPath({ input: { file_path: "notes/a.md" } }, VAULT)).toBe(
        "notes/a.md"
      );
      expect(primaryEditTargetPath({ input: { filePath: "notes/b.md" } }, VAULT)).toBe(
        "notes/b.md"
      );
      expect(primaryEditTargetPath({ input: { path: "notes/c.md" } }, VAULT)).toBe("notes/c.md");
    });

    it("uses the sole diff path when the call names its target only in its output", () => {
      expect(primaryEditTargetPath({ diffPaths: [`${VAULT}/notes/a.md`] }, VAULT)).toBe(
        "notes/a.md"
      );
    });

    it("returns null when the call has no target or patches several files", () => {
      expect(primaryEditTargetPath({}, VAULT)).toBeNull();
      expect(primaryEditTargetPath({ diffPaths: ["notes/a.md", "notes/b.md"] }, VAULT)).toBeNull();
    });

    it("leaves a path outside the vault absolute", () => {
      expect(primaryEditTargetPath({ input: { file_path: "/tmp/scratch.md" } }, VAULT)).toBe(
        "/tmp/scratch.md"
      );
    });
  });
});
