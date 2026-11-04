# Spike: 真 Chrome + CDP 能否驱动 chatgpt.com / claude.ai

| Field | Value |
|---|---|
| Status | **进行中** — 浏览器链路已证实，回复读取阻塞在登录 |
| Date | 2026-02-11 |
| Plan step | `1`（go/no-go gate，全部后续步骤依赖它） |
| Script | `extensions/piwin-web-model/spike/cdp-spike.mjs`（一次性脚本，产品代码不 import） |

## 问题

Web2Term 的核心价值是「用网页订阅账号当模型来源，不配 API Key」。piwin 里复刻它的前提是：
一台**真 Chrome**、**持久 profile**、**用户手动登录**的窗口，能被 CDP 驱动到「写入提示词 → 发送 → 读到完整回复 → 判断生成结束」。

如果 ChatGPT 的自动化检测连这条路都拦，整个方案作废。

## 环境

- Chrome `156.0.8078.80`（系统 `/Applications/Google Chrome.app`）
- Node `v24.11.1`（全局 `WebSocket` + `fetch`，spike 零依赖）
- 独立 profile：`~/.piwin/web-model/spike-profile`
- CDP 端口 `9333`，flag 组合：`--remote-debugging-port` + `--user-data-dir`（非默认目录，Chrome ≥136 才允许）+ `--disable-blink-features=AutomationControlled` + `--no-first-run` + `--no-default-browser-check`

## 已证实

| # | 结论 | 证据 |
|---|---|---|
| 1 | 独立 profile 的窗口可被 CDP attach，`/json/version` + `/json/list` + 页面 WebSocket 全部可用 | `chrome Chrome/156.0.8078.80 listening on 9333 (pid 47687)`；`Target.createTarget` 返回真实 targetId |
| 2 | **chatgpt.com 没有 Cloudflare / Turnstile 拦截** | probe 结果 `challengeFrames: []`，`title: "ChatGPT: Chat, Work, Create & Code with AI"`，`readyState: complete`，正常渲染登录页与 composer |
| 3 | 文本可写入 composer | `type` 后 readBack 返回实际内容（首次误判为空是 spike 脚本自身 bug：`textarea.innerText` 恒为 `''`，`??` 不会回落） |
| 4 | Enter 键可提交 | `Input.dispatchKeyEvent` 后 composer 值被清空、页面出现「停止生成」与「Retry」按钮 |
| 5 | 生成中状态有可用信号 | 生成期间 composer 表单内存在 `aria-label="停止生成"` 的按钮 → 可作「生成中」判定 |
| 6 | **完整闭环在免登录状态下就成立**：写入 prompt → Enter 发送 → 页面进入会话 URL → 读回回复正文 | 发送 `Reply with exactly: SPIKE_OK` 后 URL 变为 `https://chatgpt.com/uc/6ae99994-…`，正文中出现用户消息与助手回复 `SPIKE_OK` |
| 7 | 免登录渲染器的结构已知 | 助手正文为 `li#<uuid> > div > section > p`；该页面**没有** `[data-message-author-role]`、`article`、`[data-testid^=conversation-turn]` |

### 一个重要的反直觉结论

免登录的 chatgpt.com 是**另一套 SSR 渲染器**（`/uc/…` 路径），不是登录后的 React 应用。因此：

- 「能不能驱动」这个问题已经回答完了：**能**，且不需要登录；
- 但产品要的是**订阅账号额度**，登录后的 DOM 是另一套，选择器必须重新采集。这是本步唯一剩余的不确定性。

## 未证实（阻塞）

| # | 待验证 | 阻塞原因 |
|---|---|---|
| 1 | 登录后会话的 DOM（消息容器、末尾回复、停止按钮） | 需要用户在 spike profile 内登录一次；免登录渲染器与登录后渲染器不同构 |
| 2 | 登录态下的流式增量与完成判定 | 依赖 #1 |
| 3 | claude.ai 可行性 | 未登录直接 302 到 `/claude/login`（同样无 CF 拦截，只有 hCaptcha 占位 textarea） |
| 4 | 长会话下 composer 的输入上限 | 需要登录后连续发长 prompt 实测 |

注意：未登录页面**没有** `[data-message-author-role]` 与 `[data-testid=send-button]`，说明早期网上流传的选择器已过时，必须以实测为准。

## 待用户执行

在 spike 打开的 Chrome 窗口里人工登录（ChatGPT 与 Claude 各一次）。之后继续验证：

1. 发一条固定 prompt，确认 assistant 消息容器选择器；
2. 连续采样文本增量，确认「生成结束」可从「停止生成」按钮消失 + 文本长度稳定双重判定；
3. 记录两个站点各自的 composer / 消息 / 停止按钮选择器到本文档。

## 决定

**条件性 go（技术风险已排除，剩一个人工步骤）**：唯一无法用代码绕过的风险——「真 Chrome 会被判定为自动化而无法驱动」——已实测排除，且闭环在免登录状态就跑通了。

剩余不确定性只是「登录后 DOM 长什么样」，属于采集工作而非可行性风险。登录后采集完选择器即转 done；若登录后出现新的风控（例如必须过 Turnstile 才能发消息），再在此处改判。

## Live smoke 记录（`src/live-smoke.ts`）

同一个 Chrome（`:9333`，spike profile）上连续跑了三次，结果按时间顺序：

| 轮次 | 结果 | 说明 |
|---|---|---|
| 1 | 停在 `/auth/login`，驱动拒绝执行 | `describeBlocker` 返回 `no prompt box found …; the site layout may have changed`，没有瞎等 |
| 2 | **SMOKE PASS** | 命中 `composer=textarea#mobile-composer-prompt`、`assistant=main li section`、生成中信号 `button[aria-label="Stop generating"]`；写入 → Enter → 轮询 → 读回 `DRIVER_OK` |
| 3 | 快速失败（不空等） | 页面出现 `Chat verification required — We could not verify this anonymous chat`，composer `disabled:true`；新增的 `composerDisabled` 判定直接给出原因 |

### 两个由实测才暴露的缺陷（已修）

1. **陈旧回复误判**：复用同一个标签页时，上一轮的回复已经停在页面上且"文本稳定 + 未在生成"，`isSettled` 会把它当成本轮结果。新增 `hasNewReply(baseline, current)`（URL 变化 / 轮次增加 / 助手文本变化，三者之一）才允许判定完成。
2. **禁用态空等**：composer 被 `disabled` 时原先会等满 120s 超时。新增 `composerDisabled` 判定，直接报「site is refusing further input」。

### 目前的能力边界（重要）

**ChatGPT 匿名聊天在几轮自动化消息后被服务端封了**（要求登录或注册）。这意味着：

- 免登录路径不足以支撑产品使用，**登录是硬要求**；
- 登录后的 React 应用 DOM 仍未采集，`sites/chatgpt.ts` 里登录态相关的选择器仍是候选值（运行时由 probe 报告实际命中的那个）。
