import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ModelSelector } from "./ModelSelector";
import type { ModelSelectorEntry } from "./ModelSelector";
const cloudWarningProps: Array<{ stopPropagation?: boolean }> = [];
jest.mock("@/components/ui/SelfHostCloudWarningIcon", () => ({
  SelfHostCloudWarningIcon: (props: { stopPropagation?: boolean }) => {
    cloudWarningProps.push(props);
    return <span data-testid="cloud-warning" />;
  },
}));

const model = (over: Partial<ModelSelectorEntry>): ModelSelectorEntry => ({
  name: "gpt-5",
  provider: "openai",
  enabled: true,
  ...over,
});

describe("ModelSelector", () => {
  describe("ModelSelector()", () => {
    beforeEach(() => {
      cloudWarningProps.length = 0;
      jest.spyOn(window, "open").mockImplementation(() => null);
    });
    afterEach(() => jest.restoreAllMocks());

    it("selects an available model", async () => {
      const onChange = jest.fn();
      render(<ModelSelector value="" onChange={onChange} models={[model({})]} />);
      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name: /gpt-5/ }));
      expect(onChange).toHaveBeenCalledWith("gpt-5|openai");
      expect(window.open).not.toHaveBeenCalled();
    });

    it("shows the cloud-egress warning on the collapsed trigger when the current model needs it", () => {
      const cloud = model({ _needsSelfHostWarning: true });
      render(<ModelSelector value="gpt-5|openai" onChange={jest.fn()} models={[cloud]} />);

      expect(screen.getByTestId("cloud-warning")).toBeTruthy();
      expect(cloudWarningProps.some((p) => p.stopPropagation === false)).toBe(true);
    });

    it("hides the warning when the current model is self-hostable", () => {
      const local = model({ _needsSelfHostWarning: false });
      render(<ModelSelector value="gpt-5|openai" onChange={jest.fn()} models={[local]} />);

      expect(screen.queryByTestId("cloud-warning")).toBeNull();
    });

    it("renders a row's subtitle under its name and keeps it off the collapsed trigger", async () => {
      const described = model({
        displayName: "Copilot Plus Flash",
        _subtitle: "The default model: fastest responses and the most quota.",
      });
      render(<ModelSelector value="gpt-5|openai" onChange={jest.fn()} models={[described]} />);

      expect(
        screen.queryByText("The default model: fastest responses and the most quota.")
      ).toBeNull();

      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

      expect(
        await screen.findByText("The default model: fastest responses and the most quota.")
      ).toBeTruthy();
    });

    it("keeps the right-side reason for a row disabled for any other cause", async () => {
      const needsKey = model({ _disabledReason: "Add API key" });
      const onChange = jest.fn();
      render(<ModelSelector value="gpt-5|openai" onChange={onChange} models={[needsKey]} />);
      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

      expect(await screen.findByText("Add API key")).toBeTruthy();
      const row = screen.getByRole("menuitem");
      fireEvent.click(row);
      fireEvent.keyDown(row, { key: "Enter" });
      expect(row.getAttribute("aria-disabled")).toBe("true");
      expect(onChange).not.toHaveBeenCalled();
      expect(window.open).not.toHaveBeenCalled();
    });
  });
});
