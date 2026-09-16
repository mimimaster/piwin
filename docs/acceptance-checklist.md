# piwin 验收清单（Canonical）

| 字段 | 值 |
|------|-----|
| 更新 | 2026-09-16 |
| 适用范围 | Desktop（Tauri）本地 Host + 工作台 v1 + 既有功能回归 |
| 交互记录台 | [`piwin-test-bench.html`](./piwin-test-bench.html)（25 组 / 159 条，唯一记录入口） |
| 历史台（待归档） | [`feature-test-checklist.html`](./feature-test-checklist.html)（22 组 / 110 条，含 7 条已废弃） |
| 关联 | [`release-desktop.md`](./release-desktop.md) · [`adr/0071-docking-workspace-topology.md`](./adr/0071-docking-workspace-topology.md) · [`specs/2026-09-15-docking-workspace-product.md`](./specs/2026-09-15-docking-workspace-product.md) §11 · [`product-status.md`](./product-status.md) |

本文件是**唯一的验收入口**：先跑自动化门禁，再跑手工台，最后跑实机发布门禁。每条验收都要留下证据（命令输出 / 截图 / 日志），无证据不算通过。

状态图例：`todo` 未测 · `pass` 通过 · `fail` 失败 · `skip` 跳过（写明原因） · `blocked` 阻塞（写明阻塞源）

---

## 1. 自动化门禁（必须先全绿）

在仓库根目录执行。任一条红，不进手工验收。

| # | 命令 | 覆盖 | 何时必须跑 |
|---|------|------|-----------|
| 1 | `pnpm typecheck` | 全 workspace 类型（`mobile` 被排除） | 每次提交前 |
| 2 | `pnpm test` | 各包单测 + 集成测 | 每次提交前 |
| 3 | `pnpm test:architecture` | 包边界（apps ↛ Pi、contracts 叶子等） | 每次提交前；本地实测 **2026-09-16 通过** |
| 4 | `pnpm test:cold-storage` | 冷存储/打包/恢复：pack 哈希、body 守卫、journal 崩溃恢复、Host+CLI 命令、Desktop restore-first | 改动会话存储时（ADR 0044 R1 门禁） |
| 5 | `pnpm e2e:host-jsonl` | Host JSONL 端到端 | 改动 Host/传输时 |
| 6 | `pnpm e2e:desktop` | Desktop 端到端（含视口/视觉基线） | 改动 Desktop UI 时 |
| 7 | `pnpm bundle:host && pnpm test:bundle` | 打包后的 Host sidecar 冒烟 | 改动打包/bundling 时 |
| 8 | `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | Rust 壳单测 | 改动 Tauri 壳时 |
| 9 | `pnpm automated-prerequisite-gate` | 上述聚合（typecheck + test + architecture + e2e:desktop + e2e:host-jsonl + cargo） | 发版前置总闸 |

`pnpm check` = `typecheck` + `test` + `test:architecture`，是日常最小门禁。

## 2. 工作台 v1 硬验收（ADR 0071 · 切片 E）

来源：docking 产品规范 §11.2。**当前交互台无任何覆盖，属新开工单**。逐条勾选。

- [ ] **多会话并行无干扰**：双会话同时高速流式输出，任意拖动窗格、成组、切换焦点，发话/打断/模型切换/权限确认均精准指向目标会话。
- [ ] **消除副窗格特权差异**：副窗格拥有主窗格全部能力；不支持的功能严格受限于 Scope 或 Host Capability，绝不因处于副窗格而降级。
- [ ] **草稿与输入绝对保全**：移动、多标签切换、分屏重排过程中，未发送文本、上传中的 File 对象、图片引用、滚动高度无损；重启后丢失的物理附件有显式恢复指引。
- [ ] **比例恢复不变形**：设 70% / 30% → 拉窄触发聚焦展示 → 拉回，比例精准还原；展开右栏不挤爆主舞台。
- [ ] **最大化逻辑自洽**：A 最大化时在侧栏点会话 B，B 所在窗格成为唯一最大化视图；`Esc` 退出最大化并平滑恢复多窗；`Esc` 不误杀 Agent 运行。
- [ ] **有限模板严守约束**：模板仅单窗 / 左右 / 上下 / 四宫格；三窗只能由拖拽生成；减组不丢标签；主舞台硬上限 4 格，拉大窗口不自发新建第 5 格。
- [ ] **首批工具跨区无损**：浏览器、画布、变更三个视图在主舞台与右栏间往返 20 次，页面租约不断、画布 WebGL/JS 临时状态不丢、文档阅读位置不漂移、终端后台进程不受扰。
- [ ] **最近关闭重开有效**：`⇧⌘T` 或菜单能精准重开最近关闭视图；原窗格不存在时降级到当前活动组或右栏，不克隆重复视图，不自动重放危险命令。
- [ ] **未开放工具防穿透与友好反馈**：未开放跨区的工具不暴露把手/菜单项，不能靠组交换绕过；悬停主舞台时必须提示「该工具暂不支持放到主工作区」。
- [ ] **跨项目引导可操作**：跨项目拖拽被拒后，提示气泡带「切换到该项目」按钮，点击后平滑跳转并恢复目标布局。
- [ ] **单组默认体验合规**：单组单标签不显示标签条；超出视口按 MRU 收进「更多 N」并显示运行中状态；24 视图上限友好拦截并弹视图管理器。
- [ ] **右栏全宽正名落地**：文案为「右工具区临时展开」，与「移至主工作区」清晰区分，不改拓扑、不写持久化。
- [ ] **外部拖入防误劫持**：外部文件拖入、系统标题栏拖窗、编辑器正文选中、终端内文本拖拽，均不被工作台拖放系统错误拦截。
- [ ] **异常中断安全回退**：拖拽中 `Esc` / 失焦 / 项目切换 / 远程断网，事务无条件瞬时撤回，遮罩与光标干净复原。
- [ ] **旧数据迁移兜底完备**：覆盖损坏 JSON、丢失会话元数据、旧版非常规比例；5～8 格降级为四宫格且后置会话保留为标签，弹一次性通知，绝不静默清空。
- [ ] **实时订阅预算受控**：任意状态下全量实时订阅 ≤ 8 路，优先级按 §9.5 运作；预算外隐藏会话切回走标准 Resume，后台任务不中断、消息不遗漏。
- [ ] **无障碍与键盘全功能**：所有拖拽都有右键菜单与快捷键替代；Tab 顺序与视觉一致；读屏文本含角色与所属会话。
- [ ] **跨平台实机门禁**：首发必须在 macOS Tauri 真机跑全量门禁；同批发 Windows 时必须在 WebView2 实机复测，不用浏览器 Chromium 代打。

## 3. 工作台性能基准（规范 §11.3）

固定设备、固定视口分辨率、固定推送流速与画布复杂度下测量：

| # | 指标 | 门槛 | 结果 |
|---|------|------|------|
| 1 | 落点预览遮罩渲染 p95 时延 | ≤ 50 ms | |
| 2 | 释放鼠标 → DOM 投影完成的主线程长任务阻塞 | < 100 ms | |
| 3 | 20 次跨区拖拽后 JS Heap / DOM 节点数 | 回落基准线，无监听器泄漏与 Detached DOM | |
| 4 | 4 路并发流式下当前聚焦会话的键盘输入 | 对比单窗基线无可感劣化 | |

## 4. 手工功能回归（交互台 25 组 / 159 条）

在 [`piwin-test-bench.html`](./piwin-test-bench.html) 逐条记录状态（浏览器 localStorage 保存，状态键 `piwin.feature-test-bench.v1`）。

| 组 | 标题 | 条数 |
|----|------|------|
| start | 启动与默认空间 | 8 |
| session | 会话管理 | 12 |
| tree | 会话树与回合修复 | 10 |
| chat | 对话显示与交互 | 8 |
| composer | 输入框与发送控制 | 13 |
| compact | 上下文压缩 | 6 |
| slash | 斜杠命令 | 7 |
| multipane | 多对话窗格 ⚠️ 需重写为工作台组 | 6 |
| models | 模型与登录 | 6 |
| perms | 权限与写闸 | 5 |
| right | 右侧工作台 | 10 |
| ctxmenu | 右键菜单 | 5 |
| artifact | Artifact 与生成媒体 | 5 |
| media | 资料库 / 图片 / 视频 | 3 |
| flashcards | 闪卡：家、来源、出卡 | 9 |
| study-seq | 闪卡：过一遍 | 8 |
| study-due | 闪卡：今日复习 | 4 |
| skills-mcp | 技能、MCP、扩展 | 6 |
| agent-extra | Goal、子代理、计划、Walkthrough | 5 |
| web | 联网搜索与抓取 | 3 |
| settings | 设置页冒烟 | 8 |
| live | 语音 Live | 2 |
| palette | 命令面板与快捷键 | 3 |
| resilience | 稳定性与恢复 | 3 |
| cli | CLI 冒烟 | 4 |

**待处理项**

1. `multipane` 组 6 条写的是 ADR 0063 的旧引擎（1/2/4/8 预设、主窗格特权、仅 Conversation 可拆）。ADR 0071 已取代该模型（两层 group、硬上限 4 组、工具视图可移动、无主窗格特权）——这 6 条现在**会验出错误行为**，必须改写或删除，并由 §2 接替。
2. `feature-test-checklist.html` 已被 bench 覆盖 103/110 条；剩余 7 条中 `slash.stop-compact`、`settings.usage` 等已随产品改动失效。建议归档该文件，只留 bench。
3. 覆盖缺口（相对当前 main）：
   - 工作台 v1（ADR 0071）：0 条 —— 见 §2 / §3；
   - 浏览器工作台（ADR 0057 / browser find / viewport / tabs）：仅 2 条，缺标签页、查找、视口切换、截图验证；
   - CLI：4 条，`piwin doctor/chat/session/study` 之外无覆盖。

## 5. 打包与发布门禁

按 [`release-desktop.md`](./release-desktop.md) 执行；私有 v1 允许不签名。

- [ ] `pnpm package:desktop` 产出 all-in-one 安装包（macOS dmg / Windows NSIS current-user）
- [ ] `pnpm package:desktop-shell` 产出瘦壳，启动落在连接墙
- [ ] `pnpm package:host` 产出 `dist/piwin-host/`，`./start-host.sh` 起 `ws://127.0.0.1:8787`
- [ ] **不得同时**运行 all-in-one Desktop 与独立 Host 于同一个 `~/.piwin`
- [ ] 干净机器冒烟（S5）通过 —— 未通过前只做内部/开发分发
- [ ] Windows 版本在 Windows 上构建（不跨编译），WebView2 实机复测
- [ ] Linux `lancedb` 原生只带当前平台一个，FTS 使用 ICU tokenizer
- [ ] 签名/公证：有证书时执行；无证书记录为 D-ENG-03b 残留

## 6. 文档同步门禁（规范 §12.1）

首批上线前必须同步，缺一不发布：

- [ ] 工作台拓扑决策沉淀到 ADR（工作台 v1 两层级、4 格上限、单组折叠、无损降级、最近关闭栈）
- [ ] 浏览器镜像租约与画布视图的跨区移动保活生命周期写入 ADR 0057 / 0020
- [ ] 「右栏全宽」相关描述全部改写为「右工具区临时展开」
- [ ] 终端 PTY 独立生命周期（ADR 0013）**不得**提前写成已上线

## 7. 证据与记录

- 自动化：贴命令 + 结尾状态行（例：`Package boundaries OK`），不贴猜测结论。
- 手工：每条附截图或日志截图，文件名带日期与条目 id（如 `2026-09-16-pane.drag-split.png`）。
- 失败：登记到 [`todo-deferred.md`](./todo-deferred.md) 或当轮 bug register，写清复现步骤，而不是就地改口径。
- 结论只写实测过的内容；未跑就说未跑，`blocked` 必须写明阻塞源与解阻条件。
