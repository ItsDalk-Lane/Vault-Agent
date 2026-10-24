# 16 · 错误码、状态机与恢复动作

## 统一失败对象

所有 host 工具输出内部 `ToolFailure {code, message, retryable, effectState, operationId?, recoveryAction?}`。message 用户可读并脱敏；code 用于 UI/测试；retryable 表示可以重新申请，不等于系统自动重试。

| code                                   | effectState             | 下一步                                         |
| -------------------------------------- | ----------------------- | ---------------------------------------------- |
| INVALID_ARGUMENT                       | none                    | 修正参数；不弹权限                             |
| USE_VAULT_TOOL / USE_EXTERNAL_TOOL     | none                    | 调正确工具族；不透明转换禁止                   |
| PATH_OUT_OF_SCOPE / PROTECTED_PATH     | none                    | 拒绝；只有用户可改变 scope                     |
| PERMISSION_DENIED / APPROVAL_EXPIRED   | none                    | 停止该调用；必要时新请求                       |
| READ_ONLY_MODE                         | none                    | 不能模型自行退出                               |
| STALE_BASELINE / OPEN_BUFFER_CONFLICT  | none                    | 重读/保存/新 Diff 与审批                       |
| SELECTION_CHANGED                      | none                    | 用户重新选择                                   |
| OPAQUE_EXECUTION_DISABLED              | none                    | strict 下禁止；用户可单独启用风险模式          |
| TOOL_CANCELLED                         | none 或 partial/unknown | 看实际 receipt，不笼统声称未修改               |
| OUTPUT_LIMIT / DEADLINE_EXCEEDED       | partial 或 unknown      | 保留部分输出，显式检查远端效果                 |
| STORE_BUSY / STORE_VERSION_UNSUPPORTED | none                    | 只读/关闭其他实例；不偷锁                      |
| STORAGE_FAILED                         | unknown                 | 停止 Harness；对账后恢复                       |
| EFFECT_UNKNOWN                         | unknown                 | 不自动重放，人工对账                           |
| CREDENTIAL_REQUIRED / AUTH_FAILED      | none                    | 插件设置修复凭据，无终端                       |
| MODEL_CHANGE_REQUIRES_IDLE             | none                    | 停止/等当前任务结束                            |
| BUDGET_EXCEEDED                        | none（下一次操作）      | 保存进度，用户继续新 run                       |
| MCP_AUTH_REQUIRED / MCP_UNSUPPORTED    | none                    | 浏览器授权/更改传输，不执行兜底 shell          |
| MCP_RESULT_ERROR                       | unknown 或已知分类      | 保留服务端工具失败，不冒充协议成功等于业务成功 |
| SUBAGENT_LIMIT / MAX_DEPTH             | none                    | 等队列或更小任务，不递归绕过                   |

## 根运行状态

idle → accepting → running ↔ awaiting_permission/awaiting_question → completed。

running 可转 cancelling → cancelled、paused_budget、failed、interrupted。interrupted 表示上次进程关闭且任务未完成，不自动等价失败或成功。处于 cancelling 时不接纳新工具副作用，已提交 effects 仍记录。closed 是资源句柄状态，不是任务成功状态。

## 并发竞态裁决

取消与批准：先提交的有效决定决定审批状态，但实际 I/O 前必须再次检查取消。写操作已完成后取消不能撤销事实，只停止后续步骤。两个 UI 点击批准：相同 requestId 首个有效事务胜出。模型切换与调用：busy 拒绝切换，避免更换凭据/模型污染半轮上下文。

子代理报告与 stop：cancelEpoch 失配禁止自动唤起父模型，结果只保存。MCP signOut 与 refresh：generation 失配禁止写回 token。snapshot 与旧 observer：epoch 失配丢弃旧 frame，已提交历史按 ID 合并而非清空。

## 事实与展示终态

成功不是“Promise resolved”或“事件名 end”。工具有业务 isError，MCP 有 result.isError，文件有 receipt，压缩有是否 placed，subagent 有 answered/unanswered，fan-out 有每个候选状态。缺少终态证据显示 unknown/interrupted，不以空字符串冒充成功。

## 审核补充错误码（同样固定）

`UNSAFE_FILE_ALIAS`：hardlink或不支持的文件别名写入，effectState=none，拒绝。

`TOOL_DISABLED`：当前callable集中不存在/已隐藏工具，effectState=none，不通过嵌套调用恢复。

`CALLER_NOT_ALLOWED`：调用者类型不满足manifest.callers，effectState=none。

`EXTERNAL_SCOPE_REQUIRED`：尚无外部根授权，提示用户主动选择；`PATH_OUT_OF_SCOPE`则表示已有scope但请求目标不在其中。

预算终止保持既有PromptOutput契约，stopReason=max_turn_requests；用额外run_state.stopCode=BUDGET_EXCEEDED区分原因，不让旧消费者遇到未知stopReason。
