import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("QueuedMessageList", () => {
  describe("QueuedMessageList()", () => {
    const allInsertable = () => true;
    it("labels image-only rows and keeps their removal https://github.com/logancyang/obsidian-copilot/issues/2850", () => {
      const onRemove = jest.fn();
      render(
        <QueuedMessageList
          messages={[
            {
              id: "image",
              text: "",
              rawInput: "",
              promptContent: [{ type: "image", mimeType: "image/png", data: "AQID" }],
            },
          ]}
          onRemove={onRemove}
          onEdit={jest.fn()}
          onInsert={jest.fn()}
          canInsert={allInsertable}
        />
      );
      expect(screen.getByTitle("Image attachment")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Remove queued message" }));
      expect(onRemove).toHaveBeenCalledWith("image");
    });
    it("labels an empty command without claiming it contains an image https://github.com/logancyang/obsidian-copilot/issues/2850", () => {
      render(
        <QueuedMessageList
          messages={[{ id: "empty", text: "", rawInput: "/empty" }]}
          onRemove={jest.fn()}
          onEdit={jest.fn()}
          onInsert={jest.fn()}
          canInsert={allInsertable}
        />
      );
      expect(screen.getByTitle("Empty message")).toBeTruthy();
    });
    it("displays the text of a queued message", () => {
      render(
        <QueuedMessageList
          messages={[{ id: "text", text: "Explain this", rawInput: "Explain this" }]}
          onRemove={jest.fn()}
          onEdit={jest.fn()}
          onInsert={jest.fn()}
          canInsert={allInsertable}
        />
      );
      expect(screen.getByTitle("Explain this")).toBeTruthy();
    });
    it("offers edit, delete and insert actions per queued message https://github.com/ItsDalk-Lane/Vault-Agent/issues/16", () => {
      const onEdit = jest.fn();
      const onInsert = jest.fn();
      render(
        <QueuedMessageList
          messages={[{ id: "text", text: "Explain this", rawInput: "Explain this" }]}
          onRemove={jest.fn()}
          onEdit={onEdit}
          onInsert={onInsert}
          canInsert={allInsertable}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Edit queued message" }));
      expect(onEdit).toHaveBeenCalledWith("text");
      fireEvent.click(screen.getByRole("button", { name: "Insert into the running turn" }));
      expect(onInsert).toHaveBeenCalledWith("text");
    });
    it("disables insert with an auto-send hint for messages the current turn cannot take https://github.com/ItsDalk-Lane/Vault-Agent/issues/16", () => {
      const onInsert = jest.fn();
      render(
        <QueuedMessageList
          messages={[{ id: "command", text: "/compact", rawInput: "/compact" }]}
          onRemove={jest.fn()}
          onEdit={jest.fn()}
          onInsert={onInsert}
          canInsert={() => false}
        />
      );
      const insert = screen.getByRole("button", { name: "Insert into the running turn" });
      expect(insert).toHaveProperty("disabled", true);
      expect(insert.getAttribute("title")).toBe("This message will send after the current turn");
      fireEvent.click(insert);
      expect(onInsert).not.toHaveBeenCalled();
    });
    it("keeps every row's actions locked while an insert is pending https://github.com/ItsDalk-Lane/Vault-Agent/issues/16", () => {
      const onEdit = jest.fn();
      const onRemove = jest.fn();
      render(
        <QueuedMessageList
          messages={[{ id: "text", text: "Explain this", rawInput: "Explain this" }]}
          onRemove={onRemove}
          onEdit={onEdit}
          onInsert={jest.fn()}
          canInsert={allInsertable}
          pendingInsertId="text"
        />
      );
      for (const name of [
        "Edit queued message",
        "Remove queued message",
        "Insert into the running turn",
      ]) {
        expect(screen.getByRole("button", { name })).toHaveProperty("disabled", true);
      }
      fireEvent.click(screen.getByRole("button", { name: "Edit queued message" }));
      expect(onEdit).not.toHaveBeenCalled();
      expect(onRemove).not.toHaveBeenCalled();
    });
  });
});
