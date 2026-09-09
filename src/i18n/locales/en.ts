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
	macro: {
		// CommandSequenceEditor.ts — left column "Add command" pickers
		obsidianCommand: {
			name: "Obsidian command",
			desc: "Add an Obsidian command",
			placeholder: "Obsidian command",
		},
		editorCommand: {
			name: "Editor commands",
			desc: "Add editor command",
		},
		userScript: {
			name: "User scripts",
			desc: "Add a .js file or a note with a ```js code block - type the name or click Browse",
			placeholder: "Start typing script name...",
			browse: "Browse",
			browseTooltip: "Browse and select a script (.js file or note)",
		},
		choice: {
			name: "Choices",
			desc: "Add existing choice",
			placeholder: "Choice",
		},
		addOpenFileTooltip: "Add open file command",
		addAiAssistantTooltip: "Add AI Assistant command",
		addWaitTooltip: "Add wait command",
		addConditionalTooltip: "Add conditional command",
		selectCommand: "Select command",

		// MacroBuilder.ts
		onePageInputOverride: "One-page input override",
		onePageInputFollow: "Follow global setting",
		onePageInputAlways: "Always",
		onePageInputNever: "Never",
		runOnStartup: {
			name: "Run on startup",
			desc: "Execute this macro when Obsidian starts",
		},
		relativeOffsetPlaceholder: "-2",
		relativeOffsetUnitPlaceholder: "day",

		// ConditionalBranchEditorModal.ts
		closeButton: "Close",

		// ConditionalCommandSettingsModal.ts
		configureTitle: "Configure conditional command",
		conditionType: {
			name: "Condition type",
			desc: "Choose how this condition should be evaluated.",
		},
		variableName: {
			name: "Variable name",
			desc: "Name of the macro variable to inspect (without the $ prefix).",
			placeholder: "e.g. projectStatus",
		},
		operator: {
			name: "Operator",
			desc: "How to compare the variable value.",
		},
		valueType: {
			name: "Value type",
			desc: "How to interpret the comparison value.",
		},
		kind: {
			variable: "Macro variable",
			script: "Run script",
		},
		operators: {
			equals: "Equals",
			notEquals: "Does not equal",
			lessThan: "Less than",
			lessThanOrEqual: "Less than or equal",
			greaterThan: "Greater than",
			greaterThanOrEqual: "Greater than or equal",
			contains: "Contains",
			notContains: "Does not contain",
			isTruthy: "Is truthy",
			isFalsy: "Is falsy",
		},
		valueTypes: {
			string: "Text",
			number: "Number",
			boolean: "Boolean",
		},
		expectedBool: {
			name: "Expected value",
			desc: "Choose true or false.",
			true: "True",
			false: "False",
		},
		expectedValue: {
			name: "Expected value",
			desc: "Value to compare against.",
			placeholder: "Enter comparison value",
		},
		scriptPath: {
			name: "Script path",
			desc: "Vault-relative path to a .js file or a note with a ```js code block.",
			placeholder: "scripts/myCheck.js or Notes/myCheck.md",
			browse: "Browse",
			browseTooltip: "Select a script (.js file or note)",
			browseEmpty: "No scripts found in your vault",
			browseLabel: "Select a script (.js file or note with a ```js block)",
		},
		exportName: {
			name: "Export name",
			desc: "Optional export or member to call (use :: to access nested members).",
			placeholder: "default",
		},
		notices: {
			enterVariableName: "QuickAdd: Enter a variable name before saving.",
			enterScriptPath: "QuickAdd: Enter a script path before saving.",
		},

		// UserScriptSettingsModal.ts
		saveSecretTooltip: "Save secret",
		clearSecretTooltip: "Clear secret",

		// OpenFileCommandSettingsModal.ts
		filePath: {
			name: "File path",
			desc: "Path to the file. Supports formatting like {{DATE}}, {{VALUE}}, etc.",
			placeholder: "{{DATE}}todo.md",
		},
		whereToOpen: {
			name: "Where to open",
			desc: "Choose tab, split, window, or sidebar",
		},
		splitDirection: {
			name: "Split direction",
			desc: "How to arrange the new pane relative to the current one",
		},
		focusOpenedFile: {
			name: "Focus opened file",
			desc: "Bring the opened file to the foreground",
		},

		// AIAssistantCommandSettingsModal.ts
		aiModel: {
			name: "Model",
			desc: "The model the AI Assistant will use",
		},
		systemPrompt: {
			name: "System prompt",
			desc: "The system prompt for the AI Assistant",
		},
		showAdvancedSettings: "Show advanced settings",
		promptTemplate: {
			name: "Prompt template",
			desc: "Enabling this will have the assistant use the prompt template you specify. If disable, the assistant will ask you for a prompt template to use.",
		},
		outputVariableName: {
			name: "Output variable name",
			desc: "The name of the variable used to store the AI Assistant output, i.e. {{value:output}}.",
		},
		newName: "New name",
		systemPromptAria: "System prompt",
		advancedSettings: {
			desc: "Sampling settings such as temperature and top p. Untouched settings use the provider's defaults.",
		},
		estimatedLocally: "Estimated locally. Providers enforce exact context limits.",
	},

	openFile: {
		title: "Open file command settings",
		whereToOpen: {
			reuse: "Reuse active tab",
			tab: "New tab",
			split: "Split",
			window: "New window",
			leftSidebar: "Left sidebar",
			rightSidebar: "Right sidebar",
		},
		splitDirection: {
			right: "Split right",
			down: "Split down",
		},
	},

	userScript: {
		saveSecretTooltip: "Save secret",
		clearSecretTooltip: "Clear secret",
		pasteSecret: "Paste secret",
		pasteSecretPlaceholder: "Paste a secret before saving.",
		secretSaved: "Secret saved.",
		secretCleared: "Secret cleared.",
		secretSavedShort: "Secret saved",
		secretStorageUnavailableSave: "SecretStorage is unavailable. Secret was not saved.",
		secretStorageUnavailableClear: "SecretStorage is unavailable. Secret was not cleared.",
	},

	ai: {
		// AIAssistantSettingsModal.ts (settings tab — settings.ai.* namespace already covers some, this is the modal overlay)
		providers: {
			name: "Providers",
			desc: "The providers for the AI Assistant",
			editButton: "Edit providers",
		},
		defaultModel: {
			name: "Default model",
			desc: "The default model for the AI Assistant",
		},
		promptTemplateFolderPath: {
			name: "Prompt template folder path",
			desc: "Path to your folder with prompt templates",
		},
		showAssistant: {
			name: "Show assistant",
			desc: "Show status messages from the AI Assistant",
		},
		confirmToolCalls: "Confirm AI tool calls",
		defaultSystemPrompt: {
			name: "Default system prompt",
			desc: "The default system prompt for the AI Assistant",
		},

		// ModelDirectoryModal.ts
		search: {
			name: "Search",
			placeholder: "Filter by name",
		},
		selectAll: "Select all",
		clearSelection: "Clear selection",
		importMode: {
			name: "Import mode",
			desc: "Add will append new models. Replace will overwrite existing models with the selected list.",
		},
		importSelected: "Import selected",

		// AIAssistantProvidersModal.ts
		providersTitle: {
			name: "Providers",
			desc: "Providers for the AI Assistant",
		},
		addProvider: "Add provider",
		editProvider: "Edit",
		providerName: "Name",
		endpoint: {
			name: "Endpoint",
			desc: "The endpoint for the AI Assistant",
		},
		apiKey: "API key",
		apiKeyDesc: "Select a secret from SecretStorage",
		providerType: "Provider type",
		modelSource: "Model source",
		addModel: {
			name: "Add model",
			button: "Add model",
		},
		importModels: {
			name: "Import models",
			browseButton: "Browse models",
		},
		autoSyncModels: {
			name: "Auto-sync models",
			syncNowButton: "Sync now",
		},
		connect: "Connect",
		connecting: "Connecting...",
		customProvider: {
			name: "Custom provider",
			desc: "Create any custom endpoint (OpenAI-compatible or otherwise)",
			addButton: "Add custom...",
		},

		// AIToolConfirmModal.ts
		abortRun: "Abort run",
		deny: "Deny",
		approveAllRun: "Approve all this run",
		approve: "Approve",
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
