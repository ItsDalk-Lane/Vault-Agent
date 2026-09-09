/**
 * Simplified Chinese locale strings for the QuickAdd plugin.
 *
 * Keys mirror `en.ts` exactly. A missing key falls back to English via `t()`,
 * so a half-translated locale is still usable — but please add the key here
 * instead of relying on the fallback for anything user-visible.
 *
 * Translation notes for self-use fork:
 * - 6 个命令名保留英文"QuickAdd"前缀，让命令面板搜索行为与英文版一致
 * - "Reload (dev)" 保留 (dev) 标记，避免和未来可能增加的"重载"功能混淆
 * - "Return to prompt" = "返回提示"，与 PromptPeek 功能对齐
 */
const zhCN = {
	command: {
		run: "运行 QuickAdd",
		runTemplateFromFolder: "从模板新建笔记",
		applyTemplate: "对当前笔记应用模板",
		reloadDev: "重新加载（开发）",
		openSettings: "打开 QuickAdd 设置",
		resumePrompt: "返回提示",
	},
	common: {
		yes: "是",
		no: "否",
		ok: "确定",
		cancel: "取消",
		confirm: "确认",
		delete: "删除",
		save: "保存",
		add: "添加",
		remove: "移除",
		close: "关闭",
		back: "返回",
		next: "下一步",
		done: "完成",
		skip: "跳过",
		skipTooltip: "留空",
		submit: "提交",
		search: "搜索",
		loading: "加载中…",
		peekAtNote: "预览笔记",
		typeToSearch: "输入以搜索…",
	},
	onePageInput: {
		note: "笔记",
		notePlaceholder: "搜索笔记或新建笔记",
	},
	macro: {
		obsidianCommand: {
			name: "Obsidian 命令",
			desc: "添加一个 Obsidian 命令",
			placeholder: "Obsidian 命令",
		},
		editorCommand: {
			name: "编辑器命令",
			desc: "添加编辑器命令",
		},
		userScript: {
			name: "用户脚本",
			desc: "添加一个 .js 文件或带 ```js 代码块的笔记——输入名称或点击「浏览」",
			placeholder: "开始输入脚本名称...",
			browse: "浏览",
			browseTooltip: "浏览并选择脚本（.js 文件或笔记）",
		},
		choice: {
			name: "选项",
			desc: "添加已有选项",
			placeholder: "选项",
		},
		addOpenFileTooltip: "添加打开文件命令",
		addAiAssistantTooltip: "添加 AI 助手命令",
		addWaitTooltip: "添加等待命令",
		addConditionalTooltip: "添加条件命令",
		selectCommand: "选择命令",

		onePageInputOverride: "单页输入覆盖",
		onePageInputFollow: "跟随全局设置",
		onePageInputAlways: "总是启用",
		onePageInputNever: "从不启用",
		runOnStartup: {
			name: "启动时运行",
			desc: "Obsidian 启动时执行此 Macro",
		},
		relativeOffsetPlaceholder: "-2",
		relativeOffsetUnitPlaceholder: "天",

		closeButton: "关闭",

		configureTitle: "配置条件命令",
		conditionType: {
			name: "条件类型",
			desc: "选择此条件的求值方式。",
		},
		variableName: {
			name: "变量名",
			desc: "要检查的 Macro 变量名（不带 $ 前缀）。",
			placeholder: "例如 projectStatus",
		},
		operator: {
			name: "运算符",
			desc: "如何比较变量值。",
		},
		valueType: {
			name: "值类型",
			desc: "如何解释比较值。",
		},
		kind: {
			variable: "Macro 变量",
			script: "运行脚本",
		},
		operators: {
			equals: "等于",
			notEquals: "不等于",
			lessThan: "小于",
			lessThanOrEqual: "小于等于",
			greaterThan: "大于",
			greaterThanOrEqual: "大于等于",
			contains: "包含",
			notContains: "不包含",
			isTruthy: "为真",
			isFalsy: "为假",
		},
		valueTypes: {
			string: "文本",
			number: "数字",
			boolean: "布尔",
		},
		expectedBool: {
			name: "期望值",
			desc: "选择 true 或 false。",
			true: "True",
			false: "False",
		},
		expectedValue: {
			name: "期望值",
			desc: "用于比较的值。",
			placeholder: "输入比较值",
		},
		scriptPath: {
			name: "脚本路径",
			desc: "Vault 相对路径，指向 .js 文件或带 ```js 代码块的笔记。",
			placeholder: "scripts/myCheck.js 或 Notes/myCheck.md",
			browse: "浏览",
			browseTooltip: "选择脚本（.js 文件或笔记）",
			browseEmpty: "未在 vault 中找到脚本",
			browseLabel: "选择脚本（.js 文件或带 ```js 块的笔记）",
		},
		exportName: {
			name: "导出名",
			desc: "可选的导出或成员调用（用 :: 访问嵌套成员）。",
			placeholder: "default",
		},
		notices: {
			enterVariableName: "QuickAdd：请在保存前输入变量名。",
			enterScriptPath: "QuickAdd：请在保存前输入脚本路径。",
		},

		saveSecretTooltip: "保存密钥",
		clearSecretTooltip: "清除密钥",

		filePath: {
			name: "文件路径",
			desc: "文件路径。支持 {{DATE}}、{{VALUE}} 等格式。",
			placeholder: "{{DATE}}todo.md",
		},
		whereToOpen: {
			name: "打开位置",
			desc: "选择标签页、分屏、窗口或侧边栏",
		},
		splitDirection: {
			name: "分屏方向",
			desc: "新面板相对于当前面板的排列方式",
		},
		focusOpenedFile: {
			name: "聚焦打开的文件",
			desc: "将打开的文件置于前台",
		},

		aiModel: {
			name: "模型",
			desc: "AI 助手将使用的模型",
		},
		systemPrompt: {
			name: "系统提示",
			desc: "AI 助手的系统提示",
		},
		showAdvancedSettings: "显示高级设置",
		promptTemplate: {
			name: "提示模板",
			desc: "启用后，助手将使用你指定的提示模板。如果禁用，助手会询问使用哪个提示模板。",
		},
		outputVariableName: {
			name: "输出变量名",
			desc: "用于存储 AI 助手输出的变量名，即 {{value:output}}。",
		},
		newName: "新名称",
		systemPromptAria: "系统提示",
		advancedSettings: {
			desc: "采样设置，如 temperature 和 top p。未修改的设置使用提供商的默认值。",
		},
		estimatedLocally: "本地估算。提供商强制实施精确的上下文限制。",
	},

	openFile: {
		title: "打开文件命令设置",
		whereToOpen: {
			reuse: "复用当前标签页",
			tab: "新标签页",
			split: "分屏",
			window: "新窗口",
			leftSidebar: "左侧边栏",
			rightSidebar: "右侧边栏",
		},
		splitDirection: {
			right: "向右分屏",
			down: "向下分屏",
		},
	},

	userScript: {
		saveSecretTooltip: "保存密钥",
		clearSecretTooltip: "清除密钥",
		pasteSecret: "粘贴密钥",
		pasteSecretPlaceholder: "保存前请先粘贴密钥。",
		secretSaved: "密钥已保存。",
		secretCleared: "密钥已清除。",
		secretSavedShort: "密钥已保存",
		secretStorageUnavailableSave: "SecretStorage 不可用。密钥未保存。",
		secretStorageUnavailableClear: "SecretStorage 不可用。密钥未清除。",
	},

	ai: {
		providers: {
			name: "AI 提供商",
			desc: "AI 助手使用的提供商",
			editButton: "编辑提供商",
		},
		defaultModel: {
			name: "默认模型",
			desc: "AI 助手的默认模型",
		},
		promptTemplateFolderPath: {
			name: "提示模板文件夹路径",
			desc: "包含提示模板的文件夹路径",
		},
		showAssistant: {
			name: "显示助手",
			desc: "显示 AI 助手的状态消息",
		},
		confirmToolCalls: "确认 AI 工具调用",
		defaultSystemPrompt: {
			name: "默认系统提示",
			desc: "AI 助手的默认系统提示",
		},

		search: {
			name: "搜索",
			placeholder: "按名称筛选",
		},
		selectAll: "全选",
		clearSelection: "清除选择",
		importMode: {
			name: "导入模式",
			desc: "Add 将追加新模型。Replace 将用所选列表覆盖现有模型。",
		},
		importSelected: "导入所选",

		providersTitle: {
			name: "提供商",
			desc: "AI 助手的提供商",
		},
		addProvider: "添加提供商",
		editProvider: "编辑",
		providerName: "名称",
		endpoint: {
			name: "端点",
			desc: "AI 助手的端点",
		},
		apiKey: "API 密钥",
		apiKeyDesc: "从 SecretStorage 选择密钥",
		providerType: "提供商类型",
		modelSource: "模型来源",
		addModel: {
			name: "添加模型",
			button: "添加模型",
		},
		importModels: {
			name: "导入模型",
			browseButton: "浏览模型",
		},
		autoSyncModels: {
			name: "自动同步模型",
			syncNowButton: "立即同步",
		},
		connect: "连接",
		connecting: "正在连接...",
		customProvider: {
			name: "自定义提供商",
			desc: "创建任何自定义端点（OpenAI 兼容或其他）",
			addButton: "添加自定义...",
		},

		abortRun: "中止运行",
		deny: "拒绝",
		approveAllRun: "本次运行全部批准",
		approve: "批准",
	},

	choiceBuilder: {
		icon: {
			name: "图标",
			desc: "Lucide/Obsidian 图标 id。留空使用 {default}。",
			placeholder: "Lucide 图标名",
			aria: "选项图标",
		},
		folderMode: {
			obsidianDefault: "Obsidian 默认",
			specified: "指定文件夹",
			activeFile: "当前文件所在文件夹",
			prompt: "每次询问文件夹",
			obsidianDefaultDesc: "使用 Obsidian 的「新笔记默认位置」设置。",
			specifiedDesc: "在下方文件夹中创建笔记。多个文件夹时，创建笔记时会询问使用哪个。",
			activeFileDesc: "在当前活动文件旁边创建笔记（若无打开文件则回退到 vault 根目录）。",
			promptDesc: "创建笔记时选择 vault 中的任何文件夹。",
		},
		canvasPicker: {
			targetNotFound: "未找到目标 Canvas 文件。",
			couldNotOpen: "无法打开目标 Canvas。",
			copyNodeFailed: "无法自动复制节点 ID。",
		},
		captureTargetFeedback: {
			needsField: "属性捕获目标需要字段名，例如 property:type=draft。",
			filtersDesc: "捕获目标过滤器选择一个目标文件。在捕获格式中使用 {{FILE:...|multi}} 以支持多值元数据。",
		},
	},

	input: {
		optionalHint: "可选——留空、按「跳过」或按 Ctrl/Cmd+Shift+↵。",
		skipTooltip: "将此字段留空",
		skipTooltipFull: "跳过并留空",
	},

	datePicker: {
		title: "编辑文件夹",
		name: "名称",
		placeholder: {
			name: "占位符",
			desc: "在该文件夹打开时显示在选项选择器的搜索框中。留空则使用文件夹名。",
			value: "默认为文件夹名",
		},
		unableToParseDate: "无法解析日期",
	},

	promptPeek: {
		returnButton: "返回",
		returnTooltip: "返回提示而不插入",
		dropTooltip: "将所选文本放入草稿并返回",
		cancelTooltip: "放弃此次运行",
	},

	choiceSuggester: {
		defaultPlaceholder: "选择一个选项",
		previewPlaceholder: "预览将显示在此处",
		previewLabel: "预览：",
		willBeLeftEmpty: "将留空",
		newNoteFromTemplate: "从模板新建笔记…",
		emptyFlair: "空",
		unreadableFlair: "无法读取",
		emptyNoticePrefix: "为空。请添加选项或拖入一个。",
		couldNotRenderName: "无法将选项名称渲染为 Markdown；以纯文本显示",
		couldNotRunTemplate: "无法从该文件夹运行模板",
	},

	contextMenu: {
		enableInPalette: "在命令面板中启用",
		disableInPalette: "在命令面板中禁用",
		rename: "重命名",
		configure: "配置",
		duplicate: "复制",
		delete: "删除",
		moveToRoot: "移动到：(根)",
		moveToNoFolders: "移动到：(无文件夹)",
		moveToPrefix: "移动到：",
	},
	settings: {
		language: {
			name: "语言",
			desc: "选择插件界面语言。「自动（跟随 Obsidian）」会匹配 Obsidian 的语言设置。切换语言后需要重新加载插件——命令名和弹窗标签不会实时更新。",
			auto: "自动（跟随 Obsidian）",
			en: "English",
			"zh-CN": "简体中文",
		},
		appearance: {
			heading: "外观",
			ribbonIconName: "在侧边栏显示图标",
			ribbonIconDesc: "在侧边栏 ribbon 上添加 QuickAdd 图标。修改后需要重新加载插件。",
		},
		group: {
			choicesAndPackages: "选项与套餐",
			choicePicker: "选项选择器",
			input: "输入",
			templatesAndProperties: "模板与属性",
			notifications: "通知",
			globalVariables: "全局变量",
			aiAndOnline: "AI 与联网",
			developer: "开发者",
		},
		docs: {
			quickAddTooltip: "QuickAdd 文档",
			learnMore: "了解更多",
			packagesLink: "了解更多套餐相关",
			learnMoreAboutOnePageInput: "了解更多单页输入相关",
		},
		choices: {
			name: "选项",
		},
		packages: {
			name: "套餐",
			desc: "将 QuickAdd 自动化打包或导入为可复用套餐。",
			descNeedsChoice: "将 QuickAdd 自动化打包或导入为可复用套餐。添加至少一个选项后才能导出。",
			exportButton: "导出套餐…",
			importButton: "导入套餐…",
			nothingToExport: "暂无可导出内容",
		},
		items: {
			searchNestedChoices: {
				name: "搜索嵌套选项",
				desc: "在选项选择器中搜索时，同时匹配文件夹内嵌套的选项，并显示其路径。注意嵌套匹配可能比同级匹配排序更高。关闭后只搜索当前层级。",
			},
			templateFolderLauncherRow: {
				name: "在启动器中显示「从模板新建笔记」",
				desc: "在「运行 QuickAdd」中添加一行，列出已配置模板文件夹中的模板，以便无需专用 Template 选项即可从模板创建笔记。仅在配置了模板文件夹时显示；命令面板中的入口始终可用。",
				bottom: "在底部显示（保持顶部首选选项优先）",
				top: "在顶部显示",
				off: "隐藏",
			},
			useMultiLine: {
				name: "使用多行输入提示",
				desc: "使用多行输入提示代替单行输入提示。提交多行提示用 Ctrl/Cmd+Enter；Enter 插入换行。",
			},
			persistDrafts: {
				name: "保留输入提示草稿",
				desc: "关闭输入提示时保留草稿，以便在重新打开时恢复。草稿仅在本会话内存储。",
			},
			useSelection: {
				name: "使用编辑器选区作为 Capture 默认值",
				desc: "启用后，Capture 使用当前编辑器选区作为 {{VALUE}}，并可能跳过提示。禁用后，Capture 总是提示输入 {{VALUE}}。",
			},
			namePastedImages: {
				name: "用笔记标题命名粘贴的图片",
				desc: "启用后，QuickAdd 保存的剪贴板图片（在提示中粘贴，或 {{CLIPBOARD}} 带图片无文本时）会按目标笔记命名。当目标尚不确定时，QuickAdd 保留时间戳命名。重名由 Obsidian 的附件文件夹设置处理。",
			},
			onePageInput: {
				name: "为选项启用单页输入",
				descPrefix: "在选项运行前将其所有输入收集到一个表单中，而不是逐个提示。适用于 Template 和 Capture 选项，以及脚本声明了输入的 Macro。Template 和 Capture 选项可单独覆盖此设置。",
			},
			dateAliases: {
				name: "日期别名",
				desc: "用于自然语言日期解析的简写。每行一个：别名 = 短语。示例：tm = tomorrow。",
				placeholder: "t = today\ntm = tomorrow\nyd = yesterday",
				resetButton: "重置为默认值",
			},
			templateFolderPaths: {
				name: "模板文件夹路径",
				desc: "存储模板的文件夹。在配置 QuickAdd 时用于建议模板文件。可添加任意数量；留空则建议 vault 中所有模板文件。",
				empty: "尚未添加任何文件夹。",
				placeholder: "templates/",
				addButton: "添加",
			},
			convertStringTypes: {
				name: "将字符串 front matter 变量转为类型化属性（Beta）",
				desc: '脚本返回的列表/对象值始终作为正式的 Obsidian 属性写入（列表变成 List 类型）。此开关额外将字符串值转为类型化属性：以逗号或项目符号分隔的字符串变成 List，"42" 变成 Number，"true" 变成 Checkbox 等。默认关闭；字符串转换是 beta 启发式，可能有边界情况。',
			},
			announceUpdates: {
				name: "发布公告",
				desc: "安装新版本时显示发行说明。包括新功能、演示视频和 bug 修复。",
				all: "每次新版本都显示",
				major: "仅在主要版本显示（新功能、破坏性变更）",
				none: "不显示",
			},
			showCaptureNotifications: {
				name: "显示 Capture 通知",
				desc: "成功捕获内容后显示通知以确认操作完成。",
			},
			showInputCancellation: {
				name: "显示输入取消通知",
				desc: "输入提示被取消且未提交时显示通知。关闭此选项以避免取消提示时出现多余通知。",
			},
			disableAI: {
				name: "禁用 AI 与联网功能",
				desc: "阻止插件向 OpenAI 等外部服务发出请求。你仍可通过用户脚本执行任意代码，包括联系外部服务。但此设置会禁用 AI 助手等插件功能。要使用 AI 助手，需要关闭此设置。",
			},
			allowUriCallbacks: {
				name: "允许 URI x-callback-url",
				desc: "启用后，obsidian://quickadd URI 可以在 Template 或 Capture 选项完成后打开回调 URL（x-success / x-error / x-cancel），将结果和受影响笔记的 vault 路径与 URL 发送给该回调。启用时，带 x-* 回调参数的 URI 仅限 Template 和 Capture 选项（其他类型会被警告并跳过）。默认关闭，因为回调 URL 由创建 obsidian:// 链接的人设置。仅允许 shortcuts: 和 obsidian: 回调 URL。",
			},
			development: {
				name: "开发信息",
				desc: "面向开发者的 Git 信息。",
			},
			globalVariables: {
				name: "全局变量",
			},
		},
	},
} as const;

export default zhCN;
