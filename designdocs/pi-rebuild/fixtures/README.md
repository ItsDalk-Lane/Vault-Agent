# 固定输入与行为样例

这些文件定义必需行为，不是已运行的测试结果。

- test-world.json：隔离文件、路径、伪凭据与固定时钟。hash是真实UTF-8 SHA-256，可用于CAS测试。
- defaults.json：确定的初值；修改需ADR，而不是实现时自行挑数值。
- policy-cases.json：纯策略判定表。真实路径解析的链接/Windows场景还需filesystem fixture；模型不能控制resolvedZone等宿主字段。
- agent-flows.json：跨模块端到端步骤与预期。faux provider响应可以是函数，从上一个工具结果读hash，不硬编码过时基线。
- feature-matrix.json：全部必要渲染功能与后端任务映射。
- acceptance-scenarios.json：逐任务验收断言的唯一ID，执行后证据引用这些ID，不把result自动改passed。

P14故障注入中必须真正检查文件内容、side-effect次数和持久化记录，不只匹配日志文字。实际环境中不得使用这些夹具目录去覆盖任何用户库。
