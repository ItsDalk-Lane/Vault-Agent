import { TurnUsageCapsule } from "@/agentMode/ui/TurnUsageCapsule";
import type { TurnUsageSummary } from "@/agentMode/session/types";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const USAGE: TurnUsageSummary = {
  inputTokens: 22_201,
  outputTokens: 1_001,
  cacheReadTokens: 22_144,
  cacheWriteTokens: 0,
  modelRequests: 2,
  modelDurationMs: 9_000,
  toolDurationMs: 4_000,
  ttftMs: 300,
  modelId: "deepseek-chat",
};

describe("TurnUsageCapsule", () => {
  describe("TurnUsageCapsule()", () => {
    it("shows the turn's display token total on the capsule (https://github.com/ItsDalk-Lane/Vault-Agent/issues/11)", () => {
      render(<TurnUsageCapsule usage={USAGE} />);

      expect(screen.getByText("45.3K tok")).toBeTruthy();
    });

    it("opens the detail popup above with model, cache hit and token rows (https://github.com/ItsDalk-Lane/Vault-Agent/issues/11)", () => {
      render(<TurnUsageCapsule usage={USAGE} />);
      fireEvent.click(screen.getByRole("button", { name: "This turn's token usage" }));

      expect(screen.getByText("This turn")).toBeTruthy();
      expect(screen.getByText("45,346 tok")).toBeTruthy();
      expect(screen.getByText("Model")).toBeTruthy();
      expect(screen.getByText("deepseek-chat")).toBeTruthy();
      expect(screen.getByText("50%")).toBeTruthy();
      expect(screen.getByText("22,201 tok")).toBeTruthy();
      expect(screen.getByText("22,144 tok")).toBeTruthy();
      expect(screen.getByText("1,001 tok")).toBeTruthy();
    });

    it("marks unknown model and undefined cache hit as em dashes (https://github.com/ItsDalk-Lane/Vault-Agent/issues/11)", () => {
      render(
        <TurnUsageCapsule
          usage={{
            inputTokens: 0,
            outputTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            modelRequests: 1,
          }}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "This turn's token usage" }));

      expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    });
  });
});
