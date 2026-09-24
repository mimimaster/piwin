# 调用链截图（墨面 · 真实环境）

项目介绍用的「agent chat 调用链」截图（五张）。**会话内容是编的，渲染是真的**：
假会话注入 mock Host，再由桌面端**出厂组件**（工作折叠、墨线工具链、探索胶囊、差异卡、
子代理印卡、评审行、目标卡、文件变更条、计划托盘 / 执行门、权限条、作曲器石板）渲染出来，
主题是 `piwin-inkstone-ink`（墨面）。

| 文件 | 尺寸 | 会话 |
|------|------|------|
| `01-endpoint-loop.png` | 2880×2360（1440×1180 @2x） | 端上闭环 · iPhone 16 Pro |
| `02-understand-and-persist.png` | 2880×4414（1440×2207 @2x） | artifact 沙箱 CSP · 结论沉淀 |
| `03-subagent-fanout.png` | 2880×2948（1440×1474 @2x） | 三块并行 · 3 个子代理 |
| `04-tool-families.png` | 2880×3120（1440×1560 @2x） | 工具家族一览 |
| `05-approval-gates.png` | 2880×3052（1440×1526 @2x） | 待批准 · ADR 写入 + 计划 |

## 怎么跑出来的

```bash
cd apps/desktop
PIWIN_E2E_PORT=1431 pnpm exec playwright test chain-showcase-shots --workers=1
```

Playwright 的 `webServer` 会带 `VITE_PIWIN_E2E_FIXTURES=true` 启 Vite（默认 1420，
若本机已有 dev server 在跑就换端口，否则会复用到没有 fixture 的那个），
应用内用 `HostClient` mock 传输；会话由 `?e2eChainShowcase=<key>` 注入，
key ∈ `endpoint` / `research` / `fanout` / `tooled` / `approval`（`all` 一次装全部）。
**每次只装一张图要拍的那条会话** —— 起笔页的最近会话只列 4 条（`MAX_RECENT_SESSIONS`），
5 条同时塞进去会有一条点不到。

| 文件 | 作用 |
|------|------|
| `apps/desktop/src/e2e/chain-showcase-fixture.ts` | 两条假会话（唯一改内容的地方） |
| `apps/desktop/src/e2e/mock-renderer-harness.ts` | `?e2eChainShowcase=<key>` → 装夹具（6 行） |
| `apps/desktop/e2e/chain-showcase-shots.spec.ts` | 开工程 → 开会话 → 截图（2x，自适应窗口高度） |

打开会话后 `expandWorkFold()` / `expandBatchCapsules()` 会展开折叠的工作区与只读胶囊
（历史轮的 work fold 默认收起；折叠体的子节点仍在 DOM 里但 `display:none`，所以要按可见性判断再点）。

截图前 `fitTurn()` 会把窗口高度撑到整轮可见，所以**图里是完整一轮调用链，不是被裁掉一半的滚动区**。
`deviceScaleFactor: 2` 在 `page.goto()` 之前设定（见 `e2e/README.md` 的采集契约）。

## 覆盖到的调用链面

工程会话壳：标题带（交通灯 / 分支 / 墨纸切换）、左栏会话列表、右侧工作区、作曲器石板
（模型 / 运行模式 / 编排方案 / 计划托盘）。

**01 端上闭环**：思考笺 · 工作折叠头 · 墨线工具链（8 行，完成态绿点）·
`pi_ios_doctor` / `pi_ios_react_native`（doctor、start-metro）/ `pi_ios_simulator`（boot、screenshot）/
`pi_ios_build_run`（xcodebuild + exit 0）/ `pi_ios_ui`（snapshot、assert-visible）· 助手正文。

**03 三块并行**：`piwin_plan_create`（4 步 · 3 可并行）· 三个 `piwin_subagent_run`
（青色子代理印卡 ×3，worktree + profile）· `piwin_subagent_wait` 聚合行
（已等待 · 已收集 3 · 失败 0 · 已取消 0 · 待处理 2，runs 三条：merged / pending / conflict）·
`piwin_subagent_continue`（repair 第 2 轮）· `piwin_subagent_result_apply` · `piwin_subagent_verification_submit` ·
`git worktree list` 行 · `subagentActivity` 生命周期卡（已合并 · 工作树）·
计划托盘（subagent-driven 执行中，4 步状态 Done/Active/Pending）· 助手汇总正文。

**04 工具家族**：`browser_navigate` / `browser_snapshot` / `browser_screenshot` · `web_fetch` ·
`image_gen`（图片生成完成卡：18s + 打开 / 资料库）· `read` 截断标签（2841 行只读前 400 行）·
`flashcard_batch_create`（3 张卡 · 牌组 tauri · 点击翻转 + 1–4 评分）· `note_write`（允 印）·
`knowledge_read` + 引用卡 · `process_start` / `process_logs`（可展开日志）·
`piwin_toolbox`（查找可用工具卡）· `goal_wait`（已等待 45 秒）· `video_gen`（视频生成完成卡）。

**05 待批准**：**计划执行门**（draft 计划 + 已完成的 run，选放行 / 子代理驱动）·
**权限门 / 权限条**（`permission/request` 的允许一次 / 本会话允许 / 拒绝）·
**目标受阻卡**（`goal_blocked`：受阻原因 + 需要你的决定）· `read_file` / `grep` 行 + 助手正文。
这两张门卡**不是**播种数据能造出来的：执行门要求该轮有一条已完成的 Run 记录，
权限门要求一条 pending 的权限请求 —— 夹具在启动后用稳定 `eventId` 补推这两条 Host push，
所以走的是真实门控路径。

**02 理解与沉淀**：探索胶囊（`code_search`/`grep`/`read` 自动聚成 1 项失败 8 工具）·
文件 pill + 行号胶囊 · `web_fetch` 失败行（crimson + 展开的错误体）· `web_search` 源诊断（1/3 源失败）·
`knowledge_search` 行 + 正文里的引用卡 · `write_file` 内联差异卡（hunk / 拒绝 / 接受 / 全部差异）·
`bash` 测试行 · 子代理「等待」行（已收集 1 · 失败 0）· `wiki_write` · `mcp__agent-memory__…`（MCP 徽记）·
目标达成卡（成果 / 验收证据 / 涉及文件）· 2 个文件已更改条 · 报告卡 · 计划托盘（执行中，1 步 active）。

## 已知缺口（想补就说）

- **多子代理的评审环**（`SubagentReviewSummary`：候选 / 复核 / 应用 / 验证四态）只在
  子代理检查器面板里渲染（transcript 不传 `subagentResults`/`reviews`），且数据来自
  `subagent/*` 命令 + 推送；现在用「三个印卡 + 聚合等待行 + 生命周期卡」表达并行子代理。

- 已解决：计划执行门 / 权限门见 05（夹具补推 run 记录与权限请求）。
- 报告卡的正文是 mock 合成的英文占位串（`host-client-mock-ops.ts` 的 `walkthrough/list`），
  卡片本身是真的；要中文占位改那一行即可。
- 工具行里的 diff 统计来自 mock 的固定 patch（恒为 +2 −1），所以两张差异卡数字相同。
