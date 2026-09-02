# NOTES

## 连接状态语义（0.1.2 结论）

- **已连接** = 探针确认该 server 的工具已注册（`mcp__<name>__*` 存在于工具注册表），**不是**实时网络连通
- **已注册** = 插件实例激活成功，但未探测到工具：初始连接失败（后台自动重连）或服务器本身无工具
- **断开窗口**：mcp-client 断开期间保留最后可用世代的工具注册（防抖动丢工具）并自动重连（指数退避，默认约 3 分钟预算）。窗口内仍显示"已连接"，此时调用工具会失败；重连预算耗尽后工具注销，探针在下个 rescan（≤10s）翻回"已注册"
- **刷新按钮**：只重新拉取快照（host 内存中最近一次探针结果），不触发重新探测；断开窗口内刷新结果不变
- mcp-client 不暴露实时连接状态（ConnectionHandle 仅 ready/dispose），"实时断开检测"需改 dsh 本体，超出本插件范围

## 排查教训

- 改 `types.ts`（wire 字段）后必须重跑 `gen.mjs` 并**重打 UI bundle**：typert 客户端 codec 过期时，严格 codec 会静默剥离未知字段（`connected` 丢失导致永远"已注册"），且只影响通过 Remote 返回的数据，直接读 host 状态看不出来
- 构建顺序（均从仓库根目录执行）：`pnpm run build:host → pnpm run build:client → pnpm run verify`
