import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AgentWelcomeCard } from "@/agentMode/ui/AgentWelcomeCard";
import { applyLanguage } from "@/i18n";

describe("AgentWelcomeCard", () => {
  it("invokes onCreate when the CTA is clicked", () => {
    const onCreate = jest.fn();
    render(<AgentWelcomeCard onCreate={onCreate} onDismiss={jest.fn()} />);
    fireEvent.click(screen.getByText("New project"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("shows the welcome copy in Simplified Chinese after switching language", () => {
    applyLanguage("zh-CN", []);
    try {
      render(<AgentWelcomeCard onCreate={jest.fn()} onDismiss={jest.fn()} />);
      expect(screen.getByText("试试项目")).not.toBeNull();
      expect(screen.getByText("新建项目")).not.toBeNull();
      expect(screen.getByLabelText("关闭")).not.toBeNull();
    } finally {
      applyLanguage("en", []);
    }
  });

  it("invokes onDismiss from the × control", () => {
    const onDismiss = jest.fn();
    render(<AgentWelcomeCard onCreate={jest.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
