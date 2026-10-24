import VaultAgentPlugin from "@/main";
import { FileSystemAdapter, TFile, type App } from "obsidian";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { AgentChatPersistenceManager } from "@/agentMode/session/AgentChatPersistenceManager";
import type { BackendDescriptor, BackendProcess } from "@/agentMode/session/types";
import type { AgentModelPreloader } from "@/agentMode/session/AgentModelPreloader";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { USER_SENDER, AI_SENDER } from "@/constants";
import { sha256 } from "@/utils/hash";

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
jest.mock("@/system-prompts/systemPromptRegister", () => ({
  SystemPromptRegister: class SystemPromptRegister {},
}));

describe("main", () => {
  describe("VaultAgentPlugin", () => {
    describe("loadChatById()", () => {
      it("reopens the same imported root through the plugin without changing backup bytes or automatically calling a model https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const file = Object.assign(new TFile(), { path: "chat/backup.md" });
        let content =
          "---\nmode: agent\nbackendId: pi\nsessionId: missing-original\n---\n**user**: 原口令ABC123\n**ai**: 好的";
        const originalHash = sha256(content);
        const imported = new Set<string>();
        const prompt = jest.fn(async () => {
          throw new Error("opening history must not call the model");
        });
        const backend = {
          start: async () => undefined,
          isRunning: () => true,
          onExit: () => () => undefined,
          setPermissionPrompter: () => undefined,
          registerSessionHandler: () => () => undefined,
          closeSession: async () => undefined,
          shutdown: async () => undefined,
          isSetSessionModeSupported: () => false,
          isSetSessionModelSupported: () => false,
          isSetSessionConfigOptionSupported: () => false,
          sessionExistsLocally: async ({ sessionId }: { sessionId: string }) =>
            imported.has(sessionId),
          loadSession: async ({ sessionId }: { sessionId: string }) => {
            if (!imported.has(sessionId)) throw new Error("session is missing");
            return { sessionId, state: { model: null, mode: null } };
          },
          importLegacySession: async ({ entry }: { entry: { sourceHash: string } }) => {
            const sessionId = `root-import-${entry.sourceHash}`;
            imported.add(sessionId);
            return { sessionId, state: { model: null, mode: null }, notices: [] };
          },
          prompt,
        } as unknown as BackendProcess;
        const processFrontMatter = jest.fn(
          async (_file: TFile, update: (frontmatter: Record<string, unknown>) => void) => {
            const frontmatter: Record<string, unknown> = {};
            update(frontmatter);
            content += `\nlastAccessedAt: ${String(frontmatter.lastAccessedAt)}`;
          }
        );
        const app = {
          vault: {
            adapter: new (FileSystemAdapter as unknown as new (path: string) => FileSystemAdapter)(
              "/vault"
            ),
            getAbstractFileByPath: () => file,
            read: async () => content,
            on: () => ({}),
            offref: () => undefined,
          },
          metadataCache: {
            getFileCache: () => ({ frontmatter: { mode: "agent" } }),
            on: () => ({}),
            offref: () => undefined,
          },
          fileManager: { processFrontMatter },
        } as unknown as App;
        const plugin = Object.assign(Object.create(VaultAgentPlugin.prototype), {
          app,
          manifest: { version: "test" },
          chatHistoryLastAccessedAtManager: new RecentUsageManager<string>({ nowMs: () => 1000 }),
          activateAgentView: jest.fn(async () => ({ view: {} })),
        }) as VaultAgentPlugin;
        const manager = new AgentSessionManager(app, plugin, {
          resolveDescriptor: (id) =>
            id === "pi"
              ? ({
                  id: "pi",
                  displayName: "Vault Agent",
                  createBackendProcess: () => backend,
                } as unknown as BackendDescriptor)
              : undefined,
          permissionPrompter: async () => ({ outcome: { outcome: "cancelled" } }),
          modelPreloader: {
            subscribe: () => () => undefined,
            getCachedModelCatalog: () => null,
            getWarmProcs: () => [],
            takeWarm: () => null,
            clearCached: () => undefined,
            shutdown: () => undefined,
          } as unknown as AgentModelPreloader,
          persistenceManager: {
            writableSessionPath: async () => undefined,
            loadFile: async () => ({
              backendId: "pi",
              sessionId: "missing-original",
              projectId: GLOBAL_SCOPE,
              messages: [
                {
                  id: "old-user",
                  sender: USER_SENDER,
                  message: "原口令ABC123",
                  timestamp: null,
                  isVisible: true,
                },
                {
                  id: "old-ai",
                  sender: AI_SENDER,
                  message: "好的",
                  timestamp: null,
                  isVisible: true,
                },
              ],
            }),
          } as unknown as AgentChatPersistenceManager,
        });
        plugin.agentSessionManager = manager;
        try {
          await plugin.loadChatById(file.path);
          const first = manager.getActiveSession();
          expect(first?.getBackendSessionId()).toMatch(/^root-import-/);
          expect(sha256(content)).toBe(originalHash);
          await plugin.loadChatById(file.path);
          expect(manager.getActiveSession()).toBe(first);
          expect(imported.size).toBe(1);
          expect(sha256(content)).toBe(originalHash);
          expect(processFrontMatter).not.toHaveBeenCalled();
          expect(prompt).not.toHaveBeenCalled();
        } finally {
          await manager.shutdown();
        }
      });

      it.each([
        { name: "imported backup", historical: false, source: "", persist: false },
        { name: "read-only history", historical: true, source: "chat/backup.md", persist: false },
        {
          name: "bound writable original session",
          historical: false,
          source: "chat/backup.md",
          persist: true,
        },
      ])(
        "updates only the local recent cache for $name unless it is the writable bound original https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
        async ({ historical, source, persist }) => {
          const file = Object.assign(new TFile(), { path: "chat/backup.md" });
          const processFrontMatter = jest.fn(async () => undefined);
          const tracker = new RecentUsageManager<string>({ nowMs: () => 1000 });
          const session = { internalId: "opened", isHistoricalOnly: () => historical };
          const manager = {
            loadSessionFromHistory: jest.fn(async () => session),
            getSessionSourcePath: jest.fn(() => source),
          };
          const plugin = Object.assign(Object.create(VaultAgentPlugin.prototype), {
            app: {
              vault: { getAbstractFileByPath: () => file },
              metadataCache: { getFileCache: () => ({ frontmatter: { mode: "agent" } }) },
              fileManager: { processFrontMatter },
            } as unknown as App,
            agentSessionManager: manager as unknown as AgentSessionManager,
            chatHistoryLastAccessedAtManager: tracker,
            activateAgentView: jest.fn(async () => ({ view: {} })),
          }) as VaultAgentPlugin;
          await plugin.loadChatById(file.path);
          expect(manager.loadSessionFromHistory).toHaveBeenCalledWith(file);
          expect(processFrontMatter).toHaveBeenCalledTimes(persist ? 1 : 0);
          expect(tracker.getEffectiveLastUsedAt(file.path, 1)).toBe(1000);
        }
      );
    });
  });
});
