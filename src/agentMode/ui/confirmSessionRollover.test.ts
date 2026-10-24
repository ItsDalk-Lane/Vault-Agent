import { App, Notice } from "obsidian";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { confirmSessionRollover } from "@/agentMode/ui/confirmSessionRollover";

jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: jest.fn(() => ({ open: jest.fn() })),
}));
jest.mock("@/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));

const modal = ConfirmModal as unknown as jest.Mock;
const notices = Notice as unknown as jest.Mock;

describe("confirmSessionRollover", () => {
  describe("confirmSessionRollover()", () => {
    beforeEach(() => jest.clearAllMocks());

    it("explains the preserved read-only source and starts only after explicit confirmation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const app = new App();
      const rollover = jest.fn(async () => undefined);
      confirmSessionRollover(app, rollover);
      expect(modal).toHaveBeenCalledWith(
        app,
        expect.any(Function),
        "controls.rolloverDescription",
        "controls.rolloverSession",
        "controls.rolloverSession"
      );
      expect(modal.mock.results[0].value.open).toHaveBeenCalledTimes(1);
      expect(rollover).not.toHaveBeenCalled();
      const confirm = modal.mock.calls[0][1] as () => Promise<void>;
      await confirm();
      expect(rollover).toHaveBeenCalledTimes(1);
      expect(notices).toHaveBeenCalledWith("controls.rolloverCompleted");
    });

    it("shows the backend failure without announcing that a new chat was created https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      confirmSessionRollover(new App(), async () => {
        throw new Error("there is an unfinished background task");
      });
      const confirm = modal.mock.calls[0][1] as () => Promise<void>;
      await confirm();
      expect(notices).toHaveBeenCalledWith(
        "controls.rolloverFailed there is an unfinished background task"
      );
      expect(notices).not.toHaveBeenCalledWith("controls.rolloverCompleted");
    });
  });
});
