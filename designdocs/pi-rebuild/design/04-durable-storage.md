# 04 · 聊天、执行存储、恢复与导入

## 4.1 权威数据和保留项

**可以复用 pi-durable 增强聊天存储，而且本方案决定采用它。** 采用方式不是给 AgentMessageStore 加一个 JSONL 后端，而是让 Durable 同时拥有执行记录与恢复调度。原消息 store 仍服务 React；原索引仍管理列表；Markdown 仍可导出，但它们不再被当作工具调用的事实来源。[V05,V06,P01]

每个根聊天一个 store，root 及其所有子会话同处其中。保留完整模型消息、tool call/result ID、模型与 thinking 配置、用户输入 requestId、文档状态和任务关系。供应商签名/不透明字段按 SDK 原结构存储，不自行去掉再重构。API Key、OAuth token、认证 header 不进入 store。

## 4.2 本地路径和所有权

数据根由宿主代码固定计算，不让模型指定：

- macOS：`~/Library/Application Support/VaultAgent/`
- Windows：`%LOCALAPPDATA%/VaultAgent/`，环境值不存在时使用用户 home 下 `AppData/Local/VaultAgent/`。
- Linux：绝对路径 `XDG_STATE_HOME/vault-agent/`；未设置时 `~/.local/state/vault-agent/`。

路径布局为 `v1/vaults/<vaultKey>/sessions/<rootId>/store/`，同级有 `meta.json`、`lease/` 和 `attachments/`。vaultKey = SHA-256(规范化真实 Vault 根路径 + 既有 Keychain vaultId)，禁止用不可信名字直接拼接。移动 Vault 时提供显式重新关联，不猜测另一个同名库就是原库。

这部分是插件私有基础设施，可使用 Node fs；Agent 工具不能读取或写入这里。私有数据不放进会自动同步的用户笔记目录。导出到 Vault 是另一个经过用户选择的操作，绝不能导出凭据。

## 4.3 存储实现

使用 `openNodeJsonlStorage(path, context, {fsync:true})`。选择 JSONL 是为了不引入新的 native addon/独立 sqlite 安装要求；**不是声称它比 SQLite 更适合无界历史**。SDK 的 JSONL 会把历史保留在内存中。[P01,P06]

由 RuntimePool 懒打开：最多 2 个活跃根 store；无任务、无挂起审批且无观察者的 idle store 60 秒后关闭；仅展示标题不打开执行 store。初始产品限制：单根 store 16 MiB 发出建议新会话，32 MiB 在下一个安全边界禁止继续接纳新任务并提供“总结并新建会话”。仍允许取消、完成/拒绝挂起操作、导出与读取。大小包含实际 Durable 文件，不删除内部条目压缩文件。

滚动新会话用 summary + 原会话来源建立新 rootId，老 store 只读归档；必须等前后台任务全部结束后执行。模型上下文压缩不会减少 JSONL 文件或全部历史内存，UI 文案必须说清。

## 4.4 单写者 lease

进程内用 VaultKey+rootId 的唯一资源 registry；popout 只能订阅。进程外用 `mkdir(leaseDir)` 的原子排他创建，owner 文件记录随机 token、pid、启动标识、实际 storePath、createdAt。所有权释放前核对 token，不能删别人的 lease。

发现 lease 时：先读 owner；仅在能证明相应进程已退出后才回收。pid 存活、权限不足、owner 不完整或身份无法验证时拒绝写打开，提示“另一个实例或未完成恢复占用”。不根据超过 N 秒就偷锁；长时间审批不是死进程。用户手动恢复入口说明风险，要求所有相关 Obsidian 实例关闭并二次确认，留下恢复记录。

SDK 本身不提供跨进程排他锁；不能以“通常不会双开”略过。[P01] lease 错误在任何模型/工具调度前返回。

## 4.5 产品文档

使用固定 kind、version=1 和 schema 校验。所有 UI 可恢复状态写入这些文档；类型见 contracts。需要全文/大量文件内容时只存 blob 引用。

| kind           | 内容                                                            | fork 策略                        |
| -------------- | --------------------------------------------------------------- | -------------------------------- |
| `va.session`   | rootId、来源、projectId、title、schemaVersion、selectedModelKey | 新 fork 复制来源，不复制运行标记 |
| `va.run`       | requestId/runId、状态、限额、计数、开始结束、stopReason         | initial                          |
| `va.todos`     | revision、稳定 todo ID、文本、状态                              | as-of 复制                       |
| `va.plan`      | CurrentPlan、revision、审批、反馈                               | 复制正文但重新变为未批准         |
| `va.approvals` | 挂起请求、绑定摘要、决定、有效期/消费状态                       | initial；不继承一次授权          |
| `va.questions` | 挂起问题、答案、已交付标记                                      | initial                          |
| `va.mutations` | operationId、前后哈希、备份引用、提交/未知状态                  | 历史保留但不再次执行             |
| `va.subagents` | 子 conversation/owner task 映射、profile、状态、结果消费标记    | initial                          |
| `va.fanout`    | 候选回答/评估/综合与状态                                        | as-of 展示，只读历史             |
| `va.skills`    | 本次选择 skillId、内容 hash、信任与引用                         | 复制选择，重新校验磁盘           |
| `va.budget`    | 根及子会话累计真实用量、预算阈值、未知成本标记                  | 新预算，不重复历史消费           |

文档写入事务必须先完成所有必要读取，再修改；不得在 transaction 中弹窗、发模型请求或等网络。Durable 的表层 read-after-write 约束必须测试。[P03]

每次 todo/plan/approval 等重要变化，在同一提交里追加 `va.*` 被动 entry，以便轨迹、回放和审计使用；记录不含 `model` 时不送给模型。自定义文档不自动出现在 SDK 的内置 ConversationView，不能靠访问 `snapshot.docs["va.todos"]` 取它。[P05]

## 4.6 稳定 ID 和去重

用户点击发送时生成 requestId 并保存于草稿发送状态；重复点击/网络 UI 重连使用同一 ID。Durable submit 使用 requestId 幂等接纳。显示 user 消息的 ID 来源于 submission/entry，而不是每次回放 uuid。根 runId 在接纳前分配，与所有子任务预算关联。

工具 UI ID = host 编码的 conversationId + 原 SDK toolCallId；不拆解 SDK 内部 ID 格式。操作 ID = rootId + conversationId + taskId + callId 的稳定 hash；切勿每次恢复重新 uuid。

## 4.7 恢复流程

启动先拿 lease → 打开 store（不调 resume/submit/wait）→ 验证版本 → inspect → 回放完整显示历史和挂起状态 → 展示恢复条。

默认不自动继续未完成工作。用户选择“继续”后，先重载凭据与当前策略，再检查所有未决 mutations/approvals。已执行但结果未落盘的操作先对账，不能立即让模型重试。全部可处理才 `resume()`。用户选择“停止未完成工作”调用实际 abort，并等待终态；取消一个 UI wait 无效。

恢复审批由 approvals 文档决定：无决定重新显示；未消费 allow_once 只有绑定 hash、scope、policyVersion、文件基线全部一致才有效；不同则作废重新申请。已执行的工具不能因恢复再次显示可执行批准按钮。

宿主 `meta.json` 记录连续非正常打开次数（安全边界后归零）。同一未完成 run 连续 3 次打开即中断，转只读恢复模式，禁止自动调用任何 start-work API；记录错误并让用户选择停止或再次明确重试。这是宿主防崩溃环规则，不调用 v1.3.0 不存在的 restartLimit。

## 4.8 副作用崩溃矩阵

| 故障位置              | 新状态              | 恢复动作                                                                                             |
| --------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| intent 前             | 未执行              | 可以重新生成请求，仍需审批                                                                           |
| intent 已提交、批准前 | awaiting_permission | 重建同一请求，不产生 I/O                                                                             |
| 批准后、写前          | prepared            | 重验权限和 beforeHash，批准不可变更目标                                                              |
| 写成功、receipt 前    | effect_unknown      | 比较当前内容与 before/after hash；确认为 after 只补 receipt，不再次写；不匹配则 needs_reconciliation |
| receipt 后、UI 前     | committed           | 重放同一显示事件，不重复副作用                                                                       |

Vault 全文替换/创建只有采用第 07 文档的 ledger + CAS 才可标 `replay:safe`。删除、移动、Obsidian 不透明命令、外部 Shell 和未知 MCP 默认 `unsafe`，中断后不自动重做。Durable 的持久化不保证外部服务 exactly-once。[P01,P03]

## 4.9 存储故障和退出

存储 error 使 Harness 失败时，取消正在执行的 host I/O，禁止继续写文件或展示“已成功保存”；保留已知实际文件变化供对账。不得用另一个临时 MemoryStorage 偷偷继续。日志脱敏，显示可恢复错误。

插件卸载是 shutdown，不自动授权任何请求。不再接纳新输入；取消 observers/网络；关闭/终结工具资源；flush 已提交状态并释放 lease。没有后台服务器，Obsidian 关闭后不执行任务。重开恢复不是持续运行。

## 4.10 导入和导出

旧记录展示保持原 backendId/sessionId。用户选择“用新引擎继续”时创建新 root，生成来源记录 `{legacyBackendId,legacySessionId,sourcePath,importHash}`；只导入实际可获得的正文、附件引用和已确认结构。缺失工具结果不捏造，来源段标为历史材料，不是新的高优先级指令。

Markdown 导出由既有 Manager 完成，更新其输入投影即可。新增完整 JSON 导出为用户手动操作，包含 manifest/version/hash 但去除凭据和实际授权 token。导入完整包默认只读预览，重新批准工具范围，不能继承远端“始终允许”。

具体等待、原生写预览、请求归属和凭据竞态算法见 [17 · 固定实现算法](17-algorithm-recipes.md)。
