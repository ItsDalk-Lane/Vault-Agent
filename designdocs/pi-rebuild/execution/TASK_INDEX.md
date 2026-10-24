# 原子任务索引

状态以 [STATE.json](STATE.json) 为准；本文件不维护独立完成标记。

## P01 · 冻结边界与产品契约

现有插件仍可构建；Pi契约及功能清单可检查，默认执行器尚未切换。

- [P01-T01 · 登记工作树与已通过的PoC](tasks/P01-T01.md)
- [P01-T02 · 核对全部渲染分支和功能映射](tasks/P01-T02.md)
- [P01-T03 · 锁定Pi依赖与公开契约测试](tasks/P01-T03.md)
- [P01-T04 · 限制SDK依赖传播范围](tasks/P01-T04.md)
- [P01-T05 · 添加最小供应商无关领域事件](tasks/P01-T05.md)
- [P01-T06 · 注册尚未默认启用的Pi描述符](tasks/P01-T06.md)
- [P01-T07 · 建立fake provider和注入式宿主测试环境](tasks/P01-T07.md)

## P02 · 持久化与单写者

临时store中提交记录，关闭重开后完整恢复；另一writer被拒绝，尚不自动调用模型。

- [P02-T01 · 实现私有数据路径和Vault身份](tasks/P02-T01.md)
- [P02-T02 · 实现独占store lease](tasks/P02-T02.md)
- [P02-T03 · 包装JSONL打开关闭与版本元数据](tasks/P02-T03.md)
- [P02-T04 · 定义产品状态文档及自定义事件](tasks/P02-T04.md)
- [P02-T05 · 实现请求与工具稳定ID](tasks/P02-T05.md)
- [P02-T06 · 分页读取完整历史而非active snapshot](tasks/P02-T06.md)
- [P02-T07 · 实现根运行时池和有界store生命周期](tasks/P02-T07.md)
- [P02-T08 · 实现只读恢复入口和存储故障处理](tasks/P02-T08.md)

## P03 · 模型与基础聊天闭环

在现有聊天界面用插件内配置的模型流式回答、停止、关闭和重开；无外部Agent进程。

- [P03-T01 · 适配Keychain到CredentialStore](tasks/P03-T01.md)
- [P03-T02 · 适配既有模型配置到Pi模型目录](tasks/P03-T02.md)
- [P03-T03 · 按需注册Pi Provider](tasks/P03-T03.md)
- [P03-T04 · 实现模型请求的硬分发门](tasks/P03-T04.md)
- [P03-T05 · 建立唯一Durable根运行时](tasks/P03-T05.md)
- [P03-T06 · 实现会话创建加载列表与退出](tasks/P03-T06.md)
- [P03-T07 · 接通prompt和最小文本流](tasks/P03-T07.md)
- [P03-T08 · 连接Stop到真实运行取消](tasks/P03-T08.md)
- [P03-T09 · 接通模型effort与模式选择](tasks/P03-T09.md)

## P04 · 完整事件投影与基础渲染

真实新引擎流能展示文本、公开思考、工具轨迹、错误和停止；关闭重开保持顺序且无重复。

- [P04-T01 · 归一化Durable消息和工具事件](tasks/P04-T01.md)
- [P04-T02 · 建立全历史与live合并reducer](tasks/P04-T02.md)
- [P04-T03 · 将完整投影送入既有消息store](tasks/P04-T03.md)
- [P04-T04 · 接通公开思考和块计时](tasks/P04-T04.md)
- [P04-T05 · 实现工具卡输出替换与别名元数据](tasks/P04-T05.md)
- [P04-T06 · 接通loading重试时长错误与预算提示](tasks/P04-T06.md)
- [P04-T07 · 完成回放与Markdown/复制回归](tasks/P04-T07.md)

## P05 · 审核系统与权限闭环

无副作用测试工具能真正等待/拒绝/接受审批；重开后请求恢复，路径和模式绕过均被拒绝。

- [P05-T01 · 定义受控工具清单和注册门](tasks/P05-T01.md)
- [P05-T02 · 实现Vault与外部路径分类](tasks/P05-T02.md)
- [P05-T03 · 补齐平台别名与硬链接策略](tasks/P05-T03.md)
- [P05-T04 · 实现固定顺序的纯PolicyEngine](tasks/P05-T04.md)
- [P05-T05 · 持久化审批绑定与长期规则](tasks/P05-T05.md)
- [P05-T06 · 连接现有权限弹窗与取消](tasks/P05-T06.md)
- [P05-T07 · 统一模型和嵌套工具执行门](tasks/P05-T07.md)
- [P05-T08 · 实现脱敏审计和安全错误映射](tasks/P05-T08.md)

## P06 · Vault原生能力与可回退修改

真实搜索→读取→修改预览→批准→写入→Diff→冲突安全回退全链条可运行。

- [P06-T01 · 实现列表读取与链接工具](tasks/P06-T01.md)
- [P06-T02 · 实现无CLI关键词搜索](tasks/P06-T02.md)
- [P06-T03 · 实现确定性精确patch准备器](tasks/P06-T03.md)
- [P06-T04 · 实现mutation账本与短期路径锁](tasks/P06-T04.md)
- [P06-T05 · 实现Vault创建和CAS修改](tasks/P06-T05.md)
- [P06-T06 · 实现可预览的frontmatter CAS工具](tasks/P06-T06.md)
- [P06-T07 · 实现单文件重命名与回收](tasks/P06-T07.md)
- [P06-T08 · 实现选区与打开笔记公共API动作](tasks/P06-T08.md)
- [P06-T09 · 把真实receipt接到变更卡和Diff](tasks/P06-T09.md)
- [P06-T10 · 实现冲突安全的变更回退](tasks/P06-T10.md)
- [P06-T11 · 实现写操作崩溃对账测试与修复](tasks/P06-T11.md)

## P07 · 外部文件与可选宿主命令

库外read/write/edit复用Pi原生工具；库内绕行被拒绝；strict默认无进程，明确启用后命令可审核执行。

- [P07-T01 · 实现用户驱动的外部目录授权](tasks/P07-T01.md)
- [P07-T02 · 实现完整GuardedExternalEnv](tasks/P07-T02.md)
- [P07-T03 · 注册Pi原生read/write/edit工具包装](tasks/P07-T03.md)
- [P07-T04 · 实现strict与trusted_host设置和风险确认](tasks/P07-T04.md)
- [P07-T05 · 注册原生bash与PowerShell并约束解释器](tasks/P07-T05.md)
- [P07-T06 · 实现进程取消与输出清洗](tasks/P07-T06.md)

## P08 · 待办计划提问压缩与反馈

现有PlanPill/项目进度/计划卡/提问卡/压缩行/反馈卡均由新引擎真实触发并能恢复。

- [P08-T01 · 实现版本化todo工具和进度投影](tasks/P08-T01.md)
- [P08-T02 · 实现计划提交和CurrentPlan投影](tasks/P08-T02.md)
- [P08-T03 · 接通计划批准拒绝与反馈](tasks/P08-T03.md)
- [P08-T04 · 实现持久化ask_user工具](tasks/P08-T04.md)
- [P08-T05 · 接通手动自动压缩和真实终态](tasks/P08-T05.md)
- [P08-T06 · 实现本地错误反馈与报告桥](tasks/P08-T06.md)
- [P08-T07 · 接通真实用量与本地预算窗口](tasks/P08-T07.md)

## P09 · MCP完整接入

插件内新增HTTP MCP，测试连接、发现工具、授权调用、取消和OAuth可用；stdio只在明确可信模式运行。

- [P09-T01 · 实现MCP配置schema和秘密引用](tasks/P09-T01.md)
- [P09-T02 · 实现HTTP连接状态和池](tasks/P09-T02.md)
- [P09-T03 · 实现分页工具目录和安全schema适配](tasks/P09-T03.md)
- [P09-T04 · 实现Durable MCP工具桥](tasks/P09-T04.md)
- [P09-T05 · 实现MCP进度与输出限制](tasks/P09-T05.md)
- [P09-T06 · 实现Test按钮背后的有界测试](tasks/P09-T06.md)
- [P09-T07 · 实现浏览器OAuth与刷新竞态](tasks/P09-T07.md)
- [P09-T08 · 实现可选受控stdio transport](tasks/P09-T08.md)
- [P09-T09 · 实现direct/deferred/hidden能力选择](tasks/P09-T09.md)
- [P09-T10 · 完成MCP设置状态与真实演示](tasks/P09-T10.md)

## P10 · 前后台子代理

主Agent通过工具创建可检查的子会话；并发受限、父子工具可渲染、停止和重启不会复制任务。

- [P10-T01 · 定义子代理profiles与能力交集](tasks/P10-T01.md)
- [P10-T02 · 实现子代理任务输入和文件预算](tasks/P10-T02.md)
- [P10-T03 · 实现可恢复前台delegate工具](tasks/P10-T03.md)
- [P10-T04 · 接通SubAgentCard嵌套事件与查看](tasks/P10-T04.md)
- [P10-T05 · 实现后台Anchor与Reporter检查点](tasks/P10-T05.md)
- [P10-T06 · 实现后台启动查询发信停止工具](tasks/P10-T06.md)
- [P10-T07 · 实现并发队列与根预算约束](tasks/P10-T07.md)
- [P10-T08 · 处理后台报告来源与停止恢复竞态](tasks/P10-T08.md)

## P11 · 多模型Fan-out

用户选择多个模型并行只读回答，真实显示候选/失败/综合，重启后不重复已完成候选。

- [P11-T01 · 将回答器选择从backend迁移为modelKey](tasks/P11-T01.md)
- [P11-T02 · 创建只读候选并发任务](tasks/P11-T02.md)
- [P11-T03 · 实现综合步骤和结果来源](tasks/P11-T03.md)
- [P11-T04 · 接通现有FanoutMessageCard](tasks/P11-T04.md)
- [P11-T05 · 实现Fan-out恢复和历史导出](tasks/P11-T05.md)

## P12 · 技能上下文附件与项目

原技能/项目/选区/附件输入全部接新运行时；不会重复注入历史，也不会因技能绕过审核。

- [P12-T01 · 复用技能canonical store并建立宿主索引](tasks/P12-T01.md)
- [P12-T02 · 实现受控load_skill与脚本边界](tasks/P12-T02.md)
- [P12-T03 · 接入原ContextProcessor并去重历史](tasks/P12-T03.md)
- [P12-T04 · 接通图片附件存取和模型能力](tasks/P12-T04.md)
- [P12-T05 · 实现受控网页资料工具](tasks/P12-T05.md)
- [P12-T06 · 校准项目切换和快捷命令](tasks/P12-T06.md)

## P13 · 历史迁移与旧执行器移除

旧会话仍能查看/导入，新会话默认Pi；删除三套外部执行依赖后插件仍完整运行。

- [P13-T01 · 实现版本化配置迁移与备份](tasks/P13-T01.md)
- [P13-T02 · 隔离旧聊天纯读取兼容层](tasks/P13-T02.md)
- [P13-T03 · 实现基于历史新建Pi会话](tasks/P13-T03.md)
- [P13-T04 · 完善Markdown和完整备份导出](tasks/P13-T04.md)
- [P13-T05 · 将产品核心入口切换为单一Pi](tasks/P13-T05.md)
- [P13-T06 · 删除Claude执行与权限翻译链](tasks/P13-T06.md)
- [P13-T07 · 删除Codex执行与二进制安装链](tasks/P13-T07.md)
- [P13-T08 · 删除OpenCode执行与安装登录链](tasks/P13-T08.md)
- [P13-T09 · 删除无人使用的ACP与旧技能分发](tasks/P13-T09.md)
- [P13-T10 · 清理旧依赖安装文案与CLI字段](tasks/P13-T10.md)

## P14 · 全能力验收与发布门槛

在干净Obsidian环境完成完整知识任务；所有UI功能、恢复、安全、跨平台与无CLI路径有证据。

- [P14-T01 · 逐行验收完整渲染功能矩阵](tasks/P14-T01.md)
- [P14-T02 · 运行全部恢复与副作用故障矩阵](tasks/P14-T02.md)
- [P14-T03 · 执行路径权限和凭据安全回归](tasks/P14-T03.md)
- [P14-T04 · 验证只装插件的核心使用路径](tasks/P14-T04.md)
- [P14-T05 · 完成三平台路径与生命周期验收](tasks/P14-T05.md)
- [P14-T06 · 测量事件回放和资源上限](tasks/P14-T06.md)
- [P14-T07 · 执行完整工程审查与发布资料](tasks/P14-T07.md)
