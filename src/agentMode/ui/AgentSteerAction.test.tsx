import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentSteerAction } from "./AgentSteerAction";

describe("AgentSteerAction", () => {
  describe("AgentSteerAction()", () => {
    it("offers an explicit text-only supplement action while preserving the ordinary Send explanation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const submit = jest.fn();
      render(<AgentSteerAction onSubmit={submit} />);
      fireEvent.click(screen.getByRole("button", { name: /Supplement current work|补充当前工作/ }));
      expect(submit).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Text only|仅支持纯文字/)).toBeTruthy();
    });
    it("prevents another supplement while waiting for this tool round or when attachments and commands are selected https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const submit = jest.fn();
      const view = render(<AgentSteerAction onSubmit={submit} pending />);
      const pending = screen.getByRole("button", {
        name: /Adding after this tool round|等当前这轮操作结束后补充/,
      });
      expect(pending).toHaveProperty("disabled", true);
      fireEvent.click(pending);
      view.rerender(<AgentSteerAction onSubmit={submit} disabled />);
      fireEvent.click(screen.getByRole("button", { name: /Supplement current work|补充当前工作/ }));
      expect(submit).not.toHaveBeenCalled();
    });
  });
});
