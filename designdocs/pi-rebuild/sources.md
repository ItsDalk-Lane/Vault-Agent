# 源码基线与引用规则

核对日期：2026-10-21。下面链接固定到提交，避免后续 AI 会话读取不同版本产生接口漂移。

- Vault Agent：`c2a7ef50539397627a6e4446283d791ad423aff6`。
- Pi：发行版 **1.3.0**，`71023aec1546d6d677a65669c5665c0927ce0dd0`。核对时 main 已领先发行版；禁止把 main 独有 API 混入本方案。
- pi-web：`e533d9b3975f8a74b378d5007c92fdf4d15d3fba`，仅参考产品方案。

本包是实现规范，不是已经落地的代码。带 `[Vxx]`、`[Pxx]`、`[Wxx]` 的陈述是对应源码事实；其余“必须/默认/选择”是本项目确定的设计。未复制三个项目的完整源码。实施时使用仓库现有许可证和第三方声明流程。

## 引用目录

### V01 · `AGENTS.md`

仓库工程、测试、注释与审查约束；实施时以工作树实际版本为准。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/AGENTS.md)

### V02 · `src/agentMode/AGENTS.md`

session 契约层、sdk/acp 适配层和 UI 边界；新增层需更新 ESLint。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/AGENTS.md)

### V03 · `src/agentMode/session/types.ts`

BackendProcess、SessionEvent、PermissionPrompt、AgentMessagePart、TurnFileChange 等既有契约。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/session/types.ts)

### V04 · `src/agentMode/session/descriptor.ts`

现有后端描述符包含安装、登录、模型、技能等外部执行器语义。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/session/descriptor.ts)

### V05 · `src/agentMode/session/AgentChatPersistenceManager.ts`

Markdown 保存正文和时间等展示信息，不能等同完整模型执行历史。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/session/AgentChatPersistenceManager.ts)

### V06 · `src/agentMode/session/AgentSessionIndex.ts`

索引以 backendId:sessionId 为键，包含标题、时间、项目及墓碑。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/session/AgentSessionIndex.ts)

### V07 · `src/agentMode/session/AgentSession.ts`

会话状态、文件变化、计划、问题、fan-out 与上下文集成的现有入口。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/session/AgentSession.ts)

### V08 · `src/agentMode/ui/AgentChatMessages.tsx`

消息入口包含 AgentTrail、Fanout、计划、权限、提问、反馈、时长与 Diff。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/ui/AgentChatMessages.tsx)

### V09 · `src/agentMode/ui/AgentTrailView.tsx`

工具、活动组、子代理、思考、文本、计划、压缩及文件变更渲染节点。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/ui/AgentTrailView.tsx)

### V10 · `src/agentMode/ui/agentTrail.ts`

以 Agent/Task 识别子代理，以 parentToolCallId 连接子工具；ToolSearch 被隐藏。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/ui/agentTrail.ts)

### V11 · `src/agentMode/session/plan.ts`

CurrentPlan 的版本、审批状态及 permissionGated 字段。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/session/plan.ts)

### V12 · `src/agentMode/session/planUsage.ts`

用量窗口类型；BYOK 不自动提供供应商订阅额度。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/session/planUsage.ts)

### V13 · `src/agentMode/sdk/permissionBridge.ts`

旧权限桥依赖 Claude SDK 的决策和权限更新语义，不能原样用作新权限引擎。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/sdk/permissionBridge.ts)

### V14 · `src/services/keychainService.ts`

已有 SecretStorage 适配与 getSecretById/setSecretById/deleteSecretById，可复用。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/services/keychainService.ts)

### V15 · `esbuild.config.mjs`

现有 CJS 单文件打包及 Node 外部模块配置；已完成的 PoC 不重新作为待办。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/esbuild.config.mjs)

### V16 · `package.json`

构建/测试/审查脚本及待删除的旧 Agent 依赖。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/package.json)

### V17 · `src/agentMode/ui/ProjectInfoPopover.tsx`

现有项目进度区消费 AgentTodoListEntry；功能不能仅停留在工具卡。

来源：[ItsDalk-Lane/Vault-Agent@c2a7ef5](https://github.com/ItsDalk-Lane/Vault-Agent/blob/c2a7ef50539397627a6e4446283d791ad423aff6/src/agentMode/ui/ProjectInfoPopover.tsx)

### P01 · `packages/durable/README.md`

Durable 是实验性完整 harness；提供持久化、工具、压缩、子会话、恢复与事件。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/README.md)

### P02 · `packages/durable/src/index.ts`

1.3.0 公共导出，禁止深层私有 imports。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/index.ts)

### P03 · `packages/durable/src/harness/types.ts`

实际工具、Harness、Conversation、Hooks 与 Settings 类型。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/types.ts)

### P04 · `packages/durable/src/harness/events.ts`

watchEvents 原子快照/订阅、delta、snapshot 重同步和工具终态。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/events.ts)

### P05 · `packages/durable/src/harness/view.ts`

快照挂载 active entries 与内置文档，不是全部聊天历史，也不自动包含自定义文档。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/view.ts)

### P06 · `packages/durable/src/storage/jsonl/node.ts`

openNodeJsonlStorage(directory, context, options) 的真实签名。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/storage/jsonl/node.ts)

### P07 · `packages/durable/src/tools/index.ts`

Durable 原生 read/write/edit/bash/PowerShell 工具的公共导出。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/tools/index.ts)

### P08 · `packages/durable/src/tools/bash.ts`

原生命令工具通过 ExecutionEnv 执行；宿主必须添加超时、授权和环境约束。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/tools/bash.ts)

### P09 · `packages/ai/README.md`

Models 集合、Provider 工厂、凭据、模型能力与模型流事件。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/ai/README.md)

### P10 · `packages/mcp/README.md`

独立 MCP 客户端、HTTP/stdio、OAuth、工具转换、取消与不支持的协议面。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/mcp/README.md)

### P11 · `packages/durable/test/examples/22-subagent-foreground.ts`

前台拥有关系和可恢复子代理示例。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/test/examples/22-subagent-foreground.ts)

### P12 · `packages/durable/test/examples/23-subagent-background.ts`

后台 anchor/reporter 与稳定 requestId；按示例理解，不直接复制产品逻辑。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/test/examples/23-subagent-background.ts)

### W01 · `package.json`

pi-web 0.12.2 使用 Pi 1.2.0，并非本方案 Durable 1.3.0 的可直接复制实现。

来源：[agegr/pi-web@e533d9b](https://github.com/agegr/pi-web/blob/e533d9b3975f8a74b378d5007c92fdf4d15d3fba/package.json)

### W02 · `lib/mcp-test.ts`

测试连接的请求/总时限、同配置合并、脱敏优先与状态记录。

来源：[agegr/pi-web@e533d9b](https://github.com/agegr/pi-web/blob/e533d9b3975f8a74b378d5007c92fdf4d15d3fba/lib/mcp-test.ts)

### W03 · `lib/mcp-transport.ts`

stdio 清洗环境、inheritEnv:false，不回退到不受控环境。

来源：[agegr/pi-web@e533d9b](https://github.com/agegr/pi-web/blob/e533d9b3975f8a74b378d5007c92fdf4d15d3fba/lib/mcp-transport.ts)

### W04 · `lib/subagent-extension.ts`

子代理 profile、生命周期、父工具关联与后台报告的来源标记。

来源：[agegr/pi-web@e533d9b](https://github.com/agegr/pi-web/blob/e533d9b3975f8a74b378d5007c92fdf4d15d3fba/lib/subagent-extension.ts)

### W05 · `lib/subagent-input.ts`

子代理输入文件/字节限制思路；本项目数值另行锁定。

来源：[agegr/pi-web@e533d9b](https://github.com/agegr/pi-web/blob/e533d9b3975f8a74b378d5007c92fdf4d15d3fba/lib/subagent-input.ts)

## 补充官方资料

Obsidian Vault API：https://docs.obsidian.md/Plugins/Vault

Obsidian API 类型：https://github.com/obsidianmd/obsidian-api

官方 Vault 文档建议异步准备修改后，在 `Vault.process()` 回调里核对读取基线；重命名优先使用 `FileManager.renameFile()` 以配合链接更新。具体方法必须以项目实际安装的 Obsidian 类型声明及支持的宿主版本验证。不得把类型里没有的方法伪装成公共 API。

## 证据边界

已检查核心契约、持久化入口、消息/轨迹渲染入口、权限桥、Keychain、Pi 的公开类型与关键参考实现。本包未运行仓库构建、未连接真实模型、未在 Obsidian 中验证新引擎。用户已确认的原打包验证记为 P00 完成；其他功能需要执行任务中的证据。工作树与本基线不同，先做差异登记，不能覆盖用户的新代码。

## 补充核对的公开接口

### P13 · `packages/durable/src/harness/provider.ts`

ProviderDoc持久化每个conversation的sessionId，fork得到新身份；用于宿主请求归属映射。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/src/harness/provider.ts)

### P14 · `packages/durable/package.json`

确认1.3.0、public exports、Node引擎声明与chord/pi-ai依赖版本。

来源：[earendil-works/pi@71023ae](https://github.com/earendil-works/pi/blob/71023aec1546d6d677a65669c5665c0927ce0dd0/packages/durable/package.json)
