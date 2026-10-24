# 06 · 确定性审核系统与权限

## 6.1 威胁模型

防止模型误用工具、恶意笔记/网页/MCP 输出诱导越权、路径穿越、权限复用错误、子代理扩大权限、恢复重复执行和密钥泄露。该系统不是针对控制同一 OS 账户的恶意本地程序的内核沙盒。任意宿主 Shell、用户自装插件和本地 MCP 程序都不能仅靠此系统实现 OS 隔离。

不得用第二个 LLM 作最终安全裁决；它可给用户风险解释，但 allow/deny 的结果由纯规则和明确用户决定产生。

## 6.2 工具注册清单

每个工具有宿主写死的 ToolManifest：toolId、family、effects、参数目标提取器、schemaHash、implementationVersion、replayPolicy、allowedCallers、maxOutputBytes。family = vault/native_file/obsidian_action/mcp/control/host_process。effects = read/write/create/delete/rename/network/execute/ui/state。

模型不能传入 `safe:true`、`family`、`permission`、`rootId` 来改变 manifest。MCP annotations 只作提示，不授予只读权限。未知工具不注册；既有注册名不得被技能或远端服务器覆盖。

## 6.3 判定顺序（固定，不可调换）

1. 校验参数 schema、调用者身份、工具是否仍被启用；获取 root/conversation 的宿主 scope。
2. 提取所有资源目标，包括 rename 的两个端点、附件路径、输出文件和工作目录。
3. 规范化并真实解析路径；拒绝受保护目录、非法路径、跨 scope。
4. 校验工具族与资源族是否匹配；native 对 Vault 目标返回 `USE_VAULT_TOOL`，不悄悄转换 schema 后执行。
5. 应用 plan/只读子代理约束，任何写/未知本地效果拒绝。
6. 应用模式规则与长期授权；未知高风险效果始终 per-call，不被 auto 模式跳过。
7. 创建审批摘要，包含工具、最终参数摘要、目标、beforeHash、scopeVersion、policyVersion、schemaHash、有效期。
8. 必要时显示现有 PermissionPrompt，等待用户决定；此时不持有文件锁、不执行外部 I/O。
9. 决定入库；取得短期路径锁，重验取消、scope、目标解析、版本和内容基线。
10. 同一 commit 记录 intent/消费 allow_once；执行实际操作；验证结果；记录 receipt；发出展示更新。

审批摘要与执行摘要不同，必须重新审批。拒绝或关闭卡片返回结构化 tool error，模型可以换策略；不能偷偷执行其改写版本。

## 6.4 模式规则

| 操作                | plan / 只读子代理 | default                   | auto                            |
| ------------------- | ----------------- | ------------------------- | ------------------------------- |
| 本库普通笔记读/搜索 | 在项目范围内允许  | 允许                      | 允许                            |
| Vault 创建/内容修改 | 拒绝              | 每次确认或精确授权        | 已批准 scope 内可自动执行       |
| Frontmatter 变更    | 拒绝              | 确认                      | 已批准 scope 内；保护字段仍确认 |
| 删除/移动           | 拒绝              | 每次确认                  | 每次确认                        |
| 外部文件只读        | 仅显式允许根      | 首次根授权                | 同 default                      |
| 外部写入            | 拒绝              | 每次确认                  | 仅精确规则；不得隐含全 home     |
| 本地不透明进程      | 拒绝              | strict 拒绝               | strict 拒绝                     |
| trusted_host 进程   | 拒绝              | 开关确认 + 每次确认       | 不免审                          |
| 未知 MCP 效果       | 拒绝              | 明确服务器信任 + 每次确认 | 不免审                          |
| 控制任务清单/提问   | 允许状态变化      | 允许                      | 允许                            |

plan 允许记录计划/待办这种私有产品状态，不等于允许写用户 Vault。计划文件若需导出必须走普通写权限，不保留旧“特定文件名自动免权限”分支。

## 6.5 路径规范化算法

使用结构化路径输入。Vault 工具接受 Vault 相对路径，拒绝绝对路径、NUL、反斜杠混淆、`..` 逃逸、URL scheme 和未经解析的 glob。先 normalize 再校验，但不在校验之前静默丢掉危险片段。

外部工具接受绝对路径或相对**显式 externalRoot** 的路径，禁止以 Vault cwd 作默认值。已有文件 realpath；新文件解析最近存在父目录的 realpath，再拼接已校验剩余段。所有现存父目录都检查 symlink/junction；含别名路径时按真实目标判定。使用 `path.relative` 的完整边界关系，不使用 `startsWith(vaultRoot)`。

Windows：区分盘符/UNC/设备路径；默认拒绝设备命名空间、ADS 冒号流、未经显式授权 UNC、路径尾点/空格别名。大小写依据文件系统识别，不能给 Linux 也统一 lower-case。外部文件与 Vault 根的重叠双向检测；Vault 内链接到外部文件默认拒绝并要求以外部工具显式授权真实根。外部链接回 Vault 同样拒绝。写入目标若 nlink>1 默认拒绝，避免硬链接间接修改。

在执行前再解析一遍。JS 层不能消除所有本地恶意进程造成的 TOCTOU，所以不能宣传为强沙盒；正常用户并发编辑用 CAS 解决，见 07。

## 6.6 授权存储

长期规则只能由用户在 UI 建立，存到本设备/本 Vault 的宿主设置，不能由技能文件定义。规则包含 scopeId、family、effect、canonicalRoot 或 exactPath、tool/schema 指纹、创建者 user 和 expiresAt。allow_always 的 UI 必须显示真实范围，不可写“始终允许”却仅内存生效。

默认长期允许仅开放普通 Vault edit 与外部 read；delete/rename/opaque process/MCP unknown 不提供 allow_always。reject_always 可保存精确 deny 规则。deny 优先于 allow。移除项目授权/修改 MCP config 使对应 rule 失效。

一次审批默认 10 分钟有效；过期重新询问。重启后即使时间未过，也必须重验全部绑定。权限决定里的 optionId 只从实际 options 集合接受，未知 optionId = 拒绝。

## 6.7 硬约束不可卸载

每个工具注册时必须经过 ToolGateway 包装；Durable 的 beforeTool 再检查 manifest 存在。Native ExecutionEnv 每次 I/O 做最终范围检查。MCP adapter 和子代理 executeTool 路径都必须经过同一 gateway。

不要让 conversation.configure 可以删除审核扩展；对外只暴露插件自有配置方法，registry 与 raw harness 不传给 UI、技能脚本或 MCP。第三方 SKILL.md 是数据，不是可执行 JS 扩展。

## 6.8 审计

审计记录包含 operationId、actor root/child、toolId、参数摘要 hash、规范化目标、effect、policy decision、ruleId/requestId、状态和时间。参数正文只保留脱敏安全字段；密钥、header、完整 shell 环境不得写日志。

每次拒绝提供稳定 code 和中文解释；工具收到可操作提示，例如“该路径属于 Vault，请调用 vault_read”。人工解释不能代替 machine-readable code。保存拒绝本身不意味着执行过工具。

具体等待、原生写预览、请求归属和凭据竞态算法见 [17 · 固定实现算法](17-algorithm-recipes.md)。
