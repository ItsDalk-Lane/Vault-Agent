# 文档执行辅助脚本

这些脚本只依赖 Node 的内置模块，用于**开发机器**管理任务；不是插件运行依赖，不要求最终用户安装 Node。

在执行包根运行 `node scripts/check-plan.mjs` 检查任务依赖、功能/用例引用、本地链接和进度证据约束。`node scripts/next-task.mjs` 只读输出下一任务或待验阶段，不改进度。`node scripts/check-plan.test.mjs` 对检查器本身运行故障输入测试。

脚本不能证明生产代码安全或测试确实反映真实用户行为。任务证据必须由实施者如实记录，维护者仍要审查输出；禁止手工填假exitCode来绕过门槛。
