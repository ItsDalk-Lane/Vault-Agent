export const settingsUi = {
  "settings.advanced.others": "Others",
  "settings.advanced.apiKeyStorage": "API Key Storage",
  "settings.advanced.keychainUpdatePrefix": "Update Obsidian to",
  "settings.advanced.keychainUpdateMid": "to use the",
  "settings.advanced.keychainUpdateSuffix": ". Keys cannot be loaded or saved in this build.",
  "settings.advanced.keychainEmptyPrefix": "No API keys found in this device's",
  "settings.advanced.keychainEmptySuffix":
    ". Re-enter your API keys in the relevant settings sections — each device has a separate Keychain.",
  "settings.advanced.keychainStoredPrefix": "API keys are stored in this device's",
  "settings.advanced.keychainStoredSuffix": ".",
  "settings.advanced.keychainUnavailableTitle":
    "Update Obsidian to 1.11.4+ to delete Keychain entries.",
  "settings.advanced.unavailable": "Unavailable",
  "settings.advanced.deleteAllKeys": "Delete All Keys",
  "settings.advanced.removing": "Removing...",
  "settings.advanced.forgetSecretsTitle": "\u26A0\uFE0F Forget All Secrets",
  "settings.advanced.forgetSecretsBody":
    "This will remove all API keys for this vault from the Obsidian Keychain, data.json, and memory. You will need to re-enter them. Any credential backup files written during the v4 upgrade are left in place — delete those yourself once you no longer need them.",
  "settings.advanced.remove": "Remove",
  "settings.advanced.frameLogDesktopOnlyPath": "(Agent Mode frame logs are desktop-only)",
  "settings.advanced.frameLogsDesktopOnly": "Agent Mode frame logs are available on desktop only.",
  "settings.advanced.frameLogOpenFailed": "Failed to open Agent Mode frame log.",
  "settings.advanced.frameLogCleared": "Agent Mode frame log cleared.",
  "settings.advanced.frameLogClearFailed": "Failed to clear Agent Mode frame log.",
  "settings.advanced.forgetSecretsFailed": "Failed to remove API keys. Please try again.",

  "settings.resetConfirm.body":
    'Resetting settings will restore the default values. API keys are not cleared by this action — use "Delete All Keys" in Advanced Settings → API Key Storage if you also want to remove them. Are you sure you want to continue?',

  "settings.agents.notifications": "Notifications",
  "settings.tools.permissions": "Local programs and subtasks",
  "settings.models.byokTab": "Models (BYOK)",
  "settings.models.emptyPrefix": "No models configured yet. Add a provider on the",
  "settings.models.emptyChatSuffix": "tab to populate Quick Chat.",

  "settings.chatModels.searchPlaceholder": "Search chat models…",

  "settings.command.edit": "Edit",
  "settings.command.duplicate": "Duplicate",
  "settings.command.delete": "Delete",
  "settings.command.deleteConfirmTitle": "Delete Command",
  "settings.command.deleteConfirmBody":
    'Are you sure you want to delete the command "{title}"? This will permanently remove the command file and cannot be undone.',
  "settings.command.inMenu": "In Menu",
  "settings.command.inMenuTooltip":
    "If enabled, the command will be available in the context menu when you right-click in the editor.",
  "settings.command.inSlash": "In Slash",
  "settings.command.inSlashTooltip":
    "If enabled, the command will be available as a slash command in the chat.",
  "settings.command.editCommandTooltip": "Edit Command",
  "settings.command.duplicateCommandTooltip": "Duplicate command",
  "settings.command.deletedNotice": 'Command "{title}" deleted successfully!',
  "settings.command.deleteFailed": "Failed to delete command. Please try again.",
  "settings.command.duplicateFailed": "Failed to duplicate command. Please try again.",
  "settings.command.empty": "No custom prompt files found.",
  "settings.command.heading": "Custom Commands",
  "settings.command.headingDescPrefix":
    "Preset prompts you trigger from the editor right-click menu or with a",
  "settings.command.headingDescSuffix": "command in chat.",
  "settings.command.infoPrefix":
    "Commands are automatically loaded from .md files in your custom prompts folder",
  "settings.command.infoSuffix": ". Modifying the files will also update the command settings.",
  "settings.command.templating": "Custom Prompt Templating",
  "settings.command.templatingDesc":
    "Process variables like {activenote}, {foldername}, or {#tag} in prompts. Disable for raw prompts.",
  "settings.command.sortStrategy": "Custom Prompts Sort Strategy",
  "settings.command.sortStrategyDesc": "Sort order for slash command menu prompts",
  "settings.command.sortRecency": "Recency",
  "settings.command.sortAlphabetical": "Alphabetical",
  "settings.command.sortManual": "Manual",
  "settings.command.add": "Add Cmd",
  "settings.command.name": "Name",
  "settings.command.slashCmd": "Slash Cmd",
  "settings.command.actions": "Actions",

  "settings.debug.section": "Debugging & support",
  "settings.debug.reportIssueDesc":
    "Collect selected screenshots and recent logs into a local zip for review. You choose whether to open GitHub and submit the report yourself.",
  "settings.debug.offerFeedback": "Offer feedback reports in Agent Chat",
  "settings.debug.offerFeedbackDesc":
    "When something goes wrong in Agent Chat, the agent can draft a local report for you to review and submit yourself.",
  "settings.debug.debugMode": "Debug Mode",
  "settings.debug.debugModeDesc":
    "Logs agent chat activity to the developer console (View → Toggle Developer Tools), and pre-selects the chat log when you report an issue.",
  "settings.debug.activityLog": "Agent chat activity log",
  "settings.debug.activityLogDesc":
    "Records the behind-the-scenes messages between the plugin and the agent so a report always has recent activity to attach. Stored on this device only, outside your vault ({path}), and can include your prompts and note contents in plain text.",
  "settings.debug.open": "Open",
  "settings.debug.clear": "Clear",

  "settings.selfHost.intro":
    "Bring your own infrastructure — self-hosted search, web-search providers, and models.",
  "settings.selfHost.enable": "Enable Self-Host Mode",
  "settings.selfHost.enableDesc":
    "Prioritize local / self-hosted models and configure your preferred web-search provider.",
  "settings.selfHost.enableDescTooltip":
    "Use your own infrastructure for full control and offline use.",
  "settings.selfHost.privacyTitle": "Privacy-first.",
  "settings.selfHost.privacyBody":
    "While Self-Host is on, configured cloud models are flagged with a warning and sorted below your local / self-hosted models. They stay selectable — you decide whether to use them.",
  "settings.selfHost.webSearchProviders": "Web search providers",
  "settings.selfHost.selfHostedModels": "Self-hosted models",
  "settings.selfHost.modelsTitle": "Chat models",
  "settings.selfHost.modelsDesc":
    "Add local / self-hosted models as an OpenAI-compatible endpoint in BYOK.",
  "settings.selfHost.openByok": "Open BYOK",
  "settings.selfHost.searchProvider": "Web Search Provider",
  "settings.selfHost.searchProviderDesc": "Your key turns this into an agent skill parameter.",
  "settings.selfHost.signUp": "Sign up",
  "settings.selfHost.provider.firecrawl.apiKeyTitle": "Firecrawl API Key",
  "settings.selfHost.provider.firecrawl.description": "Web search & fetch via Firecrawl.",
  "settings.selfHost.provider.perplexity.apiKeyTitle": "Perplexity API Key",
  "settings.selfHost.provider.perplexity.description": "Web search via Perplexity Sonar.",
  "settings.selfHost.provider.parallel.apiKeyTitle": "Parallel API Key",
  "settings.selfHost.provider.parallel.description": "Web search via Parallel.",
  "settings.selfHost.provider.exa.apiKeyTitle": "Exa API Key",
  "settings.selfHost.provider.exa.description": "Web search via Exa.",

  "settings.instructions.examplePlaceholder":
    "e.g. Put new notes you create in Inbox/ and link them to a related note.",
  "settings.instructions.projectLabel": "Project instructions",
  "settings.instructions.projectDescription":
    "Your custom instructions for the agent to follow for every interaction in this project. They take precedence over your vault instructions wherever the two conflict. Saved to AGENTS.md in the project folder, which you can also edit as a note.",
  "settings.instructions.vaultLabel": "Custom vault instructions",
  "settings.instructions.vaultDescription":
    "Your custom instructions for the agent to follow for every vault interaction. Saved to AGENTS.md in your vault root, which you can also edit as a note.",
  "settings.instructions.openAgentsFile": "Open AGENTS.md",

  "settings.legacyPrompts.prefix": "Agent Mode now reads your instructions from",
  "settings.legacyPrompts.singleSuffix": ". Your saved system prompt is still in",
  "settings.legacyPrompts.manySuffix": ". Your {count} saved system prompts are still in",
  "settings.legacyPrompts.tail":
    "— open one there and paste anything you want the agent to keep following.",

  "settings.folderChange.heading": "Change Vault Agent folder",
  "settings.folderChange.prefix": "Vault Agent will keep new chats and data under",
  "settings.folderChange.mid": ". Your files aren't moved — your old data stays in",
  "settings.folderChange.suffix":
    ", which stays permanently excluded from vault search. Move it over if you want; Obsidian updates the links.",
  "settings.folderChange.warningTitle": "This folder already contains Markdown files.",
  "settings.folderChange.warningPrefix": "If you continue, every Markdown file under",
  "settings.folderChange.warningSuffix":
    "— including regular notes — will be excluded from vault search. The folder stays excluded even if you change the Vault Agent folder later.",

  "settings.notification.title": "Notification",
  "settings.notification.description": "Plays a short sound when an agent finishes a turn.",
  "settings.notification.sound": "Sound",
  "settings.notification.soundDescription": "Choose which sound to play.",
} as const;
