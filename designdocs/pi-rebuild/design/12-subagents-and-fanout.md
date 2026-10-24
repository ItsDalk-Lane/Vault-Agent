# 12 · 子代理、后台报告与并行回答

## 12.1 两个功能不能混为一谈

子代理是主 Agent 调用工具委派任务，父子关系显示在 SubAgentCard。fan-out 是用户选择多个模型，对同一问题并行回答并综合，显示 FanoutMessageCard。两者共享 Durable 和 ModelRuntime，但状态、触发入口、权限与显示协议分别实现。[V08,V10,W04]

## 12.2 固定 profile

内置 researcher（只读搜索/读取/链接/已授权远程只读能力）、reviewer（只读复核）、writer（可生成建议，实际写入仍须宿主权限）。默认只启用前两项，用户显式启用 writer。profile 配置是数据，不允许 JS、imports 或自建 SDK。

每个子代理配置：profileId、modelKey（默认继承主模型）、thinkingLevel、toolAllowlist、instructions、maxTurns<=16、maxDepth<=2。最终工具集 = 父 callable ∩ profile allowlist ∩ 当前 scope policy。不能把父模型可见列表的隐藏工具自动传给子代理。

输入文件最多 8 个、合计 128 KiB 且不超过子模型 context 的 10%（按保守 token 估计）；通过 Vault/native受控 read 获取，不能私自 fs.readFile。超限明确拒绝并建议让子代理逐个读取，不静默截断关键约束。

## 12.3 前台委派

注册 `delegate_task({profileId,task,description,inputFiles?,modelKey?})`，callers=[model]，显示兼容 vendorToolName=Agent。不要让一个 tool-only 脚本启动未可视化的子代理。

工具用 `replay:safe`，但其 execute 必须：api.commit 里先按 ownerTaskId 查现有 child，没有才 createConversation(ownership task:api.taskId)；初始化继承缩减后的 agent/profile/scope；写 child 映射。之后用固定 requestId `delegate:<taskId>` submit，再 wait。恢复后取得相同 child/submission，不重复创建。[P11]

完成从真实 AssistantEntry 提取答案；unanswered 返回失败/取消而不是仅返回文字 done。details 包含 childConversationId、profile、status、started/ended、progress；父工具结果包含有限答案与可打开子会话引用。原始子历史完整保存。

## 12.4 后台生命周期

注册 `start_background_task`、`get_subagent_result`、`send_subagent_message`、`stop_subagent`、`list_subagents`。start 与 send 使用稳定 commandId 去重；stop 默认 replay:unsafe，防止恢复后停止另一次新工作。

采用 Pi 官方示例的两个明确任务：[P12]

- `va.subagent_anchor`：background=true，拥有 child conversation，任务本身提交 terminal completed；拥有关系继续标识背景边界。
- `va.subagent_reporter`：background=true，状态 `deliver` → `report` → terminal。deliver 使用 requestId `subagent:<reporterTaskId>` 提交子消息并等结果；同一 commit 去重 answerEntryId 并保存待报告文本。report 使用 `subagent-report:<reporterTaskId>` 投递一次，最后标终态。

不要用 setInterval 轮询子代理完成，也不要复制示例中的未适配返回字段（Durable 工具输出是 output）。示例只决定拥有关系/检查点算法，产品权限和事件使用本包规范。

## 12.5 后台报告的安全语义

报告是工具来源，不是新用户意图。文本由宿主加固定来源声明，entry.kind=`va.subagent.report`，data 包含 child/answerEntryId/parentRunId/origin。只有确需主模型综合且该根原 run 未取消、预算仍允许时才生成 followUp input；它使用既有任务授权，不授予新权限。

用户 Stop 增加 root.cancelEpoch，并默认 `root.abort({background:true})`；迟到 reporter 比对启动 epoch，发现已取消则只保存结果，不再次启动模型。恢复默认仍需用户点击继续；不因挂 watcher 或读取报告而复活执行。Obsidian 关闭时所有后台工作停止，重开仅恢复状态。

后台子代理完成后要更新原父工具卡而非总追加一个新的虚假 launch。父卡的 tool ID、子进度与结果引用稳定，重载也相同。子代理失败只影响其任务；主流程收到真实错误可选择其他策略，不能屏蔽失败当成空答案。

## 12.6 并发和预算

每根最多 3 个 active child；超出的任务在宿主队列中可见并可取消，排队尚未发模型请求。最大深度 2；第二层不再具有委派工具。计入根 RequestBudget，不给每个子代理一份独立无限预算。

并发写入仍经过 Vault 共享锁和 CAS。多个只读候选可并行；禁止把 fan-out 候选设为 writer。权限缩减/撤销立即影响尚未开始的子工具，已批准但基线变更的写入重新确认。

## 12.7 Fan-out 固定流程

保留现有 FanoutTurn 数据结构和卡片。以前按 backendId 选择回答器的地方改成稳定 modelKey；engineId 始终 pi。用户选择 2–4 个已配置且有凭据模型。

一次 fan-out 建立一个根作业文档和 N 个只读 child：同一用户输入与审定上下文分发；候选独立保存 status/text/usage/error；全部 settled 后用指定综合模型合成。至少 1 个成功才能综合；部分失败明确显示；全部失败不生成假综合。综合消息包含实际候选回答，不能标“多个模型一致”除非文本支持。

candidate/synthesis 的 requestId 固定于 fanoutId + slot；崩溃后跳过已完成 slot，只恢复 pending。评分/比较若当前 UI 有对应字段则由明确评估步骤输出结构化结果并校验；不随机赋分、不让综合模型自行发明候选响应。

修改后续动作另起普通用户 run，经 default 权限，不让只读 fan-out 直接写库。渲染候选、综合、错误、取消、选择模型标签与重载回放都属于发布门槛。
