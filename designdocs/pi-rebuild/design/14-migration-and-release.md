# 14 · 数据迁移、旧后端删除与单插件发布

## 14.1 迁移顺序

阶段内先新增 pi backend，旧后端仅作开发对照。新会话默认 Pi 的切换发生在所有能力测试完成后。旧聊天始终可打开，不强制变更 backendId，未知 backend 的旧数据也不删除。

配置迁移采用 schemaVersion + 单调迁移步骤，迁移前保存原 data.json 和索引备份（排除既有秘密字段），写到私有迁移目录，原文件写入成功才标迁移完成。失败可重试，重复迁移不会生成重复 provider、模型或聊天。

模型来源 `origin.kind=agent` 的历史模型项保留原标签但标 needs_reconfiguration；不能把 Claude/Codex 订阅会话凭据假装转成 BYOK API Key。已有可用 BYOK keychainId 保留，不改变名字导致找不到密钥。

## 14.2 历史兼容

保留 AgentChatPersistenceManager 与 AgentSessionIndex 的兼容读取。为旧二进制写出的历史只实现纯文件解析器（确有可用数据时），不启动 CLI。解析不出完整 tool messages 时退化为可见聊天材料导入，清楚说明，不声称完整恢复。

新增 legacy→new mapping，以 sourceHash 保证重复导入幂等。旧记录有删除墓碑/用户标题/项目归属时遵守原索引，不通过扫描又把已删除会话全部恢复。

## 14.3 最终删除清单

删除旧 ClaudeSdkBackendProcess 执行链、ACP runtime 执行链、三个 backend descriptor 注册、CLI 下载/解压/版本检查/managed install/登录/二进制路径探测、向外部 Agent 同步技能、专属后台 task 协议转换及无调用者依赖。纯历史读取代码另置 legacy，并用 import-boundary 测试保证它不能 spawn。

从 production dependencies 删除已经无引用的 @anthropic-ai/claude-agent-sdk、@agentclientprotocol/sdk；是否删除其他库以实际 import 图为准，不“顺便”删除 unrelated 模型或 UI 功能。去掉 `claude/codex/opencode` 安装步骤和 PATH 指引；历史来源名仍可显示，不能为通过字符串检查把历史信息抹掉。

不要再把 `BackendDescriptor.getInstallState()` 用作模型是否可用判断。最终 engine ready=插件初始化成功；模型状态 separately configured/missing_key/error。CLI 字段先兼容返回自带引擎的正确状态，最后通过专门清理任务删除无意义字段及调用方。

## 14.4 零额外安装验收

干净测试 profile 只有支持的 Obsidian + 插件，PATH 内无 node/npm/npx/uv/claude/codex/opencode/pi。至少验证：添加 BYOK、流式回答、Vault 搜索/修改审批/Diff/回滚、待办、计划、提问、压缩、子代理、fan-out、HTTP MCP 与重启恢复。测试脚本的 Node 运行环境是开发工具，不是用户安装前提。

模型配置只通过插件 UI 完成；MCP OAuth 可打开系统浏览器，不要求终端。插件不连接外部本地 Agent daemon，不启动隐藏 HTTP Agent 服务，不携带自动更新的 CLI 代理。

外部 shell/stdio MCP 属可选增强：没有 interpreter/server 时仍完成上述核心验收。发布文案明确两者需要宿主已有可执行程序，但不把它们列为使用插件必装。严禁把“默认支持 MCP”理解成会帮用户安装每个 MCP 服务。

## 14.5 发布包与升级

随插件分发锁定 SDK 代码、必要静态资源和现有 UI；禁止启动时下载 SDK、动态 npm install、把 ESM 问题转嫁给用户安装 Node。新增 package bundle 经过已有 review:obsidian 和体积检查；不需要 node-pty/native sqlite addon。

插件 minAppVersion 不凭本包猜数字：使用已经通过的 PoC 支持版本作为最小基线，新增 SecretStorage/工具依赖若不满足则显式提升并记录测试证据。若实际 Node runtime 不支持锁定依赖，提示更新 Obsidian 而非安装 Node；原 PoC 已通过不说明所有未来宿主版本都受支持。

升级 Durable 前创建 store 备份并记录版本；未知未来 store 版本只读提示，不能自动降级重写。发布 rollback 是退回仍理解该 schema 的版本，不通过覆盖旧 store 达成。

## 14.6 回归与清理

保留聊天 Markdown/数学/链接/图片/代码块的已有渲染行为。新增状态故事只覆盖真实语义，不推倒 React。运行 unit、integration、gallery、build、lint、review。根 AGENTS 指定的 issue-linked 注释要求使用真实 issue，不编造 URL。

发布说明列出数据存储位置、MCP 与 Shell 信任边界、旧历史导入限制及 background 关闭行为；不得宣传“任意命令沙盒”“所有副作用 exactly-once”或“任何供应商都能显示思考”。
