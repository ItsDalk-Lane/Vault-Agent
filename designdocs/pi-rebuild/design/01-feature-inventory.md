# 01 · 渲染与产品能力清单

本表以已查看的 AgentChatMessages、AgentTrailView、agentTrail、领域类型和项目进度入口为基线。[V03,V08,V09,V10,V17] 它不是声称已对用户后续工作树做完自动静态分析。P01-T02 必须沿实际引用复核新增分支，补行不能减项。

每行都要求新后端真实产生数据。`existing` 代表本基线产品/渲染契约，`new_required` 是本次要求的新配置或恢复入口。任务完成不等于功能整体验收：还必须通过 P14 的真实producer→UI→重开测试。

| ID  | 能力 / 组件                                                                    | 后端落实任务 | 必需结果                                               |
| --- | ------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------ |
| F01 | 普通回答与Markdown · AgentChatMessages / ChatSingleMessage / AgentMarkdownText | P04-T07      | 真实回答的文字、代码、数学与链接维持原渲染，重载一致。 |
| F02 | 公开思考与时长 · ReasoningBlock                                                | P04-T04      | 仅公开thinking流驱动，无数据不伪造。                   |
| F03 | 工具状态卡 · ActionCard                                                        | P04-T05      | pending/执行/成功/失败反映实际授权与结果。             |
| F04 | 工具输出与截断 · ActionCard / 工具详情                                         | P04-T05      | trim/set正确，不无限拼接，不隐藏真实错误。             |
| F05 | 连续活动分组与运行提示 · ActivityGroupCard                                     | P04-T06      | 一run多turn不提前结束，活动计时真实。                  |
| F06 | 子代理树 · SubAgentCard                                                        | P10-T04      | 稳定父子ID，子工具可见，打开子历史不重新执行。         |
| F07 | 任务清单轨迹 · PlanPill                                                        | P08-T01      | todo状态来自可恢复文档，不仅工具名装饰。               |
| F08 | 项目任务进度 · ProjectInfoPopover.ProgressSection                              | P08-T01      | getCurrentTodoList在运行和重启后均有真实值。           |
| F09 | 计划正文与版本 · PlanProposalCard                                              | P08-T02      | 计划revision和正文准确，待审批可恢复。                 |
| F10 | 计划批准拒绝反馈 · PlanProposalCard / CurrentPlan                              | P08-T03      | 决定真实驱动后端，批准不等于免权限。                   |
| F11 | 用户提问多选与其他 · AskUserQuestionCard                                       | P08-T04      | 用户答案持久化、恢复、取消都可用。                     |
| F12 | 工具权限弹窗与卡片 · ToolPermissionCard / 既有权限Modal                        | P05-T06      | 实际执行等待持久化授权，拒绝无副作用。                 |
| F13 | 历史压缩行 · CompactionRow                                                     | P08-T05      | 手动自动真实压缩，区分完成失败取消跳过。               |
| F14 | 仅压缩消息渲染 · AgentTrailView compaction-only                                | P08-T05      | 不伪造普通回答，旧历史仍完整。                         |
| F15 | 文件变化摘要 · FilesChangedCard                                                | P06-T09      | 只展示实际已提交或明确未知的变化。                     |
| F16 | 差异窗口 · TurnDiffView / openTurnDiff                                         | P06-T09      | before/after取实际receipt，审批变更与落地一致。        |
| F17 | 变更回退 · 既有文件变更回退操作                                                | P06-T10      | 后续用户编辑不被覆盖，回退也是受控mutation。           |
| F18 | 并行回答候选 · FanoutMessageCard                                               | P11-T04      | 候选来自独立真实模型，有部分失败状态。                 |
| F19 | 并行回答综合 · FanoutMessageCard 综合区域                                      | P11-T03      | 只有真实候选进入综合，全失败不伪生成。                 |
| F20 | 并行任务只读限制 · 现有fan-out工作流                                           | P11-T02      | 所有候选不可写Vault，后续写另起权限流程。              |
| F21 | 模型选择器 · 既有模型选择UI / BackendState.model                               | P03-T09      | 多provider由一Pi引擎执行，busy不半切换。               |
| F22 | 推理强度选择 · 既有effort选项                                                  | P03-T09      | 按模型实际能力，缺能力不显示无效选项。                 |
| F23 | 模式切换 · 既有mode选择UI                                                      | P05-T04      | plan/default/auto均有代码规则。                        |
| F24 | Token与上下文用量 · 既有usage显示                                              | P08-T07      | 当前context与总消费分离，未知值不写0。                 |
| F25 | 用量窗口/预算 · 既有PlanUsage窗口                                              | P08-T07      | BYOK未知订阅额度不伪造，本地预算有来源标签。           |
| F26 | 耗时与运行指示 · AgentTurnDurationIndicator                                    | P04-T06      | 使用持久化时间，重载不重新计时。                       |
| F27 | 停止与取消状态 · 既有Stop及取消提示                                            | P03-T08      | 取消真实网络和工作，保留已发生副作用。                 |
| F28 | 错误与重试呈现 · AgentChatMessages错误路径                                     | P04-T06      | 有真实原因、不覆盖先前轨迹、不重复用户消息。           |
| F29 | 会话索引标题项目与墓碑 · AgentSessionIndex / 会话列表                          | P13-T02      | 历史来源、用户标题和删除墓碑不丢。                     |
| F30 | 会话历史恢复 · AgentMessageStore / AgentChatMessages                           | P04-T02      | 压缩旧历史不被snapshot清空，无重复条目。               |
| F31 | Markdown聊天保存 · AgentChatPersistenceManager                                 | P13-T04      | 现有格式可读，完整执行历史由Durable保存。              |
| F32 | 图片与附件 · ChatSingleMessage附件路径                                         | P12-T04      | 真实模型图片输入、保存与缺失占位。                     |
| F33 | 笔记路径和跳转 · 工具locations / 既有笔记链接                                  | P06-T08      | 受控目标打开正确leaf，不改变其他窗口。                 |
| F34 | 当前选区与上下文 · 既有编辑器选区输入                                          | P12-T03      | 范围/内容版本准确，不重复整段历史。                    |
| F35 | 技能管理与调用 · 既有Skills管理UI                                              | P12-T01      | canonical store直读，启停真实，不依赖CLI分发。         |
| F36 | 技能执行安全 · 技能命令入口                                                    | P12-T02      | 技能不能增加权限或自动执行脚本。                       |
| F37 | 反馈卡 · FeedbackCard                                                          | P08-T06      | 真实错误可触发，dismiss和关闭可恢复。                  |
| F38 | 问题报告 · ReportIssueModal                                                    | P08-T06      | 预览脱敏证据并确认后再提交，无自动上传。               |
| F39 | MCP工具展示 · ActionCard / mcpServer标记                                       | P09-T04      | 真实调用结果和isError保留，名字不误成子代理。          |
| F40 | MCP设置与测试 · 新增MCP设置，沿用原设置交互                                    | P09-T10      | 配置、测试、OAuth与连接状态非占位。                    |
| F41 | 后台子代理完成报告 · SubAgentCard后台进度                                      | P10-T08      | 只报告一次，Stop后不自动复活父模型。                   |
| F42 | 回答复制与操作栏 · AgentTrailView末尾操作栏                                    | P04-T07      | 复制真实回答，不附带隐藏thought/tool诊断。             |
| F43 | 项目切换与快捷命令 · 既有项目/输入命令入口                                     | P12-T06      | 原会话范围不被悄悄替换，compact显式分发。              |
| F44 | 缺凭据和能力不可用 · 既有选择器/配置错误呈现                                   | P03-T02      | 没有假模型、假key、假额度或必须装CLI提示。             |
| F45 | 网页获取工具轨迹 · AgentToolKind.fetch / ActionCard                            | P12-T05      | 真实受控抓取，不执行网页脚本。                         |
| F46 | 重启待处理交互 · 新增恢复条 / 现有权限与提问卡                                 | P02-T08      | 只读展示不启动scheduler，继续需明确用户动作。          |

## 不允许的替代验收

静态 story 不能代替后端；工具返回“成功”不能代替实际文件变化；模型说“我派了子代理”不能代替 owned conversation；模型自然语言待办不能代替 todo 文档；清空历史不能代替压缩；假设所有模型能提供思考不能代替 capability 检查；隐藏旧组件不能用来降低功能数量。

## 工作树差异

现有 renderer 名称调整时只更新组件定位，不更改能力ID。发现更深层新组件如新增工具结果类型，增加功能行、指定producer/任务/用例。没有后端方案的行必须阻塞对应阶段，不能由执行AI临场以假数据补齐。
