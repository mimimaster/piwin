# 实机体验与特性画廊 (Visual Gallery)

> **全景实录 · 12 大核心功能界面 · 8 大特性图解 · 5 大实操走查场景**  
> 一览 Piwin · 砚 在 macOS/Windows 桌面端上的真实界面表现、组件细节与架构图解。所有截图均源自真实 Host 运行环境。

---

## 1. 桌面工作台全景与出厂组件

Piwin 采用东方文人书斋设计美学，提供深邃沉静的「墨面」与温润舒目的「纸面」，支持全键盘交互、多代理分屏与富媒体画布。

| 桌面工作台全景实拍 | 出厂核心组件全览 |
| :---: | :---: |
| [![Piwin 桌面工作台全景预览](/images/readme/hero.jpg)](/images/readme/hero.jpg) | [![Piwin 出厂组件全览](/images/readme/components.jpg)](/images/readme/components.jpg) |


---

## 2. 核心功能实机截图 (README 核心特色同步)

### 2.1 扩展生态与扩展市场

| Pi 扩展热安装设置 | 扩展市场：内置 / Pi 原生 / 社区 |
| :---: | :---: |
| [![Pi 扩展热安装](/images/readme/extensions.jpg)](/images/readme/extensions.jpg) | [![扩展市场](/images/readme/marketplace.jpg)](/images/readme/marketplace.jpg) |

- **扩展热安装**：市场 / Git / 本地一键安装，下一轮对话即时生效，不重启、不丢会话。
- **扩展市场**：内置 `pi-deepseek-cache`、`goal`、`llm-wiki` 等高价值插件，支持清晰标注兼容性。

---

### 2.2 子代理编排与全双工语音

| 子代理编排：输入框一键切换方案 | 全双工语音：通话中 Agent 在后台工作 |
| :---: | :---: |
| [![子代理编排方案](/images/readme/orchestration.jpg)](/images/readme/orchestration.jpg) | [![全双工实时语音](/images/readme/voice.jpg)](/images/readme/voice.jpg) |

- **子代理编排**：内置 Ultra Code、Fusion、Reviewed Delivery 三套架构方案，在 Composer 一键无缝切换。
- **全双工语音**：说话面与工作面契约解耦，一边语音聊方案随时插话打断，一边让 Agent 在后台写代码、跑测试。

---

### 2.3 模型分工与视觉委托

| 按能力类型配模型 | 视觉委托：截图交给轻量多模态模型提炼 |
| :---: | :---: |
| [![按能力类型配模型](/images/readme/models.jpg)](/images/readme/models.jpg) | [![视觉委托](/images/readme/vision.jpg)](/images/readme/vision.jpg) |

- **按能力配模型**：推理、视觉、生图、视频、实时语音、Embedding、Reranker 解耦单独配置。
- **视觉委托**：纯文本模型也能看图，截图由轻量多模态模型秒级提取 OCR 与特征，主模型省下 70%~90% 上下文 Token。

---

### 2.4 代码检索与网络搜索

| code_search：Host 内置代码检索工具 | Web Search：免 Key 起步与抓取清洗 |
| :---: | :---: |
| [![code_search 设置](/images/readme/code-search.jpg)](/images/readme/code-search.jpg) | [![Web Search 一键配置](/images/readme/web-search.jpg)](/images/readme/web-search.jpg) |

- **code_search**：与 `read`/`grep` 同级的 Host 内置工具，检索在独立只读进程完成，0-Token 污染主上下文。
- **Web Search**：DuckDuckGo 免 Key 起步，支持 Tavily、Brave、Devin 及专用网页清洗抓取服务。

---

### 2.5 知识沉淀与资料资产

| 知识中心：LLM Wiki 词条与网状关联 | 知识库：Embedding / Reranker 单独配置 |
| :---: | :---: |
| [![知识中心 LLM Wiki](/images/readme/knowledge-wiki.jpg)](/images/readme/knowledge-wiki.jpg) | [![知识库重排设置](/images/readme/knowledge.jpg)](/images/readme/knowledge.jpg) |

| 资料库：生成的图片 / 视频集中管理 | 用量统计：缓存命中率与调用明细 |
| :---: | :---: |
| [![多媒体资料库](/images/readme/library.jpg)](/images/readme/library.jpg) | [![用量统计看板](/images/readme/usage.jpg)](/images/readme/usage.jpg) |

- **知识中心与闪卡**：LLM-Wiki 沉淀工程共识，选区划词即时生成复习闪卡。
- **资料库**：AI 生成的图片与短视频集中本地托管在 `~/.piwin/media/`，保留提示词与溯源上下文。
- **用量统计**：全通道模型消耗对比、前缀缓存命中率直观呈现，每一分 Token 清晰透明。

---

## 3. 8 大核心特性图解 (Feature Infographics)

### 01 · 子代理编排体系 (Ultra Code & Fusion)
解决长上下文腐烂与 Token 浪费：只读 Scout 负责全仓库侦察，SOTA Lead 把握架构澄清，高速 Sidekick 执行编码，原子级审查合入。

![01 子代理编排体系](/images/promo/features/01-orchestration.jpg)

---

### 02 · Code Search 智能语义代码搜索
逆向 Devin Fast-Context 机制，与 grep/read 同级的一等公民工具。0-Token 上下文污染，精准唤起代码拓扑关系。

![02 Code Search 智能代码搜索](/images/promo/features/02-code-search.jpg)

---

### 03 · 全双工实时语音 Live
边聊边写，说话面与工作面契约解耦。像真人结对编程一样，声音提出需求与技术讨论，终端、代码与工具执行实时推进。

![03 全双工实时语音](/images/promo/features/03-voice.jpg)

---

### 04 · Pi 扩展热安装与市场
支持 Agent-Runtime 级别插件热插拔。内置 `pi-deepseek-cache` 提示词前缀缓存提速、`goal` 目标管理与 `llm-wiki` 知识沉淀，无需重启客户端。

![04 Pi 扩展热安装](/images/promo/features/04-extensions.jpg)

---

### 05 · 按能力配模型 (BYOK & 视觉委托)
通道层与账号层解耦。主思考使用最顶级推理模型，视觉图表自动委托给免费轻量多模态模型处理，Token 综合成本降低 70%+。

![05 按能力配模型与视觉委托](/images/promo/features/05-models.jpg)

---

### 06 · 一键配置与官方订阅 OAuth
Kimi Coding、OpenAI Codex、Claude Pro、Copilot、Devin 官方订阅一键浏览器授权登录；所有敏感凭证仅存放于本机 Host 安全目录。

![06 一键配置与官方订阅](/images/promo/features/06-onboarding.jpg)

---

### 07 · 墨面组件墙 (东方文人深邃美学)
黑墨底衬、朱砂红印、金石书口线。暗光环境下专注护眼，信息层级分明。

![07 墨面组件墙](/images/promo/features/07-components-dark.jpg)

---

### 08 · 纸面组件墙 (东方文人温润雅趣)
宣纸底色、深褐松烟墨字。双面审美一键自由切换，白昼伏案阅读如临书卷。

![08 纸面组件墙](/images/promo/features/08-components-light.jpg)

---

## 4. 实机交互走查场景 (Real-World Scenarios)

### 场景 01 · 端上闭环
一句话让 Agent 起 Metro、编译 iOS 包并在模拟器中完成无障碍断言，全程不抢占前台输入视窗。

| 墨面 (Ink) | 纸面 (Paper) |
| :---: | :---: |
| [![端上闭环墨面](/images/promo/scene-01-endpoint.jpg)](/images/promo/scene-01-endpoint.jpg) | [![端上闭环纸面](/images/promo/scene-01-endpoint-light.jpg)](/images/promo/scene-01-endpoint-light.jpg) |

---

### 场景 02 · 理解与沉淀
广度搜索与测试执行完成后，提炼出的技术结论与验收证据自动沉淀至 LLM-Wiki 与记忆闪卡中。

| 墨面 (Ink) | 纸面 (Paper) |
| :---: | :---: |
| [![理解沉淀墨面](/images/promo/scene-02-research.jpg)](/images/promo/scene-02-research.jpg) | [![理解沉淀纸面](/images/promo/scene-02-research-light.jpg)](/images/promo/scene-02-research-light.jpg) |

---

### 场景 03 · 子代理并行
将多项独立任务同时拆解给多个子代理并发推进；独立 Git Worktree 隔离开发，主计划托盘实时汇总。

| 墨面 (Ink) | 纸面 (Paper) |
| :---: | :---: |
| [![子代理并行墨面](/images/promo/scene-03-fanout.jpg)](/images/promo/scene-03-fanout.jpg) | [![子代理并行纸面](/images/promo/scene-03-fanout-light.jpg)](/images/promo/scene-03-fanout-light.jpg) |

---

### 场景 04 · 工具家族
内置丰富的可视化交互卡片：浏览器视口跟动、网页抓取、知识库切片、进程实时日志与多媒体生成。

| 墨面 (Ink) | 纸面 (Paper) |
| :---: | :---: |
| [![工具家族墨面](/images/promo/scene-04-tooled.jpg)](/images/promo/scene-04-tooled.jpg) | [![工具家族纸面](/images/promo/scene-04-tooled-light.jpg)](/images/promo/scene-04-tooled-light.jpg) |

---

### 场景 05 · 审批关口
目标受阻卡讲清原因，计划执行门给出下一步推演选项，权限控制条一键批准或驳回。

| 墨面 (Ink) | 纸面 (Paper) |
| :---: | :---: |
| [![审批关口墨面](/images/promo/scene-05-approval.jpg)](/images/promo/scene-05-approval.jpg) | [![审批关口纸面](/images/promo/scene-05-approval-light.jpg)](/images/promo/scene-05-approval-light.jpg) |


