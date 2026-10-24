# 实施工作树基线登记

分析快照：c2a7ef50539397627a6e4446283d791ad423aff6。

P00：accepted_user_report，原打包运行验证已全部通过（用户确认，本包与本次会话均未重跑）。

以下为 P01-T01 于 2026-10-21 实际核对结果，未编造：

实际当前 commit：`c2a7ef50539397627a6e4446283d791ad423aff6`（main，与 origin/main 同步；提交时间 2026-10-21 16:28:00 +0800）。该值与上面的分析快照相同。

未提交改动及归属：

- 未跟踪：`designdocs/pi-rebuild/` 整个执行包（用户于 2026-10-21 19:19 交付）。本任务只改其中 `execution/BASELINE.md`、`execution/HANDOFF.md`、`execution/STATE.json`、`execution/evidence/P01-T01.json`。
- 已忽略的本地构建产物（不入库）：仓库根 `main.js`（3,201,242 字节，2026-10-19 20:27，sha256 `a69471cccbfd5c16c1c90ba6e324455c278bc9d1d4b50041dd208f28928bc551`）与 `styles.css`（72,137 字节，2026-10-19 18:11）。
- 已跟踪文件无修改（`git diff` 为空）；无 stash、无附加 worktree、无本地分支。
- 未提交内容的归属：执行包属于用户交付材料；构建产物属于用户此前的本地构建。本任务未覆盖或回退任何一项。

PoC 代码/记录位置（均为用户已完成并确认，本任务未重跑）：

- Pi 兼容性打包/运行 PoC：`/Users/study_superior/Desktop/Code/vault-agent-pi-spike/`（`README.md`、`RESULTS.md`、2026-10-21 17:39 构建的 `main.js`、`test-vault/`）。记录显示 2026-10-21 在 Obsidian 1.12.7 / Node.js 22.22.1 下完成进程内 `pi-ai` 流式请求与 `pi-agent-core` 工具往返，自测 verdict 为 PASS；该目录不是 git 仓库。
- 原 Vault-Agent 打包/运行验证：`/Users/study_superior/Desktop/Project/houde/.obsidian/plugins/vault-agent/`（dev 构建 manifest：`ecb53543-dirty`，built 20261019-202728）。其 `main.js` 与仓库根 `main.js` 的 sha256 一致（`a69471cc…8bc551`），说明实际加载的是本仓库工作树构建产物；同 vault 的 `vault-agent/conversations/*.md` 保留了 2026-10-19 至 2026-10-21 的真实模型会话与子代理运行记录。
- P00 的状态来源是用户确认，不是本任务重新运行得到的测试结果；上述路径只是本地可见的佐证工件，未执行打包、安装或模型请求。

支持的 Obsidian/内置 runtime 版本（只登记已确认证据，不猜测）：

- Obsidian 1.12.7（本机 `/Applications/Obsidian.app` 的 Info.plist 版本，也是 PoC 实际运行版本）。
- PoC 记录的宿主 runtime：Node.js 22.22.1、Electron 39.8.3、Chromium 142.0.7444.265（macOS arm64）。
- 仓库 `manifest.json` 当前声明 `minAppVersion: 1.11.4`，但该版本的内置 Node 运行时未经任何 PoC 验证，不能据此推断满足 Pi 的 `>=22.19.0` 要求；按 design/14，后续迁移任务必须以已通过 PoC 的 1.12.7 作为最小版本基线显式设置并附证据。
- Windows / Linux 运行时未验证。

与分析快照的重要差异：无已跟踪文件差异。当前 HEAD 与 c2a7ef5 相同；唯一新增材料是未跟踪的执行包与已忽略构建产物。另需注意：P00 实际加载的是 `ecb53543-dirty` 构建（早于 HEAD 的最后一个 i18n 提交），不是当前 HEAD 的构建。

真实迁移跟踪 issue：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1 （2026-10-21 由 P01-T01 创建；仓库此前无 issue）。后续 issue-linked 注释/测试引用该 issue 的完整 URL，需要独立决定时另建专项 issue 并引用其 URL；不使用占位链接。
