# 从这里开始

## 给项目负责人的使用方式

把整个目录放进仓库的 `designdocs/pi-rebuild/`。此路径是文档的推荐位置，生产代码路径仍相对于仓库根目录。不要将执行包里的 `contracts/` 整目录盲目复制到 `src/`；按任务逐项实现。

给编程 AI 的第一条消息使用 `execution/prompts/START.md`。后续会话使用 `execution/prompts/RESUME.md`。任务中已有确定方案，不需要重新选框架、重新比较 Durable 与 Core 或重新讨论单插件目标。

## 每次会话固定顺序

1. 读取仓库根 `AGENTS.md` 与 `src/agentMode/AGENTS.md`，再读本包 `execution/WORK_PROTOCOL.md`。
2. 读取 `execution/STATE.json`、`execution/HANDOFF.md` 和当前任务卡。
3. 检查工作树差异。保留用户和上一会话的改动；不能 `git reset --hard`、`git clean` 或批量回退。
4. 仅阅读任务卡列出的设计、基线文件及其必要类型。依赖没完成就不能越过。
5. 修改前补失败测试；完成实现后运行任务测试。运行成功与“代码看起来正确”不同。
6. 写证据、更新状态和交接；会话结束前执行本包检查器。

在仓库根运行：

```sh
node designdocs/pi-rebuild/scripts/next-task.mjs
node designdocs/pi-rebuild/scripts/check-plan.mjs
```

检查器只检查执行文档一致性，不替代生产代码测试。

## 禁止自行改变的决定

唯一 Durable 循环；Pi 1.3.0；保留旧记录；真实能力覆盖；无 CLI 核心依赖；Keychain；确定性权限；不把壳命令当沙盒；不把模型上下文快照当完整聊天记录。

遇到无法实现的 API，不得发明同名方法、导入私有 dist 文件或加 `any` 绕过编译。先对照 `design/03-sdk-boundary.md` 和固定源码。接口确实不支持时，将任务标为 blocked，记录编译/源码证据及最小变更建议；不能把对应功能改成假数据或静默移除。

## 首个执行任务

P00 已由用户验收。领取 `P01-T01`：登记当前工作树与通过的 PoC 证据位置，建立迁移基线。不重复实验，不要求用户重新安装任何 CLI。
