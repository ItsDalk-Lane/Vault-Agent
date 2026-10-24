import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { SettingItem } from "./setting-item";

describe("setting-item", () => {
  describe("SettingItem()", () => {
    it("keeps the saved selection and sends the selected model through the responsive setting row https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const change = jest.fn();
      render(
        <SettingItem
          type="select"
          title="Default model"
          value="local"
          options={[
            { label: "Local model", value: "local" },
            { label: "Another model", value: "another" },
          ]}
          onChange={change}
        />
      );
      expect(screen.getByDisplayValue("Local model")).toBe(screen.getByRole("combobox"));
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "another" } });
      expect(change).toHaveBeenCalledWith("another");
    });

    it("preserves switch interaction when the setting row changes layout", () => {
      const change = jest.fn();
      render(
        <SettingItem type="switch" title="Notifications" checked={true} onCheckedChange={change} />
      );
      fireEvent.click(screen.getByRole("switch"));
      expect(change).toHaveBeenCalledWith(false);
    });

    it("keeps custom controls and descriptions inside their row", () => {
      render(
        <SettingItem type="custom" title="Permissions" description="Changes still require approval">
          <button type="button">Review</button>
        </SettingItem>
      );
      expect(screen.getByText("Changes still require approval")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Review" })).not.toBeNull();
    });
  });
});
