import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseLegacyNativeHistory,
  readLegacyNativeHistory,
} from "@/agentMode/session/legacy/LegacyNativeReader";

jest.mock("@/utils/desktopRuntime", () => ({
  requireNodeModule: (name: string) => jest.requireActual(name),
}));

let directory: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-native-"));
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe("LegacyNativeReader", () => {
  describe("parseLegacyNativeHistory()", () => {
    it("reads existing Claude and Codex visible messages while omitting tool bookkeeping and private thinking https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const records = [
        { type: "user", message: { role: "user", content: "原问题" } },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "private reasoning" },
              { type: "text", text: "旧回答" },
            ],
          },
        },
        {
          type: "response_item",
          payload: { role: "assistant", content: [{ type: "output_text", text: "Codex 回答" }] },
        },
        { type: "tool_result", content: "tool-only output" },
      ];
      expect(
        parseLegacyNativeHistory(JSON.stringify(records)).map((message) => [
          message.sender,
          message.message,
        ])
      ).toEqual([
        ["user", "原问题"],
        ["ai", "旧回答"],
        ["ai", "Codex 回答"],
      ]);
    });

    it("keeps readable JSONL messages when unrelated or truncated records occur https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const transcript = [
        "{broken",
        JSON.stringify({ role: "user", text: "仍可读取" }),
        JSON.stringify({ role: "assistant", content: [] }),
        JSON.stringify(null),
      ].join("\n");
      expect(parseLegacyNativeHistory(transcript).map((message) => message.message)).toEqual([
        "仍可读取",
      ]);
    });
  });

  describe("readLegacyNativeHistory()", () => {
    it("reads a known Claude transcript from its original location without modifying its bytes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const cwd = path.join(directory, "vault");
      const folder = path.join(directory, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
      await fs.mkdir(folder, { recursive: true });
      const file = path.join(folder, "old-1.jsonl");
      const transcript = JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: "原生旧记录" },
      });
      await fs.writeFile(file, transcript);
      const result = await readLegacyNativeHistory({
        backendId: "claude",
        sessionId: "old-1",
        cwd,
        homeDir: directory,
      });
      expect(result.messages[0]?.message).toBe("原生旧记录");
      expect(await fs.readFile(file, "utf8")).toBe(transcript);
    });

    it("finds a dated Codex transcript without invoking an external command https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const folder = path.join(directory, ".codex", "sessions", "2026", "10", "22");
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(
        path.join(folder, "rollout-2026-old-2.jsonl"),
        JSON.stringify({
          type: "response_item",
          payload: { role: "user", content: [{ text: "旧问题" }] },
        })
      );
      const result = await readLegacyNativeHistory({
        backendId: "codex",
        sessionId: "old-2",
        cwd: directory,
        homeDir: directory,
      });
      expect(result.messages[0]?.message).toBe("旧问题");
    });

    it("rejects a session identifier that would leave the historical store https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      await expect(
        readLegacyNativeHistory({
          backendId: "claude",
          sessionId: "../private",
          cwd: directory,
          homeDir: directory,
        })
      ).rejects.toThrow("Invalid historical session identifier");
    });

    it("states that no source is available instead of inventing an old conversation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const result = await readLegacyNativeHistory({
        backendId: "claude",
        sessionId: "missing",
        cwd: directory,
        homeDir: directory,
      });
      expect(result.messages).toEqual([]);
      expect(result.notice).toContain("未找到");
    });
  });
});
