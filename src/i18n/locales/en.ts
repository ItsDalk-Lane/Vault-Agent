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
		applyTemplateNoActiveNote:
			"QuickAdd: No active markdown note to apply a template to.",
		applyTemplateNotMarkdown:
			"QuickAdd: Only markdown templates can be applied to a note. Canvas and base templates create their own file types.",
		noTemplateChoices: "QuickAdd: No Template choices or template files found. Create a Template choice or set the template folder path in settings.",
		setTemplateFolder:
			"QuickAdd: Set a template folder in Settings → QuickAdd → Templates & properties to use “New note from template”.",
		noTemplateFiles: "QuickAdd: No template files found in your configured template folder(s).",
		createdAndCaptured: "Created and captured to {fileName}",
		createdNothingToCapture:
			"Created {fileName} — nothing to capture (no content)",
		nothingToCapture: "Nothing to capture — {fileName} unchanged",
		canvasCaptureNoLinkInsert:
			"Canvas capture skipped link insertion because no Markdown editor is focused.",
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
		addCustom: "Add a custom value",
		notInList: "Not in the list…",
		submit: "Submit",
		search: "Search",
		loading: "Loading…",
		imageSaveFailed: "QuickAdd: failed to save image.",
		imageInsertLinkFailed:
			"QuickAdd: saved the image but could not insert its link.",
		imageIntakeBusyPaste:
			"QuickAdd: an image is still being saved — paste again in a moment.",
		imageIntakeBusyDrop:
			"QuickAdd: an image is still being saved — drop again in a moment.",
		optionsListAria: "Options",
		suggestionsAria: "Suggestions",
		searchOptionsPlaceholder: "Search options...",
		enterValueToAdd: "Enter a value to add.",
		peekAtNote: "Peek at note",
		typeToSearch: "Type to search…",
	},
	onePageInput: {
		note: "Note",
		notePlaceholder: "Search notes or create new note",
		noteSearchUnavailable: "Note search is unavailable. Type a new note title.",
		enterNoteTitle: "Enter a note title or choose an existing note.",
		provideInputs: "Provide inputs",
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
		editBranchTitle: "Edit {branch} commands",
		branchThen: "Then branch",
		branchElse: "Else branch",
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
		samplingResetTooltip: "Reset to provider default",
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
		wait: {
			for: "for",
			durationAria: "Wait duration in milliseconds",
		},
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
		noScriptsFound: {
			title: "No scripts found",
			body: "QuickAdd cannot find any .js files or notes with a ```js code block in your vault.",
			ensure: "Please make sure your scripts are:",
			inVault: "✓ In your vault (not in {configDir} folder)",
			notHidden: "✓ Not in hidden folders (starting with a dot)",
			isJsOrNote: "✓ A .js file, or a note containing a ```js code block",
			viewDocs: "View documentation",
		},
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
		addProviderTitle: "Add a provider",
		settingsTitle: "AI Assistant settings",
		docsLink: "Docs",
		browseModelsTitle: "Browse models for {provider}",
		samplingParamsRejected:
			"{model} doesn't accept the {labels} setting{labelSuffix}, so QuickAdd retried without {pronoun}. You can remove {pronoun} from this command's advanced settings.",
		samplingParamsRejectedChat:
			"{model} doesn't accept the {labels} setting{labelSuffix}, so QuickAdd retried without {pronoun}.",
		toolConfirmArgs:
			"The AI requested this tool call with the arguments below.",
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
		modelNameEmpty: "Model name cannot be empty.",
		maxTokensPositive: "Max tokens must be a positive number.",
		selectOneModel: "Select at least one model.",
		noModelsSelected: "No models selected to import.",
		customProviderAdded: "Custom provider added. Click Edit to configure.",
	},

	choiceBuilder: {
		icon: {
			name: "Icon",
			desc: "Lucide/Obsidian icon id. Leave empty to use {default}.",
			placeholder: "Lucide icon name",
			aria: "Choice icon",
		},
		folderMode: {
			obsidianDefault: "Obsidian default",
			specified: "In a specific folder",
			activeFile: "Same folder as current file",
			prompt: "Ask for folder each time",
			obsidianDefaultDesc: "Use Obsidian's “Default location for new notes” setting.",
			specifiedDesc: "Create the note in the folder(s) below. With multiple folders, you'll be asked which one when the note is created.",
			activeFileDesc: "Create the note next to the currently active file (falls back to the vault root if no file is open).",
			promptDesc: "Choose any folder in the vault when the note is created.",
		},
		canvasPicker: {
			targetNotFound: "Target canvas file was not found.",
			couldNotOpen: "Could not open target canvas.",
			copyNodeFailed: "Could not copy node id automatically.",
			statusShowing: "Showing {filtered} of {total} nodes",
			statusLoading: "Loading canvas nodes…",
			emptyFormatPath:
				"Node picker works for direct .canvas paths that already exist in your vault. Format syntax paths cannot be listed here.",
			emptyNoNodes: "No selectable nodes found in the target canvas.",
			noticeSelectOneCard:
				"Open the target canvas and select exactly one card to use this action.",
			noticeNodeNotFound:
				"The selected node was not found in the loaded canvas.",
			noticeStillLoading:
				"Canvas nodes are still loading. Wait a moment and try again.",
			noticeCopiedNodeId: "Copied node id {id}",
			typeText: "TEXT",
			typeFile: "FILE",
			typeNode: "NODE",
			openCanvas: "Open target canvas",
			useSelected: "Use selected in open canvas",
			filterPlaceholder: "Filter by card text, file path, or node id…",
			filterAria: "Filter canvas nodes",
			noMatch: "No nodes match the current filter.",
			selected: "Selected",
			useNode: "Use node",
			unavailable: "Unavailable",
			copyId: "Copy ID",
			emptyTextCard: "(empty text card)",
			lineCount: {
				one: "{count} line",
				other: "{count} lines",
			},
			reasonMarkdownOnly:
				"Canvas file cards must link to markdown files (.md).",
			reasonNotCapturableVersion: "Not capturable in this version",
			typeUnknown: "unknown",
			titleUnsupported: "Unsupported node ({type})",
			reasonTypeNotCapturable: "Type is not currently capturable",
			reasonNodeTypeNotCapturable: "This Canvas node type is not capturable.",
		},
		tokenHint: {
			prefix: "Type",
			suffix: "to insert a token",
			docsLink: "Format syntax",
		},
		placeholder: {
			templatePath: "Template path",
			format: "Format",
			fileNameFormat: "File name format",
			folderPath: "Folder path",
			canvasNodeId: "Canvas node id",
			insertAfter: "Insert after",
			insertBefore: "Insert before",
			propertyName: "Property name",
			frontmatterPropertyAria: "Frontmatter property",
		},
		captureTargetFeedback: {
			needsField: "Property capture target needs a field name, e.g. property:type=draft.",
			filtersDesc: "Capture target filters select one destination file. Use {{FILE:...|multi}} in the capture format for multi-value metadata.",
			folder: { one: "folder", other: "folders" },
			tag: { one: "tag", other: "tags" },
			file: { one: "file", other: "files" },
			excluding: "excluding {noun} {list}",
			allNotes: "all notes",
			joinerOr: "or",
			partSeparator: "; ",
			listJoinMiddle: ", ",
			frontmatterWithValue: "frontmatter {field} = {value}",
			frontmatterFieldOnly: "frontmatter field {field}",
			recognizedProperty: "Recognized property target: {summary}.",
			recognizedPicker: "Recognized filtered picker: {summary}.",
		},
		captureForm: {
			templateFormatSyntaxHint: "Contains format syntax — resolved at run time.",
			templateNotFound: "Template not found",
			selectionFollowGlobal: "Follow global setting",
			selectionUse: "Use selection",
			selectionIgnore: "Ignore selection",
			headingLocation: "Location",
			createFileIfMissing: "Create file if it doesn't exist",
			createWithTemplate: "Create file with a template",
			createWithTemplateDesc: "Path to the template QuickAdd applies to the new file.",
			headingPosition: "Position",
			headingLinking: "Linking",
			copyLinkToClipboard: "Copy link to clipboard",
			copyLinkToClipboardDesc: "Copy a link to the captured file after the Capture choice runs.",
			headingContent: "Content",
			task: "Task",
			taskDesc: "Formats the value as a task.",
			captureFormat: "Capture format",
			captureFormatDesc: "Set the format of the capture. When off, QuickAdd captures {{VALUE}} on its own - what you type at the prompt, or the current selection.",
			captureFormatRequired: "Capture format is required when enabled",
			headingBehavior: "Behavior",
			openFileDesc: "Open the captured file.",
			editorSelection: "Use editor selection as default value",
			editorSelectionDesc: "Controls whether this Capture uses the current editor selection as {{VALUE}}. Does not affect {{SELECTED}}.",
			templaterAfterCapture: "Run Templater on entire destination file after capture",
			templaterAfterCaptureDesc: "Advanced / legacy: this executes any <% %> anywhere in the destination file (including inside code blocks).",
		},
		captureTarget: {
			emptyTargetHint: "Leave empty to pick the note each time this choice runs.",
			toActiveFile: "Capture to active file",
			toActiveFileDesc: "Capture into whichever note is open when the choice runs, instead of a fixed target.",
			captureTo: "Capture to",
			captureToDesc: "Vault-relative path to a file or folder, a #tag, or property:field=value. Supports format syntax like {{DATE}}; end with '/' to capture into a folder.",
			targetCanvasNode: "Target canvas node",
			targetCanvasNodeDesc: "Choose a card from the canvas below, or paste an exact node id.",
			canvasNodeIdRequired: "A canvas capture target requires a node id — pick a card below or paste an exact node id.",
			canvasTip: "Tip: open this canvas and select one card to grab its id instantly.",
		},
		propertyCapture: {
			property: "Property",
			kindNamed: "Named property",
			kindPrompt: "Choose when capturing",
			propertyNameRequired: "Property name is required",
			action: "Action",
			actionDescAddToList: "Add captured values to the property's list, keeping existing items and skipping duplicates.",
			actionDescSet: "Replace the property's value with the captured value.",
			actionSet: "Set value",
			actionAddToList: "Add to list",
			createIfMissing: "Create property if missing",
		},
		templateForm: {
			templateFormatSyntaxHint: "Contains format syntax — resolved at run time.",
			templateNotFound: "Template not found",
			duplicateFolderWarning: "cannot add same folder twice.",
			headingTemplate: "Template",
			templatePath: "Template path",
			templatePathDesc: "Path to the template this choice creates notes from.",
			fileNameFormat: "File name format",
			fileNameFormatDesc: "Set the file name format. When off, QuickAdd asks for the note title.",
			headingLocation: "Location",
			newNoteLocation: "New note location",
			emptyFolderListWarning: "Add at least one folder. With none, the note falls back to the active file's folder (or you'll be prompted to pick one if no file is open).",
			includeSubfolders: "Include subfolders",
			includeSubfoldersDesc: "Get prompted to choose from both the selected folders and their subfolders when creating the note.",
			headingLinking: "Linking",
			copyLinkToClipboard: "Copy link to clipboard",
			copyLinkToClipboardDesc: "Copy a link to the created file after the Template choice runs.",
			headingBehavior: "Behavior",
			searchExisting: "Search existing notes before creating",
			searchExistingDesc: "Show matching notes and unresolved links in the note-title prompt.",
			searchExistingUnsupportedDesc: "Only available when the file name prompt is the default note title: no custom format, {{VALUE}}, or {{NAME}}.",
			whenSelectingExisting: "When selecting an existing note",
			ifNewNotePathExists: "If a new note's path already exists",
			ifTargetFileExists: "If the target file already exists",
			fileExistsDesc: "Choose whether QuickAdd should ask what to do, update the existing file, create another file, or keep the existing file.",
			updateAction: "Update action",
			newFileNaming: "New file naming",
			openFileDesc: "Open the created file.",
		},
		fileOpening: {
			location: "File opening location",
			locationDesc: "Where to open the {context} file",
			viewMode: "View mode",
			viewModeDesc: "How to display the opened file",
			viewModeSource: "Source",
			viewModePreview: "Preview",
			viewModeLivePreview: "Live Preview",
			viewModeDefault: "Default",
			focus: "Focus new pane",
			focusDesc: "Focus the opened tab immediately after opening",
			contextCreated: "created",
			contextCaptured: "captured",
		},
		openFileSetting: {
			name: "Open",
		},
		insertAfter: {
			chooseHeading: "Choose heading when capturing",
			chooseHeadingDesc: "Instead of typing a target line now, show a dropdown of the target note's headings when you run this capture and insert under the one you pick.",
			chooseHeadingHint: "You'll pick a heading from the target note when you run this capture, and the text is inserted under it. Use the toggles below to control placement within that section.",
			label: "Insert after",
			labelDesc: "Insert capture after specified text. Accepts format syntax. Tip: use a heading (starts with #) to target a section. Blank line handling is configurable below.",
			required: "Insert after text is required",
			inline: "Inline insertion",
			inlineDesc: "Insert captured content on the same line, immediately after the matched text (no newline added).",
			inlineDescOrdered: "Inline insertion can't be combined with ordered placement.",
			inlineLinebreakWarning: "Inline insertion needs a single-line target. The line break (\\n) can't be matched on the same line — remove it, or turn off \"Inline insertion\".",
			replaceExisting: "Replace existing value",
			replaceExistingDesc: "Replace everything after the matched text up to end-of-line.",
			insertAtEnd: "Insert at end of section",
			insertAtEndDesc: "Place the text at the end of the matched section instead of the top.",
			blankLines: "Blank lines after match",
			blankLinesDesc: "Controls whether Insert After skips existing blank lines after the matched line.",
			blankLinesDescUnused: "Not used when inserting at end of section.",
			blankLineAuto: "Auto (headings only)",
			blankLineSkip: "Always skip",
			blankLineNone: "Never skip",
			considerSubsections: "Consider subsections",
			considerSubsectionsDesc: "Also include the section’s subsections (requires target to be a heading starting with #). Subsections are headings inside the section.",
			considerSubsectionsDescHeading: "Also include the chosen heading’s subsections (nested headings inside its section).",
			considerSubsectionsDescInactive: "Only affects placement when “Insert at end of section” is on.",
			considerSubsectionsNotice: "Consider subsections requires the target to be a heading (starts with #)",
			createLine: "Create line if not found",
			createLineDesc: "Creates the 'insert after' line if it is not found.",
			locationTop: "Top",
			locationBottom: "Bottom",
			locationCursor: "Cursor",
			locationOrdered: "Ordered (place new section among siblings)",
			orderedHint: "The \"Insert after\" heading is created at its sorted position among ALL same-level headings in the note (it is not scoped to one parent section). It does NOT re-sort headings you already have; only the new one is placed. Use \"Insert at end of section\" above for newest-on-top vs. appended entries within each section.",
			sortBy: "Sort sections by",
			sectionOrder: "Section order",
			orderByInsertion: "Insertion order (no sorting)",
			orderByLexical: "Text (A→Z)",
			orderByNumeric: "Number",
			orderByDate: "Date",
			orderBySemver: "Version (semver)",
			directionDesc: "Newest / highest first",
			directionAsc: "Oldest / lowest first",
			dateFormat: "Date format",
			dateFormatDesc: "Moment format used to parse existing heading dates for sorting (e.g. YYYY-MM-DD).",
			unparseable: "Existing unparseable headings",
			unparseableDesc: "Where to rank EXISTING headings whose text can't be parsed for this sort. (A new heading that can't be parsed is appended at the end.)",
			unparseableToBottom: "Sort existing unparseable headings to bottom",
			unparseableToTop: "Sort existing unparseable headings to top",
			insertionHint: "No sorting: newest-first prepends the new section above existing ones; oldest-first appends it below.",
			insertionFallbackWarning: "This heading uses a date token QuickAdd can't auto-read for sorting. Pick \"Date\" and enter the format, or sections stay in insertion order.",
		},
		insertBefore: {
			label: "Insert before",
			labelDesc: "Insert capture before specified text. Accepts format syntax.",
			required: "Insert before text is required",
			createLine: "Create line if not found",
			createLineDesc: "Creates the 'insert before' line if it is not found.",
			locationTop: "Top",
			locationBottom: "Bottom",
			locationCursor: "Cursor",
		},
		writePosition: {
			label: "Write position",
			descActiveFile: "Where to place the capture in the current file.",
			descTargetFile: "Where to place the capture in the target file.",
			optionCursor: "At cursor",
			optionTop: "Top of file",
			optionActiveTop: "Top of file (after frontmatter)",
			optionNewLineAbove: "New line above cursor",
			optionNewLineBelow: "New line below cursor",
			optionAfter: "After line…",
			optionBefore: "Before line…",
			optionBottom: "Bottom of file",
			optionProperty: "Property",
			canvasNotice: "Canvas note: 'At cursor' and 'New line above/below cursor' are not supported for Canvas card capture. Use top, bottom, insert-after, or insert-before placement.",
		},
		appendLink: {
			fileLabelCaptured: "captured",
			fileLabelCreated: "created",
			linkTo: {
				name: "Link to {file} file",
				desc: "Choose whether QuickAdd should insert a link to the {file} file.",
			},
			destination: {
				name: "Link destination",
				desc: "Where QuickAdd writes the link to the {file} file.",
			},
			destinationCurrentNote: "Current note",
			destinationSpecifiedNote: "Specified note",
			placement: {
				name: "Link placement",
				desc: "Where to place the link when appending",
			},
			placementReplaceSelection: "Replace selection",
			placementAfterSelection: "After selection",
			placementEndOfLine: "End of line",
			placementNewLine: "New line",
			placementInFrontmatter: "In frontmatter property",
			linkType: {
				name: "Link type",
				desc: "Choose whether to insert a link or an embed. Embeds transclude the note's contents at the placement position.",
			},
			linkTypeLink: "Link",
			linkTypeEmbed: "Embed",
			displayText: {
				name: "Link display text",
				desc: "What the inserted link displays. 'Selected text' keeps the highlighted text as the link's display text; with nothing selected, the plain link is inserted.",
			},
			displayTextDefault: "Default",
			displayTextSelection: "Selected text",
			frontmatterProperty: {
				name: "Frontmatter property",
				desc: "Required property to insert the link into.",
			},
			propertyHandling: {
				name: "Property handling",
				desc: "Choose how strict QuickAdd should be when the property is missing or not a list.",
			},
			handlingAlwaysAppend: "Create or convert",
			handlingCreateProperty: "Create if missing",
			handlingError: "Require list",
			destinationFile: {
				name: "Destination file",
				desc: "Existing Markdown note that receives the link at the bottom.",
			},
			destinationFileRequired: "Destination file is required",
			destinationFileNotFound: "Markdown file not found",
			destinationFileAria: "Append link destination file",
			modeRequired: "Enabled (strict)",
			modeOptional: "Enabled (skip if unavailable)",
			modeDisabled: "Disabled",
		},
		onePageOverride: {
			desc: "Override the global setting for this choice. 'Always' forces the one-page modal even if disabled globally; 'Never' disables it even if enabled globally.",
		},
	},

	input: {
		optionalHint: "Optional — leave empty, press Skip, or ctrl/cmd+shift+↵.",
		skipTooltip: "Leave this field empty",
		skipTooltipFull: "Skip and leave empty",
		skipLeaveEmpty: "Skip (leave empty)",
	},
	mathModal: {
		submitHint: "Ctrl/Cmd+Enter to submit · Tab to jump to the cursor marker",
	},

	datePicker: {
		title: "Edit folder",
		name: "Name",
		placeholder: {
			name: "Placeholder",
			desc: "Shown in the choice picker search box when this folder opens. Leave blank to use the folder name.",
			value: "Defaults to the folder name",
		},
		unableToParseDate: "Unable to parse date",
		today: "Today",
		time: "Time",
		previousMonthAria: "Previous month",
		nextMonthAria: "Next month",
		previewLabel: "Preview:",
	},

	promptPeek: {
		returnButton: "Return",
		returnTooltip: "Go back to the prompt without inserting",
		dropTooltip: "Drop the selected text into your draft and return",
		cancelTooltip: "Discard this run",
		cancelAria: "Cancel this run",
		hint: "Look at the note, copy or select text, then come back. Your draft is still there.",
	},

	choiceSuggester: {
		defaultPlaceholder: "Select a choice",
		previewPlaceholder: "Preview will appear here",
		previewLabel: "Preview:",
		willBeLeftEmpty: "Will be left empty",
		newNoteFromTemplate: "New note from template…",
		emptyFlair: "Empty",
		unreadableFlair: "Unreadable",
		emptyNoticePrefix: "is empty. Add a choice or drag one in.",
		couldNotRenderName: "Could not render a choice name as Markdown; showing it as plain text",
		couldNotRunTemplate: "Could not run a template from that folder",
		noChoicesNotice:
			"QuickAdd: No choices yet. Create your first one in Settings → QuickAdd.",
	},
	choiceList: {
		newChoice: "New choice",
		addChoice: "Add choice",
		newFolder: "New folder",
		addFolder: "Add folder",
		addChoiceTo: "Add choice to {folder}",
		addFolderTo: "Add folder to {folder}",
		templateDesc: "Create a note from a template file.",
		captureDesc: "Add text to a note — append, prepend, or insert.",
		macroDesc: "Run a sequence of commands and scripts.",
		defaultNewTemplate: "New template",
		defaultNewCapture: "New capture",
		defaultNewMacro: "New macro",
		defaultNewFolder: "New folder",
	},

	contextMenu: {
		enableInPalette: "Enable in command palette",
		disableInPalette: "Disable in command palette",
		rename: "Rename",
		configure: "Configure",
		duplicate: "Duplicate",
		delete: "Delete",
		moveToRoot: "Move to: (root)",
		moveToNoFolders: "Move to: (no folders)",
		moveToPrefix: "Move to: ",
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

	packageManager: {
		exportTitle: "Export QuickAdd package",
		exportDesc: "Select choices to bundle. Dependencies are added automatically.",
		selectVisible: "Select visible",
		clearSelection: "Clear selection",
		emptyFilter: "No choices match the current filter.",
		packageSummary: "Package summary",
		selectedChoices: "Selected choices",
		totalPackaged: "Total packaged",
		autoIncluded: "Auto-included",
		scriptsEmbedded: "Scripts embedded",
		templatesEmbedded: "Templates embedded",
		missingDependencies: "Missing dependencies detected",
		warnings: "Warnings",
		missingAssets: "Missing assets:",
		saveToFile: "Save to file",
		filterPlaceholder: "Filter choices",
		missingChoiceIdsDesc:
			"The following choice IDs were referenced but not found:",
		missingChoices: "Missing choices:",
		copying: "Copying…",
		copyJson: "Copy JSON",
		saving: "Saving…",
		choiceCount: {
			one: "{count} choice",
			other: "{count} choices",
		},
		asset: {
			userScript: "User script",
			conditionalScript: "Conditional script",
			template: "Template file",
			captureTemplate: "Capture template",
		},
		noticeSelectOne: "Select at least one choice to export.",
		noticeExportFailed: "Export failed: {error}",
		noticeCopied: "Copied package ({choices}) to clipboard.",
		noticeCopiedWarnings:
			"Package copied with warnings. Review details below.",
		noticeEnterPath: "Enter a file path before saving.",
		noticeOverwrote: "Overwrote package ({choices}) at '{path}'.",
		noticeSaved: "Saved package ({choices}) to '{path}'.",
		noticeSavedWarnings:
			"Package saved with warnings. Review details below.",
		noticeSaveCancelled: "Save cancelled.",
		noticeSaveFailed: "Save failed: {error}",
		noticeCopyFailed: "Copy failed: {error}",
		confirmDeleteTitle: "Are you sure you wish to delete this command?",
		confirmDeleteBody: "If you click yes, you will delete '{name}'.",
		errorClipboardUnsupported:
			"Clipboard copy is not supported in this environment.",
		commandLoadFailed: "{name} could not be loaded.",
		exportConfirmOverwriteTitle: "Overwrite existing file?",
		exportConfirmOverwriteBody:
			"A file already exists at '{path}'. Saving the package will overwrite it. Continue?",
		exportPathEmpty: "Output path cannot be empty.",

		importTitle: "Import QuickAdd package",
		importDesc: "Review what this package adds and runs before importing.",
		pasteJson: "Paste package JSON",
		pastePlaceholder:
			"Paste the contents of a .quickadd.json package here",
		analyzing: "Analyzing package…",
		metaVersion: "Version",
		metaCreated: "Created",
		choicesHeading: "Choices",
		noChoices: "No choices found in this package.",
		colName: "Name",
		colLocation: "Location",
		colAction: "Action",
		alreadyInVault: "already in vault",
		showMacro: "Show macro",
		hideMacro: "Hide macro",
		importAction: "Import",
		overwriteAction: "Overwrite",
		duplicateAction: "Duplicate",
		skipAction: "Skip",
		filesHeading: "Files",
		noFiles: "No files bundled with this package.",
		filesAdded: "Added ({count})",
		filesWillOverwrite: "Will overwrite ({count})",
		fileCount: {
			one: "{count} file",
			other: "{count} files",
		},
		rootLocation: "Root",
		missingFiles: "Missing files",
		missingRefScript:
			"not bundled, so it runs from whatever file exists at that path after import",
		missingRefFile: "not bundled and not in your vault",
		unreferencedFiles: "Unreferenced files",
		orphanAssetDesc: "bundled but not used by any choice",
		ackReviewedWithUnbundled:
			"I have reviewed each bundled script above and trust the source, including scripts that are not included and cannot be shown.",
		ackReviewed: "I have reviewed each script above and trust the source.",
		ackUnbundled:
			"This package runs scripts that are not included and cannot be reviewed. I trust the source.",
		ackGeneric:
			"I understand this package can run code, and I trust the source.",
		scriptCount: {
			one: "{count} executable script",
			other: "{count} executable scripts",
		},
		ackHint:
			"Open “View contents” on each of the {scripts} above to enable this.",
		ackConfirmTooltip: "Confirm the acknowledgement above to continue",
		importing: "Importing…",
		importPackageButton: "Import package",
		noticeAlreadyImported: "This package has already been imported.",
		noticeLoadFirst: "Load a package before importing.",
		noticeImported: "Imported {choices} successfully.",
		noticeImportFailed: "Import failed: {error}",
		summary: {
			choicesAdded: {
				one: "{count} choice added",
				other: "{count} choices added",
			},
			overwritten: "{count} overwritten",
			filesWritten: {
				one: "{count} file written",
				other: "{count} files written",
			},
			skipped: "{count} skipped",
			prefix: "Imported: {parts}.",
			nothing: "Nothing was imported.",
		},

		capabilityBanner: {
			aria: "What this package can do",
			title: "What this package can do",
			reloadNote:
				"Takes effect after you reload the plugin or restart Obsidian.",
		},
		flag: {
			userScript: {
				label: "SCRIPT",
				description:
					"Runs custom JavaScript with full access to your vault and the network.",
			},
			conditionalScript: {
				label: "CONDITIONAL",
				description:
					"Runs custom JavaScript to decide which branch executes.",
			},
			bundledScript: {
				label: "SCRIPT FILE",
				description:
					"Bundles a file that will be written to your vault and can be run as code.",
			},
			runOnStartup: {
				label: "STARTUP",
				description: "Runs automatically every time Obsidian starts.",
			},
			mislabeledExecutable: {
				label: "EXECUTABLE",
				description:
					"A bundled file is run as code even though it is labeled a template.",
			},
			registersCommand: {
				label: "COMMAND",
				description: "Adds a command to the command palette.",
			},
			obsidianCommand: {
				label: "OBSIDIAN",
				description: "Triggers another Obsidian command.",
			},
			ai: {
				label: "AI",
				description:
					"Sends note content to your AI provider over the network.",
			},
			aiTools: {
				label: "AI TOOLS",
				description:
					"Lets an AI model read and write your vault: the script gives the model tools (functions) it calls with model-chosen arguments.",
			},
			captureWrites: {
				label: "WRITES",
				description: "Writes captured text into your notes.",
			},
			templateWrite: {
				label: "TEMPLATE",
				description: "Creates notes from a bundled template.",
			},
			overwritesExistingChoice: {
				label: "OVERWRITES",
				description: "Replaces a choice that already exists in your vault.",
			},
			overwritesExistingFile: {
				label: "OVERWRITES",
				description: "Overwrites a file that already exists in your vault.",
			},
			missingReference: {
				label: "MISSING",
				description: "References a file that is not bundled in this package.",
			},
			unknownCommand: {
				label: "UNKNOWN",
				description: "An unrecognised command type. Review it manually.",
			},
			editorCommand: {
				label: "EDITOR",
				description: "Runs a built-in editor command.",
			},
			openFile: {
				label: "OPEN FILE",
				description: "Opens a file in your vault.",
			},
		},
		row: {
			runOnStartup: "Runs automatically every time Obsidian starts",
			userScript:
				"Runs custom JavaScript with full access to your vault and the network",
			conditionalScript: "Runs custom JavaScript chosen by a condition",
			obsidianCommand: "Triggers another Obsidian command",
			ai: "Sends note content to your AI provider over the network",
			unknownCommand: "Unknown capability. Review it manually.",
			mislabeledExecutable:
				"Runs a file as code even though it is labeled a template",
			bundledScript:
				"Bundles a file that will be written to your vault and can be run as code",
			aiTools: "Lets an AI model read and write your vault",
			registersCommand: "Adds commands to the command palette",
			overwritesChoices: "Replaces choices that already exist in your vault",
			overwritesFiles: "Overwrites existing files in your vault",
			missingRefsScript:
				"References scripts that are not bundled, so they run from whatever exists at those paths after import",
			missingRefsFile:
				"References files that are not bundled and not in your vault",
		},
		referenceCount: {
			one: "{count} reference",
			other: "{count} references",
		},
		crumb: {
			template: "template",
			newFileTemplate: "new-file template",
			then: "then",
			else: "else",
		},
		conditionScriptPrefix: "script:",
		errorNotBundled: "File is not bundled in this package.",
		commandType: {
			userScript: "User script",
			conditional: "Conditional",
			nestedChoice: "Nested choice",
			obsidian: "Obsidian command",
			choice: "Choice",
			wait: "Wait",
			editorCommand: "Editor command",
			aiAssistant: "AI assistant",
			openFile: "Open file",
		},
		fileRow: {
			statusWillOverwrite: "Will overwrite",
			statusNewFile: "New file",
			executableBadge: "Executable",
			executableTooltip:
				"Runs as code when its choice runs. It can read, change, or delete files in your vault and access the network.",
			reviewedBadge: "Reviewed",
			unusedBadge: "Unused",
			unusedTooltip:
				"Bundled in this package but not referenced by any choice.",
			destinationField: "Destination",
			writeAction: "Write",
			skipWarning:
				"Won't be written. Any choice that uses this script will run whatever file already exists at this path after import, not the contents you reviewed.",
			viewContents: "View contents",
			hideContents: "Hide contents",
			contentsAria: "Contents of {path}",
			previewUnavailable: "Preview unavailable: {error}",
			minifiedWarning:
				"Minified: cannot be visually reviewed. Import only if you trust the source.",
			truncatedScript: "Preview truncated. The full script will run.",
			truncatedFile: "Preview truncated. The full file will be imported.",
		},
	},

	globalVariables: {
		empty: "No global variables yet.",
		columnName: "Name",
		columnValue: "Value",
		columnActions: "Actions",
		deleteTooltip: "Delete",
		deleteButton: "Delete",
		addVariableButton: "Add variable",
		namePlaceholder: "Name",
		valuePlaceholder: "Snippet value (supports QuickAdd tokens)",
	},

	choiceView: {
		empty: "No choices yet",
		emptyLink: "Learn more",
		emptyBody: "A choice is an action QuickAdd can run: create a note, capture text, or run a macro. Group them with folders.",
		filterPlaceholder: "Filter choices...",
		clearFilterAria: "Clear filter",
		configureAi: "Configure AI Assistant",
		noMatch: "No choices match your filter.",
	},
	fileExists: {
		promptPlaceholder: "If the target file already exists",
		category: {
			prompt: "Ask every time",
			update: "Update existing file",
			create: "Create another file",
			keep: "Keep existing file",
		},
		mode: {
			appendBottom: {
				label: "Append to bottom",
				description: "Adds the template content to the end of the existing file.",
			},
			appendTop: {
				label: "Append to top",
				description:
					"Adds the template content to the beginning of the existing file.",
			},
			overwrite: {
				label: "Overwrite file",
				description: "Replaces the existing file content with the template.",
			},
			increment: {
				label: "Increment trailing number",
				description:
					"Changes trailing digits only. Example: Draft009.md -> Draft010.md.",
			},
			duplicateSuffix: {
				label: "Append duplicate suffix",
				description:
					"Keeps the original name and adds a duplicate marker. Example: Project Plan.md -> Project Plan (1).md.",
			},
			doNothing: {
				label: "Do nothing",
				description: "Leaves the file unchanged and opens the existing file.",
			},
		},
		existingNoteAction: {
			open: { label: "Open note", verb: "Open" },
			appendBottom: { label: "Append template to bottom", verb: "Append to" },
			appendTop: { label: "Insert template at top", verb: "Insert into" },
			overwrite: { label: "Replace entire note", verb: "Replace" },
		},
	},
	templateDiscovery: {
		searchOrCreate: "Search notes or create {name}",
		createLabel: "Create: {title}",
		createNewNote: "Create new note: {title}",
		noteForAria: "Note for {name}",
		changeNoteAria: "Change note",
		unresolvedLink: "Unresolved link",
		aliasLabel: "Alias: {alias}",
	},
	update: {
		fetchingReleaseNotes: "Fetching release notes...",
		fetchReleaseNotesFailed: "Failed to fetch release notes: {error}",
		exportSkippedMissing: "QuickAdd export skipped missing {kind}: {path}",
		exportReadFailed:
			"QuickAdd export failed to read {kind} '{path}': {error}",
		exportUserScriptInspectFailed:
			"QuickAdd export could not inspect user-script settings '{path}': {error}",
	},
	templater: {
		settleAdapterFallback: "waitForFileSettle: fallback due to adapter/stat failure – {error}",
		teardownFailed: "withTemplaterFileCreationSuppressed: teardown failed – {error}",
		stopChangingFallback: "waitForFileToStopChanging: fallback due to adapter/stat failure – {error}",
		rollbackFailed: "Failed to rollback {path} after Templater error: {error}",
		cursorJumpApiFailed: "jumpToNextTemplaterCursorIfPossible: API failed – {error}",
	},
	uri: {
		noChoiceParameter: "URI was executed without a `choice` parameter.",
		choiceNotFound: "URI could not find any choice named '{name}'",
		ambiguousChoice:
			"QuickAdd URI: {count} choices are named '{name}'. Ran the first match — rename choices to keep names unique so URIs target the right one.",
	},
	errors: {
		noCommandsInMacro: "No commands in the macro for choice '{name}'",
		skippedCommandInMacro: "Skipped {name} in the macro for '{choice}': {reason} QuickAdd did not stop the macro, so its result may be incomplete.",
		loadUserScriptFailed: "failed to load user script {path}.",
		invalidUserScript: "user script in macro for '{name}' is invalid",
		obsidianCommandUnavailable: "Obsidian command '{name}' is no longer available.",
		choiceNotFound: "choice '{name}' could not be found.",
		choiceInvalid: "choice in {name} is invalid",
		conditionalScriptMustReturnBoolean: "Conditional script '{path}' must return a boolean result.",
		openFilePathTraversal: "OpenFile: Path traversal not allowed in '{path}'",
		openFileNotFound: "OpenFile: '{path}' does not exist or is not a file",
		openFileFailed: "OpenFile: Failed to open file '{path}': {error}",
		fileNotFound: "{path} not found",
		pathIsFolder: "{path} found but it's a folder",
		ambiguousMacroReference: "Ambiguous macro reference '{name}'. Multiple choices match when ignoring case.",
		macroNotFound: "macro '{name}' does not exist.",
		macroMemberNotExported: "Macro '{name}' was asked for member '{member}', but it has no user script exporting it; the result is empty.",
		multipleScriptsExportMember: "Macro '{name}': multiple user scripts export '{member}' ({names}); using '{chosen}'. Disambiguate with '{{MACRO:{name}::<Script Name>::{member}}}'.",
		templateNotFound: "Template {path} not found.",
		copyLinkToClipboardFailed: "Could not copy link to clipboard for '{path}': {error}",
		appendLinkTargetNotFound: "Append link target file not found or is not a Markdown file: {path}",
		multiSelectFormatWarning: "QuickAdd: {{VALUE:…|multi}}, {{FILE:…|multi}} and {{FIELD:…|multi}} in this capture write comma-separated strings by default. Add |format:yaml, |format:markdown, |format:inline or |format:spaced to choose the output explicitly.",
		noActiveMarkdownEditor: "Capture \"{name}\": no active Markdown editor to insert into.",
		cleanupClipboardAttachmentFailed: "QuickAdd: failed to clean up clipboard attachment '{path}': {error}",
		fileExistsUnresolvable: "'{path}' already exists but could not be resolved as a markdown, canvas, or base file.",
		resolveFileExistsBehaviorFailed: "Could not resolve file exists behavior for '{path}'.",
		createdButLinkInsertFailed: "Created '{name}' but could not insert the link: {error}",
		cannotAppendToNonMarkdown: "Cannot append to '{path}': appending a template to a {extension} file would corrupt it. Use the \"Overwrite\" file-exists option instead.",
		multipleFilesMatchCaseInsensitive: "Multiple files match '{path}' when ignoring case: {matches}",
		noActiveFileForSameFolder: "No active file or active file has no parent. Cannot create file in same folder as active file. Creating in root folder.",
		parseTemplateFrontmatterFailed: "Could not parse template frontmatter for merging: {error}",
		skipUnsafeFrontmatterKey: "Skipping front matter merge for unsafe key \"{key}\" to avoid prototype pollution.",
		moveNoteFailed: "Could not move note to match choice settings: {error}",
		conditionalNoVariableName: "Conditional command skipped: No variable name configured.",
		conditionalVariableNotDefined: "Conditional command skipped: Variable '{name}' is not defined.",
		conditionalOperatorRequiresValue: "Conditional command: Operator '{operator}' requires a comparison value.",
		conditionalContainsRequiresNonEmpty: "Conditional command: 'contains' operator requires a non-empty comparison value.",
		conditionalNumericComparisonFailed: "Conditional command numeric comparison failed: non-numeric value encountered.",
		structuredVariableValidationWarning: "Structured variable validation warning: {warning}",
		cannotPostProcessFrontMatter: "Cannot post-process front matter for file {path} due to validation errors: {summary}. The file was created successfully, but some structured variables may not be properly formatted. Please check the variable values and ensure they don't contain circular references, exceed nesting depth of {depth}, or contain unsupported types (functions, symbols).",
		postProcessFrontMatterFailed: "Failed to post-process front matter for file {path}: {error}. The file was created successfully, but structured variables may not be properly formatted. This usually happens when variable values contain unexpected types or when Obsidian's YAML processor encounters an issue. Check the console for more details about which variables caused the problem.",
		skipUnsafeFrontmatterKeyPath: "Skipping front matter assignment for unsafe key path \"{path}\" to avoid prototype pollution.",
		openDocsFailed: "QuickAdd: Failed to open documentation ({url}): {error}",
		migrateTemplateFolderFailed: "Failed to migrate template folder path.",
		nothingSelected: "nothing selected.",
		noActiveMarkdownView: "no active markdown view.",
		formattedPasteFailed: "Formatted paste failed. Falling back to plain text: {error}",
		readClipboardTextFailed: "Failed to read clipboard text: {error}",
		noInternalLinkOnLine: "no internal link found on line {line}.",
		appendToCurrentLineFailed: "unable to append '{text}' to current line.",
		insertOnNewLineFailed: "unable to insert '{text}' on new line {direction}.",
		loadUserScriptFileFailed: "failed to load file {path}.",
		customCreateRowRenderFailed: "customCreateRow rendering failed: {error}",
		customRenderItemFailed: "customRenderItem rendering failed: {error}",
		modelPinnedProviderNoLongerServes:
			"resolveModel: pinned to provider \"{provider}\" — that provider no longer serves \"{name}\". Falling back to \"{fallback}\".",
		modelServedByMultipleProviders:
			"resolveModel: '{name}' is served by multiple providers ({candidates}). Pin one (e.g. {{ name: \"{name}\", provider: \"openai\" }}) or use a qualified string to keep this stable.",
		namedValueConflictingOptionLists:
			"Formatter: named value '{name}' is defined more than once with different option lists ({labels}). Keeping the first definition.",
		noJsCodeBlock:
			"No ```js (or ```javascript) code block found in the note.",
		emptyJsCodeBlock: "The ```js code block is empty.",
		commandLoadFailed: "{name} could not be loaded.",
		commandNotFound: "command not found",
		obsidianCommandNotFound:
			"Could not find Obsidian command with name \"{name}\"",
		invalidEditorCommandType: "invalid editor command type",
		qualifiedModelNameShadowed:
			"resolveModel: '{name}' is served by multiple providers ({candidates}). Did you mean the object form '{ name: \"{name}\", provider: \"{provider}\" }'?",
		secretStorageReadFailed:
			"Failed to read SecretStorage entry \"{name}\": {error}",
		secretStorageWriteFailed:
			"Failed to write SecretStorage entry \"{name}\": {error}",
		suggesterEmptyDisplayValues:
			"Suggester: one or more items have an empty display value.",
		templateInclusionCycle:
			"[QuickAdd: template inclusion cycle detected at \"{path}\"]",
		templateInclusionDepthExceeded:
			"[QuickAdd: max template inclusion depth ({depth}) exceeded at \"{path}\"]",
		unknownToolNames:
			"AI tools {names} are not in the {option} list for this group. Valid names: {validNames}.",
		unsupportedCaseStyle:
			"QuickAdd: Unsupported |case style \"{style}\" in token \"{token}\". Supported styles: {styles}.",
	},
} as const;

export default en;
