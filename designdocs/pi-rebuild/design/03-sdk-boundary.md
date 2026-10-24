# 03 · 固定 SDK 契约与禁止猜测的接口

## 依赖

直接依赖固定：`@earendil-works/pi-durable@1.3.0`、`@earendil-works/pi-ai@1.3.0`、`@earendil-works/pi-mcp@1.3.0`、`@earendil-works/chord@1.3.0`。同步提交 lockfile。TypeBox 优先使用 Pi AI 的公开 re-export，避免另一版 schema 库混入。

不要直接依赖 `pi-agent-core` 或 `pi-coding-agent` 来驱动此引擎。Durable 的传递依赖不等于启用它们的可选产品能力。不要 import `/dist/`、相对穿透 node_modules、使用 pi-web 的私有 SDK 定位器。[P02,W01]

## 已确认可用的公共调用

```ts
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, createRegistry, watchEvents } from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
```

打开存储的签名是 `openNodeJsonlStorage(directory, context, { fsync: true })`。[P06] 必须在拿到独占 lease 后调用。Harness.open 的 models 和 registry 来自插件；这里只列真实入口，不给可误直接运行的无权限全功能示例。

| 对象      | 真实 API / 行为                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Harness   | `open(storage, options, context)`；`root(context, options?)`；`conversation(id, context)`；`createConversation(options, context)`  |
| 输入      | `conversation.submit({type:"input", content, requestId, whenBusy}, context)`；whenBusy 为 steer/followUp/reject                    |
| 等待      | `submission.wait(context)`；取消 context 只取消等待，不取消工作                                                                    |
| 停止      | `conversation.abort(context, {background:true})` 可连后台任务一起停止                                                              |
| 暂停/重开 | close 后检查点保留；`resume()`、submit、wait 等可能启动 scheduler，读取历史不得调用这些动作                                        |
| 历史      | `entries(query, limit, cursor, context)` 是完整、fork-aware 的分页历史；`context()` 与事件 snapshot 是 active context              |
| 压缩      | `compact(instructionsOrUndefined, context)` 返回 taskId；随后检查 task 结果和可能的 submission 是否真正放置                        |
| 模型      | `configure({model:{provider,modelId}, thinkingLevel}, context)`                                                                    |
| 事件      | `watchEvents(harness, conversationId, context)` → snapshot/start/stop/closed                                                       |
| 工具      | `defineTool({parameters, execute(args, api, context), replay, callers, ...})`；不是 AgentCore 的 execute(toolCallId,params,signal) |
| 工具内容  | `output` 给模型，`details` 给 UI；`structuredOutput` 给嵌套程序，不能假定它持久化在 transcript                                     |
| 插件状态  | `defineDoc`/`defineDocFamily` 和 `commit`；自定义文档要显式订阅或同提交写 `va.*` 事件                                              |

## 不得混用 main API

本基线 HarnessSettings 没有 main 后增的 `restartLimit`、`compaction.modelOverrides`。`onReport` 基线签名只有 error。不要照抄 main 文档的睡眠、遥测或恢复字段。需要的产品级 crash-loop 限制由 StoreRecovery 的宿主记录实现；模型窗口阈值按本包既定算法处理。[P03]

## Hook 的权限地位

`ToolTask.beforeTool` 返回 `{block}` 或参数替换，抛错会阻断；用它做第一道工具注册/范围检查。最终批准和实际 I/O 检查仍在工具包装器内。其他 hooks 的异常可能只是被报告，**不能依赖在 beforeRequest 抛错来构建硬预算或安全边界**。

Generation.beforeRequest 只用于构建本次 messages，不改变 Durable 保存的原始事实。工具能力限制应作用于 callable 集合，不只是 modelTools 可见集合。子会话禁止的工具不能在内部 executeTool 路径重新得到。

## 取消适配

Chord Context 与浏览器 AbortSignal 不相同。使用其公开 context 工具连接信号，不能 `as Context` 伪造。外部取消只在正确范围传播：关闭 UI observer 不取消用户任务；用户 Stop 调 conversation.abort；shutdown 关闭 Harness 并取消所有 host I/O。工具必须监听实际执行 context.abortSignal。

## SDK 升级流程

只能专门任务/变更：备份真实 store → 新版本契约编译 → fake-provider 完整测试 → 恢复/副作用故障注入 → 三平台打包 → 可回滚升级。锁定版本并不保证实验性持久化格式永远稳定；不要自动在未知新版本上写入旧 store。

## 与 pi-web 的复用边界

复用概念：MCP 测试连接、状态和脱敏、子代理 profile 和父子关联。不要照搬 Next API 路由、服务器账户、node-pty、websocket daemon、服务器文件系统、SDK 私有 imports 或工作树依赖。本插件以 Obsidian 事件和同进程调用替代 HTTP 服务。

具体等待、原生写预览、请求归属和凭据竞态算法见 [17 · 固定实现算法](17-algorithm-recipes.md)。
