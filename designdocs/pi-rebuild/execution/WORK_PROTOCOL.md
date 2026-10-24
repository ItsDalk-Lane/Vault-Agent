# 多会话执行协议

## 唯一进度源

任务定义在 TASKS.json；运行状态在 STATE.json。任务卡和阶段说明是定义的可读视图，不在卡片里另维护一份 checkbox 完成情况。HANDOFF.md 记录当前局部上下文，不代替状态。

状态允许 todo → in_progress → done；遇阻 in_progress → blocked 或 verify_failed，修复后回 in_progress。done 必须 evidence 文件完整且 status=passed。用户已完成 P00 的状态记 accepted_user_report，不把它伪造成工具自己跑出的测试。

## 开始任务

读取 root AGENTS、本包 START、STATE 和 HANDOFF。检查 git status --short 与最近 commit。不做 git clean/reset，不覆盖未提交工作。若指定任务已经 in_progress，先看差异和 evidence 草稿继续它；不要把一半实现丢掉重新做。

所有依赖必须 done（或明确的 accepted_user_report P00）。每次只领取一个任务；前一任务的证据与交接写完才能领取下一项。大任务卡若仍超过一次会话，不扩大 scope；保存中间状态，下次继续同一 ID。

实现前先打开卡片列出的真实代码，不凭历史对话假设文件内容。工作树与固定基线不一致时登记到 BASELINE.md；保留已有 PoC 和新代码，按实际类型适配，不要求回退到 c2a7ef5。

## 实现规则

每个任务先补失败测试，再实现，再回归。不得把未完成行为设为默认成功、硬编码 UI数据、吞掉异常或用any绕开类型。安全规则冲突时 fail closed，并记录具体边界，不自改设计。

仓库要求 issue-linked comments/tests 时，用用户项目中的真实 issue。没有 issue，先记录需要创建的真实跟踪项；只有执行环境有写授权时才能创建。不可用“example/issues/123”充数。本包不预先捏造 issue ID，也不要求没有外部写权限时擅自发布内容。

`npm run dev` 禁止。普通验证使用 `npm test -- --runInBand --runTestsByPath <相关测试>`；指定集成门槛执行 build/lint。单独执行测试0个匹配不算通过。新增 UI 状态需要相邻 story 和实际 gallery 检查。

## 完成与交接

写 execution/evidence/TASK-ID.json：实际命令、cwd、退出码、测试数、对应文件/场景、未执行项、摘要。任何未通过的必需项目使状态 verify_failed，不能写 done。git commit 可按项目工作方式执行；没有提交就保留 null，不编造 SHA。

更新 STATE 的任务状态、updatedAt、currentTaskId、nextTaskId。更新 HANDOFF：已完成、目前差异、下一步精确操作、已运行命令、尚缺证据、风险。执行 check-plan.mjs，再结束会话。该脚本不会替你执行npm测试。

## 阶段门槛

阶段全部任务完成后，执行 phases 文件列出的真实演示。写 evidence/GATE-Pxx.json，包含通过条件与失败项。未通过则暂停下一阶段；不靠“后面再补”越过数据安全和核心交互缺口。

## 阻塞处理

SDK不存在的API、无法复现的旧格式、缺真实平台、未获得安全所需用户选择，均记录 blocker。允许继续**独立且依赖已完成**的任务；本包默认顺序保守，变更顺序写DECISIONS记录。不能隐藏能力、降低权限或新增外部CLI当作临时修复。

## 自动执行与人工控制

编程工具可连续执行已经授权的代码编辑和测试，但不能自动发布插件、推送强制覆盖、上传私密笔记、删除旧存储或创建外部帐号。发布/外部上传遵守项目和工具的确认规则。任务执行是开发过程，不是插件产品需要用户安装Node。
