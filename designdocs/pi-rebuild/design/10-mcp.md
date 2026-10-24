# 10 · 原生 MCP 集成

## 10.1 选择

直接使用 `@earendil-works/pi-mcp` 的公开客户端和传输。协议解析、请求关联、取消与 OAuth 不自己重写。MCP 是独立包，不表示它会自动接到 Durable；本项目实现一个 Durable ToolRegistration adapter。[P10]

参考 pi-web 的连接测试、环境清洗、配置指纹和脱敏方案，不复制其 Coding Agent 私有接口或 Next 服务。[W02,W03]

## 10.2 配置与设置 UI

新增 MCP 面板（不改聊天主体），支持 serverId、displayName、scope(global-this-vault/project)、enabled、transport、超时、tool exposure、凭据引用和信任状态。

HTTP 配置：url、headerSecretRefs、oauth 设置。stdio：绝对 commandPath、args[]、绝对 cwd、最小 env 的显式键值/secretRef。每个配置存 revision 和 SHA-256 fingerprint。拒绝 `!command`、`${SHELL...}` 命令求值、自动 npx/uv 下载、相对可执行文件与隐式 PATH 查找。

用户从笔记或导入文件添加配置后，先显示差异，不能自动启用/连接新 server。server 返回的 instructions/description 是不可信外部文本，不能修改权限或系统策略。

## 10.3 连接管理

`McpManager` 的 key = vaultKey + rootId + scopeId + fingerprint。状态 idle/connecting/connected/auth_required/error/closing/closed。相同 key 并发 connect 合并为同一 Promise；失败清理后下一次可重试。连接时 freeze config，本次 call 不受用户编辑半途混合影响；配置修改取消旧待授权请求并下轮建立新连接。

默认 lazy connect，只在用户测试或任务实际需要该 server 时连接。工具目录可缓存非秘密信息，过期/重连后重新 listTools；分页直到结束或总数 500，超限显示明确限制，不把不完整结果称完整。tool-list-change 使 catalog version 变化，已显示审批的 schema 改变后作废。

引用计数归零即关闭；插件卸载关闭全部。连接失败不得阻止本地 Vault 工具继续工作。不要用全局跨 Vault 连接缓存共享 roots 或 token。

## 10.4 Test 按钮

单请求 15 秒，总测试 20 秒，关闭等待 2 秒。同一 fingerprint 测试点击合并，用户取消释放 waiter；最后一个 waiter 取消即停止真正测试。测试只 connect/list/close，不调用有副作用工具。

输出真实状态、server info、capabilities、工具数/样本、耗时、错误和脱敏 stderr 尾部。先脱敏再截断，error/stderr 各不超过 2000 字符，工具列表最多 500 项。[W02] 不把 shell 配置命令当测试准备步骤执行。

## 10.5 工具注册

工具内部名按 `mcp_<serverSlug>_<toolSlug>_<hash12>` 生成，限制 64 个 ASCII 字符；hash 输入完整 serverId + 原 toolName。维护双向映射，不靠截断后的名字反推目标。冲突测试含同名、多语言、超长名字和标点。

参数 schema 必须是 object，properties 缺失补空对象，其他关键约束保留；schema 深度<=20、序列化<=64 KiB。遇到不支持的 schema 明确禁用该工具并显示原因，不能 `any` 或删所有 required 后继续。

Durable execute(args,api,context) 调 client.callTool，并转成 `output:toLlmContent(result)`、`isError`、安全 details；structuredContent 若要供 UI/历史保留，明确写 details，不假定 structuredOutput 会自动持久化。图片和二进制使用单条结果 2 MiB/可控数量限制，模型不支持的类型以带原因占位；原始秘密不进 output。

进度通知映射到 tool_execution_update，关联服务器请求与 host toolCallId。取消 context 必须传入 callTool；收到服务端 isError=true 是工具失败，不是成功的文本输出。

## 10.6 暴露方式

支持 direct、deferred、hidden 三种。direct 初始最多 40 个，超过引导 deferred；deferred 使用 Durable 的公开 tool-search 扩展，只把匹配集合加入本会话 modelTools；hidden 不提供给模型也不能被嵌套调用。不要把“从 modelTools 隐藏”误当禁止执行。

本次不启用任意 code-mode 脚本。它不是当前聊天渲染必需能力，避免扩大任意代码入口。日后启用仍要全部 nested calls 经过同一策略，不得直接给脚本 McpClient。

## 10.7 授权与边界

协议的 roots 是告知，不是文件访问隔离；readOnlyHint 不是安全证明。每个 server/tool 有本地宿主确定的风险记录。未知 effects 一律 per-call，plan/只读子代理中拒绝。已知能访问 Vault 的本地 filesystem MCP 不启用，其功能使用 Vault API 工具替代，不能借 MCP 绕路。

HTTP 远程服务默认不会访问本机文件，但可能改变远端数据/外泄内容，仍需授权其网络目标和操作。stdio 是不透明本地进程，strict 模式不启动；trusted_host 经独立风险确认和配置授权启用，明确不是沙盒。远端或本地服务器能够做什么，不能由工具名 alone 推断。

MCP call 的恢复默认 unsafe，只有服务商明确支持 idempotencyKey 且 adapter 保存实际契约的特定工具，才能后续单独升级 safe。HTTP 流恢复不等于有副作用 call 可以重发。

## 10.8 OAuth

使用 `pi-mcp/oauth` 的 McpOAuthProvider、adaptOAuthProvider、authorizeMcp、OAuthCallbackServer。浏览器由宿主打开，回调监听只绑定 loopback，校验 state/PKCE，10 分钟超时，取消后关闭监听。UI 显示目标域名与 scope，所有 token 存 Keychain secretRef。

并发 401 共享一次 refresh；signOut 提升 credentialGeneration，迟到的刷新/登录回调不能把 token 写回已退出的账户。配置 origin 改变必须重新授权，旧 token 不转发。与模型 CredentialStore 分开命名空间。

## 10.9 协议范围与核心安装承诺

依据 pi-mcp 1.3.0 支持面实现 Streamable HTTP、stdio、工具列表/调用、progress/cancel、OAuth。legacy HTTP+SSE、sampling、task 协议不伪装已支持；返回明确 unsupported。server 请求客户端主动执行不受支持功能时拒绝，不转为任意模型调用。

核心使用及 HTTP MCP 无外部安装。可选 stdio 的程序依赖由用户提供，插件不自动安装 npm/Node/uv，不将其检测作为插件启动前置条件。
