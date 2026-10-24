import type { settingsUi as enSettingsUi } from "@/i18n/messages/en/settingsUi";

export const settingsUi: Record<keyof typeof enSettingsUi, string> = {
  "settings.advanced.others": "其他",
  "settings.advanced.apiKeyStorage": "API 密钥存储",
  "settings.advanced.keychainUpdatePrefix": "更新 Obsidian 至",
  "settings.advanced.keychainUpdateMid": "以使用",
  "settings.advanced.keychainUpdateSuffix": "。此版本无法加载或保存密钥。",
  "settings.advanced.keychainEmptyPrefix": "此设备的",
  "settings.advanced.keychainEmptySuffix":
    " 中未找到任何 API 密钥。请在相应的设置区域重新输入 API 密钥——每台设备的 Keychain 都是独立的。",
  "settings.advanced.keychainStoredPrefix": "API 密钥存储在此设备的",
  "settings.advanced.keychainStoredSuffix": "中。",
  "settings.advanced.keychainUnavailableTitle": "更新 Obsidian 至 1.11.4+ 才能删除 Keychain 条目。",
  "settings.advanced.unavailable": "不可用",
  "settings.advanced.deleteAllKeys": "删除所有密钥",
  "settings.advanced.removing": "正在删除……",
  "settings.advanced.forgetSecretsTitle": "⚠️ 忘记所有密钥",
  "settings.advanced.forgetSecretsBody":
    "这将从此库的 Obsidian Keychain、data.json 和内存中移除所有 API 密钥。你需要重新输入。v4 升级期间写入的凭据备份文件会保留在原处——不再需要时请自行删除。",
  "settings.advanced.remove": "移除",
  "settings.advanced.frameLogDesktopOnlyPath": "（Agent Mode 帧日志仅在桌面端可用）",
  "settings.advanced.frameLogsDesktopOnly": "Agent Mode 帧日志仅在桌面端可用。",
  "settings.advanced.frameLogOpenFailed": "无法打开 Agent Mode 帧日志。",
  "settings.advanced.frameLogCleared": "Agent Mode 帧日志已清空。",
  "settings.advanced.frameLogClearFailed": "无法清空 Agent Mode 帧日志。",
  "settings.advanced.forgetSecretsFailed": "无法移除 API 密钥。请重试。",

  "settings.resetConfirm.body":
    "重置设置将恢复默认值。此操作不会清除 API 密钥——如果还想删除密钥，请使用高级设置 → API 密钥存储中的“删除所有密钥”。确定要继续吗？",

  "settings.agents.notifications": "通知",
  "settings.tools.permissions": "本地程序与子任务",
  "settings.models.byokTab": "模型（BYOK）",
  "settings.models.emptyPrefix": "尚未配置任何模型。请在",
  "settings.models.emptyChatSuffix": "标签页添加提供商，以填充快速对话。",

  "settings.chatModels.searchPlaceholder": "搜索对话模型……",

  "settings.command.edit": "编辑",
  "settings.command.duplicate": "复制",
  "settings.command.delete": "删除",
  "settings.command.deleteConfirmTitle": "删除命令",
  "settings.command.deleteConfirmBody":
    "确定要删除命令“{title}”吗？这将永久删除命令文件，且无法撤销。",
  "settings.command.inMenu": "在菜单中",
  "settings.command.inMenuTooltip": "启用后，在编辑器中右键单击时，该命令会出现在上下文菜单中。",
  "settings.command.inSlash": "在斜杠命令中",
  "settings.command.inSlashTooltip": "启用后，该命令可在对话中作为斜杠命令使用。",
  "settings.command.editCommandTooltip": "编辑命令",
  "settings.command.duplicateCommandTooltip": "复制命令",
  "settings.command.deletedNotice": "命令“{title}”已删除！",
  "settings.command.deleteFailed": "无法删除命令。请重试。",
  "settings.command.duplicateFailed": "无法复制命令。请重试。",
  "settings.command.empty": "未找到自定义提示词文件。",
  "settings.command.heading": "自定义命令",
  "settings.command.headingDescPrefix": "在编辑器右键菜单中或通过对话中的",
  "settings.command.headingDescSuffix": "命令触发的预设提示词。",
  "settings.command.infoPrefix": "命令会自动从自定义提示词文件夹中的 .md 文件加载",
  "settings.command.infoSuffix": "。修改这些文件也会更新命令设置。",
  "settings.command.templating": "自定义提示词模板",
  "settings.command.templatingDesc":
    "处理提示词中的 {activenote}、{foldername} 或 {#tag} 等变量。关闭后使用原始提示词。",
  "settings.command.sortStrategy": "自定义提示词排序方式",
  "settings.command.sortStrategyDesc": "斜杠命令菜单中提示词的排序方式",
  "settings.command.sortRecency": "最近使用",
  "settings.command.sortAlphabetical": "按字母顺序",
  "settings.command.sortManual": "手动",
  "settings.command.add": "添加命令",
  "settings.command.name": "名称",
  "settings.command.slashCmd": "斜杠命令",
  "settings.command.actions": "操作",

  "settings.debug.section": "调试与支持",
  "settings.debug.reportIssueDesc":
    "将选中的截图和最近日志打包到本地，供你检查。是否打开 GitHub 并提交报告，由你自行决定。",
  "settings.debug.offerFeedback": "在 Agent 对话中提供反馈报告",
  "settings.debug.offerFeedbackDesc":
    "当 Agent 对话出现问题时，Agent 可以为你起草一份本地报告，供你检查并自行提交。",
  "settings.debug.debugMode": "调试模式",
  "settings.debug.debugModeDesc":
    "将 Agent 对话活动记录到开发者控制台（查看 → 切换开发者工具），并在你报告问题时预先选中对话日志。",
  "settings.debug.activityLog": "Agent 对话活动日志",
  "settings.debug.activityLogDesc":
    "记录插件与 Agent 之间在后台收发的消息，以便报告始终能附上最近的活动。仅存储在此设备上，位于你的库之外（{path}），且可能以纯文本包含你的提示词和笔记内容。",
  "settings.debug.open": "打开",
  "settings.debug.clear": "清空",

  "settings.selfHost.intro": "使用你自己的基础设施——自托管搜索、网络搜索提供商和模型。",
  "settings.selfHost.enable": "启用自托管模式",
  "settings.selfHost.enableDesc": "优先使用本地 / 自托管模型，并配置你选用的网络搜索服务。",
  "settings.selfHost.enableDescTooltip": "使用你自己的基础设施，获得完全控制与离线使用能力。",
  "settings.selfHost.privacyTitle": "隐私优先。",
  "settings.selfHost.privacyBody":
    "自托管开启期间，已配置的云端模型会带有警告标记，并排在本地 / 自托管模型之后。它们仍可选择，是否使用由你决定。",
  "settings.selfHost.webSearchProviders": "网络搜索提供商",
  "settings.selfHost.selfHostedModels": "自托管模型",
  "settings.selfHost.modelsTitle": "对话模型",
  "settings.selfHost.modelsDesc": "在 BYOK 中将本地 / 自托管模型添加为 OpenAI 兼容端点。",
  "settings.selfHost.openByok": "打开 BYOK",
  "settings.selfHost.searchProvider": "网络搜索提供商",
  "settings.selfHost.searchProviderDesc": "你的密钥会将其转换为 Agent 技能参数。",
  "settings.selfHost.signUp": "注册",
  "settings.selfHost.provider.firecrawl.apiKeyTitle": "Firecrawl API 密钥",
  "settings.selfHost.provider.firecrawl.description": "通过 Firecrawl 进行网络搜索和抓取。",
  "settings.selfHost.provider.perplexity.apiKeyTitle": "Perplexity API 密钥",
  "settings.selfHost.provider.perplexity.description": "通过 Perplexity Sonar 进行网络搜索。",
  "settings.selfHost.provider.parallel.apiKeyTitle": "Parallel API 密钥",
  "settings.selfHost.provider.parallel.description": "通过 Parallel 进行网络搜索。",
  "settings.selfHost.provider.exa.apiKeyTitle": "Exa API 密钥",
  "settings.selfHost.provider.exa.description": "通过 Exa 进行网络搜索。",

  "settings.instructions.examplePlaceholder": "例如：将你新建的笔记放入 Inbox/，并链接到相关笔记。",
  "settings.instructions.projectLabel": "项目指令",
  "settings.instructions.projectDescription":
    "你为 Agent 自定义的指令，在本项目的每次交互中生效。两者冲突时，优先于库指令。保存到项目文件夹中的 AGENTS.md，你也可以将其作为笔记编辑。",
  "settings.instructions.vaultLabel": "自定义库指令",
  "settings.instructions.vaultDescription":
    "你为 Agent 自定义的指令，在每次库交互中生效。保存到库根目录的 AGENTS.md，你也可以将其作为笔记编辑。",
  "settings.instructions.openAgentsFile": "打开 AGENTS.md",

  "settings.legacyPrompts.prefix": "Agent Mode 现在从",
  "settings.legacyPrompts.singleSuffix": " 读取指令。你保存的系统提示词仍位于",
  "settings.legacyPrompts.manySuffix": " 读取指令。你保存的 {count} 个系统提示词仍位于",
  "settings.legacyPrompts.tail": "——打开其中一个，粘贴任何你希望 Agent 继续遵循的内容。",

  "settings.folderChange.heading": "更改 Vault Agent 文件夹",
  "settings.folderChange.prefix": "Vault Agent 会将新对话和数据保存在",
  "settings.folderChange.mid": "。你的文件不会被移动——旧数据仍保留在",
  "settings.folderChange.suffix":
    "，该文件夹将永久从库搜索中排除。如需移动可以自行操作；Obsidian 会更新链接。",
  "settings.folderChange.warningTitle": "此文件夹已包含 Markdown 文件。",
  "settings.folderChange.warningPrefix": "如果继续，该文件夹下的每个 Markdown 文件",
  "settings.folderChange.warningSuffix":
    "——包括常规笔记——都将从库搜索中排除。即使你之后更改 Vault Agent 文件夹，该文件夹仍将保持排除。",

  "settings.notification.title": "通知",
  "settings.notification.description": "当 Agent 完成一轮时播放简短提示音。",
  "settings.notification.sound": "提示音",
  "settings.notification.soundDescription": "选择要播放的提示音。",
};
