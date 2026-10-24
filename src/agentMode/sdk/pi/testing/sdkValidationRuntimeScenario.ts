import { runStalledRuntimeScenario } from "./stalledRuntimeScenario";

export function runSdkValidationRuntimeScenario(directory: string) {
  return runStalledRuntimeScenario(directory, true);
}
