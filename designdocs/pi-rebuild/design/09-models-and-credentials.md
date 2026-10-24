# 09 · 模型、凭据、网络与运行预算

## 9.1 模型不是后端品牌

最终 engineId 固定 `pi`。用户的 provider/model 配置仍有多个实例；模型选择项保存稳定 configuredModelId，映射为 `{providerInstanceId, upstreamModelId, api, baseUrl, capabilities, contextWindow, costRates?}`。两个使用相同 upstream 名字但不同端点的实例不是同一凭据域。

复用已有模型选择组件、Provider 配置和 Keychain，不再调用 Claude/Codex/OpenCode 探测进程拿模型列表。使用 `createModels` + 单独 provider 工厂；自定义端点用 Pi AI 公开 createProvider。启动只读本地目录与已保存选择，刷新模型是明确动作，不自动把全部 Vault 发给测试请求。[P09,V14]

## 9.2 初始支持集合

提供 Anthropic Messages、OpenAI Responses、OpenAI-compatible Chat Completions、Google Gemini 四类协议工厂。其他既有模型配置按其实际协议归入上述类型，不把未知名称猜为 OpenAI。无法映射的旧配置保留并标“需选择协议”，不能删除或默默换供应商。

能力校验：chat + tool calling 必须，images/thinking 根据模型支持。自定义模型允许用户声明 contextWindow 与 reasoning levels，但测试连接不代表所有能力均验证；结果分别记录。不支持 reasoning 的模型不显示无效 effort 选项。

## 9.3 凭据适配

实现 Pi AI 的 CredentialStore 公共接口 `read/list/modify/delete`，落到现有 KeychainService。`modify` 在 provider 实例范围串行化读改写，支持 OAuth 刷新原子替换；list 只返回非秘密 metadata，不读取 token、不执行配置命令。[P09,V14]

Models 默认可能读取环境或其他 ambient credentials；本产品显式禁止隐式回退。每个提供者调用先检查对应插件配置凭据，缺失直接 CREDENTIAL_REQUIRED；“无密钥的本地端点”是明确 authMode，不以空字符串绕过检查。不得在测试失败后换用用户环境变量里的别的 key。

SecretStorage 不可用时明确提示支持版本/宿主能力，禁止写 data.json 明文。API Key 只存 keychainId 引用，秘密按请求注入；不得放入 Durable agent instructions、工具参数或插件 debug trace。

## 9.4 ProviderGuard（硬边界）

在每个提供者 `stream/streamSimple` 的实际分发前包装检查：当前 root/run 仍有效、未取消、scope和 endpoint 指纹一致、凭据可用、允许的协议、预算许可。被拒绝时产出正规失败流/错误结果，**不能先建立网络请求再检查**。

预算需要异步 durable reserve 时，宿主包装流先等待 reserve commit，再创建底层 provider stream；不要对 SDK beforeRequest 抛异常寄希望于阻断。使用 Pi 公开 stream 类型/测试 provider 验证返回协议，不自行解析 SSE。所有模型生成入口，包括压缩、标题、子代理和 fan-out，经过同一 gate；额外 image/classifier 能力未实现时不得绕行调用。

禁止把 raw Models 或 provider factory 交给技能/MCP。请求失败不自动切到其他 endpoint；重定向越过授权 origin 时拒绝或移除凭据并重新确认。

## 9.5 网络传输

复用已通过的桌面流式传输路径。不能用不支持真正流式的 requestUrl 伪装 fetch Response，也不能关闭 TLS 验证。请求 AbortSignal 必须终止真实流。自定义 localhost/http 允许用户明确配置；其他端点默认 HTTPS。对 model endpoint 的内网允许属于用户明确选择，不等于工具可任意 fetch 内网地址。

新增 `web_fetch` 工具如既有 UI 有 fetch 路径，则实现独立 URL 审核、超时 30 秒、响应 1 MiB、重定向最多 3 次，每跳重验；禁止 file/data/javascript scheme，不默认读 localhost/私网/云 metadata。文本抓取不执行网页 JS，内容标为不可信资料。

## 9.6 默认预算与重试

每根 run：最多 32 次模型请求尝试（含压缩/重试/子代理），64 次工具执行，最多 3 个活跃子代理，单条模型请求超时 120 秒，整个活跃 run 15 分钟后暂停并让用户继续。等待人工审批/问题期间停止计入活跃运行时长，但绝对审批有效期仍会过期。用户可在设置调高，不能由模型修改。

SDK 内部请求重试设为 0，由 Durable 重试策略管理最多 2 次，退避基数 1 秒且尊重安全上限；只重试网络/可重试模型错误，不自动重复外部工具。不要同时启用三层重试导致实际尝试爆炸。

计数许可使用 root 级事务和稳定 attemptId，第一次发起前占用名额；崩溃重发是新实际尝试，应另计，不声称免费。软成本预算可设置 USD 上限；价格/usage 未知时显示 unknown，不自动视为 0。硬停止依据请求/工具次数与可知 token 限制；货币统计是估算，不承诺供应商最终账单准确。

到达上限：不创建下次请求，保留未完成 todo 和消息，既有 PromptOutput.stopReason 固定映射为 max_turn_requests，同时发送 run_state.stopCode=BUDGET_EXCEEDED 供UI准确显示；用户可以明确开启新run。别把上限停止写成成功 end_turn。

## 9.7 模型切换与窗口

idle 时切换，写入 Durable agent 与产品 selectedModelKey；模型不支持历史图片时提供显式转换提示，不丢弃事实记录。混合模型窗口采用本根已启用模型的最小已知 W：reserve=min(16384,floor(W/8))，keepRecent=min(20000,floor(W/4))，background=min(32768,floor(W/8))；W<8192 或未知时要求用户声明，不猜大小。

因为 1.3.0 compaction policy 是 Harness-wide，不使用不存在的 per-model modelOverrides。改变子代理模型只能使当前根 policy 更保守；需要扩大阈值等根全部 idle。上述值是本产品初始配置，不是 Pi 的性能承诺。

具体等待、原生写预览、请求归属和凭据竞态算法见 [17 · 固定实现算法](17-algorithm-recipes.md)。
