import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { PiSubagentSettings } from "./PiSubagentSettings";

describe("PiSubagentSettings", () => {
  describe("PiSubagentSettings()", () => {
    it("requires an explicit user toggle before enabling a writing subtask https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const change = jest.fn();
      render(<PiSubagentSettings writerEnabled={false} onWriterEnabledChange={change} />);
      const toggle = screen.getByRole<HTMLInputElement>("checkbox");
      expect(toggle.checked).toBe(false);
      expect(change).not.toHaveBeenCalled();
      fireEvent.click(toggle);
      expect(change).toHaveBeenCalledWith(true);
      expect(screen.getByText(/Every actual change still/)).toBeTruthy();
    });
  });
});
