# 宿主接口契约

`host-types.ts` 是本项目计划拥有的类型，不是 Pi API，不承诺直接复制就完成实现。按对应任务将类型放入领域/适配层；已有类型可复用时不要创建同义重复类型。

Pure policy 只依赖这些宿主数据，不接受原始 App、SDK Harness 或 Keychain。I/O 函数注入最小依赖以便测试；真正权限决定在 ToolGateway，canonical targets 由 PathResolver 产生，不能由模型提供。

SDK 接口一律从固定包导入，公共类型以 `design/03-sdk-boundary.md` 与 sources 中 P02/P03 为准。没有在本包里伪造 `DurableAgent`、`saveChat()`、`mcp.install()` 等方法。

本包仅对该接口文件做语法/文档一致性检查；生产 TypeScript 类型检查必须在仓库中运行并记录，不能把本文件当 SDK 编译证明。
