# Study Space：接在知识飞轮上的陪练

Study Space 是一个主动启用的 Extension。它不是新的卡库、调度算法或外部服务：学习的单位是 wiki 概念，三个仓各管一件事。

| 仓 | 职责 | 学习中的角色 |
| --- | --- | --- |
| 知识库（RAG） | 原料 | 讲解的依据，带 `[n]` 引用 |
| Wiki | 我理解了什么 | 每学完一个概念，落成一页概念 |
| 闪卡 | 我需要记住什么 | 只为答错的点制卡，来源指向 wiki 概念页 |
| Study Space | 学到哪了 | 每个主题一份薄进度 |

普通编码会话不会因为加载扩展变成课堂。

## 安装

独立源码仓库：[mimimaster/piwin-study-space](https://github.com/mimimaster/piwin-study-space)，市场条目 id `mimimaster/piwin-study-space`。主仓 `packages/agent-host/standalone-extensions/study-space/` 只是 Host 集成测试用的副本，不随产品安装。当前版本 0.2.0，测试过的 Pi API 是 0.84.2。

讲解依赖 Host 的 `knowledge_search`、`wiki_read/write` 和闪卡工具。模型可能只能看到 `piwin_toolbox`，这时先 search/describe 再调用。缺少某个工具时陪练会说明一次并降级：没有 wiki 工具就把总结写在回复里，没有闪卡工具就不制卡。

## 使用

- `/learn [主题]`：开始一个主题，或按名称继续已有主题。不填主题时列出已有主题（最近的在前）和“新主题”。
- `/review`：到期复习与回炉。
- `/study`：看板，显示各主题已写入 wiki 的概念数、薄弱点和下一个概念。
- `/study save`：仅对下一轮生效，把刚才的对话整理成一页 wiki 概念。
- `/study off`：退出，保留进度、wiki 和卡片。

命令只选择模式，下一条消息开始这一轮；输入框上方会提示该发什么。0.1 的 `/teacher*` 命令已移除。

### 学习循环

1. 还没有路径时：检索知识库、读 wiki 索引，给出 3–7 个概念，标注“wiki 已有 / 待建 / 无资料”，保存路径并开始第一个概念。
2. 每个概念：依据资料短讲，只提一个问题，然后针对你实际写的回答给反馈。资料里没有的部分用通用知识讲，并明说不是来自你的资料。
3. 概念收尾：写入 wiki 概念页（只有真的答错过才有“曾经的误解”一节），再把概念标记为完成。
4. 制卡：每个概念最多 3 张，只针对答错的点；deck 用主题名，来源指向概念页。

### 复习

评分和调度留在原生闪卡面板。`/review` 报告各 deck 的到期数量；你把评为 Again/Hard 的卡贴出来或说出名字，陪练回到对应概念换个角度重讲并再问一次。学习模式开启期间，模型对 `flashcard_study_write` 的调用会被拦截。

## 确认与底线

- 制卡只确认一次：Host 对每次制卡调用弹出自己的权限确认（Host 处于 bypass 模式时除外）。扩展不再叠加弹窗。
- 说过不要卡片后（`cards: never`），学习模式下的制卡调用一律被拦截；重新开启需要弹窗确认。
- 看板只统计已写入的概念和记录的薄弱点，没有掌握度百分比。
- 扩展不改变可用工具集合，不在 Host 背后发起对话轮次，不读写 wiki 和卡库。

## 数据

只使用 `${PIWIN_ROOT}/study-space`（默认 `~/.piwin/study-space`）。每个主题一个 `<topicId>.json`：主题名、deck、有序的概念列表（名称、状态、wiki 页标题、薄弱点）。`preferences.json` 保存制卡偏好。

写入使用跨进程写锁、revision CAS 和原子替换。损坏的 JSON、未知版本、符号链接都会报错而不是被重置。崩溃留下的 `.write-lock` 不会被自动夺取：确认没有写进程并备份后，手动移除。

0.1 的课程文件保留在磁盘上但不再读取，不做迁移。

## 已知限制

- 运行时重建后学习模式会关闭：Host 每次重建都给 Pi 会话一个新身份，扩展无法认出同一个会话。用 `/learn` 按名称继续。
- 命令不能自己发起这一轮，需要 Host 提供能力。
- `/review` 不能替你打开闪卡面板。

## 验证

```sh
pnpm --dir packages/agent-host/standalone-extensions/study-space test
pnpm --dir packages/agent-host/standalone-extensions/study-space typecheck
pnpm --filter @piwin/host-runtime exec vitest run src/study-space.integration.test.ts src/extension-scanner.test.ts
```

扩展目录不带 node_modules，前两条需要先提供它声明的开发依赖。集成测试使用真实 Pi SDK 和 spawned RPC worker、同一份扩展、正常的 Toolbox/Host port 和真实原生卡片，模型响应由本地脚本提供。它证明协议和持久状态链路，不证明真实模型的教学质量和 Desktop 视觉效果。
