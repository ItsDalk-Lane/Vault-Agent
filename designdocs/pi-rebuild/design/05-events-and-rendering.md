# 05 · 事件、历史回放与全部渲染能力

## 5.1 不变原则

Domain 类型属于 Vault Agent；Pi 事件不直接进 React。只有已经 Durable 提交的状态才能进入权威投影。可有“正在发送”草稿占位，但必须与已提交 user message 区分，失败可重试且 ID 不变。

`run_end` 对应一次用户工作的结束，`turn_end` 只代表一次模型响应/工具轮结束。不能提前结束 loading、遗漏后续工具或把后台子任务误判为完成。[P04]

## 5.2 订阅和全历史合并

打开会话时先 attach `watchEvents` 获取原子 snapshot 与后续订阅，随后启动事件处理器并暂存按序批次；分页读取 `conversation.entries(...order:"ascending")` 得到完整历史。按 EntryId 去重，历史先组成 committedMap，再叠加已收到的较新 entry 和 live snapshot；初始化提交一个 `session_projection`。

缓冲有界：最多 100 批或 2 MiB，超过则停止该次初始化并重新 attach；不能丢一半文本继续拼接。稳定连接后的处理器顺序 await，一个批次合并成一帧更新，UI 不能反过来阻塞执行存储提交。慢 UI 得到 snapshot 时，**只替换 live/active 部分，并分页补全 missing entries；绝不能删除已经压缩的旧消息**。[P04,P05]

为每次 attach 生成 streamEpoch；适配器局部 frameIndex 递增用于防止迟到的旧观察者覆盖新 UI。它不是 Durable 持久化序号，重启不据此判断业务幂等。历史事实去重依据 EntryId/SubmissionId/ToolId。

## 5.3 事件映射表

| Durable 来源                    | Vault 领域效果                     | 关键处理                                                    |
| ------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| user entry / submission         | user_message_chunk 或完整投影      | 与乐观草稿对齐，只出现一次                                  |
| text_delta / text block         | agent_message_chunk / text part    | contentIndex 定位；block/message 是替换，不是 append        |
| thinking_delta / thinking block | agent_thought_chunk / thought part | 只用公开返回内容；切换 block 时关闭计时                     |
| toolcall 参数流                 | pending tool_call                  | 参数未完成不能执行；无需为每个 token 发权限                 |
| tool_execution_start            | 工具已登记                         | 未获许可时仍 pending，不谎称副作用已开始                    |
| wrapper 开始实际 I/O            | tool_call_update in_progress       | 宿主确认后才变执行中                                        |
| output trim+append/set          | tool output patch                  | 必须支持截头/替换，不能无限 append                          |
| tool_execution_end              | completed/failed                   | entry/result 缺失时视 interrupted/failed；不凭 end 词判成功 |
| va.todos entry                  | todo_update + plan part            | 同 revision 一次，更新项目进度 getter                       |
| va.plan entry                   | plan_proposal_update               | 绑定 pendingToolCallId、revision 和真实决定                 |
| compaction_start/end            | compaction part                    | 完成还要核对 summary 是否实际放置                           |
| agent_changed                   | state_changed                      | 模型与 effort 使用配置规范 ID                               |
| usage_changed                   | usage_update + budget_update       | 累积值使用差额/替换，禁止重复计数                           |
| auto*retry*\*                   | run_state/工具诊断                 | 保留已提交内容；失败不假扮新的正常回答                      |
| task_failed/session failure     | error message + recovery state     | 显示脱敏错误，解除 loading，留住已发生变更                  |

## 5.4 功能兼容策略

ActionCard 的 vendorToolName 是显示兼容字段，不等于安全分类。为原生工具建立固定别名映射：read→Read，write→Write，edit→Edit，bash/powershell→Bash；Obsidian 专属工具使用自己的名字和 toolKind。MCP 保留 mcpServer，绝不让名叫 Agent 的 MCP 工具被识别成子代理。

子代理控制工具对现有 renderer 发 `vendorToolName:"Agent"`；子工具具有 namespaced parentToolCallId。子会话文本与思考留在其自身轨迹，父卡显示工具子树、结果摘要与打开子会话动作，不能把子思考注入主会话的 reasoning block。[V10]

如现有 toolSummaries 对名字作特殊解析，改为增加一张受测试的别名表；不要更改事实层工具 ID，也不要扩散原生工具名称判断到权限系统。

## 5.5 可恢复交互

权限、提问、计划批准来自 durable 产品文档；UI 打开时重新构建。相同 requestId/revision 只能处理一次。两个窗口同时点击时，第一次有效提交获胜；第二次显示已处理而不再次执行。批准后关闭 UI 不撤销已开始的操作；显式 Stop 才请求取消。

计划与 todo 区分：todo 是进度事实，plan 是待批准方案。不能把 plan 单一数组既当执行进度又当批准。`CurrentPlan` 复用现有类型；必要新增领域事件，不让 AgentSession 再解析 Claude 私有工具输出。[V11,V17]

## 5.6 Usage/时长/额度

模型 input/output/cache tokens 来自真实 usage。token 统计缺失时用 null/unknown 状态，不显示 0 代表免费。contextWindow 是模型目录信息；usedTokens 是当前上下文使用估计/测量，累计消费另外计数，不能把总消费当当前窗口。

Run 的 wall-clock duration 保存 started/ended；重启前后的等待单独显示，不能用组件渲染次数计时。局部 thinking duration 用真实流区间和持久化时间，不重启后重新开始计时。

原计划额度窗口的 UI 改成有 `source:"provider"|"local_budget"` 的来源标记。BYOK 默认只显示真实 token/成本和可选本地预算；供应商额度没有公开可靠数据时显示不适用，而非保留假的 Claude/ChatGPT 订阅窗口。[V12]

## 5.7 全部组件覆盖的门槛

`fixtures/feature-matrix.json` 是本基线的必要功能表，每行给组件、后端生产者、验收场景和任务。P01 对真实工作树做传递引用核对，补入新增组件，但不得删除现有行以让覆盖率好看。

任何 renderer 的 story 通过不等于功能实现。每一行至少有：fake-provider/host 输入 → 新后端真实事件 → UI 状态断言 → 关闭重开后状态一致。需要真实供应商的 reasoning/MCP/多模型补人工 E2E 证据。错误、取消、拒绝和空结果都必须有可观察状态。
