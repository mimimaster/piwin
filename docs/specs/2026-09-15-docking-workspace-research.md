# 会话与工具自由分窗：复核调研及产品方向

- 日期：2026-09-15
- 状态：**调研 / 产品建议，尚未实施，不替代已接受 ADR**。
- 目标：会话可拖动分屏，工具可在右栏内部上下分组，也可移入主舞台；布局形状有限，操作可恢复。
- 本轮范围：当前工作区代码审查、官方资料复核、现有测试、布局纯函数复现。未操作 Claude 实机，未完成 Tauri 原生拖拽原型或性能实测。
- 当前工作区有大量其他任务的未提交修改；本轮只新增本文，不改应用代码。

后续已收敛为[产品方案 v1（范围收缩版）](2026-09-15-docking-workspace-product.md)：产品负责人确定首批四格硬上限、按尺寸决定可用分屏、四个模板、重开视图及浏览器/变更/Diff/文档/画布移动；布局撤销后置，终端移动与右栏上下两组放第二批。本文下方的宽屏八格、撤销及全工具建议保留为历史调研，不作为当前实施范围；具体交互、容量、生命周期与验收以产品方案为准。

## 1. 结论

建议方向是 **有限布局的多会话工作台**：统一会话和工具的视图身份、焦点和移动规则，再提供拖拽。技术上优先采用 **产品自有布局规则 + 现有几何算法 + Pragmatic drag and drop**。

这不等于在现有代码上补几个 `draggable`。现有“主窗格 + 简化附加窗格 + 独立右栏”只能作为迁移起点。需要先拆开布局、会话状态、工具资源生命周期，消除主窗格特权。

Dockview 是有竞争力的备选，不能仅因“重”“外观固定”排除。若近期范围变成任意标签组、自由浮动、多原生窗口、复杂停靠边栏，应重新比较完整框架的总成本。无论选哪种库，草稿、PTY、会话路由仍需 piwin 自己负责。

建议的交付顺序：**稳定当前分窗 → 统一会话视图与移动命令 → 会话拖拽 → 工具双区停靠 → 原生多窗口（独立项目）**。终端/浏览器生命周期验证应在早期进行，不能拖到工具接入末尾才发现模型不成立。

## 2. 上一份调研需要修正的地方

| 原判断 | 复核结果 | 对方案的影响 |
| --- | --- | --- |
| Claude 的 `col/row` 证明它是固定列行网格 | 坐标输出可以来自树布局、网格或其他布局算法，不能反推内部模型，也不能推出 4 列 × 2 行上限。本轮没有该接口的可复核调用记录 | 4×2 只能是 piwin 的产品建议，不能称 Claude 已验证规则 |
| Claude 的拖放中心一定替换/交换 | 官方公开资料确认窗格可拖动排列，但未在查到的章节规定中心落点语义 | piwin 要自行明确交换、成组、打开的区别 |
| 浏览器面板是 iframe | 当前 `BrowserSessionPanel` 使用 `<img>` 展示 Host 镜像帧 | 浏览器移动应保住租约、控制权和 Host 页面，不能套用 iframe reload 结论 |
| 浏览器有租约，所以只能存在一个视图 | Host 使用 `Set` 管理多个镜像租约；镜像消费者和交互控制权是不同概念 | 首版一个浏览器工具视图可以是产品限制，但不是租约系统强制单实例 |
| 把终端 DOM 用 `appendChild` 搬走就能解决生命周期 | `useTerminalSessions` 卸载会 close-all；`XtermSurface` 自己也在卸载/依赖变化时关闭对应 PTY | 必须分离两层资源归属，仅上移列表状态不够 |
| React Mosaic 新版仍与当前二叉树完全一致 | 官方 v7 发布说明已转向 n 叉树并引入一等标签节点 | 不能按旧版模型估算接入成本 |
| 0.x / 包体大即可判定不合适 | 版本号不能代替维护和能力评估，本轮未做生产包体积测量 | 比较模型适配、生命周期、限制能力和迁移成本 |
| 每次放下后全部均分 | 会抹掉用户调整好的会话/代码阅读空间 | 默认只分配受影响区域；“均分”作为显式命令 |

Claude 官方资料明确描述 Code 页中的 chat、diff、browser、terminal、file、plan、tasks、subagent 窗格可拖动排列，并支持将窗格弹出。该来源针对 **Code 页**，不应泛化到 Chat/Cowork 的全部行为。[Claude Code Desktop](https://code.claude.com/docs/en/desktop#arrange-your-workspace)

React Mosaic v7 的模型变化见其[官方发布记录](https://github.com/nomcopter/react-mosaic/releases)。

## 3. 当前“脆弱”在哪里

### 3.1 已有资产值得保留

- 纯布局树及矩形计算、尺寸约束、几何焦点导航、键盘分隔条。
- 每个 scope 的布局存储、重复会话去重、关闭窗格不终止会话。
- 主舞台目前已将叶子展开成平级、以 `paneId` 为 key 的 DOM；**不能简单归因为“树布局每次 resize 都会重挂载”**。
- 共用的消息渲染、模型选择、前台 Run 命令、HostClient 和会话订阅并集。
- 右栏工具现有内容组件、能力探测、浏览器镜像租约及控制权机制。

### 3.2 代码证据与风险分级

“代码确定”表示实现可直接读出；“函数复现”表示本轮运行了当前纯函数；“风险”表示有具体路径，但未完成实机复现。

| 问题 | 证据 | 用户影响 / 判断 |
| --- | --- | --- |
| 主/副窗格不对等 | `conversation-pane-workspace.tsx:393` 起的分支：主窗格用传入的 `primaryPane`，副窗格用独立 `ConversationPaneSession`；主窗格禁止关闭 | 同一会话换位置可能跨两套 UI/状态管线。代码确定，移动前必须处理 |
| 焦点与工具目标分离 | `workbench-app.tsx:161` 已用聚焦会话给 Live；`:771` 仍把主 `state.activeSessionId` 传给 inspector，`:773` 起传主 composer 回调 | 副会话获得焦点后，侧聊、附件回填等仍可能针对主会话。代码路径确定；具体交互需集成验收 |
| 副窗格草稿在局部状态 | `conversation-pane-session.tsx:107`；`:192` 的 effect 会清空 composer 并 resume，依赖包含 locale/session | 替换后再打开会话没有该组件提供的草稿恢复；跨容器/身份变更有丢草稿风险；语言切换也应验收 |
| 缩小窗口会改写用户比例 | `conversation-pane-workspace.tsx` 的 ResizeObserver 调 controller.update；layout constrain 改 ratio；hook 保存该 layout | 70/30 → 窄窗 50/50 → 宽窗仍 50/50。函数复现 |
| 减少预设会丢视图绑定 | `conversation-pane-layout.ts:367` 直接 `slice(0, count)` | 2→1→2 后第二个会话变空格。会话本身未删除；是布局语义及恢复能力不足。函数复现 |
| 焦点可以落在最大化遮住的窗格 | `focusConversationPane` 只改 active；`toggleMaximizedConversationPane` 单独维护 maximize | 最大化 A 后 focus B 得到 active=B、maximized=A。侧栏已有调用 focus 的路径。函数复现，实机键盘影响待验收 |
| 右栏与舞台分别计算空间 | pane minimum 300×220；右栏保留的 stage minimum 是 420px | 420px 能放一个主会话，不能保证两个会话。打开/加宽工具栏可能压坏已有分屏；应由整体布局判断 |
| 预设尺寸检查只看是否减少数量 | `conversationPanePresetFits` 对 targetCount≤currentCount 直接 true | 例如窄的纵向四格改成横向二格，数量减少也不代表宽度足够。代码确定 |
| 工具状态和位置紧耦合 | `right-panel.tsx:107` 仅活动工具挂载，终端是例外；openTabs 是组件内部状态，activeTab 来自外部 | 两个独立状态更新不能保证“右栏移除 + 舞台插入”原子完成 |
| 终端有两处破坏性 cleanup | `use-terminal-sessions.ts:174` close-all；`xterm-surface.tsx:223` close 当前 PTY 并 dispose | 搬移不能等同关闭；close-all 对未来多窗口尤其危险 |
| 有限订阅不等于无限标签 | `use-conversation-pane-layout.ts:122` 截到 8；contracts live 上限也是 8 | 引入隐藏标签、固定工具绑定后，要重新计算订阅并集，不能静默截掉用户正在看的会话 |

来源均为本轮工作区快照；行号随其他任务修改可能变化。

### 3.3 纯函数复现结果

| 输入步骤 | 实际输出 |
| --- | --- |
| 双列设 ratio=0.7，constrain 到 500×600，再到 1400×600 | `0.7 → 0.5 → 0.5` |
| A/B 双窗，applyPreset(1)，再 applyPreset(2) | 第二个叶子 sessionId 由 B 变为 null，且 paneId 重建 |
| maximize(A)，focus(B) | `activePaneId=B`，`maximizedPaneId=A` |

这些输出可以直接调用 `conversation-pane-layout.ts` 的现有导出复现，无需 Host。不能据此宣称已复现完整 Tauri UI 故障，也不能将预设收起误报成会话数据删除。

### 3.4 结构规模

当前 `workbench-app.tsx` 972 行、pane session 577 行、pane workspace 457 行、layout 431 行、inspector 482 行、right-panel 436 行。新增能力必须按状态/策略/视图拆分；不要继续向总装文件塞拖拽、资源池和持久化。

## 4. 推荐产品契约

以下是可评审的推荐默认值，尚未作为已接受需求实施。

### 4.1 两个停靠区域，一个工作台

- **主舞台**：会话、终端、浏览器、文件/变更/文档等可并排。
- **右工具区**：最多上下两组，每组可有多个工具标签；首版不将会话放入窄右栏。
- 工具可从右栏移到舞台，也可移回；来源位置保留在视图记录里。
- 同一个工具视图只出现在一个位置；工具入口始终可找到。已移出工具再次从“+”打开时，定位已有视图，避免用户觉得功能消失。
- 独立原生窗口是另一层能力，不与本次“窗口内分屏”混为一谈。

### 4.2 有限格式应以阅读任务为中心

建议首版常用模板：单窗、左右双窗、上下双窗、主区域+两个辅区域（允许旋转/镜像）、2×2。新增三窗能力很重要：会话+终端+预览比强迫凑成四格更自然。

```text
双会话                 会话 + 两种工具             右栏上下分组
┌───────┬───────┐      ┌─────────┬──────┐         ┌─────────┬──────┐
│ 会话A │ 会话B │      │         │ 预览 │         │         │ 文件 │
│       │       │      │  会话A  ├──────┤         │ 会话舞台├──────┤
│       │       │      │         │ 终端 │         │         │ 终端 │
└───────┴───────┘      └─────────┴──────┘         └─────────┴──────┘
```

主舞台常用 1–4 格；保留现有最多 8 格作为宽屏高级能力，不把 8 格设为默认体验。**主舞台上限 8、右栏最多 2 个可见组、Host 会话 live 上限 8 是三个不同限制**；整体是否容纳还要看像素和资源预算。隐藏的打开标签不计可见格数，但仍占状态/缓存预算。

不建议把任意叶子的“左/右”固定解释成“增加整列”：在右侧已有上下两个工具时，拖入左侧会引起无关区域一起变化。应先生成候选布局，再验证它是否属于允许形状；预览必须展示所有受影响区域。

模板是可旋转/镜像的拓扑约束，尺寸比例允许调节。既存不在新模板内的合法 v1 布局应先保留为兼容布局；不能迁移时强制均分或删掉会话。

### 4.3 落点语义：同一动作只有一种可解释结果

| 来源 → 落点 | 建议行为 |
| --- | --- |
| 侧栏尚未打开的会话 → 舞台边缘 | 新建视图并拆分；只接受合法、能放下的候选布局 |
| 已打开会话/窗格 → 舞台边缘 | 移动既有视图，完成后收拢空区域；不复制会话，不重复 resume |
| 侧栏会话 → 舞台中心 | 打开为该组标签并激活；已有视图则移动到组内，避免重复 |
| 窗格标题 → 舞台中心 | 默认加入目标组标签；“交换位置”单独通过菜单提供 |
| 工具标签 → 舞台边缘/中心 | 分屏或加入标签组，整体移动同一个工具视图 |
| 工具 → 右栏标签带 | 移入该组并排序 |
| 工具 → 右栏上/下边缘 | 当前只有一组时建立第二组；已有两组时给出禁止原因 |
| 外部文件/内部文件树路径 → 输入框 | 沿用附件/上下文流程，绝不触发布局操作 |
| 会话 → 不同项目 scope | 首版不隐式跨项目切换和混排；保留原布局，解释原因 |

主舞台标签组可保持轻量：一张标签时不加冗余标签条，多张时才显示。分组能让中心落点和“减少可见格数”都有不丢内容的语义，但也会增加状态复杂度。若实施切片暂不做标签组，**有内容的中心落点先禁用**，只能向空格打开/通过菜单交换；不能用静默覆盖凑数。

放下前校验最终布局：先在候选状态移出源视图，再计算新增/合并，而不是因为源仍占一格就误报“已到上限”。源/目标失效、scope 改变、窗口 resize 都要重验；失败不改原布局。

### 4.4 让用户敢拖：可预测、可恢复

- 移动保留草稿、附件、滚动位置、选中模型、运行状态及工具资源身份。
- 同一窗口里同一 session 只保留一个可编辑会话视图；点击已打开会话首先定位它。
- 新分屏只调整受影响区域；均分全部是显式命令。
- “布局改成一格”合并到标签或收起区；“最大化”临时隐藏其他区域；“关闭视图”移除视图。三者不能共用删除叶子的语义。
- 提供“撤销布局调整”“重新打开已关闭视图”“恢复默认布局”。撤销只回退布局，不能撤销发送消息或重启进程；恢复引用前重新检查资源是否还存在。
- 全窗口最后一个会话视图可关闭，留下空舞台或工具；不再保留用户无法移动/关闭的特殊主窗格。
- 单窗状态也要有易发现的“移到右侧/下方”菜单和拖拽把手，不能要求先通过快捷键分屏才看到入口。
- 非法落点显示简短原因，如“宽度不足”“右栏最多两组”；不要只有禁止鼠标图标。
- Esc 取消拖动；菜单、IME、终端按键与窗口拖动区域有明确优先级，取消布局操作不应停止 Agent。

### 4.5 空间不足时不破坏布局

实际可用舞台 = 窗口内容宽度 − 左导航 − 右工具区 − 分隔条/边框；高度还要扣掉标题、组标签和必要 composer。不同视图有不同最小尺寸，不能统一用 300×220 当“可用性证明”。

例如仅四列会话最低就需要 1200px。当前窗口默认宽 1280px，加入任一侧栏后通常已不够。因此 4×2 应是宽屏模式；主聊天完整 composer 现有舞台基准又是 420px，值得作为可读性验证起点，而非直接承诺 300px 足够。

建议：新增分屏在不满足最小尺寸时拒绝；窗口缩小时保留用户原始比例，将不足以展示的区域临时收为标签/提供“显示其余 N 项”；手机保留现有只呈现活动窗格方式。变宽后恢复用户布局，不写入临时收缩比例。

右栏已有“拖过阈值展开覆盖舞台 / 收起”行为：统一处理 `聚焦视图最大化` 与 `右工具区展开` 的展示状态，避免两个布尔值同时隐藏不同区域。继续保留原有入口及恢复尺寸；拖工具标题不能误触发右栏 splitter 的 overshoot。

## 5. 焦点与上下文：比拖拽库更重要

至少区分三个身份：`focusedViewId`（键盘在哪）、`lastFocusedSessionId`（工具区操作的会话目标）、工具自己的绑定。点击终端后不能把“当前会话”变成 null；聚焦空会话时也不能悄悄向之前会话发送。

| 工具/动作 | 默认上下文建议 | 规则 |
| --- | --- | --- |
| 会话发送/停止/模型选择 | 该会话视图自身的 session/run | 直接携带身份，不读取全局主 session |
| 文件树、仓库变更 | 当前项目或明确 worktree | 会话只在相同项目内切换不应重建；未来跨项目布局再扩充 |
| Tasks、跟随式 inspector | 最近聚焦的有效会话 | 显示“跟随当前会话”，支持固定；其计划数据必须一起切换，不能只换标题 |
| 侧聊 | 创建时的父会话/分支 | 固定绑定；不随焦点替换讨论来源 |
| 文档、Diff、Artifact | 打开时的资源定位及来源会话/message | 固定；另一会话的自动预览不能覆盖固定文档 |
| 终端 | PTY 实例 + 本机 cwd | 移动不 cd、不重启；切换会话不改变执行环境；远程 Host 连接下明确“本机终端” |
| 浏览器 | Host 浏览器资源 + 控制权 | 不伪装成每个 Chat 私有浏览器；“附加到会话”单独指明目标 |
| 文件/元素/Artifact 提案回填 | 操作发起时解析出的目标会话 | 异步完成后仍发给原目标；焦点改变不能重新解释请求 |

`resolveFocusedConversationSessionId` 可以复用其解析思想，但它只返回 ID。它无法自动替换主 composer、`addContextRef`、`addWebElement`、计划状态、权限请求和文档回调的所有闭包。需要统一 `SessionActionTarget` 的解析及动作分发，并在动作开始时捕获目标。

Agent 自动打开工具应带来源身份：用户主动点击可以聚焦；后台会话的自动 reveal 默认只标记提醒、不抢输入焦点、不覆盖正在看的固定工具。删除/断开来源时显示失效态，绝不悄悄绑定另一个会话。

## 6. 技术选型

### 6.1 按当前范围比较

| 方案 | 适配情况 | 主要成本 | 建议 |
| --- | --- | --- | --- |
| 产品布局规则 + Pragmatic DnD | 拖拽层独立于 React UI，适合既有几何算法、有限模板及 piwin 视觉体系 | 命中预览、组规则、键盘替代、资源存活、撤销与恢复都要实现 | **当前首选，需原生 WebView 原型验证** |
| Dockview React | 原生具备标签组、停靠、布局状态、事件拦截和保活选项 | 适配自有模板/双区、统一状态权威、旧布局迁移、工具资源接入 | 强备选；全功能 IDE 式方向时优先重评 |
| React Mosaic | 提供窗格重排/缩放，v7 支持 n 叉树与标签 | 模型迁移、DnD 整合和产品外观接入 | 可行但当前没有明显胜过前两项的理由 |
| FlexLayout | 直接面向多 tabset 布局；官方说明仅依赖 React | 自有模型、tabset 规则、布局及视觉适配 | 不能因 0.x 排除，但有限模板下收益不突出 |
| dnd-kit | Pointer/Keyboard sensor，适合同窗指针/触控操作和定制预览 | 不提供布局模型；原生外部拖放是另一路径 | 若触控/动画成为首要目标可重评，不是只能列表排序 |
| 原生 HTML DnD 全手写 | 没有拖拽库依赖 | 平台事件、取消/卸载边界、可访问性都由自己维护 | 不建议为省一个依赖承担重复平台工作 |

Pragmatic 官方说明其 core 与可选 UI 分离，可用自己的设计系统；element/external adapter 区分内部元素和窗口外来源。[官方仓库](https://github.com/atlassian/pragmatic-drag-and-drop)、[Adapters](https://atlassian.design/components/pragmatic-drag-and-drop/core-package/adapters/)。

Dockview 提供 `onWillShowOverlay`/`onWillDrop` 拦截，因此“无法限制布局”不成立；它也有 `always` 渲染模式。是否跨停靠动作保住真实 xterm/iframe 仍要在选定版本实测。[DnD API](https://dockview.dev/docs/api/dockview/overview/)、[渲染模式](https://dockview.dev/docs/core/panels/rendering/)。

Dockview 基础版是 MIT；商业扩展包含部分高级导航、布局历史等功能，基础停靠并非都要付费。选型要按实际使用功能核对，不把官网全部示例当免费能力。[功能与许可矩阵](https://dockview.dev/docs/overview/licence/)。

FlexLayout 能力见[官方 README](https://github.com/caplin/FlexLayout)。dnd-kit 的 Pointer/Keyboard 配置见[官方传感器文档](https://dndkit.com/react/guides/sensors/)。本轮不重复未经核实的精确版本号和包体积数字，实施时锁定版本并测量增量产物。

### 6.2 不将未来原生窗口当作 PDD 的保证

原生 HTML DnD 可以提供跨窗口数据通道的基础，但“拖出应用自动建一个 Tauri 窗口”还需要窗口创建、跨 WebView 握手、资源交接、订阅、失败回滚和权限能力。Pragmatic 的窗口外来源也走 external adapter，而非自动共用内部 element 数据对象。

Tauri 官方明确 Windows 上 frontend HTML5 DnD 需要关闭其原生 dragDrop handler。项目已有 `dragDropEnabled: false`，但仍必须分别验证内部视图拖拽和系统文件附件；一个配置项不是完整兼容证明。[Tauri 配置](https://v2.tauri.app/reference/config/#windowconfig)、[PDD 平台约束](https://atlassian.design/components/pragmatic-drag-and-drop/web-platform-design-constraints/)。

## 7. 建议实现边界

### 7.1 将四类状态分开

| 层 | 保存什么 | 不负责什么 |
| --- | --- | --- |
| WorkspaceLayout | 舞台树、右栏组、组内 viewId、激活项、用户比例 | 不拥有 PTY、会话 transcript |
| ViewRegistry | 稳定 viewId、session/资源定位、工具绑定模式、返回位置 | 不把 RightPanelTab 枚举当实例 ID |
| SessionViewState | 草稿、附件引用、滚动锚点、视图模式；按 Host+session 标识 | 不再按可变化的 pane 位置持有输入 |
| Resource controllers | PTY/xterm、浏览器镜像租约、Artifact frame 生命周期 | 不因布局区域改变自行销毁 |

`PaneContent = session | tool` 不够：两个不同文件不能只有 `tool:'docPreview'`，四个终端也不能只有 `tool:'terminal'`。需要区分“工具类型”“打开的具体资源”“显示在哪个组”。

建议 v2 让树叶引用 `groupId`，组记录有序 `viewIds + activeViewId`，视图注册表保存可序列化描述；右区复用组。舞台矩形继续从树计算。有限模板由纯 policy 校验，不同时维护可独立修改的 tree 和 col/row 两套布局权威。

### 7.2 一个命令入口，一次布局提交

拖拽、菜单、快捷键统一提交 `openView / moveView / moveToGroup / splitGroup / closeView / focusView / maximize / restore / applyTemplate`。

推荐事务流程：读取当前布局 revision → 解析/校验来源 → 生成候选（含移出源、收拢空组）→ 验证 scope、唯一性、模板、尺寸 → 单次提交左右两个区域 → 恢复正确焦点 → 持久化。拖动期间只更新预览；resize 的临时结果不覆盖用户期望比例。

布局操作不得发送 `session/abort`、`pty/close`、重复 `session/resume`，或重置 browser page。聚焦命令也要统一处理最大化目标及组内激活，避免 active 指向隐藏视图。

### 7.3 挂载策略

复用现有平级叶子渲染思路，优先尝试主舞台与右区共享稳定的表面宿主：以 viewId 稳定挂载，通过计算矩形改变位置，语义顺序/Tab 顺序同步管理。这样源视图移动时不经过卸载→挂载。

这仍需验证浮层定位、裁切、右栏 drawer、可访问顺序及滚动容器，不能只验证“截图长得一样”。若使用 portal，目标容器本身也必须稳定；React 官方明确换 portal DOM 目标会重建内容。[React createPortal](https://react.dev/reference/react-dom/createPortal)

不把任意 `appendChild` 移动 React 管理的节点当默认架构。Artifact iframe 移动和生命周期独立验收；若选固定 DOM 宿主，尽量只改样式位置。若必须重建，需保存可恢复交互状态并明确限制，不能默认接受任意表单/交互丢失。

### 7.4 工具生命周期

- **终端**：先把会话列表、PTY 关闭权和 xterm 控制器拆出呈现容器；同时消除 view cleanup 的 close-all 与 XtermSurface 的 close。移动只触发稳定后的 fit/resize。隐藏不以零尺寸 resize，显式“结束终端”才终止进程；窗口销毁按所属资源关闭，禁止全局误杀。Tauri 本机 PTY 继续遵循 ADR 0013，不为布局改造强行迁到 Node Host。
- **浏览器**：Host 页面与交互锁保持；镜像 lease 属于浏览器视图控制器。移动不能出现“最后一个 lease 释放 → Chromium 退出 → 新 lease 重启”的空档。允许多租约的事实不等于首版允许多个交互浏览器面板。
- **Artifact**：固定 session/message/artifact 身份，保持 sandbox/CSP；拖拽期间不向 iframe 暴露可信布局接口。用户交互状态与自动流式更新要分别处理。
- **文件/变更/任务**：虽没有 PTY，也有树展开、选中行、滚动、筛选和来源绑定，不能笼统叫“无状态工具”。先接入它们是因资源风险较低。
- **隐藏视图**：保留必要状态不等于全部持续绘制。会话渲染、视频/动画、镜像帧率按可见性暂停或降低成本；恢复时重新 hydrate/校验。明确缓存/草稿保留策略。

### 7.5 拖拽基础设施

- 内部 payload 最少含版本、来源窗口/scope、实体种类及 ID；可用统一 `application/x-piwin-workspace-view`，不必强行三种 MIME。核心是校验且与 `PIWIN_PATH_MIME`/Files/文本彻底分流。
- 内部 payload 是输入，不能凭任意 MIME 信任来源；按当前注册表重新解析资源。真正 drop 时才取需要的数据，不假设 dragover 总能读全 `getData`。
- 只在正在进行的内部布局拖动期间启用 iframe 接收遮罩，覆盖相应停靠区域；遮罩自身承担命中或明确转发坐标，不能吞掉事件后期待下层收到。
- 取消、窗口失焦、来源卸载、路由切换、dragend 都清理遮罩；不影响系统文件拖入和普通 iframe 交互。
- 拖拽把手使用 `data-no-window-drag` 等既有机制，从原生窗口移动区域剥离。按钮、编辑标题、文本选择、终端选区有独立交互区域；不能“把整行 div 设 draggable”后不做手势验收。
- 命中预览只改变几何/轻量指示，不在 pointer/dragover 路径重建会话树或触发网络请求。最近边缘算法只是候选生成的一部分，还要处理中心、角落、嵌套组优先级及吸附稳定性。

### 7.6 包边界及持久化

- 初期纯布局/命令/注册表模块留在 Desktop 明确目录中，通用 Tab/拖拽指示/分隔条由 `@piwin/ui-kit` 提供；ui-kit 不依赖 Host、Node 或 Pi。
- Host session/run/资源事实继续由 Host 管理，壳层布局不进入 transcript 或 Pi adapters。只有新增跨客户端动作/资源协议时，才从 contracts 开始；不要把 Desktop `RightPanelTab` 类型塞进 contracts。
- 持久化使用 `host identity + scope + workspace/window identity + version` 命名空间；首期单窗口也留好结构。沿用设备本地展示状态决定；若新增磁盘存储，统一在 `~/.piwin`，不新建其他配置根。
- v1 每个 leaf 迁移为一个 group 和 session view，保持比例/顺序/绑定；去掉 primary 特权，保留旧 ID 到新身份映射。旧右栏状态一起导入，同一工具去重。
- 原始 v1 记录保留，v2 验证成功才作为活动布局；不认识的版本、缺失/已删除资源恢复成可解释占位，不能静默用第一会话替代。旧版合法非模板布局按兼容方式恢复。
- 草稿及资源句柄不塞进布局 JSON；崩溃恢复不自动重新执行终端命令。PTY 存活能力与 xterm 回放能力单独定义。
- 会话订阅并集应去重且有明确预算；前台视图优先，隐藏视图降级必须可解释。不要用静默 `slice(0,8)` 掩盖漏流。CLI 无布局 UI 是有意降级，仍共用 Host 会话权威。

## 8. 分期与验收闸门

| 阶段 | 可交付结果 | 进入下一阶段的条件 |
| --- | --- | --- |
| P0 稳定当前多窗 | 保留用户比例；最大化/焦点一致；收起可恢复；会话作用域与草稿问题有回归覆盖 | 当前两会话连续操作不丢绑定/草稿、不聚焦隐藏视图 |
| P1 统一视图内核 | 消除主/副状态特权；资源描述与位置分离；菜单完成分屏/移动/收起/恢复 | 完整会话功能在任意格一致，布局命令不触发运行操作 |
| P2 会话拖拽 | 侧栏到舞台、组内/组间移动、受限模板、落点预览、取消、撤销 | Tauri 实机内部拖拽及文件附件并行通过；不仅是 happy-dom 测试 |
| P3 工具双区停靠 | 右栏上下两组及往返主舞台；先低资源风险工具，再终端/浏览器/Artifact | 终端 PID/ptyId 不变，浏览器页面不重建，工具回填目标正确 |
| P4 原生多窗口 | 跨窗口布局及资源交接协议、窗口级持久化和关闭规则 | 独立 ADR/跨窗口验收；不依赖浏览器 `window.open` 假装已支持 Tauri |

P0/P1 中做一个严格限定的技术原型：两个真实会话草稿 + 一个实际 PTY + 一个 browser lease + 一个有交互状态的 Artifact，完成主舞台/右区往返。只做 fake 彩色盒子拖拽不能判定选型成功。本轮尚未实施该原型。

若自有方案原型必须大量手动重挂 DOM 才能成立，或产品确定近期引入完整自由标签/浮动能力，再用同一组真实内容做 Dockview 原型对照。比较可维护模块、迁移代码、帧耗时、额外订阅、资源泄漏和实际打包增量，避免只比首页 demo。

### 必测场景

1. A/B 同时流式；移动/互换后发送、停止和权限响应只到目标会话。
2. A 有未发送草稿、附件及滚动锚点；移动、切标签、收起、恢复、重启后符合明确保留规则。
3. 最大化 A → 侧栏选择 B → 键盘输入，B 必须可见且获得焦点。
4. 宽→窄→宽，左右栏展开/收起、右栏全宽、DPI/缩放后恢复期望比例。
5. 1/2/3/4 格模板互转，不丢原有会话；达到上限时“移动”仍可用，新增被明确拒绝。
6. 工具往返 20 次：无额外 PTY、browser lease、listener、iframe 重建或会话 resume。20 次是验收动作数量建议，不是性能实测结果。
7. 操作发起后切焦点：文件附加、浏览器元素选择、Artifact 提案仍回到原目标。
8. 外部图片/PDF、内部文件路径、文本选择、原生标题栏拖窗互不干扰。
9. 拖动中关闭来源、切 scope、断开 Host、窗口失焦，取消后布局及遮罩恢复正常。
10. v1→v2、坏记录、旧版本、缺资源、重复 view、不同 Host/scope；无 silent rebind。
11. 鼠标以外的菜单与键盘全流程、IME、屏幕阅读顺序；手机只显示活动项但不丢布局。
12. 2/4/8 会话分别记录空闲 CPU、流式输入延迟、拖拽长帧、内存增量和事件订阅数量；先建立现有基线，再设性能门槛，不编造 60fps 承诺。

MD/源码变更实施时按项目要求执行 typecheck、触及包测试、架构检查及文件行数检查。改 UI 的实机回归不能用绿色单元测试替代。

## 9. 本轮实际验证

- 执行 Desktop 10 个相关测试文件：pane layout/storage/bind/shortcuts/workspace/session、pane subscriptions、right-panel、browser lease、terminal sessions。
- **78/78 测试通过，10/10 文件通过**；测试有 React `act(...)` 警告，不把它描述成无警告验收。
- 运行当前布局纯函数，复现 §3.3 三种状态结果。
- 核对当前相关实现文件行数，见 §3.4。
- 未运行整仓 typecheck/全量测试：本轮是调研文档，未改产品源码；也不据此宣称当前脏工作区整仓通过。
- 未做 Claude 实机、Tauri WebKit/WebView2 拖拽、跨窗口、资源压力或生产包体积验证；全部明确列为后续闸门。

## 10. 需要落到后续规格的产品决定

推荐默认选择已经在本文给出：**两停靠区、常用 1–4 格/宽屏 8 格、中心成组、不覆盖内容、固定资源与跟随工具分开、首版同 scope、原生多窗口后置**。

正式实施时更新 ADR 0063 的主/副窗格、叶子内容和恢复语义，以及 conversation multi-pane spec；终端生命周期涉及 ADR 0013，浏览器视图/租约涉及 ADR 0020/0057，右栏展开涉及 2026-09-08 right-panel-full-width spec。文档跟随最终产品决定，不把历史 ADR 当设计否决理由。

### 本地证据索引

- [现有多窗 ADR](../adr/0063-conversation-multi-pane-workspace.md)
- [现有多窗规格](conversation-multi-pane-workspace.md)
- [右栏全宽规格](2026-09-08-right-panel-full-width.md)
- [布局算法](../../apps/desktop/src/conversation-pane-layout.ts)
- [布局控制/订阅](../../apps/desktop/src/use-conversation-pane-layout.ts)
- [舞台渲染](../../apps/desktop/src/conversation-pane-workspace.tsx)
- [附加会话状态](../../apps/desktop/src/conversation-pane-session.tsx)
- [工作台装配](../../apps/desktop/src/workbench-app.tsx)
- [工具装配/回填](../../apps/desktop/src/workbench-inspector.tsx)
- [右工具栏](../../apps/desktop/src/right-panel.tsx)
- [终端列表生命周期](../../apps/desktop/src/use-terminal-sessions.ts)
- [xterm/PTY 生命周期](../../apps/desktop/src/xterm-surface.tsx)
- [浏览器视图租约](../../apps/desktop/src/browser-session-lease.ts)
- [浏览器多租约实现](../../packages/browser/src/browser-runtime.ts)
- [浏览器 Host 生命周期](../../packages/browser/src/browser-session.ts)
- [外部附件拖入](../../apps/desktop/src/hooks/use-composer-attachments.ts)
- [原生窗口拖动边界](../../apps/desktop/src/native-window-drag.tsx)
