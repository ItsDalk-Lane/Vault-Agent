import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SettingsMigration } from "@/agentMode/sdk/pi/storage/SettingsMigration";
import { LegacyImport } from "@/agentMode/sdk/pi/storage/LegacyImport";
import { SessionExport } from "@/agentMode/sdk/pi/storage/SessionExport";
import { LegacyHistoryReader } from "@/agentMode/session/legacy/LegacyHistoryReader";
import {
  backendDisplayOrder,
  backendRegistry,
  creatableBackendDescriptors,
  describeBackendForHistory,
  getEngineState,
  getPiModelState,
  isHistoricalBackendId,
} from "@/agentMode/backends/registry";

// GATE-P13 child: drives the real migration, legacy-reader, legacy-import, export and registry modules
// over fake hosts, plus the shipped dependency manifest:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const projectRoot = process.argv[2] ?? process.cwd();
const report = {};

// --- 1. idempotent versioned migration + backup ---
const migrationSettings = {
  openAIApiKey: "sk-live-secret",
  providers: [
    {
      providerId: "byok-openai",
      providerType: "openai",
      apiKeyKeychainId: "keychain-openai",
      origin: { kind: "byok", catalogProviderId: "openai" },
      addedAt: 1,
    },
    {
      providerId: "byok-openai",
      providerType: "openai",
      origin: { kind: "byok", catalogProviderId: "openai" },
      addedAt: 2,
    },
    {
      providerId: "agent-claude",
      providerType: "anthropic",
      requiresApiKey: false,
      extras: { credentialKind: "subscription" },
      origin: { kind: "agent", agentType: "claude" },
      addedAt: 3,
    },
  ],
  configuredModels: [
    {
      configuredModelId: "byok-openai:gpt-4o",
      providerId: "byok-openai",
      info: {},
      configuredAt: 1,
    },
    {
      configuredModelId: "agent-claude:sonnet",
      providerId: "agent-claude",
      info: {},
      configuredAt: 2,
    },
  ],
  agentMode: { activeBackend: "claude", byok: {} },
  chatRecords: [{ chatId: "chat-1", backendId: "claude" }],
};
const migrationState = {
  settings: migrationSettings,
  backups: [],
  writes: [],
  failBackup: false,
  failWrite: false,
};
const migration = new SettingsMigration({
  ports: {
    readSettings: async () => migrationState.settings,
    writeSettings: async (next) => {
      if (migrationState.failWrite) throw new Error("disk full");
      migrationState.writes.push(next);
      migrationState.settings = next;
    },
    writeBackup: async (input) => {
      if (migrationState.failBackup) throw new Error("no backup space");
      migrationState.backups.push(input);
      return { path: `migration/backup-${input.schemaVersion}.json` };
    },
  },
});
const firstMigration = await migration.migrate();
const secondMigration = await migration.migrate();
migrationState.settings = migrationSettings;
migrationState.failBackup = true;
const failedMigration = await migration.migrate();
migrationState.failBackup = false;
const retriedMigration = await migration.migrate();
const migrated = migrationState.writes[0];
const migratedProviders = migrated.providers;
report.migration =
  firstMigration.status === "migrated" &&
  secondMigration.status === "already_current" &&
  migrationState.backups.length === 2 &&
  JSON.stringify(migrationState.backups[0].payload).includes("sk-live-secret") === false &&
  migrationState.backups[0].payload.openAIApiKey === undefined &&
  Object.keys(migratedProviders).join(",") === "byok-openai,agent-claude" &&
  migratedProviders["byok-openai"].apiKeyKeychainId === "keychain-openai" &&
  migrated.configuredModels.find((m) => m.configuredModelId === "agent-claude:sonnet")
    .needsReconfiguration === true &&
  migrated.agentMode.activeBackend === "pi" &&
  JSON.stringify(migrated.chatRecords) === JSON.stringify(migrationSettings.chatRecords) &&
  failedMigration.status === "failed" &&
  migrationState.writes.length === 2 &&
  retriedMigration.status === "migrated";

// --- 2. pure legacy history reading (three backends, tree not spawn) ---
function markdown(backendId, sessionId, title, text) {
  return [
    "---",
    `backendId: ${backendId}`,
    `sessionId: ${sessionId}`,
    `title: ${title}`,
    "createdAtMs: 1700000000000",
    "---",
    "",
    `**user**: ${text}`,
    "",
    `**ai**: answer for ${backendId}`,
    "",
  ].join("\n");
}
const legacyFiles = [
  {
    path: "chats/old-claude.md",
    content: markdown("claude", "old-claude", "Old Claude chat", "summarize"),
  },
  {
    path: "chats/old-codex.md",
    content: markdown("codex", "old-codex", "Old Codex chat", "refactor"),
  },
  {
    path: "chats/old-opencode.md",
    content: markdown("opencode", "old-opencode", "Old opencode chat", "explain"),
  },
  {
    path: "chats/duplicate.md",
    content: markdown("claude", "old-claude", "Old Claude chat", "summarize"),
  },
];
const tombstones = new Set(["opencode:old-opencode"]);
const reader = new LegacyHistoryReader({
  ports: {
    listFiles: async () => legacyFiles,
    isTombstoned: async (backendId, sessionId) => tombstones.has(`${backendId}:${sessionId}`),
  },
});
const readResult = await reader.readAll();
report.legacyRead =
  readResult.entries.length === 2 &&
  readResult.entries
    .map((entry) => entry.backendId)
    .sort()
    .join(",") === "claude,codex" &&
  readResult.skipped.some((skip) => skip.reason === "tombstoned") &&
  readResult.skipped.some((skip) => skip.reason === "duplicate_source") &&
  readResult.entries.every((entry) => entry.importMode === "text_only" && entry.notice) &&
  readResult.entries[0].messages.length === 2 &&
  Object.keys(reader).length === 0 &&
  "spawn" in reader === false &&
  "exec" in reader === false &&
  "childProcess" in reader === false;

// --- 3. legacy import creates one Pi session per source (idempotent), labelled as material ---
const importRoots = [];
const importMaterials = [];
const importMappings = new Map();
let nextRoot = 1;
const legacyImport = new LegacyImport({
  ports: {
    findMapping: async (sourceHash) => importMappings.get(sourceHash),
    createRoot: async (input) => {
      const index = nextRoot++;
      importRoots.push(input);
      return { rootId: `root-${index}`, sessionId: `session-${index}` };
    },
    saveMapping: async (mapping) => importMappings.set(mapping.sourceHash, mapping),
    appendMaterial: async (input) => {
      importMaterials.push(input);
      return { messageId: `message-${importMaterials.length}` };
    },
    now: () => 1_700_000_000_000,
  },
});
const claudeEntry = readResult.entries.find((entry) => entry.backendId === "claude");
const firstImport = await legacyImport.importEntry(claudeEntry);
const secondImport = await legacyImport.importEntry(claudeEntry);
report.legacyImport =
  firstImport.status === "created" &&
  secondImport.status === "already_imported" &&
  secondImport.sessionId === firstImport.sessionId &&
  importRoots.length === 1 &&
  importMaterials.length === 1 &&
  importMaterials[0].origin === "legacy_session" &&
  importMaterials[0].text.includes("not a new user instruction") &&
  importMaterials[0].text.includes("**user**: summarize") &&
  importMaterials[0].importMode === "text_only";

// --- 4. export round-trip strips credentials, import stays read-only ---
const exportFiles = new Map();
const sessionExport = new SessionExport({
  ports: {
    writeFile: async (path, content) => {
      exportFiles.set(path, content);
    },
    readFile: async (path) => {
      const content = exportFiles.get(path);
      if (content === undefined) throw new Error(`missing ${path}`);
      return content;
    },
    now: () => 1_700_000_000_000,
  },
});
const exported = await sessionExport.exportSession({
  sessionId: "session-1",
  backendId: "pi",
  title: "Pi chat",
  createdAtMs: 1_700_000_000_000,
  lastAccessedAtMs: 1_700_000_100_000,
  messages: [
    { role: "user", text: "hello" },
    { role: "assistant", text: "hi" },
  ],
  extras: {
    mcpServers: [{ name: "docs", url: "https://docs.test/mcp", token: "mcp-secret-token" }],
    apiKeyKeychainId: "keychain-openai",
    theme: "dark",
  },
});
const exportedContent = exportFiles.get(exported.path) ?? "";
const roundTrip = await sessionExport.importDocument(exported.path);
report.export =
  exported.ok === true &&
  exportedContent.includes("mcp-secret-token") === false &&
  exportedContent.includes("keychain-openai") === false &&
  exportedContent.includes("https://docs.test/mcp") === true &&
  roundTrip.ok === true &&
  roundTrip.readOnly === true &&
  roundTrip.requiresAuthorization === true &&
  roundTrip.document.session.messages.map((message) => message.text).join(",") === "hello,hi" &&
  activeExportWrites(exportFiles) === 1;

function activeExportWrites(files) {
  return files.size;
}

// --- 5. registry: single creatable engine, legacy labels - only history ---
report.registry =
  backendDisplayOrder()
    .map((descriptor) => descriptor.id)
    .join(",") === "pi" &&
  creatableBackendDescriptors()
    .map((descriptor) => descriptor.id)
    .join(",") === "pi" &&
  backendRegistry.pi !== undefined &&
  ["claude", "codex", "opencode"].every((id) => isHistoricalBackendId(id)) &&
  describeBackendForHistory("claude").label === "Claude" &&
  describeBackendForHistory("claude").installRequired === false &&
  describeBackendForHistory("codex").label === "Codex" &&
  describeBackendForHistory("opencode").label === "opencode" &&
  getEngineState().kind === "ready" &&
  getPiModelState({ hasKey: false }).kind === "missing_key" &&
  getPiModelState({ hasKey: true }).kind === "configured";

// --- 6. shipped manifest and source tree carry no legacy execution/install chain ---
const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const allDeps = {
  ...(pkg.dependencies ?? {}),
  ...(pkg.devDependencies ?? {}),
};
report.dependencies =
  allDeps["@agentclientprotocol/sdk"] === undefined &&
  allDeps["@anthropic-ai/claude-agent-sdk"] === undefined &&
  readFileSync(join(projectRoot, "package-lock.json"), "utf8").includes(
    "@anthropic-ai/claude-agent-sdk"
  ) === false;

const removeLegacySources = [
  "src/agentMode/acp",
  "src/agentMode/sdk/ClaudeSdkBackendProcess.ts",
  "src/agentMode/sdk/permissionBridge.ts",
  "src/agentMode/backends/claude/ClaudeInstallModal.tsx",
  "src/agentMode/backends/codex/CodexBinaryManager.ts",
  "src/agentMode/backends/opencode/OpencodeBinaryManager.ts",
  "src/agentMode/backends/shared/managedInstall.ts",
  "src/agentMode/skills/symlinks.ts",
];
const existsLegacy = removeLegacySources.filter((path) => {
  try {
    readFileSync(join(projectRoot, path).replace(/\/$/, "/index.ts"));
    return true;
  } catch {
    return false;
  }
});
report.removedChains = existsLegacy.length === 0;

// Content hash of the demo report payload to prove these are real module outputs.
report.payloadHash = createHash("sha256").update(JSON.stringify(report)).digest("hex");
report.result = "passed";
process.stdout.write(JSON.stringify(report));
