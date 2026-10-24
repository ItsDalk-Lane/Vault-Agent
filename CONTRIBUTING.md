# 为 Vault Agent 贡献

Vault Agent 是 Obsidian 桌面插件，使用内置执行引擎和用户配置的 BYOK 模型服务。仓库源自 Obsidian Copilot，保留原有许可与署名；当前运行方式以本仓库的 [README](README.md) 和 [AGENTS.md](AGENTS.md) 为准。

## 问题与改动

先查看[本仓库问题列表](https://github.com/ItsDalk-Lane/Vault-Agent/issues)，确认是否已有相同记录。报告应包含复现步骤、实际与预期结果、Obsidian／插件版本和必要截图。不要公开密钥、私人笔记或未经核对的日志。

插件可在本机准备报告 zip，供你检查后手动附加到问题页面；没有自动上传服务。打开问题页面也不会自动提交。

代码改动应关联具体问题，保留无关修改、原有聊天和设置。提交或推送前确认已有相应授权，不要把完成实现理解为自动发布许可。

## 开发准备

1. 在资料库外检出仓库，不要把整个源代码放入用户笔记库。
2. 运行 `npm install` 安装开发依赖。
3. 阅读 [AGENTS.md](AGENTS.md) 和与你修改区域匹配的[开发指南](designdocs/agents/STYLE_GUIDE.md)。
4. 使用 `npm run build` 构建；不要运行 `npm run dev`。

Node/npm 是开发和构建工具。最终用户只需桌面 Obsidian 和构建好的插件；不需要额外 Agent CLI 或独立 Node 安装。

运行时只使用内置引擎。不要重新引入 Claude Code、Codex、OpenCode 的安装、登录、探测、更新或启动链。旧程序名称仅供历史记录显示；真实供应商模型品牌不受此限制。

## 实现与验证

- 先用失败检查复现要修的问题，再实现满足需求的最小完整修改。
- 按模块组织测试，验证可观察行为；不要模拟掉正在验证的权限或写入层。
- 新增界面或重要状态需增加相邻组件预览，并实际查看不同宽度。
- 新增注释用中文，并关联真实 GitHub 问题；不改 AI 提示词，除非任务明确要求。
- 用户行为变更需同步 [使用指南](docs/index.md)。

常用检查：

```bash
npm test -- --runInBand --runTestsByPath <相关测试>
npm run build
npm run format
npm run lint
node scripts/check-pi-boundaries.mjs
npm run review:obsidian
```

PR 前必须完成 `npm run format && npm run lint`。涉及插件源码、样式、依赖或发布资料时还需运行 `npm run review:obsidian` 并阅读警告。错误会阻断；不要弱化规则来换取通过。审查器的故意失败夹具应与真实源码错误分开看。

## 本机真实测试

本机唯一测试库是用户指定的现有 **houde**：`/Users/study_superior/Desktop/Project/houde`。不得新建 PiSmoke 或其他测试库，不得使用独立 Obsidian profile。保留日常仓库列表和已有笔记、聊天、设置。

```bash
export COPILOT_TEST_VAULT_PATH="/Users/study_superior/Desktop/Project/houde"
npm run test:vault
```

部署、重载和任何 CLI／界面修改前，同时核对实时库名 `houde` 以及解析后的完整路径。测试授权不包括清空库、删除已有配置、直接移除设置文件或批量重置。只清理本次明确创建的临时内容。

`test:vault` 构建插件，按配置部署产物并通过 Obsidian CLI 重载；已有组件图库也会同步构建。详见[测试指南](designdocs/agents/TESTING_GUIDE.md)。开发者不得为了复现旧记录重新建立历史测试库或独立 profile。

建议按本次影响验证：BYOK 草稿保存／取消、模型切换、技能单一开关、MCP 连接与审批、目录授权、笔记写入及回退、停止、历史只读和重开恢复。真实模型请求、跨平台测试和远程服务授权分别记录；自动测试通过不能冒充 Windows／Linux 实机已验。

## PR 说明

说明用户原来遇到的问题、修改后的结果、实际运行的检查及尚未验证的范围。界面改动提供经过核对的截图。保留旧聊天与配置的兼容性，不用删除旧数据来掩盖失败。

发布资料中的 `RELEASES.md` 仅在发布 PR 修改。正常开发不要自动发布插件或扩大外部权限。
