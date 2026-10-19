import { getBuiltinSkillVersion } from "./builtinOwnership";

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";
describe("builtinOwnership", () => {
  describe("getBuiltinSkillVersion()", () => {
    it(`recognizes string and numeric versions in YAML metadata ${ISSUE}`, () => {
      for (const marker of ['"3"', "3"]) {
        expect(
          getBuiltinSkillVersion(
            `---\nmetadata:\n  vault-agent-builtin-version: ${marker}\n---\nbody`
          )
        ).toBe(3);
      }
    });
    it(`does not claim body examples, top-level fields, malformed YAML, or invalid versions ${ISSUE}`, () => {
      for (const content of [
        'vault-agent-builtin-version: "1"',
        '---\nname: user-skill\n---\nExample:\nvault-agent-builtin-version: "1"',
        '---\nvault-agent-builtin-version: "1"\n---\nbody',
        "---\nmetadata: [\n---\nbody",
        "---\nmetadata:\n  vault-agent-builtin-version: true\n---\nbody",
        '---\nmetadata:\n  vault-agent-builtin-version: "bad"\n---\nbody',
        "---\nmetadata:\n  vault-agent-builtin-version: 99999999999999999\n---\nbody",
      ])
        expect(getBuiltinSkillVersion(content)).toBeNull();
    });
  });
});
