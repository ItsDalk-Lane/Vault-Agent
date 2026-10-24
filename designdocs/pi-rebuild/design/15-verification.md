# 15 · 测试、证据与阶段运行

## 测试分层

纯单元：路径分类、policy 决策、ID 映射、patch、schema、去重与恢复判断。运行时集成：Pi 官方 faux provider + MemoryStorage/临时 JSONL + 注入的 Obsidian adapter，真实走 Harness/ToolGateway/事件转换。UI：既有 React 测试和组件 stories。端到端：支持版本 Obsidian 中真实模型/HTTP MCP，记录人工步骤与结果。

不得把真实 API Key 放测试源码或 fixtures；测试依赖 fake credentials。网络默认禁用，只有标记的 E2E 使用明确测试端点。Mock 必须在 I/O 边界，不 mock 掉待验证的 PermissionEngine、MutationCoordinator 或 EventTranslator。

## 每个生产功能的最小测试组

正常成功 → 无数据/不支持 → 参数错误 → 权限拒绝 → 用户取消 → 并发/迟到事件 → 关闭重开 → 失败后恢复。不是每个纯函数都写八类不适用测试；任务卡给出了该函数的具体必测行为。

禁止 `setTimeout(0)`、随机 sleep、`await Promise.resolve()` 等等 pending 工作。用 explicit deferred、真实事件或返回 Promise 等待；超时用可控 fake clock。压力测试与性能指标不能用 mock 时间冒充实际运行。

## 必做故障注入位置

批准前、批准后写前、外部效果后 receipt 前、receipt 后 UI 前、模型流中途、压缩摘要生成但未放置、子代理创建后 submit 前、report提交后 reporter终结前、MCP远端返回前断线、Keychain刷新与signOut竞态、store lease占用、Durable存储提交失败。

实现 `FaultInjector` 仅测试构建启用，生产默认不可由模型/设置打开。断点由测试主动 reject 或中止环境，不能真的破坏用户 Vault。每种故障测试检查最终文件内容、执行次数、记录状态和 UI，不仅检查 log 被调用。

## 发布前真实性检查

- fake provider 不足以证明真实模型 thinking/tool/schema 支持，分别记录至少一个实际供应商测试。
- HTTP MCP 用本进程内存/测试服务验证协议，再做一个用户许可的远程连接；测试调用只选无副作用工具。
- 清理 PATH 与旧 agent 安装后核心流程仍通过；测试项目编译用 Node 与用户运行插件无 Node 是两件事。
- 所有 UI 功能 matrix 行均有 producer、task、scenario 与 evidence；失败行不能通过隐藏组件消失。
- unknown token/price/quota 确实显示未知；没有实际子代理工具调用时不显示虚构进度。

## 证据格式

每张任务卡生成 `execution/evidence/<taskId>.json`。内容包括开始/结束的实际 git SHA（无提交写 null）、修改文件、运行命令、cwd、exitCode、摘要、对应 tests、人工步骤和未执行项。完成状态必须 evidence.status=passed；未执行/失败不得 done。

测试输出可存另一个日志文件，先脱敏。不要写“全部通过”而没有命令结果。文档检查器只能证明本包的依赖/覆盖/链接一致，不证明插件代码正确。

## 三平台矩阵

Windows/macOS/Linux 均验证 Vault 路径、外部路径、Keychain、流取消、持久化重开；至少 Windows 覆盖盘符大小写/junction/UNC/ADS，macOS 覆盖大小写卷行为，Linux 覆盖符号链接。缺少真实平台时记录 not_run，发布 gate 不宣称三平台通过；可保留待验版本而不是降低安全规则。

## 性能目标（验收目标，不是已测结论）

在记录硬件和样例规模后测：1000 条显示消息的回放不阻塞界面超过 200 ms 的单次任务；长事件流单 UI 帧合批；无界 token 输出不导致无限数组；两根会话同时运行时限制满足。若不满足，先拆批/分页和限制输出，不换另一引擎或删除功能。

具体任务依赖和运行演示见 `execution/phases/`；行为用例见 `fixtures/acceptance-scenarios.json`。新增边界问题先加回归用例再修复。
