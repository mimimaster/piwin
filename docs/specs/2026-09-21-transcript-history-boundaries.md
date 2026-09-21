# 长会话滚动和刻度条的历史边界

## 已确认原因

1. Live transcript 缓存达到 160 条 / 2 MiB 后会移除 olderCursor，
   `cacheLimitReached` 同时禁用滚动加载。数据仍在 Host，但用户无法继续上滑。
2. 刻度条 seek 只打开一个 bounded historyView，原先没有保存窗口范围，也没有
   对接两端分页，所以只能在局部片段中滚动。
3. user/send、queued send、steer 会清空 userMessageIndex，streaming 期间又
   不刷新索引。刻度条退回 resident messages，完整历史入口随之消失。

## 行为

- 保留 live tail 和独立的 historyView。达到 live 缓存上限后，按边界 message id
  调用现有 `session/transcript-window`，向上/向下各取至多 49 条相邻记录。
- 历史窗口按阅读方向合并；超出 160 条 / 2 MiB 时淘汰另一端，并裁剪对应 Run 投影。
  内存限制不再代表历史终点。Host 数据和 CLI 行为不变，无协议或 Pi adapter 变更。
- 虚拟列表使用现有库的 key anchoring 保持阅读位置；不再用总高度差补偿虚拟窗口。
- 拟合视口的短历史片段也响应滚轮。请求去重；无新增记录不会自动循环请求。
  刻度条跳转与返回最新清除旧滚动意图；迟到请求不能覆盖之后的跳转。
- 在新一轮生成期间保留已读取的全局刻度索引，附加新发送的本地 user 行；
  索引依旧使用 epoch 拒绝过期响应，在生成结束后刷新。切换会话/分支仍清空旧索引。

## 验证

- Reducer：300 条消息往返遍历，窗口条数/字节预算、Run 清理、迟到页、无进展页。
- Actions：缓存满后的向前请求、向后请求、返回最新后忽略迟到响应、发送时保留索引。
- 刻度索引：保留 Host 锚点，去重，不从局部窗口填充 sampled index 的内部空位。
- Chromium：缓存满后滚到开头并返回尾部；通过真实刻度条跳转后继续双向滚动；
  新一轮发送不缩短刻度条；淘汰另一端时保留可见消息位置；已有滚动稳定性测试。
- 完成记录见本文后续结果。浏览器夹具不访问用户会话，不启动原生 Tauri；
  安装包中的 WKWebView 仍需随下次构建确认。

## 验证结果

- 新建后一直运行、没有恢复页 cursor 的会话，也保留缓存裁剪标记；已补失败后通过的回归。
- `pnpm typecheck` 通过。
- 14 个相关测试文件，161 项通过；7 项 Chromium 回归通过。
- Desktop 全量：4560 项通过、3 项失败。失败均为此前已记录的主题旧 ID 映射、
  blur 白名单及 Inkstone 字号下限规则，不涉及本次滚动代码。
- 涉及源码均不超过 1000 行。为遵守上限，从原有超长 composition 文件中抽出
  原有 session export 和媒体库 composer wiring，行为保持原样。
- 共享目录被其他操作重置两次后，验证转入隔离 worktree；最终改动同步回主项目，
  不修改其他任务的 Artifact 渲染变更，也不创建包含混合改动的提交。
