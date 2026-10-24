# 02 · 目标架构、目录与责任

## 唯一依赖方向

```text
现有 React UI / AgentChatBackend / AgentSession / MessageStore
                           ↓
              BackendProcess + SessionEvent
                           ↓
           backends/pi/descriptor.ts → sdk/pi/PiBackendProcess
                           ↓
             RootSessionRuntime（每根会话一个 Harness）
        ┌──────────────────┼────────────────────┐
        ↓                  ↓                    ↓
   Durable + JSONL    ModelRuntime(pi-ai)    ToolRegistry
        ↓                                       ↓
   UiProjection                          ToolPolicy + ToolGateway
                                             ↓
                      Vault API / guarded native env / pi-mcp
```

所有 SDK 包 import 留在 `src/agentMode/sdk/pi/`。`session/` 不得反向 import `sdk/`。`backends/pi/descriptor.ts` 只组装依赖并实现产品描述，不承载执行状态。不要移动既有 UI 文件，也不要重写 AgentSessionManager 的全部职责。[V02]

## 固定生产目录

- `sdk/pi/PiBackendProcess.ts`：完整实现既有 BackendProcess，协调 session handlers；不含路径算法或 JSX。
- `sdk/pi/runtime/`：RootSessionRuntime、RuntimePool、Cancellation、RunBudget。
- `sdk/pi/storage/`：StoreLocator、StoreLease、DurableStore、ProductDocs、Recovery、Migration。
- `sdk/pi/events/`：EventTranslator、HistoryProjector、ProjectionReducer。
- `sdk/pi/policy/`：ToolManifest、PathResolver、PolicyEngine、ApprovalStore、AuditLog。
- `sdk/pi/tools/`：VaultTools、NativeTools、MutationCoordinator、ObsidianActions、ControlTools。
- `sdk/pi/models/`：ModelRuntime、CredentialStore、ProviderGuard、ModelCatalog。
- `sdk/pi/mcp/`：McpManager、McpToolAdapter、McpConfig、McpOAuth。
- `sdk/pi/features/`：Todos、Plans、Questions、Subagents、Fanout、Compaction、Feedback、SkillsContext。

这些是责任边界，不要求每个名字都做成 class。无状态规则用纯函数；只有持有资源/生命周期才用类。任何任务可以在对应目录创建命名更明确的小文件，但不能另造服务定位器、事件总线框架或依赖注入容器。

## BackendProcess 方法语义

`newSession`：先建立本地根 store 和 root conversation，再返回 sessionId/state。失败不留索引里的可用假会话。`prompt`：输入得到稳定 requestId，Durable 接纳成功才确认发送；监听事件，等待本次 submission 终结，再映射 stopReason。不得因一次 `turn_end` 就结束用户任务。

`loadSession`：只加载并回放，不启动未完成任务。`resumeSession`：恢复 UI 与状态，同样默认不自动产生副作用；需要“继续未完成任务”明确动作后启动。保留这两个既有方法名，不把 SDK 的 resume() 不加区分地直接调用。

`cancel`：用户停止语义，调用 root.abort，并让 pending 问题/授权结束；不是只取消等待 Promise。`closeSession`：标签关闭，停止 UI 观察；是否继续已有后台子任务遵守明确产品开关，默认关闭会话同时停止其交互任务。`shutdown`：关闭所有 harness/连接/工具资源，保留可恢复检查点；不等待用户审批，不再次触发模型。

`listSessions`：读取本项目索引和本地 store 头信息，不启动所有 Harness 扫描历史。`setSessionModel` 和推理强度切换只能在 root 及其前台子任务 idle 时应用；busy 返回 `MODEL_CHANGE_REQUIRES_IDLE`，UI 不伪装已切换。`setSessionMode` 收紧权限立即生效；扩大权限只在安全边界生效并明确用户动作。

## 可添加的领域契约

在 `session/types.ts` 增加独立、供应商无关的事件：`session_projection`（完整显示快照替换）、`todo_update`、`plan_proposal_update`、`approval_state`、`recovery_state`、`run_state`、`budget_update`。使用 discriminated union，提供对应 reducer 测试。旧后端暂时不发送新增事件即可，不能强迫旧执行器模拟 Durable。

`SessionProjection` 包含全部已加载显示消息与当前 pending 状态，具有 streamEpoch 与 frameIndex；它不是 Pi snapshot 的直接别名。大历史分页时增加 prepend/replace 语义，稳定消息 ID 不变。该新增事件解决恢复与快照重同步，不要靠把全文再次拆成文本 delta 伪造回放。

## 生命周期

一个 Obsidian 插件实例拥有一个 PiBackendProcess、一个根运行时池和一套 Vault 级路径锁。每个根聊天对应独立 Harness/store，子代理是其中的 owned conversation。全局同时最多 2 个活跃根会话、每根最多 3 个活跃子代理；排队可见且可取消。标签页/popout 只增加观察者，不能另建 writer。

初始工具执行 `sequential`。并行发生在受控子会话，不允许用 `Promise.all` 绕过路径锁。MCP 连接以 root + scope/config fingerprint 为键复用；不同 Vault 的授权/凭据/roots 不能共享。

## 现有代码精简次序

先新增 Pi descriptor → 接通事件与恢复 → 接通全部功能 → 迁移旧数据 → 默认改 Pi → 删除旧外部执行器、安装/登录页面和废弃依赖。最后再精简 BackendDescriptor 的 CLI 字段。纯历史读取器放 `session/legacy/`，绝不通过启动旧二进制读取历史。
