import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildPiRuntimeFixture(outfile, scenario = "production") {
  const scenarios = {
    checkpointToolBoundary: [
      "checkpointToolBoundaryRuntimeScenario",
      "runCheckpointToolBoundaryRuntimeScenario",
    ],
    projectInstructions: [
      "projectInstructionsRuntimeScenario",
      "runProjectInstructionsRuntimeScenario",
    ],
    steer: ["steerRuntimeScenario", "runSteerRuntimeScenario"],
    historyCapacity: ["historyCapacityRuntimeScenario", "runHistoryCapacityRuntimeScenario"],
    sdkValidation: ["sdkValidationRuntimeScenario", "runSdkValidationRuntimeScenario"],
    instructionRefresh: [
      "instructionRefreshRuntimeScenario",
      "runInstructionRefreshRuntimeScenario",
    ],
    userPause: ["userPauseRuntimeScenario", "runUserPauseRuntimeScenario"],
    queuedRootInput: ["queuedRootInputRuntimeScenario", "runQueuedRootInputRuntimeScenario"],
    workContinuation: ["workContinuationRuntimeScenario", "runWorkContinuationRuntimeScenario"],
    stalled: ["stalledRuntimeScenario", "runStalledRuntimeScenario"],
    capacityPause: ["capacityPauseRuntimeScenario", "runCapacityPauseRuntimeScenario"],
    budgetPause: ["budgetPauseRuntimeScenario", "runBudgetPauseRuntimeScenario"],
    production: ["productionRuntimeScenario", "runProductionRuntimeScenario"],
    fanout: ["fanoutRuntimeScenario", "runFanoutRuntimeScenario"],
    queuedFanout: ["queuedFanoutRuntimeScenario", "runQueuedFanoutRuntimeScenario"],
    mcp: ["mcpRuntimeScenario", "runMcpRuntimeScenario"],
    mcpDisconnect: ["mcpDisconnectRuntimeScenario", "runMcpDisconnectRuntimeScenario"],
    selectionMutation: ["selectionMutationRuntimeScenario", "runSelectionMutationRuntimeScenario"],
    subagents: ["subagentRuntimeScenario", "runSubagentRuntimeScenario"],
    subagentResources: ["subagentResourcesRuntimeScenario", "runSubagentResourcesRuntimeScenario"],
    pool: ["poolRuntimeScenario", "runPoolRuntimeScenario"],
    dispatch: ["dispatchRuntimeScenario", "runDispatchRuntimeScenario"],
    native: ["nativeRuntimeScenario", "runNativeRuntimeScenario"],
    models: ["modelRuntimeScenario", "runModelRuntimeScenario"],
    openCodeSession: ["openCodeSessionRuntimeScenario", "runOpenCodeSessionScenario"],
    modelCapabilities: ["modelCapabilitiesScenario", "runModelCapabilitiesScenario"],
    compaction: ["compactionRuntimeScenario", "runCompactionRuntimeScenario"],
    compactionBoundaries: [
      "compactionBoundaryRuntimeScenario",
      "runCompactionBoundaryRuntimeScenario",
    ],
    recovery: ["recoveryRuntimeScenario", "runRecoveryRuntimeScenario"],
    rollover: ["rolloverRuntimeScenario", "runRolloverRuntimeScenario"],
    mutationIdentity: ["mutationIdentityRuntimeScenario", "runMutationIdentityRuntimeScenario"],
    mutationFailure: ["mutationFailureRuntimeScenario", "runMutationFailureRuntimeScenario"],
    nativeMutationFailure: [
      "nativeMutationFailureRuntimeScenario",
      "runNativeMutationFailureRuntimeScenario",
    ],
    startup: ["startupRuntimeScenario", "runStartupRuntimeScenario"],
    streamFailure: ["streamFailureRuntimeScenario", "runStreamFailureRuntimeScenario"],
    skills: ["skillsRuntimeScenario", "runSkillsRuntimeScenario"],
    initialization: ["initializationRuntimeScenario", "runInitializationRuntimeScenario"],
    mcpStdio: ["mcpStdioRuntimeScenario", "runMcpStdioRuntimeScenario"],
    backgroundReport: ["backgroundReportRuntimeScenario", "runBackgroundReportRuntimeScenario"],
    platformPath: ["platformPathRuntimeScenario", "runPlatformPathRuntimeScenario"],
    interactionBoundaries: [
      "interactionBoundaryRuntimeScenario",
      "runInteractionBoundaryRuntimeScenario",
    ],
  };
  const selected = scenarios[scenario];
  if (!selected) throw new Error(`Unknown production runtime scenario: ${scenario}`);
  const [moduleName, callable] = selected;
  await build({
    stdin: {
      contents: [
        `import { ${callable} as runScenario } from "@/agentMode/sdk/pi/testing/${moduleName}";`,
        "globalThis.window ??= globalThis;",
        'runScenario(process.argv[2]).then(report => process.stdout.write(JSON.stringify(report) + "\\n"), error => { process.stderr.write(String(error?.stack ?? error) + "\\n", () => process.exit(1)); });',
      ].join("\n"),
      resolveDir: projectRoot,
      sourcefile: "pi-production-runtime-fixture.ts",
      loader: "ts",
    },
    absWorkingDir: projectRoot,
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    loader: { ".md": "text", ".svg": "text" },
    plugins: [
      {
        name: "isolated-host-io",
        setup(bundle) {
          bundle.onResolve({ filter: /^obsidian$/ }, () => ({
            path: "host",
            namespace: "pi-test",
          }));
          bundle.onResolve({ filter: /^@\/logger$/ }, () => ({
            path: "logger",
            namespace: "pi-test",
          }));
          bundle.onLoad({ filter: /.*/, namespace: "pi-test" }, ({ path: name }) => ({
            loader: "js",
            contents:
              name === "logger"
                ? "export const logWarn = () => {}; export const logError = () => {}; export const logInfo = () => {};"
                : "export const Platform={isDesktopApp:true,isMobile:false}; export class TAbstractFile {} export class TFile extends TAbstractFile {} export class TFolder extends TAbstractFile {} export class MarkdownView {} export class FileSystemAdapter {} export class Notice {} export const requestUrl=async()=>{throw new Error('The diagnostic host has no Obsidian request service.')}; export const normalizePath=p=>p.replace(/\\\\/g,'/'); export const parseYaml=JSON.parse; export const stringifyYaml=JSON.stringify; export const moment=()=>({locale:()=> 'en'});",
          }));
        },
      },
    ],
  });
}
