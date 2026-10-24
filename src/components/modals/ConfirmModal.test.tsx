import { ConfirmModal } from "./ConfirmModal";
import { act, fireEvent, within } from "@testing-library/react";
import { App } from "obsidian";

jest.mock("obsidian", () => {
  const actual = jest.requireActual<typeof import("obsidian")>("obsidian");
  class OpenableModal extends actual.Modal {
    constructor(app: App) {
      super(app);
      delete (this as Partial<OpenableModal>).onOpen;
      delete (this as Partial<OpenableModal>).onClose;
      this.open = () => {
        document.body.appendChild(this.containerEl);
        this.onOpen();
      };
      this.close = () => {
        this.onClose();
        this.containerEl.remove();
      };
    }
    setTitle(title: string): void {
      this.titleEl.setText(title);
    }
  }
  return { ...actual, Modal: OpenableModal };
});

const ISSUE = "https://github.com/ItsDalk-Lane/Vault-Agent/issues/1";

describe("ConfirmModal", () => {
  describe("ConfirmModal", () => {
    describe("constructor()", () => {
      it("uses the supplied title", () => {
        const modal = new ConfirmModal(new App(), () => {}, "Body", "Confirm change");
        expect(modal.titleEl.textContent).toBe("Confirm change");
      });
    });

    describe("onOpen()", () => {
      it(`preserves ordinary confirmation focus and primary styling ${ISSUE}`, () => {
        const modal = new ConfirmModal(new App(), () => {}, "Body", "Confirm change");
        const activeBefore = document.activeElement;
        act(() => modal.open());
        expect(document.activeElement).toBe(activeBefore);
        expect(
          within(modal.contentEl).getByRole("button", { name: "Continue" }).className
        ).toContain("mod-cta");
        act(() => modal.close());
      });

      it(`focuses Cancel for permanent deletion and invokes deletion only after confirmation ${ISSUE}`, async () => {
        const confirm = jest.fn(async () => {});
        const cancel = jest.fn();
        const modal = new ConfirmModal(
          new App(),
          confirm,
          "Cannot be undone.",
          "Delete chat",
          "Permanently delete",
          "Cancel",
          cancel,
          true
        );
        act(() => modal.open());
        expect(document.activeElement).toBe(
          within(modal.contentEl).getByRole("button", { name: "Cancel" })
        );
        expect(confirm).not.toHaveBeenCalled();
        const deleteButton = within(modal.contentEl).getByRole("button", {
          name: "Permanently delete",
        });
        expect(deleteButton.className).not.toContain("mod-cta");
        await act(async () => fireEvent.click(deleteButton));
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(cancel).not.toHaveBeenCalled();
        expect(modal.containerEl.isConnected).toBe(false);
      });
    });

    describe("onClose()", () => {
      it(`cancels permanent deletion without invoking the destructive action ${ISSUE}`, () => {
        const confirm = jest.fn();
        const cancel = jest.fn();
        const modal = new ConfirmModal(
          new App(),
          confirm,
          "Cannot be undone.",
          "Delete chat",
          "Permanently delete",
          "Cancel",
          cancel,
          true
        );
        act(() => modal.open());
        act(() => {
          fireEvent.click(within(modal.contentEl).getByRole("button", { name: "Cancel" }));
        });
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(confirm).not.toHaveBeenCalled();
        expect(modal.contentEl.childElementCount).toBe(0);
      });
    });
  });
});
