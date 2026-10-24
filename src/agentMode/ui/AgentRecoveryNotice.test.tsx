import type { RecoveryStateUpdate } from "@/agentMode/session/types";
import { AgentRecoveryNotice } from "@/agentMode/ui/AgentRecoveryNotice";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/i18n", () => ({ t: (key: string) => key }));

const interrupted: RecoveryStateUpdate = {
  status: "available",
  pendingPermissionIds: [],
  pendingQuestionIds: [],
  pendingMutationIds: [],
  crashLoopTripped: false,
  message: "上次工作未完成，请选择继续或结束。",
};

describe("AgentRecoveryNotice", () => {
  describe("AgentRecoveryNotice()", () => {
    it("shows a saved unsent request without claiming a paused SDK run and waits for explicit Continue https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const onRecover = jest.fn(async () => undefined);
      const recovery: RecoveryStateUpdate = {
        ...interrupted,
        message: "这条请求尚未发送，原文和附件引用已保存。",
      };
      render(<AgentRecoveryNotice recovery={recovery} onRecover={onRecover} />);
      expect(screen.getByText(recovery.message!)).toBeTruthy();
      expect(onRecover).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "controls.recoveryContinue" }));
      });
      expect(onRecover).toHaveBeenCalledWith("continue");
    });
    it("offers an explicit history reload for a full runtime pool without offering Continue or silently retrying https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const onRecover = jest.fn(async () => undefined);
      render(
        <AgentRecoveryNotice
          recovery={{
            ...interrupted,
            status: "read_only",
            reloadAvailable: true,
            message: "其他聊天正在运行，现显示保存的历史。",
          }}
          onRecover={onRecover}
        />
      );
      expect(onRecover).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "controls.recoveryContinue" })).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "controls.recoveryReload" }));
      });
      expect(onRecover).toHaveBeenCalledWith("reconcile");
    });
    it("keeps a new-message composer available only for a safe completed-segment continuation, not an interrupted or unsafe SDK run https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const recovery = { ...interrupted, continuationAvailable: true };
      const { rerender } = render(
        <AgentRecoveryNotice recovery={recovery} onRecover={async () => undefined}>
          <input aria-label="New requirement" />
        </AgentRecoveryNotice>
      );
      expect(screen.getByRole("textbox", { name: "New requirement" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "controls.recoveryContinue" })).toBeTruthy();
      for (const unsafe of [
        { ...recovery, continuationAvailable: false },
        { ...recovery, status: "read_only" as const },
        { ...recovery, pendingMutationIds: ["unknown"] },
        { ...recovery, pendingPermissionIds: ["permission"] },
        { ...recovery, pendingQuestionIds: ["question"] },
        { ...recovery, crashLoopTripped: true },
      ]) {
        rerender(
          <AgentRecoveryNotice recovery={unsafe} onRecover={async () => undefined}>
            <input aria-label="New requirement" />
          </AgentRecoveryNotice>
        );
        expect(screen.queryByRole("textbox", { name: "New requirement" })).toBeNull();
      }
    });
    it("waits for the user's chosen action instead of continuing work when the notice opens https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const onRecover = jest.fn(async () => undefined);
      render(<AgentRecoveryNotice recovery={interrupted} onRecover={onRecover} />);

      expect(screen.getByText(interrupted.message!)).toBeTruthy();
      expect(onRecover).not.toHaveBeenCalled();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "controls.recoveryContinue" }));
      });

      expect(onRecover).toHaveBeenCalledTimes(1);
      expect(onRecover).toHaveBeenCalledWith("continue");
    });

    it("sends an explicit abort and blocks repeat actions until that work settles https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      let finish: (() => void) | undefined;
      const onRecover = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
      render(<AgentRecoveryNotice recovery={interrupted} onRecover={onRecover} />);
      fireEvent.click(screen.getByRole("button", { name: "controls.recoveryAbort" }));
      fireEvent.click(screen.getByRole("button", { name: "controls.recoveryContinue" }));

      expect(onRecover).toHaveBeenCalledTimes(1);
      expect(onRecover).toHaveBeenCalledWith("abort");
      await act(async () => {
        if (!finish) throw new Error("The abort action was not started");
        finish();
      });
    });

    it("offers a deliberate retry after repeated crashes while unreadable versions remain read-only https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const onRecover = jest.fn(async () => undefined);
      const { rerender } = render(
        <AgentRecoveryNotice
          recovery={{ ...interrupted, status: "read_only", crashLoopTripped: true }}
          onRecover={onRecover}
        />
      );
      expect(screen.getByRole("button", { name: "controls.recoveryContinue" })).toBeTruthy();

      rerender(
        <AgentRecoveryNotice
          recovery={{ ...interrupted, status: "read_only", crashLoopTripped: false }}
          onRecover={onRecover}
        />
      );

      expect(screen.getByText("controls.recoveryReadOnly")).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
      expect(onRecover).not.toHaveBeenCalled();
    });

    it("offers a read-only file check for unresolved effects without resuming work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const onRecover = jest.fn(async () => undefined);
      render(
        <AgentRecoveryNotice
          recovery={{ ...interrupted, status: "read_only", pendingMutationIds: ["mutation-1"] }}
          onRecover={onRecover}
        />
      );
      expect(screen.queryByRole("button", { name: "controls.recoveryContinue" })).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "controls.recoveryReconcile" }));
      });
      expect(onRecover).toHaveBeenCalledWith("reconcile");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "controls.recoveryAbort" }));
      });
      expect(onRecover).toHaveBeenCalledWith("abort");
    });

    it("keeps a failed recovery visible and offers retry without pretending the work finished https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const onRecover = jest.fn(async () => {
        throw new Error("storage remains unavailable");
      });
      render(<AgentRecoveryNotice recovery={interrupted} onRecover={onRecover} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "controls.recoveryContinue" }));
      });

      expect(screen.getByText("storage remains unavailable")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "controls.recoveryContinue" }).hasAttribute("disabled")
      ).toBe(false);
    });
  });
});
