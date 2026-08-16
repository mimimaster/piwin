# Doc Cards 展示槽（固定格式，视觉后换）

卡片**格式固定**，皮肤后换。不要再塞进聊天气泡，也不要再用 artifact HTML 当 RAG 翻卡器。

## 放哪里

展示会话的 transcript **上方**，独立槽 `DocCardSurface`。

```text
┌ 会话顶栏：Doc cards: Notes
├ DocCardSurface          ← 固定看卡区，不进气泡
│  进度 3/12
│  一张卡：front / 翻面 back / 来源 / 评分
│  上一张 · 下一张
├ 指针消息（短摘要，无卡面）
└ 用户继续打字
```

翻卡只改这个槽的本地 index。不写 transcript，不改模型上下文。

## 固定格式（后面 UI 模型只能换皮）

一张卡永远是这些槽，不能加减：

| 槽 | 来源 | 空时 |
|---|---|---|
| workspace | `sequence.workspaceName` | 仍显示「Doc cards」 |
| progress | `index+1 / total` | 空态 |
| front | `card.front` | 跳过这张 |
| back | `card.back`，先藏着 | 空字符串也算有卡 |
| source | `sourceFile` + `sourceLine` | 不显示打开按钮 |
| ratings | again / hard / good / easy | 翻面后才出现 |
| nav | prev / next | 到头按钮灭 |

`card.id` 必须是 CardStore 里那张。缺卡跳过；一张不剩显示空态。

## 不要

- 不要把 front/back 写进 transcript
- 不要用 `buildFlashcardArtifactHtml` 当 RAG 翻卡器（那是聊天出卡路径）
- 不要把当前张悄悄塞给模型

聊天出卡仍走原来的 artifact 翻转卡，两条路径皮肤可以像，数据路径分开。
