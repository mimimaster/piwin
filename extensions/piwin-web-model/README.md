# piwin-web-model

用**你自己的模型网页订阅**给 piwin 当模型来源：一个装在 Host 上的 Pi 扩展，把
ChatGPT / Claude 的网页会话注册成 piwin 里的模型 provider，不需要 API Key。

```text
Pi Context (system + messages + tools)
        │  serialize（工具协议注入）
        ▼
   真 Chrome 标签页（持久 profile，你的登录态）
        │  读回复 / 判定生成结束
        ▼
AssistantMessageEvent 流（text-delta + toolcall）
        │
        ▼
piwin 的工具管线 + 权限规则引擎（原样复用）
```

**关键设计**：网页只是**传输层**，不是 agent。工具、权限、计划、子代理仍然全部归
piwin，所以网页模型调 `bash`/`edit` 一样要过权限闸门。这也是它与 Web2Term 类产品的
区别——不复刻执行循环，只替换模型来源。

## 安装

扩展以目录形式安装，不需要 `npm install`（零运行时依赖：只用 Node 内置能力 +
系统 Chrome）：

```bash
piwin extension install /path/to/extensions/piwin-web-model
```

然后在 piwin 里启用，并按 ADR 0047 的规则应用到当前 Agent（`/reload` 无效）。
模型列表里会出现两个 provider：

| provider | 模型 id |
|---|---|
| `chatgpt-web` | `chatgpt-web/default` |
| `claude-web` | `claude-web/default` |

## 首次登录

扩展会用**独立 profile**启动一个真 Chrome 窗口：

```
~/.piwin/web-model/chrome-profile/     # 与你的日常 Chrome 完全隔离
CDP 端口 9333
```

第一次跑的时候窗口里没有登录态，直接在那个窗口里登录一次即可（登录态会留在
profile 里，后续复用）。**不要**把你的日常 Chrome profile 指给它：Chrome ≥136 会
直接拒绝在默认 profile 上开调试端口，而且那会碰到你真实的 cookie。

需要自定义时（安装在非标准路径的 Chrome）：

```bash
export PIWIN_WEB_MODEL_CHROME_PATH=/path/to/chrome
```

## 能力边界（当前版本）

| 项 | 状态 |
|---|---|
| 纯文本对话 + 工具调用 | 支持 |
| 图片 / 附件输入 | **不支持**（在提示词里降级为 `[image omitted …]`） |
| 每次对话的网页上下文 | **每轮新开一个会话**（无状态，失败不会污染下一轮） |
| 输出思考过程 | 不支持（网页不暴露 reasoning） |
| 用量/成本 | 不统计（`usage` 全 0，走订阅额度） |
| 状态栏上报 | 暂无（provider 的 `streamSimple` 拿不到 `ctx.ui`；异常作为 error 事件回传） |
| 站点适配 | `chatgpt.com`、`claude.ai`（选择器为候选链，运行时自诊断） |

## 已知风险（请先读完再用）

1. **账号风险**：用自动化方式操作订阅账号，处于各家 ToS 的灰区，**存在封号可能**。
   这是本方案与 API 渠道最本质的区别，不要用在主账号上。
2. **DOM 适配必然易碎**：站点前端一改就可能读不到消息或发不出去。设计上的缓解是
   把选择器集中在 `src/sites/*.ts` 的候选链里、并让 probe 报告实际命中的选择器，
   但**不能消除**这个风险。
3. **提示词注入面更大**：网页内容、插件输出、模型自己的回复都会进入上下文；模型看到
   的任何文本都可能诱导它调用工具。相比 API 渠道，这里多了一层"网页渲染"的可信度
   问题。权限闸门能挡住越权写入，但挡不住"你让它做的事它不是你想的那么做"。
4. **不要指望它稳定替代 API**：它的价值是"没有 API Key 也能用订阅额度试起来"。

## 排查

| 现象 | 先看 |
|---|---|
| `Google Chrome was not found` | 装 Chrome，或设 `PIWIN_WEB_MODEL_CHROME_PATH` |
| `the prompt box … is disabled` | 页面在拒绝输入（匿名额度用尽/需要验证），去那个 Chrome 窗口登录一次 |
| `no prompt box found at …` | 站点改版了，更新 `src/sites/<site>.ts` 的选择器候选链 |
| `no settled reply within …` | 生成没结束或完成判定失效；错误里带最后一段文本 |
| 端口冲突 | 默认 `9333`；同 profile 的已有 Chrome 会被复用 |

快速自检（需要有已打开的标签页）：

```bash
node src/live-smoke.ts chatgpt-web
```

## 测试

```bash
npm test        # node --test，零依赖，46 个用例
```

覆盖：提示词序列化（8）、驱动与站点适配（9）、回复解析（11）、事件整形（7）、
provider 注册与失败路径（4）、Chrome 发现（5）。**不含**真机 piwin 内安装后的
端到端验收——那需要一次人工登录。
