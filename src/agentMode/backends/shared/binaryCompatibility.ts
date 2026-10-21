import type { InstallState } from "@/agentMode/session/types";
import { t } from "@/i18n";
import { compareSemver, parseSemver } from "@/utils/semver";

export type BinaryInspection =
  | { kind: "absent" }
  | { kind: "error"; message: string }
  | { kind: "installed"; version: string; source: "managed" | "custom" };

export function classifyBinaryInstall(
  inspection: BinaryInspection,
  minimumVersion: string,
  displayName: string
): InstallState {
  if (inspection.kind !== "installed") return inspection;
  const parsed = parseSemver(inspection.version);
  if (!parsed || !parseSemver(minimumVersion)) {
    return {
      kind: "error",
      message: t("agentInfra.backend.compat.invalidMetadata", { name: displayName }),
    };
  }
  const order = compareSemver(inspection.version, minimumVersion);
  // Prereleases of the minimum do not guarantee its stable protocol contract. https://github.com/Brevilabs/obsidian-copilot-private/issues/535
  if (order < 0 || (order === 0 && parsed.prerelease !== undefined)) {
    return {
      kind: "incompatible",
      source: inspection.source,
      currentVersion: inspection.version,
      minVersion: minimumVersion,
      message: t("agentInfra.backend.compat.unsupported", {
        name: displayName,
        version: inspection.version,
        minimum: minimumVersion,
      }),
    };
  }
  return { kind: "ready", source: inspection.source };
}

export function assertBinaryCompatible(
  inspection: BinaryInspection,
  minimumVersion: string,
  displayName: string
): void {
  const state = classifyBinaryInstall(inspection, minimumVersion, displayName);
  if (state.kind !== "ready")
    throw new Error(
      "message" in state
        ? state.message
        : t("agentInfra.backend.compat.notInstalled", { name: displayName })
    );
}
