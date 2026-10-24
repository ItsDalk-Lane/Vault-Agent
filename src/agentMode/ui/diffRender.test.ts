import { diffLines, extractDiffContents, formatAgentInput } from "@/agentMode/ui/diffRender";

describe("diffRender", () => {
  describe("diffLines()", () => {
    it("marks every old line deleted and every new line inserted with prefixes", () => {
      expect(diffLines("a", "b\nc")).toEqual([
        { change: "deleted", text: "- a" },
        { change: "inserted", text: "+ b" },
        { change: "inserted", text: "+ c" },
      ]);
    });

    it("keeps an empty new text as a single empty inserted line", () => {
      expect(diffLines(null, "")).toEqual([{ change: "inserted", text: "+ " }]);
    });
  });

  describe("formatAgentInput()", () => {
    it("pretty-prints object input", () => {
      expect(formatAgentInput({ file_path: "a.md" })).toBe('{\n  "file_path": "a.md"\n}');
    });

    it("returns null for absent input", () => {
      expect(formatAgentInput(null)).toBeNull();
      expect(formatAgentInput(undefined)).toBeNull();
    });

    it("JSON-quotes primitive strings like any other JSON value", () => {
      expect(formatAgentInput("cmd")).toBe('"cmd"');
    });
  });

  describe("extractDiffContents()", () => {
    it("keeps diff outputs with path and optional old text", () => {
      expect(
        extractDiffContents([
          { type: "text" },
          { type: "diff", path: "a.md", newText: "new" },
          { type: "diff", path: "b.md", oldText: "old", newText: "next" },
        ])
      ).toEqual([
        { path: "a.md", oldText: null, newText: "new" },
        { path: "b.md", oldText: "old", newText: "next" },
      ]);
    });

    it("returns an empty list for null content", () => {
      expect(extractDiffContents(null)).toEqual([]);
    });
  });
});
