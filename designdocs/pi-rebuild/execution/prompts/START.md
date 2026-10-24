请在当前 Vault-Agent 仓库执行 `designdocs/pi-rebuild/` 中的重构方案。

先阅读仓库 AGENTS、该目录 START_HERE.md、execution/WORK_PROTOCOL.md、STATE.json 和 HANDOFF.md，然后领取 P01-T01。原打包/运行 PoC 已全部通过，不重做。

固定采用 pi-durable 1.3.0 作为唯一循环，pi-ai 和 pi-mcp 配套；不得重新选框架，不得启动外部Agent CLI，不得只做UI占位。一次只处理一个依赖已满足的任务，严格使用任务卡中的设计和验收。

开始前检查工作树，保留已有PoC和用户改动。任务完成必须记录实际测试、更新STATE和HANDOFF、运行文档检查器；没跑的测试不能称通过。会话不足则保持同一任务in_progress并交接精确下一步，不扩大任务。
