# Codex Live intelligence wire probe

| 字段 | 值 |
|------|----|
| 日期 | 2026-08-29 |
| 能力常量 | `CODEX_LIVE_INTELLIGENCE_ENABLED = false` |
| 状态 | 待测 |

设置页打开不得创建通话。本记录只保存去敏结论：状态、mapped code、是否接受 `instant` / `medium` / `high`。

| 档位 | HTTP | mapped code | 上游是否接受 | 证据 |
|------|------|-------------|--------------|------|
| instant | — | — | 未测 | — |
| medium | — | — | 未测 | — |
| high | — | — | 未测 | — |

三档都通过后，把 `@piwin/voice` 的 `CODEX_LIVE_INTELLIGENCE_ENABLED` 改为 `true`，schema 才会下发该字段。
