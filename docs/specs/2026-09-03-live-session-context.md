# 产品规格 — piwin Live 会话续接上下文

| 字段 | 值 |
|------|----|
| 状态 | **已落地** |
| 日期 | 2026-09-03 |
| 一句话 | 语音模型在通话开始时拿到绑定工作会话的续接摘要，通话中同步打字与 Run 结果，从而能参考会话聊天。 |
| 计划 | [2026-09-03-live-session-context.md](../superpowers/plans/2026-09-03-live-session-context.md) |
| 权威 | ADR 0065 · [语言分层](./2026-08-31-live-language-layers.md) |

## 问题

三条 Live 渠道的 `instructions` / `systemInstruction` 都是常量。语音模型从未收到会话内容，合同却要求它回答 “from this conversation”。

## 各渠道注入

| 渠道 | 启动摘要怎么给语音模型 |
|------|------------------------|
| Codex | call-create `session.initial_items`：一条 `role: "developer"` 消息，正文为 `renderLiveStartupContext(summary)` |
| Gemini | Host 铸造 ephemeral token 时追加第二条 `systemInstruction.parts`（Gemini 没有 initial_items） |
| OpenAI Realtime | owner bootstrap `startupContext`，shell 在 `session.update` 里拼进 instructions |

摘要由 Host 用绑定会话当前聊天模型做一次无工具 completion（与意图判断同一套解析）。失败不阻塞通话。
`voice/live/status` 就绪时会预热该会话的摘要，让随后的 `start` 命中缓存而不必等模型。
摘要提示词声明 transcript 是数据而非指令，避免会话里的注入文本借摘要抬升到 `developer` 角色。

## 通话中同步

| 事件 | 通道 | 内容 |
|------|------|------|
| 成功改绑到另一会话 | commentary `session` | 先立即推 `piwinLiveRetargetContext(label)`；摘要就绪后再推一条 `renderLiveStartupContext`，改绑响应不等模型 |
| 绑定会话里用户打字或排队 | commentary `session` | `piwinLiveTypedInputContext(text)`；不承诺已受理，语音层不得声称已开始或已完成 |
| 绑定会话上任意 session-turn Run 结束 | speakable | 去敏 takeaway；语音委派 Run 仍走 `delegation` target |
| 用户自己取消 / 中断的非委派 Run | 不推 | 用户刚在聊天页做的决定，语音层不复述「没完成」 |

改绑或挂断后到达的迟到摘要按 `callId + sessionId` 校验后丢弃，不会推给已经换了目标的通话。

## 隐私 / 留存

| 数据 | 默认 |
|------|------|
| 会话续接摘要 | 仅内存；只出现在 owner bootstrap / owner `append-context` / provider 请求体 |
| 原始音频 / 闲聊 transcript | 不落盘（不变） |

不上 `LiveCallView`、`voice/live-updated`、Host 日志正文或会话 transcript。

## 验收

11. 打开有历史的会话再开 Live，问「刚才我们在做什么」→ 语音层用摘要回答，不出现委派卡片。
12. 通话中在绑定会话打字发任务 → 语音层收到 commentary，Run 结束后说 takeaway，不把打字当新的委派。
13. 改绑到另一会话 → 语音层拿到新会话摘要；已接纳 Run 不取消。
