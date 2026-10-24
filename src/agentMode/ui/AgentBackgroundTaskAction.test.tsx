import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentBackgroundTaskAction } from "./AgentBackgroundTaskAction";

describe("AgentBackgroundTaskAction", () => {
  describe("AgentBackgroundTaskAction()", () => {
    it("shows running background work and offers an explicit stop action after the main answer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const stop = jest.fn();
      render(<AgentBackgroundTaskAction count={2} onStop={stop} />);
      expect(screen.getByRole("status").textContent).toContain("2");
      fireEvent.click(
        screen.getByRole("button", { name: /Stop all background tasks|停止全部后台任务/ })
      );
      expect(stop).toHaveBeenCalledTimes(1);
    });
    it("disables another stop request until the pending cancellation finishes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const stop = jest.fn();
      render(<AgentBackgroundTaskAction count={1} pending onStop={stop} />);
      const pending = screen.getByRole("button", {
        name: /Stopping background tasks|正在停止后台任务/,
      });
      expect(pending).toHaveProperty("disabled", true);
      fireEvent.click(pending);
      expect(stop).not.toHaveBeenCalled();
    });
  });
});
