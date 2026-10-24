import VaultAgentPlugin from "@/main";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { buildNativeChatId } from "@/utils/nativeChatId";
import { Notice } from "obsidian";
import { t } from "@/i18n";

jest.mock("obsidian", () => ({
  ...jest.requireActual<typeof import("obsidian")>("obsidian"),
  Plugin: class Plugin {},
}));
jest.mock("@/settings/SettingsPage", () => ({
  VaultAgentSettingTab: class VaultAgentSettingTab {},
}));
jest.mock("@/commands", () => ({ registerCommands: jest.fn() }));
jest.mock("@/modelManagement", () => ({ createModelManagement: jest.fn() }));
jest.mock("@/contextProcessor", () => ({ ContextProcessor: class ContextProcessor {} }));
jest.mock("@/commands/customCommandRegister", () => ({
  CustomCommandRegister: class CustomCommandRegister {},
}));
jest.mock("@/projects/projectRegister", () => ({ ProjectRegister: class ProjectRegister {} }));
describe("main", () => {
  describe("VaultAgentPlugin", () => {
    describe("getChatHistoryItems()", () => {
      it("returns the manager's disk session list https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const items = [{ id: buildNativeChatId("pi", "stored"), title: "Stored chat" }];
        const plugin = Object.assign(Object.create(VaultAgentPlugin.prototype), {
          agentSessionManager: {
            getChatHistoryItems: jest.fn(async () => items),
          } as unknown as AgentSessionManager,
        }) as VaultAgentPlugin;
        await expect(plugin.getChatHistoryItems()).resolves.toBe(items);
      });

      it("returns no history before the session manager is ready https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const plugin = Object.create(VaultAgentPlugin.prototype) as VaultAgentPlugin;
        await expect(plugin.getChatHistoryItems()).resolves.toEqual([]);
      });
    });

    describe("loadChatById()", () => {
      it("rejects note paths without opening or rewriting any vault file https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const plugin = Object.create(VaultAgentPlugin.prototype) as VaultAgentPlugin;
        await expect(plugin.loadChatById("chat/backup.md")).rejects.toThrow();
      });
    });

    describe("openChatDeepLink()", () => {
      it("explains that a permanently deleted session no longer exists https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const loadChatById = jest
          .fn()
          .mockRejectedValue(Object.assign(new Error("missing"), { code: "SESSION_NOT_FOUND" }));
        const plugin = Object.assign(Object.create(VaultAgentPlugin.prototype), {
          loadChatById,
        }) as VaultAgentPlugin;
        await plugin.openChatDeepLink({ id: "root-deleted" });
        expect(Notice).toHaveBeenLastCalledWith(t("localData.sessionMissing"));
      });
    });
  });
});
