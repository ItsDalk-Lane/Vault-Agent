import { t } from "../i18n";
import type { PreviewSeverity, PreviewFlag } from "../types/packages/PackagePreview";
interface FlagMeta {
	severity: PreviewSeverity;
	/** Key under `packageManager.flag.*` for label/description. */
	i18nKey: string;
}

// One row per flag — severity and locale key in lockstep so adding a
// capability can't half-define it across parallel tables. Labels and
// descriptions resolve through `t()` at access time (never at module load,
// which would freeze the English strings before `setLocale` runs).
const FLAG_META: Record<PreviewFlag, FlagMeta> = {
	"user-script": { severity: "critical", i18nKey: "userScript" },
	"conditional-script": { severity: "critical", i18nKey: "conditionalScript" },
	"bundled-script": { severity: "critical", i18nKey: "bundledScript" },
	"run-on-startup": { severity: "critical", i18nKey: "runOnStartup" },
	"mislabeled-executable": { severity: "critical", i18nKey: "mislabeledExecutable" },
	"registers-command": { severity: "warning", i18nKey: "registersCommand" },
	"obsidian-command": { severity: "warning", i18nKey: "obsidianCommand" },
	ai: { severity: "warning", i18nKey: "ai" },
	"ai-tools": { severity: "critical", i18nKey: "aiTools" },
	"capture-writes": { severity: "warning", i18nKey: "captureWrites" },
	"template-write": { severity: "warning", i18nKey: "templateWrite" },
	"overwrites-existing-choice": { severity: "warning", i18nKey: "overwritesExistingChoice" },
	"overwrites-existing-file": { severity: "warning", i18nKey: "overwritesExistingFile" },
	"missing-reference": { severity: "warning", i18nKey: "missingReference" },
	"unknown-command": { severity: "warning", i18nKey: "unknownCommand" },
	"editor-command": { severity: "info", i18nKey: "editorCommand" },
	"open-file": { severity: "info", i18nKey: "openFile" },
};

export function flagSeverity(flag: PreviewFlag): PreviewSeverity {
	return FLAG_META[flag].severity;
}

export function flagLabel(flag: PreviewFlag): string {
	return t(`packageManager.flag.${FLAG_META[flag].i18nKey}.label`);
}

export function flagDescription(flag: PreviewFlag): string {
	return t(`packageManager.flag.${FLAG_META[flag].i18nKey}.description`);
}
