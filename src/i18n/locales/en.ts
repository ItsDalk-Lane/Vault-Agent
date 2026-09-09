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
		skip: "Skip",
		skipTooltip: "Leave empty",
		submit: "Submit",
		search: "Search",
		loading: "Loading…",
		peekAtNote: "Peek at note",
		typeToSearch: "Type to search…",
	},
	onePageInput: {
		note: "Note",
		notePlaceholder: "Search notes or create new note",
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
		group: {
			choicesAndPackages: "Choices & packages",
			choicePicker: "Choice picker",
			input: "Input",
			templatesAndProperties: "Templates & properties",
			notifications: "Notifications",
			globalVariables: "Global variables",
			aiAndOnline: "AI & online",
			developer: "Developer",
		},
		docs: {
			quickAddTooltip: "QuickAdd documentation",
			learnMore: "Learn more",
			packagesLink: "Learn more about packages",
			learnMoreAboutOnePageInput: "Learn more about one-page inputs",
		},
		choices: {
			name: "Choices",
		},
		packages: {
			name: "Packages",
			desc: "Bundle or import QuickAdd automations as reusable packages.",
			descNeedsChoice: "Bundle or import QuickAdd automations as reusable packages. Export becomes available once you have a choice. ",
			exportButton: "Export package…",
			importButton: "Import package…",
			nothingToExport: "Nothing to export yet",
		},
		items: {
			searchNestedChoices: {
				name: "Search nested choices",
				desc: "When searching in the choice picker, also match choices nested inside folders and show their path. Note that nested matches can outrank same-level ones. Disable to search only the open level.",
			},
			templateFolderLauncherRow: {
				name: "“New note from template” in the launcher",
				desc: "Add a row to Run QuickAdd that lists templates from your configured template folder, so you can create a note from a template without a dedicated Template choice. Only appears when a template folder is configured; the command palette entry works regardless.",
				bottom: "Show at the bottom (keeps your top choice first)",
				top: "Show at the top",
				off: "Hide",
			},
			useMultiLine: {
				name: "Use multi-line input prompt",
				desc: "Use multi-line input prompt instead of single-line input prompt. Submit multi-line prompts with Ctrl/Cmd+Enter; Enter inserts a newline.",
			},
			persistDrafts: {
				name: "Persist input prompt drafts",
				desc: "Keep drafts when closing input prompts so they can be restored on reopen. Drafts are stored only for this session.",
			},
			useSelection: {
				name: "Use editor selection as default Capture value",
				desc: "When enabled, Capture uses the current editor selection as {{VALUE}} and may skip the prompt. When disabled, Capture always prompts for {{VALUE}}.",
			},
			namePastedImages: {
				name: "Name pasted images after the note title",
				desc: "When on, clipboard images saved by QuickAdd (pasting into a prompt, or {{CLIPBOARD}} with an image and no text) are named after the destination note. When the destination is not yet known, QuickAdd keeps the timestamp name. Duplicate names are handled by Obsidian's attachment folder setting.",
			},
			onePageInput: {
				name: "One-page input for choices",
				descPrefix: "Collect a choice's inputs in one form before it runs, instead of one prompt at a time. Works with Template and Capture choices, and with Macros whose scripts declare inputs. Template and Capture choices can override this individually. ",
			},
			dateAliases: {
				name: "Date aliases",
				desc: "Shortcodes for natural language date parsing. One per line: alias = phrase. Example: tm = tomorrow.",
				placeholder: "t = today\ntm = tomorrow\nyd = yesterday",
				resetButton: "Reset to defaults",
			},
			templateFolderPaths: {
				name: "Template folder paths",
				desc: "Folders where templates are stored. Used to suggest template files when configuring QuickAdd. Add as many as you like; leave empty to suggest every template file in the vault.",
				empty: "No folders added yet.",
				placeholder: "templates/",
				addButton: "Add",
			},
			convertStringTypes: {
				name: "Convert string front matter variables to typed properties (Beta)",
				desc: 'List/object values from scripts are always written as proper Obsidian properties (a list becomes a List). This toggle additionally converts string values into typed properties: a comma or bullet-list string becomes a List, "42" becomes a Number, "true" becomes a Checkbox, etc. Disabled by default; the string conversion is a beta heuristic that may have edge cases.',
			},
			announceUpdates: {
				name: "Announce updates",
				desc: "Display release notes when a new version is installed. This includes new features, demo videos, and bug fixes.",
				all: "Show updates on each new release",
				major: "Show updates only on major releases (new features, breaking changes)",
				none: "Don't show",
			},
			showCaptureNotifications: {
				name: "Show capture notifications",
				desc: "Display a notification when content is captured successfully to confirm the operation completed.",
			},
			showInputCancellation: {
				name: "Show input cancellation notifications",
				desc: "Display a notification when an input prompt is cancelled without submitting. Disable this to avoid extra notices when dismissing prompts.",
			},
			disableAI: {
				name: "Disable AI & online features",
				desc: "This prevents the plugin from making requests to external providers like OpenAI. You can still use user scripts to execute arbitrary code, including contacting external providers. However, this setting disables plugin features like the AI Assistant from doing so. You need to disable this setting to use the AI Assistant.",
			},
			allowUriCallbacks: {
				name: "Allow URI x-callback-url",
				desc: "When on, an obsidian://quickadd URI may open a callback URL (x-success / x-error / x-cancel) after a Template or Capture choice finishes — sending the outcome and the affected note's vault path and URL to that callback. While on, a URI that carries x-* callback params is restricted to Template and Capture choices (other choice types are warned and skipped). Off by default because the callback URL is set by whoever creates the obsidian:// link. Only shortcuts: and obsidian: callback URLs are permitted.",
			},
			development: {
				name: "Development information",
				desc: "Git information for developers.",
			},
			globalVariables: {
				name: "Global variables",
			},
		},
	},
} as const;

export default en;
