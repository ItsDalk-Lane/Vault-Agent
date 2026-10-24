# 08 · Pi 原生工具与外部命令的真实边界

## 8.1 原生工具保留方案

从 `@earendil-works/pi-durable/tools` 导入 `createReadTool`、`createWriteTool`、`createEditTool`、`createBashTool`、`createPowerShellTool`。它们是 Pi 官方原生工具；本方案不复制其 edit/read 算法，也不为使用它们再启动 Coding Agent。[P07,P08]

每个工具注册前加 ToolGateway；execute 使用 `GuardedExternalEnv`。该环境实现 SDK 的完整 ExecutionEnv 公共契约，所有读取、写入、stat、目录、临时输出和 exec 都检查 host capability。不能只检查工具 args 后把 raw NodeExecutionEnv 暴露给它。

native read/write/edit 仅可作用于用户显式授权的 externalRoot。禁止根与 Vault、Obsidian 配置、插件状态、凭据保护目录重叠；路径链接回这些区域仍拒绝。没有 externalRoot 时这些工具仍存在，但调用返回 `EXTERNAL_SCOPE_REQUIRED`，界面提供选择目录动作，不自动授权 home。

## 8.2 宿主范围选择

UI 的目录选择需要真实用户点击。scope 记录 canonical root、read/write 允许集、有效期、Vault 归属和版本。模型的请求只能生成“请求访问此目录”审批，不可自己写 scopes。重命名/移动 Vault 或 externalRoot 后重新解析，不沿用旧路径字符串授权。

native write/edit 也生成 diff/权限请求和 mutation receipt，使用同一项目锁与审计。Node fs 的 write 不能让“外部”成为绕过审批的漏洞。遇到打开的 Vault 文件必须返回 USE_VAULT_TOOL。

## 8.3 Shell 的不可证明性与固定产品模式

任意 shell 字符串可以计算路径、读取脚本、解码输入或联网；`cwd` 在库外、字符串不含 Vault 路径、正则未命中 rm 均不能证明安全。因此实现**两种明确模式**，不是让 AI 自行实现一个“智能命令审核模型”。

### strict（默认）

保留 native bash/powershell 的工具定义，但 opaque command 调用在 gateway 被拒绝为 `OPAQUE_EXECUTION_DISABLED`。不运行，不下载工具。常见笔记命令改用专门 Obsidian 工具；外部文件读写用 native file 工具；查询时间/平台等使用固定宿主控制工具，不执行任意 shell。

### trusted_host（高级用户显式开启）

用户先在插件设置阅读并确认：进程拥有当前 OS 账户的能力，不是沙盒，技术上可能访问 Vault。之后每次调用都显示完整 command、绝对 cwd、选定 interpreter、输出限制、网络/文件不可精确推断说明，再批准；不提供 allow_always，不被 auto 模式跳过。明确包含已知 Vault 目标的命令仍拒绝并引导 Obsidian 工具。

这满足原生外部命令的可用性，但**不声称在 trusted_host 中仍能保证所有 Vault 访问都通过 API**。要同时允许任意 shell 且强制这一保证，需要 OS 级沙盒，属于后续独立工程，不能用提示词填补。

## 8.4 不引入安装前置条件

macOS/Linux 使用宿主已有且实际存在的 `/bin/bash` 或配置的绝对 interpreter；Windows 使用系统 PowerShell 的绝对路径，不要求 Git Bash。若缺少所需 interpreter，只禁用对应命令能力，聊天/Vault/native file/MCP HTTP 仍正常。不得用 PATH 自动搜索 `node`、`npx`、`uv`、Agent CLI。

插件可调用已有外部程序但不替用户下载它。没有命令可用时返回可观察能力状态，不能引导所有用户先安装 Node 才能启动插件。

## 8.5 进程执行规范

`inheritEnv:false`，只传宿主需要的最小环境与用户对此 command 明确指定的非秘密值；不把模型 API Key/OAuth token、Obsidian 内部环境传入。命令输入不得包含 secretRef 的自动展开。默认超时 60 秒，硬上限 300 秒；默认保留尾部 64 KiB，完整输出私有 spill 最大 4 MiB，超限停止进程并给出 output_limit 错误。

执行前保存 intent；native tool 的默认无限 timeout 被包装器覆盖。标准输出先按已知 secret 值脱敏再截断；返回码非零标 failed，保留真实部分输出。取消必须传给实际进程；子进程组清理按平台测试，超时无法证明整个树退出时标 `cleanup_incomplete`，不声称所有进程已死。

一律 `replay:unsafe`。crash 后 shell 结果未知，用户检查后才可以新建请求重做，不能“自动重试失败工具”。环境清理/执行许可的测试必须独立于 Pi 自带工具测试。

## 8.6 Obsidian 命令

`obsidian_action` 采用宿主固定注册表：open_note、reveal_note、get_selection、replace_selection、create_note 等明确公共 API 操作。UI 可以显示为命令，但模型不能把任意 commandId 传给 `app.commands`。后者不能被假定为稳定公共 API，也可能执行第三方任意代码。

已有项目确需保留的 commandId 功能须在兼容适配器内做 capability 检测、固定白名单、效果声明和每次确认；不在白名单返回 unsupported。不能把“调用 Obsidian API”视为任何插件命令都安全。

具体等待、原生写预览、请求归属和凭据竞态算法见 [17 · 固定实现算法](17-algorithm-recipes.md)。
