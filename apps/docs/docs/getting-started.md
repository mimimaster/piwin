# 快速起步概览

欢迎阅读 **Docs**！这里主要会介绍一些常用的agent的配置指南推荐。本文档旨在帮助大伙儿或者小白找到一些好用的agent工具，比如好用的web_search渠道，文中所述配置以piwinwin为示例；这些文档会尽量使用人类文笔撰写，但本人文笔极差，(*∩_∩*)~ 嘻嘻

---
## BYOK
BYOK（Bring Your Own Key) 懂得都懂，这里在废话多说几句，现在市场上的agent数不胜数，许多都带有自己的套餐，使用自家的渠道去使用特定厂商的模型资源，很多时候，自带的这些资源并无法满足用户的需求，用户就会自己去收集、购买不同厂商的TOKEN PLAN，然后可以集合到一个agent上使用，谁都不想电脑上开很多个coding agent，明明干的还是同个项目。所以可以使用一些Agent自带的模型配置功能，就是说，用你自家的key；
## 中转路由 
有时候用户可能是拥有多个套餐，他们有的原生支持你使用api调用，有的不可以，只能以oauth的情况使用，这时候我们如果既要又要，只能被迫反代，常见的场景就是将codex套餐授权至cliproxyapi(以下简称CPA)，再由CPA进行管理分发，之后你就可以用不同的agent去进行使用api调用了，甚至做了协议兼容；CPA是一个很方便的个人中转路由工具，你可以将你不同的套餐聚合在一起，统一管理，一个key，就可以使用你所有套餐下的模型，建议个人本地部署，类似工具还有sub2api、newapi、oneapi；
小巧思:
如果有CPA、su2api、newapi之类的工具不支持2API的套餐，可以自行使用agent工具检索github库，必然有你想要的答案

## Provider
通道（Channel）是 BYOK / 网关：Anthropic API Key、OpenRouter key、Ollama、本机 CPA（常见 `http://127.0.0.1:8317/v1`）等。已有 `anthropic` 通道时，登录 Claude 套餐会把它改名为 `anthropic-api`。

套餐账号（Account）是另一层：设置 → **OAuth 登录** 登录 Kimi Code、ChatGPT Codex、Claude Pro/Max、Grok、GitHub Copilot，凭证写在 Pi 的 `~/.pi/agent/auth.json`，不会塞进通道 `apiKeyRef`。OpenRouter 仍是通道 Key。CLI：`piwin auth status | login <kimi-coding|openai-codex|anthropic|xai|github-copilot> | logout <id>`。



## 核心配置导航

点击左侧侧边栏或下方卡片直接阅读对应章节：

- [⚡ 视觉模型与委托配置](./vision-models.md)：了解视觉委托机制，免费获取 Gemini / SiliconFlow / Groq / Ollama 视觉模型配置。
- [🌐 Web 搜索与社群资源](./web-community.md)：获取 Tavily 免费 1000 次搜索 Key、自建 SearXNG 与 MCP 生态资源。
- [📝 如何添加我自己的 Markdown 文档](./how-to-write-docs.md)：教你如何 3 步在本项目中添加你自己的文档与笔记。

---

## 客户端一键直达

在 Piwin 客户端各配置项旁边，点击 **「📖 配置指南」** 即可精准跳转至对应文档锚点。
