# Doc Cards 产品口径（2026-08-16）

按用户当面拍板整理。实现和改 Spec 都以这份为准。

两条出卡路径互不掺和：

| 路径 | 是什么 | 本文件管不管 |
|------|--------|----------------|
| RAG 出卡 | 选文件夹 → 入库 → 生成闪卡 | 管 |
| 聊天出卡 | 会话里直接让模型写卡 | 不管。独立 Schema，独立路径 |

---

## RAG 路径（一次性 = 不做过期，不是只能出一轮）

1. 必须先选本地文件夹。文件夹名 = Workspace / 空间名。
2. 可以不勾文件（= 当前支持的全部），也可以勾一部分。
3. 只解析支持的类型。配了 MinerU 才能做 PDF。不支持的不当成功。
4. 后台异步入库。前端进度条。做完通知。做完 = 选中的支持文件都进**检索索引**（配了 embedding 才有向量；没配则 FTS-only，仍算出库完成）。
5. 没入完，生成按钮不亮。不能边入边生成。
6. **一次性**只表示：不管磁盘后来改没改，不做 STALE / 过期检测 / 改文件自动灭按钮。用户自己对资料负责。**不是**只能 Generate 一次。
7. **不做文件过期 / STALE / 改文件后自动灭按钮。** 后续 RAG 再扩展是以后的事。

## 出卡与存储

8. 入库完成后，用模型按 RAG 流水线出卡。同一文件夹可以再 Generate。
9. 只写进现有卡片库一份。会话里不另存一套。
10. `sequenceId` + `position` 只给展示：上一张 / 下一张。不是复习调度，不是知识图谱。展示会话里可以评分，写的是同一份 FSRS。

## 展示

11. 生成完新开一个 chat 会话。**0 张新卡（例如全部重复）不开会话。**
12. 会话里临时按顺序翻卡（动画/点击下一张）。翻卡动作不写进 transcript。
13. 用户可在这个会话里换模型、继续问问题。模型靠开场短摘要 + `flashcard_list`；不知道「正在翻哪一张」。要对某张卡说话，用户自己提编号或问题。
14. 翻的是卡片库里那批卡，不是第二份数据。缺卡就跳过；一张不剩就空态，不崩。

## 2026-08-16 补锁定（对话）

15. **展示会话 = transcript 指针消息。** 新 general 会话写入一条产品消息，只存 `{ sequenceId, cardIds, generationId, workspaceName }`，不存 front/back。UI 按 `sequenceId` 向 CardStore 现查、按 `position` 排；`cardIds` 只是创建时快照。重开这个会话还能翻。
16. **这个会话关掉 `flashcards-write`。** 没有 `flashcard_create` / `flashcard_batch_create`。`flashcards-read`（`flashcard_list`）和 artifact 的 rate / open-source 保留。提问不会再写出第二批卡。
17. **同一文件夹可以再 Generate。** 每次新 `generationId` + 新 `sequenceId` + 新 chat。卡片仍进同一个 CardStore。去重按同一 `sourceFolder`（没有 sourceFolder 的聊天卡仍按 deck）。按钮只看「当前勾选的支持文件都 READY，且没有 RUNNING 的入库/出卡 job」。上次 Job 是 FAILED / CANCELED 不钉死按钮。
18. **Topic 选填。** 有字用用户输入当检索 query；空则 `query = workspaceName`（文件夹 basename）。Generate 不因为没填 topic 而灭。
19. **继续聊不跟踪翻卡位置（方案 A）。** 不把上一张/下一张写成 transcript，也不把当前卡打进隐式模型上下文。

## 闭环补全（2026-08-16 文档自洽）

20. **生成按钮看当前勾选，不看上次 Job 名字。** 去掉失败文件后，剩下的若都 READY，按钮可以亮。
21. **0 张新卡：** Job `COMPLETED`，`created=0`，不开新会话。UI 提示可能都是重复。
22. **0 个有效 chunk：** 该文件 `FAILED`，不当 READY。
23. **只勾了不支持的文件：** Index 直接拒绝，不空跑 COMPLETED。
24. **Host 重启：** 遗留 `RUNNING` 标成 `FAILED`，原因 `HOST_RESTARTED`，避免按钮永久灭。
25. **卡片已写入、开会话失败：** 卡片保留，Job `COMPLETED_DEGRADED`，push 仍带 `cardIds`；Desktop 可补开，或去卡片库看。
26. **deck 默认 = 文件夹名**（给人看）。两个都叫 `Notes` 的文件夹不去重误伤，因为去重范围是 `sourceFolder`。
27. **再点 Index 的 SKIP** 不是过期产品：只有 `file_hash` 和 parser/chunker/embedding 配置 hash 都相同才跳过。换模型必须重嵌入。

## 明确不做（RAG 这条）

- 入库未完成就生成
- 入库和生成并行
- 会话里再存一份卡
- 文件过期检测
- 把「聊天直接出卡」揉进这条 RAG 流水线
- 出完一次就锁死 Generate
- 用文件夹绝对路径当空 topic 的检索 query
- 把翻卡位置写进 transcript / 隐式同步给模型
