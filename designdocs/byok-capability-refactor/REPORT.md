# BYOK 能力与配置界面验收记录

本次改造保留已有供应商、密钥和单模型显示状态。配置先留在草稿中，保存才统一应用；取消不保存。不能真实发送的 PDF、视频和原生联网搜索明确禁用。

## 1. 关联记录

- 主任务：https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
- PDF / 视频转换：https://github.com/ItsDalk-Lane/Vault-Agent/issues/3
- 原生联网搜索：https://github.com/ItsDalk-Lane/Vault-Agent/issues/4
- 旧 CORS 字段与旧桥接清理：https://github.com/ItsDalk-Lane/Vault-Agent/issues/5

未提交、推送、发布；未修改 AI 提示词或 RELEASES.md。保留任务开始时已有的大量未提交改动。

## 2. 改动文件（按里程碑）

### M1：供应商能力和地址

- `src/utils/providerCapability.ts`；`src/modelManagement/catalog/providerCapability.ts`（模块入口）及相邻测试。
- `catalogTransform.ts` / 测试、`CatalogDownloadService.ts` / 测试、`types/catalog.ts`、`types/runtime.ts`、模块 `index.ts`。
- `AddProviderDialog.tsx` / 测试 / stories；`ByokPanel.tsx` / 测试；`setup/AgentSetupApi.ts`。
- 三个供应商 adapter、Google adapter 测试和新增 `ProviderAdapterRegistry.test.ts`：四格式字段可通过真实校验，Google 地址不会重复版本段。

### M2 / M6：界面、双语与文档

- `ConfigureProviderDialog.tsx` / 测试：保留 Obsidian 外壳，装配目录、受保护密钥、保存验证和移除确认。
- 新增 `ConfigureProviderEditor.tsx` / 测试 / stories：面板、模型卡片、浮层、提示与键盘交互。
- 新增 `providerDraft.ts` / 测试：token 解析、草稿、声明合并和推理等级排序；保存明确记录未勾选为 false，防止 SDK 默认值悄悄重新开启能力。
- 新增 `providerModalKeyboard.ts` / 测试：在 Obsidian 原生快捷键层先关闭帮助、下拉、模型选择或推理输入，避免 Esc 误关整个草稿。
- `components/ui/password-input.tsx` / 测试 / 新 stories：可访问名称、等宽输入和键盘显隐。
- `ByokGlobalTable.tsx` / 测试 / 新 stories：保留停用供应商的编辑入口并显示状态。
- `src/i18n/messages/{en,zh-cn}/sharedUi.ts`；`docs/settings.md`；`TODO.md`。
- 删除本次替换后已无产品调用的 `useModelCandidatePool.ts`、`ModelChecklist` 与 `CorsCompatibilitySetting`；同时移除这两个已不存在组件的专项测试和 stories。它们原有测试通过后才清理；现有仍适用的测试未删以绕过失败，新交互由新组件测试覆盖。

### M3 / M4：声明事实与真实请求

- `sdk/pi/models/DeclaredModelCapabilities.ts` / 测试：同步能力查询及别名。
- 新增 `DeclaredPiModelFacts.ts`、`generateDeclaredModels.mjs`、`declaredPiModels.generated.ts`、`declaredPiModelsContract.test.ts`：从锁定 SDK 的公开入口自动提取 42 家、1614 个模型的必要事实，并全量对账。
- `ModelRequestCapabilities.ts` / 测试、`ProviderFactory.ts`、`ModelCatalog.ts` / 测试、`ModelRuntime.test.ts`、`ModelSelection.test.ts`。
- `runtime/PiRuntimeModels.ts` / 测试、`testing/modelCapabilitiesScenario.ts`、`testing/dispatchRuntimeScenario.ts`。
- `agentMode/index.ts` / 相关测试、`main.ts`、`createModelManagement.ts`：SDK → barrel → 主插件 → 注入，模型管理不导入 SDK。
- `components/ui/ModelEffortPicker.test.tsx`；`scripts/pi-runtime-fixture.mjs`；`package.json`（生成步骤及样式扫描范围，无新增依赖）；`tailwind.config.js`：排除不含界面的生成事实表与打包产物，原始界面文件仍完整扫描。

### M5：统一保存与开关

- `utils/providerAvailability.ts`；模型管理模块转出入口 / 测试。
- `ProviderRegistry.ts` / 测试、`ByokSetupApi.ts` / 测试、`types/persisted.ts`。
- `BackendConfigRegistry.ts` / 测试、`state/atoms.ts` / 测试。
- `settings/v2/components/configuredModelGrouping.ts` / 测试、两个模型列表组件的 mock 补全。
- 为下列旧运行场景的测试夹具补入明确的假地址，替代已禁止的隐式主机兜底；已有明确地址不改，测试仍使用假供应商：

- `src/agentMode/sdk/pi/testing/compactionRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/fanoutRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/streamFailureRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/skillsRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/poolRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/backgroundReportRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/nativeMutationFailureRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/mutationFailureRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/recoveryRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/nativeRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/selectionMutationRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/productionRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/compactionBoundaryRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/mcpRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/interactionBoundaryRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/subagentRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/rolloverRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/initializationRuntimeScenario.ts`
- `src/agentMode/sdk/pi/testing/mcpDisconnectRuntimeScenario.ts`

## 3. 设计稿逐项对照

| 项目                                                | 结果                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| 标题、副标题、线性图标、可编辑供应商名称            | 已实现；语义颜色同时适配亮暗主题                                                 |
| Base URL、密码显隐、四项非原生 API 下拉             | 已实现；外点 / Esc 收起，对勾和提示真实更新                                      |
| 底部保存 / 取消 / 编辑态移除 / 供应商启用           | 已实现；这是需求明确增加、原设计稿没有的底部区                                   |
| 模型头部、上下文和视觉标签、固定四控件顺序          | 已实现；显示 / 删除 / 检查 / 折叠独立操作                                        |
| 添加并聚焦、折叠、输入同步、K/M 解析和内联错误      | 已实现；保留原数字精度，不把输入四舍五入                                         |
| 删除淡出、无动画时删除、动画期间禁存                | 已实现；等待实际动画结束，不用固定延时假等候                                     |
| 文本必选、图片、多选能力                            | 已实现；输入只保留真正可发送的 text / image                                      |
| 视频 / PDF / 原生联网搜索                           | 禁用并说明原因，见后续 issue；不显示已启用标签                                   |
| 推理等级多选、自定义、重名、删除、聊天列表          | 已实现；默认等级由协议真实支持范围约束                                           |
| Google max / 自定义等级；未声明 max 的 Anthropic    | 禁用或过滤：当前 SDK 无法保证对应请求真实生效                                    |
| 帮助气泡、下方箭头、视口边界、Esc                   | 已实现；修复首次点击时浮层落在模态遮罩后方的问题                                 |
| 获取模型弹窗、真实获取、搜索 / 全选 / 已添加 / 数量 | 已实现；失败 / 重试 / 加载、打开重置、焦点与关闭路径均覆盖                       |
| 底部居中状态提示，约 2.2 秒及卸载清理               | 已实现，带 status / aria-live                                                    |
| 小面板输入堆叠、标签换行、底部操作区常驻            | 已实现；按容器宽度响应，组件预览也能复现                                         |
| CORS 控件 / 高级区 / Bedrock 选项                   | 均不出现；旧 CORS 持久化值保留                                                   |
| API 格式切换后自动改地址                            | 原生默认地址可以更新；第三方主机及手填地址保留，避免把第三方密钥转发到另一家公司 |
| 无地址的目录项                                      | 按“未知即隐藏”和验收 1 隐藏；自定义入口仍可手填。这是冲突条款的明确裁决          |

## 4. 能力真实性证明

| UI 项          | 证据                                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文本           | `modelCapabilitiesScenario` 的 `text_reaches_payload_with_images_enabled_or_disabled`；始终进入实际 SDK 请求                                                                |
| 图片           | `image_declaration_drives_attachment_rejection_and_payload`：声明关闭时附件入口拒绝，开启时原始图片字节进入请求                                                             |
| 视频           | 禁用；当前没有抽帧、资源限额与恢复记录的完整链路，issue #3                                                                                                                  |
| PDF            | 禁用；当前没有文本提取 / 扫描页渲染与恢复记录的完整链路，issue #3                                                                                                           |
| 结构化输出     | `strict_schema_payload_on_and_off`：Chat Completions / Responses / Anthropic 工具严格 schema 参数受开关控制；不强迫普通文字回答变成 JSON                                    |
| 原生联网搜索   | 禁用；锁定 Pi 公共契约无原生搜索透传入口，issue #4；未拿普通搜索工具冒充                                                                                                    |
| 对话中系统消息 | `native_mid_conversation_system_messages_on_and_off`：同一轮中途指令在开启时以原生系统角色发送，关闭时走 SDK 兼容处理                                                       |
| 推理等级       | `ModelCatalog` / `ModelSelection` / `ModelEffortPicker` 测试；`custom_openai_effort_reaches_payload`；Claude 原生 adaptive max 的请求证明；跨协议不沿用 Google 大写 wire 值 |
| 单模型显示     | `ByokSetupApi.saveProviderDraft()`：分别写入 / 移出 chat、pi 的 enabledModels，保留模型定义                                                                                 |
| 供应商启用     | availability、registry、atoms、分组、PiRuntimeModels 测试；`provider_disabled_during_guard_denied` 证明已在进行的会话也不会继续开旧请求                                     |

运行 `node scripts/test-pi-runtime.mjs modelCapabilities`，7 份实际 SDK 请求全部通过；在生成请求内容的回调中停止，没有对外发送。它们是请求级证据，不冒充远程模型成功回应。

## 5. 视频 / PDF 最终结论

本次没有实现转换，界面明确禁用。Pi 只承载 text / image，现有附件存储和 MIME 校验只接图片；仅修改声明不会让文件送达。

最小后续方案是：PDF 有界提取文本，扫描页按需渲染图片；视频按明确时间 / 张数上限抽帧；转换产物纳入现有私有附件存储与恢复记录后，再由 text / image 请求发送。必须另行核验解析 worker 体积、Electron 视频解码、取消 / 超限 / 损坏文件和弹出窗口生命周期。未增加依赖或二进制，也没有隐藏这个未实现范围。

## 6. 供应商整体启用和旧配置

`enabled` 缺省为 true，旧数据无需迁移。关闭仅改变可用性，不删除供应商、模型或 backend 引用；重新开启恢复原单模型开关。设置页保留供应商卡片用于重新编辑，但隐藏其模型。

保存草稿时，密钥先写入受保护存储；失败则不修改三份设置。供应商、模型和两个 backend 的选择通过一次设置更新发布。密钥不进入普通设置 JSON。取消无写入，移除仍需确认。

地址读取先修复可精确识别的历史默认值（例如 MiniMax 尾部 /v1），已知默认补空；编辑时可借助同协议目录事实补空，保存才落盘。无法确定的离线旧地址明确不可用并记录，不借用 OpenAI 或其他原生主机。凭据校验也遵守这条规则。用户手填地址不被替换。

## 7. 实际验证

实际 Obsidian 仅连接现有 houde，并在部署 / 重载 / UI 操作前同时核对库名和完整路径。未创建测试库、独立 profile、用户笔记或测试聊天；没有更改已有供应商配置。

| 实际命令                                                                                 | 最终结果                                                                   |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `npm run format`                                                                         | 通过                                                                       |
| `npm run format:check`                                                                   | 通过                                                                       |
| `npm run lint`                                                                           | 0 错误；保留已有测试 mock 的两条 hook 命名警告                             |
| `npm test -- --runInBand`                                                                | 526 套 / 5872 项全部通过，95.314 秒                                        |
| `npm run build`                                                                          | 通过；由本轮 `test:vault` 执行；主文件 4,819,596 字节，低于 5,000,000 门禁 |
| `npm run review:obsidian`                                                                | 退出码 0；实际源码无阻断错误；生产依赖审计 0 漏洞；保留既有警告            |
| `node scripts/check-pi-boundaries.mjs`                                                   | 通过，1376 个文件，0 越界                                                  |
| `npm run gallery:build`                                                                  | 通过；由本轮 `test:vault` 执行                                             |
| `COPILOT_TEST_VAULT_PATH=/Users/study_superior/Desktop/Project/houde npm run test:vault` | 构建、gallery、部署与重载成功；记录包 `c2a7ef50-dirty-937901a85e98`        |
| `node scripts/test-pi-runtime.mjs modelCapabilities`                                     | 7 份真实 SDK 请求、8 项行为断言通过；在网络发送前截停                      |
| 19 个依赖明确服务地址的既有 Pi 场景                                                      | 13 个脚本场景与 6 个定向场景通过；全量单测再次通过                         |
| 真实远程 Pi 生成                                                                         | `not_run`，没有把请求构造证明写成远程回答成功                              |

Obsidian review 末尾两条 `manifest-beta.json` error 是审查器的故意失败夹具；夹具检查输出 `Obsidian review fixtures passed` 并退出 0，不属于产品源码错误。

[检查摘要](./checks.json)、[gallery 原始结果](./gallery-checks.json)、[SDK 请求检查](./request-checks.json)、[原生窗口复查](./native-window-checks.json) 随报告保存。

组件 gallery 已核验 6 个状态 × 3 种宽度（300 / 560 / 760）× 亮暗主题，共 36 项：均无横向溢出、底部可见；窄面板单列、宽面板双列；12 个嵌套弹窗状态均获得焦点。错误状态使用明确失败的 fixture，不伪造服务成功。

原生设置窗口已实测添加自定义服务、添加并聚焦模型、禁用项说明、首次帮助显示；取消后供应商 / 模型 / 后端配置摘要不变（3 家 / 8 模型）。首次原生复查暴露 Esc 会同时关闭帮助和配置，已新增原生 Scope 修复及 6 项回归测试；2026-10-23 解锁后实机复查通过：Esc 分别仅关闭帮助、四项 API 菜单、自定义推理等级输入；主配置草稿均保留。更改 API 格式后取消草稿，原有 3 家供应商 / 8 个模型及后端配置摘要仍与测试前完全一致。

补充事实：Obsidian 1.14.4 设置在独立原生窗口中，主窗口 CLI 的 document 不能代替该窗口的交互证据。此次通过原生界面另行核验。设置页自动检查显示原有 LM Studio 成功、OpenCode Go 失败，未修改这些配置。

初次完整 SDK 目录导入使包体超过门禁，已改成公开事实的自动投影并用全量契约对账，最终大小通过。gallery 样式扫描误扫打包产物导致耗时过长，已排除生成数据与产物，保留所有原始界面扫描，修复后构建通过。

## 8. 新字段、文案与后续记录

- `Provider.enabled?: boolean`：缺省启用。
- `ModelInfo.capabilities?`：`structuredOutput?`、`nativeWebSearch?`、`midConversationSystemMessages?`。
- `CatalogProvider.npm? / api?` 保留原始发现事实；`providerType?` 仅兼容旧消费者。
- `ProviderDefinition.useResponsesApi?`；`reasoningEfforts` 继续使用原有字段。
- 运行时快照另包含严格结构和中途系统消息开关，用于发现旧会话中的能力变更，不新增持久化数据格式。
- 中英文新增 73 个配置文案键完全对应（列表见后）。后续工作为 issue #3 / #4 / #5。

## 9. 限制和未覆盖项

- PDF、视频、原生搜索仍未实现，已经禁用；Google 的相关兼容开关也没有伪造支持。
- 自定义 OpenAI 推理等级会原样发给服务，服务仍必须实际支持该名称；该检查不能证明任意供应商会接受任意等级。
- 每模型连通性检查确认服务列表中是否存在 ID，不等于已经执行生成请求。
- 真实远程 Pi 模型调用为 `not_run`；远程响应、计费及各供应商当前服务状态没有在本轮验证。
- 本次没有执行 Windows / Linux 实机检查，也没有重跑与 BYOK 无关的历史跨平台验收。
- 无法离线确定地址的旧供应商需打开配置补上正确地址后保存；它不会静默切换到另一家服务。

## 10. 为什么符合长期原则

1. 协议与地址只有一份纯策略，目录只负责发现。
2. Pi 能力来自锁定 SDK 自动投影，并全量对账，避免手工维护第二份事实。
3. 四种运行时协议都有配置入口，自定义入口保留扩展空间。
4. 未分类、无主机、无实际链路的项隐藏或禁用。
5. 用户地址、密钥、已有模型定义和旧数据字段保留。
6. 开关、能力和推理等级都连接到实际选择器或请求。
7. 不新增依赖、不放宽大小 / lint / 审查边界。
8. 新 UI 使用 React、现有原语和语义颜色。

### 文案键清单

- `ui.model.providerDisabled`
- `ui.byok.title`
- `ui.byok.subtitle`
- `ui.byok.apiFormat`
- `ui.byok.formatChat`
- `ui.byok.formatResponses`
- `ui.byok.formatAnthropic`
- `ui.byok.formatGoogle`
- `ui.byok.formatChanged`
- `ui.byok.fetchModels`
- `ui.byok.addModel`
- `ui.byok.empty`
- `ui.byok.providerEnabled`
- `ui.byok.providerEnabledHelp`
- `ui.byok.unsetId`
- `ui.byok.idPlaceholder`
- `ui.byok.context`
- `ui.byok.output`
- `ui.byok.contextPlaceholder`
- `ui.byok.outputPlaceholder`
- `ui.byok.inputTypes`
- `ui.byok.text`
- `ui.byok.image`
- `ui.byok.vision`
- `ui.byok.video`
- `ui.byok.pdf`
- `ui.byok.textRequired`
- `ui.byok.inputHelp`
- `ui.byok.videoUnavailable`
- `ui.byok.pdfUnavailable`
- `ui.byok.capabilities`
- `ui.byok.structured`
- `ui.byok.webSearch`
- `ui.byok.midSystem`
- `ui.byok.capabilityHelp`
- `ui.byok.searchUnavailable`
- `ui.byok.compatUnavailable`
- `ui.byok.efforts`
- `ui.byok.effortHelp`
- `ui.byok.addEffort`
- `ui.byok.effortPlaceholder`
- `ui.byok.effortExists`
- `ui.byok.removeEffort`
- `ui.byok.modelAdded`
- `ui.byok.modelDeleted`
- `ui.byok.showModel`
- `ui.byok.modelShown`
- `ui.byok.modelHidden`
- `ui.byok.deleteModel`
- `ui.byok.testModel`
- `ui.byok.collapse`
- `ui.byok.expand`
- `ui.byok.testSuccess`
- `ui.byok.testFailed`
- `ui.byok.testUnknown`
- `ui.byok.selectTitle`
- `ui.byok.selectSubtitle`
- `ui.byok.searchModels`
- `ui.byok.selectAll`
- `ui.byok.deselectAll`
- `ui.byok.alreadyAdded`
- `ui.byok.noMatches`
- `ui.byok.addSelected`
- `ui.byok.modelsAdded`
- `ui.byok.retry`
- `ui.byok.close`
- `ui.byok.invalidId`
- `ui.byok.invalidCount`
- `ui.byok.requiredBaseUrl`
- `ui.byok.help`
- `ui.byok.add`
- `ui.byok.customEffortUnavailable`
- `ui.byok.maxEffortUnavailable`
