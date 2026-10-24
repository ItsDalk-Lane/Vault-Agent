# 13 · 技能、项目上下文、附件与网页资料

## 13.1 保留什么

保留已有技能管理界面、canonical folder、SKILL.md 解析/编辑、内置技能协调与用户开关。删除面向三个外部 Agent 的 symlink、安装目录分发和重启流程。迁移期先让 Pi 直接从 canonical store 加载，旧分发只服务临时旧后端，最终删除。[V02,V04]

## 13.2 技能不是任意代码插件

Skill 定义：skillId、name、description、sourcePath、contentHash、enabled、scope、trust。索引仅加载 metadata；用户显式选择或模型调用 `load_skill({skillId})` 时按权限读取完整指令。注册的技能不能增加工具、修改 scope、设置 auto 模式或覆盖 ToolGateway。

技能里的脚本不能直接 import/require/eval；执行脚本必须转为 host_process 请求，遵守 strict/trusted_host。安装/启用技能不是批准任意命令。第三方 skill 内容在 UI 中可查看来源和本次版本。

## 13.3 上下文组装次序

固定顺序：产品基础行为 → 当前工具说明/权限边界的解释 → 用户主动配置的系统指令 → 项目说明 → 显式选中的技能 → 当前用户输入和资料。权限仍由代码，不因最后一段要求绕过限制而改变。

资料（笔记、网页、MCP结果、旧会话、子代理报告）带 origin/path/url/time/hash 标签；工具结果仍保留工具角色，不把整段外部内容拼成 system 指令。用户主动选择可信 skill 的 instructions 可作为技能段，但它不能覆盖不可变权限策略。

每次 request 依据固定版本信息渲染 sections，避免每个 token 修改系统指令破坏缓存。指令/技能改变仅在安全边界应用；正在执行的工具使用已绑定参数和实时收紧后的政策。保存 skill hash 供恢复重验，不静默加载新内容并复用旧授权。

## 13.4 ContextProcessor 复用

继续使用原 ContextProcessor 中选择笔记/选区/项目 block 的入口，但转换结果进入新统一 UserInput。去掉“把同一会话全部历史再套 conversation_history 发一次”的重复路径：Durable 已经持有历史，只在导入旧记录时使用有来源的历史材料。

当前笔记只有用户选择/设置允许时附加；不用每次聊天自动全库扫描。默认注入资料总量 128 KiB，超过时保留清单并提示按需读取。预算依据具体模型 context，不能单凭中文字符≈token 的固定比例当精确计数。

## 13.5 附件与图片

保留现有图片持久化路径与 ChatSingleMessage 渲染。新 user entry 保存图片 MIME、blobRef 或受控 Vault 路径，读取时有范围和大小检查。对允许的 PNG/JPEG/GIF/WebP 根据模型实际能力输入；未知二进制拒绝，不以 base64 文本刷满上下文。

会话导出/迁移复制附件前校验引用目标，防目录穿越。丢失附件显示失效占位与原路径，不阻止其他文本历史加载。截图含敏感信息不自动追加诊断报告。

## 13.6 快捷输入、命令与项目切换

`/compact`、技能命令、停止、模型切换保留显式 dispatcher；不把它们全改成 LLM 自然语言指令。未知 slash command 保留可读错误，不能执行 OS 命令。

项目切换影响新的 root 会话或在 idle 时显式调整 scope。已有会话始终保留原 projectId/授权根，不能因为用户切到其他项目就让旧待审批写入新项目。配置保存失败不能 UI 先声称切换成功。
