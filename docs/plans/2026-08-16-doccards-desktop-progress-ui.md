# Doc Cards Desktop 进度圈（补闭环）

> 产品口径不变。本文件只补 Desktop 异步反馈和生成按钮门闩。

**Goal：** Index / Generate 进行中显示进度圈和当前阶段；Generate 按钮看当前勾选文件是否 READY，不再看上次 Job 名字。

## 用户会看到什么

1. 可点「选择文件夹」，路径仍可手改。
2. 点 Index 后，面板出现进度圈：`Indexing 2/8 · Parsing`。
3. 点 Generate 后，进度圈：`Generating · Retrieving`。
4. 没选文件，或勾选的文件还没全部 READY，或正在入库/出卡 → Generate 灭。
5. 上次 Index FAILED 不钉死按钮：去掉失败文件后，剩下的若都 READY，按钮可亮。

## 实现

- `apps/desktop/src/doccards-progress.ts`：纯函数，从 Job 算出 `percent` + 文案。
- `apps/desktop/src/DocCardsProgressRing.tsx`：SVG 圈 + 百分比 + 阶段字。
- `DocCardsPanel`：poll `index-status` / `generation-status` 更新圈；门闩改成 `index-status.documents`。
- 选夹复用 `pickProjectDirectory`。

不改 Host 状态机，不造 STALE，不改翻卡样式。
