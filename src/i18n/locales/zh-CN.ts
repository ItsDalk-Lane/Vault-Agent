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
		search: "搜索",
		loading: "加载中…",
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
	},
} as const;

export default zhCN;
