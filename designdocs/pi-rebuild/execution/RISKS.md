# 已识别风险与固定处理

| 风险                     | 不能接受的处理          | 本方案处理                                              |
| ------------------------ | ----------------------- | ------------------------------------------------------- |
| Durable实验性API/格式    | 自动升级main            | 锁定1.3.0，adapter隔离，备份+契约+恢复测试后单独升级    |
| 两套Agent循环            | Core执行、Durable假记账 | 只有Durable Harness                                     |
| JSONL全历史内存          | 无限制会话              | 每根store、lazy/LRU、软硬阈值和安全归档                 |
| 双实例写入               | 以“用户不会双开”忽略    | lease、token核对，无法确认时拒绝写                      |
| Shell/MCP绕过Vault       | 正则/提示词声称沙盒     | strict禁止opaque，高级可信模式诚实告知风险              |
| 效果完成但receipt丢失    | 自动重试一切            | Vault CAS对账，unsafe操作人工核对                       |
| 快照压缩删除旧聊天       | 用active快照替换全部    | full entries + live overlay                             |
| 旧历史缺完整工具记录     | 伪装无损resume          | 只读保留+带来源新会话导入                               |
| 所有模型thinking/额度    | 生成假思考和百分比      | 能力检测、真实数据、unknown与本地预算标签               |
| MCP配置任意命令          | 测试时执行!secret命令   | secretRef、禁止求值、限定传输与授权                     |
| 子任务无限递归/重复报告  | 仅提示不要递归          | depth/concurrency/budget硬限制、stable IDs与cancelEpoch |
| Pi-web私有API/服务器依赖 | 整段复制web后端         | 只借鉴协议与产品行为，使用本方案公开SDK                 |
| 未获得真实平台证据       | 宣称三平台通过          | not_run保留，发布gate不通过                             |

执行中出现新风险，记录实际触发条件、涉及任务和最小修复，不把所有未知都变为泛化框架。
