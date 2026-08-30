# Handoff — piwin Live 点一下就弹回 idle

| 字段 | 值 |
|------|----|
| 日期 | 2026-08-29 |
| 状态 | **两层根因均已修复** — `alloy` 导致误导性 403；201 answer 的末行终止符被删导致 WebKit 拒绝 SDP |
| 产品 | piwin Live（首期 Codex 套餐 + Gemini API；不是 Platform Realtime） |
| 权威 | [codex-live-product.md](./2026-08-28-codex-live-product.md) · [ADR 0065](../adr/0065-piwin-live-voice-work-session.md) |

本文记录 2026-08-29 的真实点击诊断与修复结果。

---

## 1. 用户看到的现象（已确认）

输入栏点 **Live**：

1. 按钮闪一下（离开 “Live”，大概变成「取消」或「挂断」）。
2. 立刻变回 **Live**。
3. 顶栏通话条不停留。通话说不住。

这不是「挂断后又自动打回来」。这是 **start 根本没站住**。

---

## 2. 设计上应该发生什么

```text
Desktop 点 Live
  → getUserMedia + RTCPeerConnection（Desktop 持麦）
  → ICE gather 完，把 SDP offer 交给 Host
  → Host 用 openai-codex OAuth POST
      chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas
    换 SDP answer（token 不出 renderer）
  → Desktop setRemoteDescription，WebRTC 连通
  → 按钮变「挂断」，顶栏保持「已连接」
  → 闲聊不进会话；上游 client delegation 才进当前 Session
```

鉴权：已有 Accounts 里的 `openai-codex`。没有设置页开关。当前聊天模型（如 glm）不驱动语音。

---

## 3. 真实点击证据与根因

一次真实 Desktop 点击的系统日志已确认：

1. 麦克风授权成功，音轨正常启动；
2. `RTCPeerConnection` 正常生成 offer，host 与 srflx ICE candidates 收集完成；
3. 从未执行 `setRemoteDescription`；
4. 约 0.9 秒后由应用主动停止音轨。

使用同一份 Codex 登录凭据和由参考客户端生成的有效 SDP offer 直连上游时，piwin 的旧默认音色 `alloy` 返回 HTTP 403：`Voice session access denied.`。账号是 Plus 且已具备官方 ChatGPT Voice；把请求唯一相关差异改为参考实现的 v3 默认音色 `cove` 后，上游立即返回 HTTP 201。因此根因不是账号资格，而是 **Codex Live v3 音色目录与旧 Realtime 音色不兼容，上游又把无效音色错误映射成了 403**。可以排除麦克风、Tauri WebRTC、ICE、token 过期、account id 和 session id 格式。

本地同时存在一个确定的静默竞态：Host 创建失败时先推送 `voice/live-updated(call: null)`，Desktop 收到后停止 peer 并 abort start；随后失败响应到达，`useLiveCall` 因 signal 已 abort 而吞掉真实错误。最终表现正是「按钮闪一下、顶栏消失、没有错误」。

切换到 `cove` 后，第二次真实 Desktop 点击进一步确认 call-create 已越过 201：WebKit 在 2026-08-29 11:26:59 实际执行了 `setRemoteDescription`，随后明确报 `Invalid SDP line`。上游原始 answer 使用 CRLF 并带末行终止符，但本地 `extractSdpAnswer()` 的 `trim()` 删除了最后的 CRLF。原生参考 helper 容忍这一差异，macOS WebKit 不容忍，因此出现「无法建立 Live 连接」。

---

## 4. 已实施修复

- Desktop 先处理 Host start 响应，再判断 abort；失败时不再被空 call push 抢先吞掉。
- 只有已经存在过 call 时，后续 `call: null` 才负责停止 peer。
- 新增稳定错误码 `live-provider-access-denied`；上游 403 不再降级为泛化协议失败。
- Codex adapter 对齐参考拓展 `resolveCodexVoiceAuth`：`originator: pi`、`user-agent: pi-codex-conversion`、`x-session-id`，accountId 优先读 `auth.json`，创建成功要求 HTTP 201。WebRTC 与 `pi-codex-voice` 一样用默认 `RTCPeerConnection`（不加额外 STUN）。
- Codex adapter 使用 Live v3 音色目录，默认 `cove`；旧值或未知值在上游请求前安全回退到 `cove`，不再发送 `alloy`。
- SDP answer 统一规范化为 CRLF，并始终保留末行终止符，满足 macOS WebKit 的严格 SDP 解析。
- Live 条从本地 peer 阶段开始立即常驻，显示「打开麦克风 / 连接 / 聆听 / 模型响应 / 重连 / 失败」。
- 失败面板保留真实原因和「重试 / 收起」动作；不再用按钮旁的一小行文字承载关键错误。
- Composer 按钮在活动通话时只聚焦 Live 条，挂断是 Live 条上的独立动作，避免误触。
- 动态波形只用于连接和语音活动，且遵守 `prefers-reduced-motion`。

---

## 5. 当前可验证结果

本地状态机、错误映射、音色归一化、SDP CRLF 规范化、adapter 请求、Host coordinator 和 Desktop 竞态均有测试覆盖。当前账号的官方 Voice 资格已经确认，参考客户端生成的真实 SDP + `cove` 已拿到 201 SDP answer；参考 helper 对同一 answer 已进入 `connected`。界面不会错误指控套餐资格，也不会再假装成功或静默弹回。

修复后的 Host 已重启；仍需在当前最新 Desktop 进程中完成一次重试，确认 WebKit 进入 connected，并继续验收音频收发和活动事件。非公开协议若再次变化，应先对照 v3 音色与参考 wire shape，不把 HTTP 403 直接归因于套餐。

---

## 6. 后续真实账号验收

冷启动修复后的 Host/Desktop，并按以下顺序完成端到端验收：

1. 点击 Live 后面板立即出现，依次显示麦克风与连接阶段；
2. 收到 201 SDP answer 后进入「我在听」，不会跳回；
3. 用户说话与模型响应分别显示不同的动态状态；
4. 静音、挂断、上游失败和重试均有稳定、可读状态；
5. 日志只记录阶段、耗时和映射错误码，不记录 token、SDP 或音频。

---

## 7. 主要文件

| 文件 | 职责 |
|------|------|
| `apps/desktop/src/live/LiveComposerButton.tsx` | Live / 取消 / 挂断 同一颗按钮 |
| `apps/desktop/src/live/use-live-call.ts` | Desktop 通话 hook；**abort 静默** |
| `apps/desktop/src/live/live-peer.ts` | 麦 + WebRTC + ICE |
| `apps/desktop/src/hooks/use-composer-dock-props.ts` | `useLiveCall` 挂在 composer |
| `packages/host-runtime/src/commands/voice-live-commands.ts` | `voice/live/*` |
| `packages/host-runtime/src/voice/live-call-coordinator.ts` | 单槽、建连、清理 |
| `packages/voice/src/codex-live-adapter.ts` | Codex POST |
| `packages/host-runtime/src/voice/codex-live-token.ts` | 从 Pi `auth.json` 读 token + account id |

约束：`apps/*` 不 import `@piwin/voice`；token / 上游 URL 不进 contracts。

---

## 8. 不变量

- 不把会话标题当成 Live 报错。
- 不把非用户触发的 abort 当成无 UI 的成功空操作。
- 不把 token、SDP、原始上游 payload 或音频写入日志。
- 不用本地兼容补丁伪装或绕过上游授权。
