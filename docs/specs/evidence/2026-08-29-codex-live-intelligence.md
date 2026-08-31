# Codex Live intelligence wire probe

| 字段 | 值 |
|------|----|
| 日期 | 2026-08-30；拒收证据 2026-08-31 |
| 能力常量 | `CODEX_LIVE_INTELLIGENCE_ENABLED = false` |
| 状态 | **上游拒绝** — 不再发送、设置页隐藏 |

2026-08-31 Codex AVAS call-create 返回 HTTP 400：

```text
Invalid AVAS session_data: [ObjectParam] [intelligence] [unknown_parameter]
Unknown parameter: 'intelligence'.
```

因此关闭该字段：schema 不再下发，adapter 不写 `session.intelligence`，config 里的旧值也不发送、不挡住建连。

| 档位 | HTTP | mapped code | 上游是否接受 | 证据 |
|------|------|-------------|--------------|------|
| 任意 | 400 | `live-protocol-failed` | 否 | 2026-08-31 Host `[piwin-live] codex createCall` |
