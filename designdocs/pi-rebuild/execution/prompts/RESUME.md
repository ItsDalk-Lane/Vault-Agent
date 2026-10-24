继续 Vault-Agent 的 Pi 重构，不重新规划。

阅读 `designdocs/pi-rebuild/START_HERE.md`、`execution/STATE.json`、`execution/HANDOFF.md`，并运行 next-task.mjs。优先恢复已在进行的任务；若没有，则领取依赖及前阶段gate已通过的下一任务。再读对应任务卡和指定设计章节。

核对当前diff与上次交接，不能重置未完成改动。P00已由用户确认完成。以已有ADR和固定SDK版本实施，任何偏差必须留证据，不能隐去功能。

结束前记录实际测试命令与结果、当前commit或null、修改文件、仍未执行的验收，更新状态和交接并运行check-plan。任务没完整通过就保持in_progress/verify_failed，不伪造done。
