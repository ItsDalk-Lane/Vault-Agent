import { diffLines } from "@/agentMode/ui/diffRender";
import { DiffLines } from "@/agentMode/ui/DiffLines";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("DiffLines", () => {
  describe("diffLines()", () => {
    it("prefixes old lines with - and new lines with + in order", () => {
      expect(diffLines("a\nb", "c")).toEqual([
        { change: "deleted", text: "- a" },
        { change: "deleted", text: "- b" },
        { change: "inserted", text: "+ c" },
      ]);
    });

    it("emits only inserted lines when there is no old text", () => {
      expect(diffLines(null, "x")).toEqual([{ change: "inserted", text: "+ x" }]);
    });
  });

  describe("DiffLines()", () => {
    it("tints deleted lines red and inserted lines green (https://github.com/ItsDalk-Lane/Vault-Agent/issues/10)", () => {
      const { container } = render(<DiffLines oldText="old" newText="new" />);

      const removed = screen.getByText("- old");
      expect(removed.getAttribute("data-change")).toBe("deleted");
      expect(removed.className).toContain("tw-bg-error");
      const added = screen.getByText("+ new");
      expect(added.getAttribute("data-change")).toBe("inserted");
      expect(added.className).toContain("tw-bg-success");
      expect(container.querySelector("ul")).toBeNull();
    });
  });
});
