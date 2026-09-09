/**
 * English locale strings for the QuickAdd plugin.
 *
 * Convention: dot-separated keys via `t("command.run")`. Adding a new key here
 * means adding it to every locale file (or accepting English fallback). Keeping
 * this file the "source of truth" makes missing translations obvious — the
 * fallback to English in `t()` is the user-visible symptom.
 *
 * Why TypeScript and not JSON: `pnpm run build` runs `tsc --noEmit` first, and
 * `resolveJsonModule` would require a tsconfig.json change — but the project
 * contract (per the i18n fork plan) forbids touching tsconfig.json so rebase
 * stays clean. TS modules get inlined by esbuild exactly the same way JSON
 * would, so the runtime shape is identical; only the editor experience differs
 * (slightly better: tsc catches typos in key paths).
 */
const en = {
	command: {
		run: "Run QuickAdd",
		runTemplateFromFolder: "New note from template",
		applyTemplate: "Apply template to active note",
		reloadDev: "Reload (dev)",
		openSettings: "Open QuickAdd settings",
		resumePrompt: "Return to prompt",
	},
	common: {
		yes: "Yes",
		no: "No",
		ok: "OK",
		cancel: "Cancel",
		confirm: "Confirm",
		delete: "Delete",
		save: "Save",
		add: "Add",
		remove: "Remove",
		close: "Close",
		back: "Back",
		next: "Next",
		done: "Done",
		search: "Search",
		loading: "Loading…",
	},
	settings: {
		language: {
			name: "Language",
			desc: "Choose the plugin UI language. \"Auto (follow Obsidian)\" matches Obsidian's language setting. Reload the plugin after switching languages — command names and modal labels don't update live.",
			auto: "Auto (follow Obsidian)",
			en: "English",
			"zh-CN": "简体中文",
		},
		appearance: {
			heading: "Appearance",
			ribbonIconName: "Show icon in sidebar",
			ribbonIconDesc: "Add QuickAdd icon to the sidebar ribbon. Requires a reload.",
		},
	},
} as const;

export default en;
