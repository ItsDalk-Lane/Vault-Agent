import { FileSystemAdapter, type App } from "obsidian";
import type VaultAgentPlugin from "@/main";
import { AgentModelPreloader } from "@/agentMode/session/AgentModelPreloader";
import type { BackendDescriptor } from "@/agentMode/session/types";
import type { VaultAgentSettings } from "@/settings/model";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { StoreLocator } from "@/agentMode/sdk/pi/storage/StoreLocator";
import { requireNodeModule } from "@/utils/desktopRuntime";

export async function runStartupRuntimeScenario(directory: string) {
  const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const vaultRoot = path.join(directory, "vault");
  await fs.mkdir(vaultRoot, { recursive: true });
  const app = {
    vault: {
      configDir: ".fixture-config",
      adapter: Object.assign(Object.create(FileSystemAdapter.prototype), {
        getBasePath: () => vaultRoot,
      }),
      getFiles: () => [],
      getMarkdownFiles: () => [],
      on: () => ({}),
      offref: () => undefined,
    },
    workspace: {},
  } as unknown as App;
  const settings = {
    providers: {},
    configuredModels: [],
    backends: {},
    agentMode: { skills: { folder: "skills" }, backends: {}, offerFeedbackCards: false },
  } as unknown as VaultAgentSettings;
  const backend = new PiBackendProcess({
    host: {
      app,
      privateRoot: path.join(directory, "private"),
      getSettings: () => settings,
      keychain: {
        isAvailable: () => true,
        getVaultId: () => "startup-failure",
        getSecretById: () => null,
        setSecretById: () => undefined,
        deleteSecretById: () => undefined,
      },
    },
  });
  let unhealthyNotifications = 0;
  backend.setUnhealthyHandler(() => {
    unhealthyNotifications += 1;
  });
  let exitNotifications = 0;
  backend.onExit(() => {
    exitNotifications += 1;
  });
  const locator = new StoreLocator({
    platform: process.platform,
    homeDir: path.join(directory, "private"),
    env: {},
    vaultRoot,
    vaultId: "startup-failure",
  });
  const failedPaths = locator.sessionStorePaths("root-startup-failure");
  const rename = fs.rename;
  const fetch = window.fetch;
  let networkCalls = 0;
  window.fetch = async () => {
    networkCalls += 1;
    throw new Error("A session lifecycle operation must not call a model.");
  };
  try {
    const preloader = new AgentModelPreloader(
      app,
      { manifest: { version: "test" } } as VaultAgentPlugin,
      () => ({ id: "pi", createBackendProcess: () => backend }) as unknown as BackendDescriptor
    );
    await preloader.preload("pi");
    assert.equal(preloader.takeWarm("pi")?.proc, backend);
    const locations = backend.getLocalStoragePaths();
    assert.deepEqual((await backend.listSessions({ cwd: vaultRoot })).sessions, []);
    assert.deepEqual(await fs.readdir(locations.sessionsRoot), []);
    assert.deepEqual(await fs.readdir(vaultRoot), []);
    const unaffected = await backend.newSession({
      cwd: vaultRoot,
      sessionId: "root-startup-unaffected",
    });
    // 在真实显示快照落盘处故障，失败创建不能留下一条看似可打开的聊天。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    fs.rename = async (source, target) => {
      if (String(target) === path.join(path.dirname(failedPaths.metaPath), "recovery-view.json"))
        throw new Error("injected recovery snapshot failure");
      await rename(source, target);
    };
    try {
      await assert.rejects(
        backend.newSession({ cwd: vaultRoot, sessionId: "root-startup-failure" }),
        /injected recovery snapshot failure/
      );
    } finally {
      fs.rename = rename;
    }
    assert.equal(
      await backend.sessionExistsLocally({ sessionId: "root-startup-failure", cwd: vaultRoot }),
      false,
      "a failed creation must not become a saved session"
    );
    assert.deepEqual(
      (await backend.listSessions({ cwd: vaultRoot })).sessions.map((session) => session.sessionId),
      [unaffected.sessionId]
    );
    assert.equal(unhealthyNotifications, 0, "one failed creation must not restart other chats");
    assert.equal(exitNotifications, 0, "one failed creation must not exit the runtime");
    assert.equal(backend.isRuntimeReady(), true);
    assert.equal(backend.isRunning(), true);
    await assert.rejects(fs.stat(failedPaths.leaseDir), { code: "ENOENT" });
    assert.equal(
      (await backend.loadSession({ sessionId: unaffected.sessionId, cwd: vaultRoot })).sessionId,
      unaffected.sessionId,
      "the original chat remains usable after the individual failure"
    );
    const created = await backend.newSession({
      cwd: vaultRoot,
      sessionId: "root-startup-failure",
    });
    assert.equal(created.sessionId, "root-startup-failure");
    await backend.closeSession({ sessionId: created.sessionId });
    await backend.loadSession({ sessionId: created.sessionId, cwd: vaultRoot });
    assert.deepEqual(
      (await backend.listSessions({ cwd: vaultRoot })).sessions
        .map((session) => session.sessionId)
        .sort(),
      [unaffected.sessionId, created.sessionId].sort()
    );
    await backend.shutdown();
    assert.equal(exitNotifications, 1, "only the explicit shutdown publishes an exit");
    assert.equal(unhealthyNotifications, 0);
    await backend.shutdown();
    assert.equal(networkCalls, 0);
    return {
      status: "passed",
      checks: [
        "preload_without_session_files",
        "no_ghost_index",
        "individual_creation_failure_does_not_restart_runtime",
        "other_chat_remains_usable",
        "retry_releases_lease",
        "load_without_model",
        "double_shutdown",
      ],
      modelCalls: networkCalls,
    };
  } finally {
    fs.rename = rename;
    window.fetch = fetch;
    await backend.shutdown();
  }
}
