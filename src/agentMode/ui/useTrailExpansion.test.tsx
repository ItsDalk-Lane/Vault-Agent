import { useTrailExpansion } from "@/agentMode/ui/useTrailExpansion";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import React from "react";

const ExpandableRow: React.FC<{ id: string; label?: string }> = ({ id, label }) => {
  const { isOpen, toggle } = useTrailExpansion();
  return (
    <button type="button" aria-expanded={isOpen(id)} onClick={() => toggle(id)}>
      {label ?? id}
    </button>
  );
};

describe("useTrailExpansion", () => {
  describe("useTrailExpansion()", () => {
    it("reports every trail row closed until the user opens one", () => {
      const { result, rerender } = renderHook(() => useTrailExpansion());

      expect(result.current.isOpen("action-0")).toBe(false);
      rerender();
      expect(result.current.isOpen("action-0")).toBe(false);

      act(() => result.current.toggle("action-0"));

      expect(result.current.isOpen("action-0")).toBe(true);
      expect(result.current.isOpen("action-1")).toBe(false);
    });

    it("closes a row again only when the user toggles it a second time", () => {
      const { result } = renderHook(() => useTrailExpansion());

      act(() => result.current.toggle("action-0"));
      act(() => result.current.toggle("action-1"));
      act(() => result.current.toggle("action-0"));

      expect(result.current.isOpen("action-0")).toBe(false);
      expect(result.current.isOpen("action-1")).toBe(true);
    });

    it("keeps the toggle callback stable so cards do not re-render on unrelated state", () => {
      const { result } = renderHook(() => useTrailExpansion());
      const firstToggle = result.current.toggle;

      act(() => result.current.toggle("action-0"));

      expect(result.current.toggle).toBe(firstToggle);
    });

    it("keeps an opened row open as later parts stream into the same trail", () => {
      const { rerender } = render(
        <div>
          <ExpandableRow id="action-0" />
        </div>
      );

      fireEvent.click(screen.getByRole("button"));
      expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");

      rerender(
        <div>
          <ExpandableRow id="action-0" />
          <ExpandableRow id="action-1" label="streamed-in action" />
        </div>
      );
      expect(screen.getAllByRole("button")[0].getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("streamed-in action")).not.toBeNull();
    });
  });
});
