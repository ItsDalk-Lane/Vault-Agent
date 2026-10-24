import { loadProjectInstructions } from "./ProjectInstructions";

describe("ProjectInstructions", () => {
  describe("loadProjectInstructions()", () => {
    it("loads vault and ancestor rules in scope order while leaving ordinary notes unread https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const files: Record<string, string> = {
        "AGENTS.md": "Vault rules",
        "team/AGENTS.md": "Team rules",
        "team/work/AGENTS.md": "Work rules",
        "team/work/note.md": "ordinary note",
      };
      const read = jest.fn(async (path: string) => files[path]);
      const result = await loadProjectInstructions({ workspaceRelativePath: "team/work", read });
      expect(result.instructions).toEqual([
        { path: "AGENTS.md", scope: ".", text: "Vault rules" },
        { path: "team/AGENTS.md", scope: "team", text: "Team rules" },
        { path: "team/work/AGENTS.md", scope: "team/work", text: "Work rules" },
      ]);
      expect(read).not.toHaveBeenCalledWith("team/work/note.md", expect.any(Number));
    });

    it("prefers the nearest rules within the total byte budget and reports omitted ancestors https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const result = await loadProjectInstructions({
        workspaceRelativePath: "work",
        maxBytes: 6,
        read: async (path) => (path === "work/AGENTS.md" ? "local" : "root"),
      });
      expect(result.instructions.map((entry) => entry.path)).toEqual(["work/AGENTS.md"]);
      expect(result.notices.join(" ")).toContain("AGENTS.md");
    });

    it("rechecks changed and removed sources without retaining an obsolete instruction revision https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let text: string | undefined = "old";
      const options = { workspaceRelativePath: "", read: async () => text };
      expect((await loadProjectInstructions(options)).instructions[0].text).toBe("old");
      text = "new";
      expect((await loadProjectInstructions(options)).instructions[0].text).toBe("new");
      text = undefined;
      expect((await loadProjectInstructions(options)).instructions).toEqual([]);
    });

    it("omits unreadable and out-of-vault sources with explicit notices https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const read = jest.fn(async () => {
        throw new Error("scope rejected");
      });
      const result = await loadProjectInstructions({ workspaceRelativePath: "../outside", read });
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith("AGENTS.md", expect.any(Number));
      expect(result.instructions).toEqual([]);
      expect(result.notices).toHaveLength(2);
    });
  });
});
