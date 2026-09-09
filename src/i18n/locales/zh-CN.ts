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
