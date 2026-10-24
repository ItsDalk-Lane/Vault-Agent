# 11 · 待办、计划、提问、压缩与反馈

## 11.1 待办：真实可恢复进度

注册 `todo_set({expectedRevision,items:[{id,text,status,priority}]})`，status=pending/in_progress/completed，最多 50 项，文本每项<=500 字符。模型提供 id 只在本次现存列表中有效；新增项 id 由宿主生成并返回，不把同名文本当唯一键。

事务读 va.todos → 对 revision → 校验 ID/状态 → 更新 revision+1 → 同事务追加 va.todos.changed 事件。重复 toolTask 调用根据 operationId 返回已提交结果；不能又增长 revision。错误返回 TODO_REVISION_CONFLICT 和最新列表，模型必须重读。

EventTranslator 发送 todo_update，AgentSession 更新 getCurrentTodoList；同一事实投影成既有 plan part/PlanPill。只允许一个根 todo 为 in_progress 的初始规则，fan-out 子任务自有列表不被混进主 todo。删除已完成项需显式新列表，历史事实仍保留。不得仅显示 TodoWrite 工具卡而项目进度为空。[V17]

## 11.2 计划与审批

注册 `propose_plan({title,body,steps})`，最大正文 32 KiB。创建稳定 planId、revision 和 pendingToolCallId，写 va.plan，再发 plan_proposal_update。计划正文是建议，不自动执行其中任何命令。显示现有 PlanProposalCard。[V11]

批准：比较 planId/revision/状态，事务写 approved，并将会话模式从 plan 收敛到 default（不是 auto/bypass）；返回 tool result 让当前 run 继续。所有实际写操作仍过 ToolGateway。拒绝：记录 rejected，工具返回被拒绝；反馈：rejected_with_feedback，反馈作为同一计划的用户输入材料，生成新 revision 后再批准。重复点击只消费一次。

进入 plan 模式必须收紧 policy/callable，禁止写入、删除、Shell、不透明本地 MCP；不是仅追加一句“请先做计划”。退出 plan 模式只能由 UI 或已批准的 propose_plan 流程触发，模型不能使用普通工具自行更改权限。

计划卡关闭/重开、插件重启后状态不丢。等待审批时不占用文件锁，不通过轮询 setTimeout 保持任务；监听持久化文档变化与 AbortSignal。缺少 UI prompter 时返回明确 unavailable，不能默认批准。

## 11.3 用户提问

注册 `ask_user({questions})`，复用 AgentQuestion 结构：1–6 个问题，每题最多 12 个选项，可多选/其他文本。requestId = 本工具稳定 taskId；字段 answerKey 由宿主校验唯一。

写 va.questions 后调用既有 AskUserQuestionPrompter。UI 结果经验证后写入文档再 resolve 工具；恢复时有答案则返回同一答案，无答案则重挂同一请求。停止时标 cancelled 并解除所有 waiter；关闭窗口不自动填默认选项。多个问题与权限保持现有“问题优先”的展示政策，但独立 stable resolver 不能串错请求。[V08]

工具输出只包含用户实际选择的内容，不能把没有回答当作同意。answer 字段中的笔记/代码片段作为用户回答传给模型，不被当作宿主指令执行。

## 11.4 压缩

复用 Durable compact 与自动 compaction。输入 `/compact` 在现有命令分发点识别后调用明确 compact API，不把字符串交给模型等待其猜测。

创建 CompactionSnapshot：id=taskId，trigger manual/auto，in_progress。task 结束时：有 error → failed；用户取消 → cancelled；declined/no range/stale → skipped；只有 summary 真正写入并作为当前有效 context head 时才 completed。需要等待返回 submissionId 的实际放置结果，不能收到 compaction_end 就一概成功。[P01,P04]

保留之前所有原始 entries 和用户可见消息。压缩摘要用于下一次模型请求，不抹掉聊天记录。重新打开后历史里有真实 compaction row，且不能把该行当普通助手最终回答计时/复制。[V09]

供应商可见 token 数、估计值与 unavailable 区分；不要计算假的 pre/post tokens。Context window 和阈值按 09 固定算法。模型上下文溢出处理使用 SDK 行为，最多一次自动压缩后重试；失败显示保留内容和重试动作，不无限压缩。

## 11.5 标题、时长、重试与错误

标题优先用户手动设置；首次回答完成后可用已有规则从用户输入生成本地标题，不额外模型请求。后续自动标题不能覆盖 titleSource=user。来源写索引并持久化，索引失败可重建不阻止回答。

错误显示同时保留实际输出和已提交 fileChanges；不得用一条错误文本覆盖所有先前工具轨迹。refusal、max_tokens、cancelled、budget_exceeded、transport_error 必须区分。重试时新 generation attempt 使用稳定消息归属，不重复 user message。

## 11.6 反馈卡与问题报告

替换旧 feedback MCP server 的依赖，增加宿主 `FeedbackService`。连续两次同类 provider/tool 错误或用户主动报告时生成 FeedbackOffer（来源=pi、runId、脱敏错误码、可选择证据）。规则不调用模型，也不自动上传。

保留 FeedbackCard 的 review/dismiss/turn off，复用 ReportIssueModal。用户勾选的日志、版本、问题描述在确认前预览；默认不包含笔记正文、密钥、完整命令环境和私有路径。报告目的地由现有产品流程决定，不能在新引擎里硬编码上游 pi-web 项目。

dismiss/已报告状态持久化，重开不反复弹同一 offer。关闭功能后不再生成新卡。fake-provider 测试必须从真实错误到 FeedbackOffer 再到卡片，而不是直接构造静态 story 冒充端到端。
