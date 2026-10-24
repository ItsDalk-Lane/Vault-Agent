# 07 · Vault 工具、写入事务与 Diff

## 7.1 固定工具集合

所有工具用 TypeBox object schema，additionalProperties=false；所有文本长度/数组数量有上限。App 从构造参数注入，禁用 global app。每次执行重新通过 PathResolver，MetadataCache 仅用于检索候选，读文件以 Vault API 为准。

| 名称                         | 输入核心字段                     | 实现与返回                                                        |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `vault_list`                 | folder?,limit<=200,cursor?       | Vault 获取 Markdown 文件、排序分页；不遍历配置目录                |
| `vault_search`               | query,folder?,limit<=100,cursor? | 关键词/标签/标题检索；正文按需分批 read；返回路径、命中片段与范围 |
| `vault_read`                 | path,startLine>=1,lineCount<=400 | Vault.read，返回内容、范围、总行数与 SHA-256；单次最多 64 KiB     |
| `vault_links`                | path,direction in/out/both       | MetadataCache resolvedLinks + 缺失链接提示；不假定索引实时        |
| `vault_create`               | path,content                     | Vault.create；已存在返回冲突，不覆盖                              |
| `vault_edit`                 | path,expectedHash,edits[]        | 精确 patch；先唯一匹配/行范围校验，产生 proposedContent，再 CAS   |
| `vault_frontmatter`          | path,expectedHash,set?,remove?   | 生成可预览的新 Markdown，再 Vault.process CAS；见下文选择         |
| `vault_rename`               | path,newPath,expectedHash        | FileManager.renameFile；更新链接的效果另行收集/披露               |
| `vault_trash`                | path,expectedHash                | FileManager.trashFile 或宿主支持的回收 API；不永久删除            |
| `obsidian_open_note`         | path,line?                       | workspace.getLeaf/openFile；位置参数校验                          |
| `obsidian_get_selection`     | 无或显式 leaf 标识               | 当前 MarkdownView.editor.getSelection；不跨窗口猜活跃 App         |
| `obsidian_replace_selection` | selectionToken,text              | 先固定 selectionToken，再 editor.transaction/replaceRange；见 7.6 |
| `obsidian_action`            | action 枚举、结构化参数          | 仅宿主注册的公共 API 动作，不接受任意 JS 或任意 commandId         |

搜索实现不调用 rg/grep/CLI。初版无向量数据库依赖；确定性关键词搜索已经是真实功能，不以“之后接 RAG”作为占位。缓存以 Vault create/modify/rename/delete 事件失效，缓存失效不能触发后台全库上传。

## 7.2 精确编辑协议

edits 为 `[{oldText,newText,occurrence?}]` 或受控行段之一，首版只实现 oldText/newText，避免两套算法。oldText 非空，默认必须唯一出现；0 次和多次均拒绝，除非 occurrence 是用户请求所需明确整数。多 patch 基于同一 before 内容计算，先检验不重叠，再从后向前应用。

读 → 准备 proposedContent → 固定 before/after hash → 权限/完整 Diff → 获批 → 获取路径锁 → Vault.process 回调对当前内容重新 SHA-256 比对 → 返回 proposedContent。回调同步，不 await，不调用网络或 UI。hash 不符抛 `STALE_BASELINE`，无写入，重读后展示新 Diff，原批准不可复用。

默认单文件输入最多 1 MiB，单次 edits<=50，新内容最多 2 MiB；超限返回引导分段修改。不得静默截断后写回。Unicode 用 UTF-8 哈希，不按显示字符数猜字节大小。

## 7.3 Frontmatter 的确定选择

这里**不让实现 AI 在两个写入方案之间选择**：用户可审批的 `vault_frontmatter` 走同一全文 CAS 路径。用 Obsidian 公开 `parseYaml/stringifyYaml` 处理 frontmatter，保留正文原样；只支持 JSON 可表示的值和显式 set/remove，不执行 YAML 标签。序列化会改变 YAML 格式时，完整 proposed Diff 必须显示，不能隐藏注释/格式变化。

选择原因是保证“用户批准的全文 = 实际提交的全文”，避免先弹全文 Diff、随后 `processFrontMatter` 基于已经改变的内容再次序列化。已有插件自身的非 Agent frontmatter 帮助函数仍可保持 processFrontMatter；本任务不改它们。后续要保留 YAML 注释可单独替换解析器，但不能绕过相同 CAS/审批。

## 7.4 MutationCoordinator

负责路径锁、intent/receipt 与 diff。状态固定：prepared → awaiting_approval → approved → applying → committed；分支 rejected/cancelled/stale/failed/effect_unknown/needs_reconciliation。

锁在批准后短暂持有；多路径按 canonicalPath 排序获取，避免死锁。一个 Vault 共享锁池，涵盖主会话、子代理、fan-out 后续修改和回滚。它只协调插件自身写入，用户编辑器/同步器仍可能修改，必须 CAS。

保存 before/after 内容为私有 content-addressed blob；账本保存 hash、blobRef、实际目标、operationId、权限摘要。blobs 在 intent 前写好并 flush，写错则不开始操作。写完成但 receipt 失败：显示 effect_unknown，不能说未发生任何修改。

工具结果 `details` 存安全 MutationReceipt。文件卡使用实际已提交变更，不使用模型声称的“已修改”。原 `originalFiles` 可作为兼容输入，但不用它另起一套写逻辑。[V03,V07]

## 7.5 重命名/删除与非原子效果

重命名必须调用 FileManager.renameFile，不能 Node fs.rename，因为 Obsidian 可能更新内部链接。操作前列出目标和 MetadataCache 能找到的入链候选，读取候选基线，Diff 预览明确“可能更新引用”。任何会影响系统目录的移动拒绝。首版仅单文件重命名/移动，不做目录递归移动。

FileManager 操作与链接更新不是本项目数据库事务。操作期间收集 Vault 事件并在完成后读取相关文件；只将可归因于此次 rename 的变化入账。并发编辑使归因不明时记录 `unattributedChanges`，显示需人工核对，不把用户编辑算成 Agent 修改。失败可能有部分效果，写 `partial` 结果，不自动反向批量覆盖。

删除使用回收站，不承诺可在所有系统自动还原。已删除且 crash 未记 receipt，恢复先检查状态；不再次删除碰巧在相同路径出现的新文件。删除/rename `replay:unsafe`，需要人工对账。

## 7.6 编辑器未落盘内容

当前选区操作使用 `SelectionSnapshot`：leaf 身份、文件路径、完整 editor 文本 hash、起止位置、选区 hash、时间。审批后重新获取同一视图并比较全部身份/版本，失效则返回 `SELECTION_CHANGED`。文件关闭、切换或 popout 消失不转为写当前文件。

普通文件工具发现同路径活动编辑器内容与 Vault.read 不同，返回 `OPEN_BUFFER_CONFLICT`，引导用户保存或使用选区工具；禁止对磁盘写入覆盖未保存 buffer。无需假设存在某个未公开强制保存 API。

## 7.7 回滚

回滚是新的经批准 mutation，不能直接把 before 内容 fs.writeFile 回去。当前内容 hash 必须等于 receipt.afterHash；否则冲突，展示当前 vs 当时变更，不自动覆盖。创建的回滚通过回收 API；删除的恢复只在能拿到备份且目标不存在时经确认创建。rename 多文件副作用只对明确已归因且 hash 全部匹配的文件执行补偿；任一不匹配停止并列出，不能伪造原子回滚。

## 7.8 输出与错误

每项工具返回机器可识别 code、用户可读说明和可选恢复建议。读取结果有截断标志与下一段信息。binary/图片由 Vault.readBinary，受 MIME/大小限制；模型不支持图片时给明确占位，不把二进制误当 UTF-8。配置目录、插件 state、Keychain 文件不通过附件工具泄漏。

验收必须覆盖：已存在创建、多匹配编辑、审批期间用户编辑、同步器冲突、跨会话修改、停止时写已完成、无效选区、重命名并发、回滚冲突和 crash 后对账。
