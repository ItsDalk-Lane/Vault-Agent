import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { LegacyHistoryNotice } from "@/agentMode/ui/LegacyHistoryNotice";

jest.mock("@/i18n", () => ({ t: (key: string) => key }));

describe("LegacyHistoryNotice", () => {
  describe("LegacyHistoryNotice()", () => {
    it("keeps an archived Pi chat read-only without offering an unnecessary legacy import https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const props = { busy: false, onImport: jest.fn(), onExport: jest.fn(), canImport: false };
      render(<LegacyHistoryNotice {...props} />);
      expect(screen.getByText("controls.piReadOnlyHistory")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "controls.importLegacy" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "controls.exportArchive" }));
      expect(props.onExport).toHaveBeenCalledTimes(1);
      expect(props.onImport).not.toHaveBeenCalled();
    });

    it("offers explicit import and export actions instead of a message composer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const onImport = jest.fn();
      const onExport = jest.fn();
      render(<LegacyHistoryNotice busy={false} onImport={onImport} onExport={onExport} />);
      expect(screen.getByText("controls.legacyReadOnly")).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "controls.importLegacy" }));
      fireEvent.click(screen.getByRole("button", { name: "controls.exportArchive" }));
      expect(onImport).toHaveBeenCalledTimes(1);
      expect(onExport).toHaveBeenCalledTimes(1);
    });

    it("prevents repeated import or export clicks while an operation is pending https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const onImport = jest.fn();
      const onExport = jest.fn();
      render(<LegacyHistoryNotice busy onImport={onImport} onExport={onExport} />);
      fireEvent.click(screen.getByRole("button", { name: "controls.importLegacy" }));
      fireEvent.click(screen.getByRole("button", { name: "controls.exportArchive" }));
      expect(onImport).not.toHaveBeenCalled();
      expect(onExport).not.toHaveBeenCalled();
    });
  });
});
