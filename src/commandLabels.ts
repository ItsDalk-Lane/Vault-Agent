import { t } from "./i18n";

/**
 * Command labels, resolved at call time.
 *
 * This MUST stay a function, not a module-scope const: ES module imports run
 * before the plugin's `onload` body calls `setLocale(...)`, so a top-level
 * `t()` would bake in the fallback (English) locale for every command name.
 * `registerCoreCommands` calls this after the locale is pinned.
 */
export function quickAddCommandLabels() {
	return {
		run: t("command.run"),
		runTemplateFromFolder: t("command.runTemplateFromFolder"),
		applyTemplate: t("command.applyTemplate"),
		reloadDev: t("command.reloadDev"),
		openSettings: t("command.openSettings"),
		resumePrompt: t("command.resumePrompt"),
	} as const;
}
