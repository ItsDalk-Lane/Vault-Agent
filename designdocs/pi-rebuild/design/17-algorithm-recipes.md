# 17 · 容易出错的实现步骤：固定算法

本节补足上游没有替本产品决定的算法。这里的名字是宿主自有 helper，不是额外宣称 Pi 存在同名 API。

## A. 避免审批/提问等待丢唤醒

实现一个每 root 的 `DecisionCoordinator`，所有本产品审批和回答写入都经过它。使用短串行队列处理“读决定/注册waiter/提交决定/发布决定”，但等待用户的Promise必须在队列外等待。

1. 用稳定 requestId 在 Durable 文档里读现有请求；没有才同提交创建。
2. 在协调器串行区读取最新决定：已终结直接返回；pending 则登记 waiter。
3. 登记完成立即重新读一次决定。发现并发提交已经结束就立即移除并完成 waiter；不能等一个永远不会再来的通知。
4. UI 决定先 durable commit，再发布宿主通知；commit 失败不唤醒为approved。
5. signal取消将 waiter 移除；用户Stop另行提交 cancelled。observer关闭只是detach，不改请求决定。
6. 重启后waiter不存在，但文档存在。工具安全重入先读决定，再走同一协议；不能把内存Promise当状态权威。

没有必要寻找并不存在的 `harness.waitForPermission()`。UI现有回调返回后仍要经过文档提交。所有带批准语义的写通道必须统一，不允许另一个组件直接把待办状态当授权。

## B. 原生工具的写预览不能只根据args猜

Pi edit内部会计算新内容。外层ToolGateway先做参数/工具族/范围/模式审查，但还不能批准未确定的最终字节。GuardedExternalEnv按 invocation 建立 `ReadSet`，记录原生算法实际读取过的文件hash。

当原生工具调用环境的写方法时，拦住该调用，取得它准备写的确切字节；与ReadSet基线/新文件不存在状态组成 MutationPlan。此时生成Diff并申请唯一一次具体写审批。获批后重验范围/取消/当前hash，再实际写并记receipt。

先前外层的scope授权不等于这个write批准。执行环境不能在工具准备阶段直接调用未包装的fs.write。这个设计复用官方算法，但副作用与审批仍归插件。外部文件写默认unsafe恢复；本插件的路径锁不等于能阻止其他程序编辑外部文件，因此对可能的外部竞态显示冲突/未知，不宣传OS原子CAS。

## C. ProviderGuard怎样知道请求属于哪个run

每个根Harness独立拥有自己的guarded Models集合。Host保存 `providerSessionId → conversationId → parentRunId` 的映射；providerSessionId取Durable已提交的pi.provider状态，不由模型参数提供。创建/重开子会话时恢复该映射，缺映射在请求前fail closed。

根用户输入创建va.run；子会话在同一创建提交中绑定parentRunId。后台child继续属于原run，后续用户新run不能把旧child的费用/取消epoch串到新run。压缩沿目标conversation映射，标题本方案默认本地生成所以没有无归属模型请求。

每次实际provider分发创建attemptId并提交预算reserve；包装流在reserve成功前不创建底层网络流。自动重试产生新的实际attempt，重新计数；task重放发现同attempt已经有已知结果则不能多次计入。没有依据证明请求未发送的崩溃，成本标unknown，不伪称未计费。

## D. 凭据刷新锁与原有API Key兼容

API Key原记录仍是原keychainId中的字符串。CredentialStore.read根据provider authMode把它包装成Pi Credential，不把原条目改为JSON导致旧设置读坏。OAuth使用独立keychainId存JSON envelope，包含版本、type、token和generation。

进程内modify按provider实例串行；同设备跨进程刷新再用私有路径 `credentials/<providerHash>/lease`，复用StoreLease的保守所有权规则。锁内读当前envelope→确认generation→执行刷新→写回；signOut同样取得锁并推进generation。刷新网络超时有界；不因等待超过几秒偷锁。list不触发刷新或读秘密。

同Vault多个root共享CredentialStore和该锁；不同Vault不混用provider id。过期凭据刷新失败必须保留可重新登录状态，不回退环境变量或另一账户key。

## E. 显示用量去重

维护 `lastUsageByConversationId`。SDK usage_changed是当前累计快照；新值覆盖旧值，根合计按所有conversation当前值计算，不每收到事件就加一遍。相同snapshot回放合计不变。

nested tool的usage由SDK相应层计入，不在父结果再加一次。unknown价目/usage标记向根合计传播；known部分可展示，但总价标“不完整估计”。预算尝试计数与供应商usage分开，避免错误流无usage时系统认为没有发生调用。

## F. Vault路径与Pi cwd不得混用

BackendProcess的OpenSessionInput.cwd是旧产品的Vault工作范围，不直接复制为原生工具执行目录。Vault工具通过注入App和scope访问；Pi原生工具环境的cwd只来自已批准externalRoot，没有时native路径能力等待授权。

子代理继承缩减后的externalScope，不因为profile的instructions写了一个目录就改变env.cwd。MCP roots另由scope生成，不能据它推断本地已沙盒隔离。

## G. 完整历史合并的稳定顺序

显示层保存 committed entries 的不可变ID和SDK返回的历史顺序。不能假定用字符串字典序排序所有entryId永远等于正确fork历史；使用entries()分页顺序与明确新增提交顺序建立order map。重复ID只更新已知终态不追加。

snapshot给active subset，不改变archive map。若active snapshot包含未见entry，先插入待补全映射，再按完整历史页校准顺序；未准备好时显示加载状态，不将祖先历史丢掉。旧observer以epoch判过期；本地frameIndex仅传输顺序，不作为持久化ID。

## H. 初始运行参数

progress.partialIntervalMs=100、progress.outputIntervalMs=100；这两个数是本产品合并UI更新的初值，不是上游默认值或性能承诺。存储commit失败不继续输出假持久化成功。

根活跃时长只在至少一个实际模型请求/工具在运行时累计；所有工作都等用户时暂停，子代理仍运行则不暂停。用测试注入clock计算时间段并集合，不能简单为每个child累加墙钟后导致并发三倍计时。
