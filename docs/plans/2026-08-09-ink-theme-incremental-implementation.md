# 水墨画主题增量实施计划

| 字段 | 内容 |
|---|---|
| 目标 | 为 piwin 增加一个可独立移除的水墨画主题，并验证视觉效果 |
| 实施 worktree | `/Users/yorickjue/Developer/piwin-ink-theme` |
| 分支 | `codex/ink-theme` |
| 基线 | 当前 `main` 的 `8b11fe490998597a97f461702c47bfe31bb05341` |
| 主题形态 | 第一阶段 token-only；第二阶段在通过视觉门槛后再补受控水墨质感 |
| 核心约束 | 不改变现有默认主题、业务功能、Host/Pi 执行链路和用户已有配置 |

## 1. 目标与非目标

### 目标

1. 新增一个独立的 `piwin-ink-wash` 主题包，第一阶段只使用现有的
   `ThemeManifest` token 合约。
2. 通过现有的主题投影链路验证宣纸、墨色、黛青/朱砂强调色、低对比边界和
   代码可读性。
3. 视觉验证通过后，再增加有限、可关闭、由产品代码控制的水墨纹理或背景层。
4. 所有改动保持可逆：删除主题包、主题预览入口和对应测试后，现有产品恢复原状。

### 非目标

- 不修改 Pi、`@piwin/agent-host`、会话、权限、媒体、MCP 或工具执行逻辑。
- 不改现有 `piwin-dark`、`piwin-light`、`piwin-orange-white` 的 token 值。
- 不引入任意主题 CSS、JS、远程字体、远程图片或可执行主题脚本。
- 不把水墨装饰铺到代码、Artifact iframe、终端输出或高密度工具内容上。
- 不在第一阶段引入主题 marketplace、主题编辑器或复杂的主题继承系统。
- 不修改主 worktree 中现有的未提交改动。

## 1.1 UI 视觉设计锚点：泼墨大写意 + 深夜书案

这套主题的统一风格关键词固定为：

```text
泼墨大写意 · 深夜书案 · 玄黑宣纸 · 墨分五色 · 枯笔飞白 · 朱砂钤印 · 大面积留白 ·
极简禅意 · 安静克制 · 无文字入画 · 无人物入画
```

所有主视觉、背景、头像、分隔条和空状态小品都必须共享这套关键词骨架。图片可以有
不同题材，但不能出现彩色插画、摄影感、3D、卡通、建筑、人物或互相冲突的风格。

### UI 区域使用规则

| UI 区域 | 图片策略 | 说明 |
|---|---|---|
| 启动页/欢迎页 | 可使用主视觉 | 允许泼墨感最强，作为视觉识别锚点 |
| 普通会话背景 | 可使用极淡底纹 | 只放在背景层，透明度目标 30–40%，中心保持近乎纯黑 |
| Agent 头像 | 可使用朱文篆刻印章 | 默认使用“砚”字钤印，独立 1:1 资产 |
| 普通页面分隔 | 可使用单道枯笔飞白 | 仅用于非执行型页面或低密度内容 |
| 空会话/无文件/搜索无结果 | 可使用小品插图 | 只作为空状态辅助，不替代说明文字 |
| 调用链、工具卡、运行日志、权限卡、子 Agent 流、终端、代码/diff | **禁止图片，纯留白/纯色语义层** | 这是硬约束，确保信息密度、可读性和执行态稳定 |
| Artifact iframe | **默认禁止主题图片** | 只注入安全的 Artifact token；不把桌面装饰带入不可信 HTML |

“调用链 UI 区域不用图”优先级高于装饰性设计。任何图片加载失败、主题未启用或用户
关闭装饰时，所有区域都必须自动回退到现有 token-only 视觉，不能出现空白占位、布局
跳动或阻塞会话。

### 图片资产硬约束

- 图片内不烘焙文字、logo、watermark 或产品 UI 文案；文案由 React/UI 层渲染。
- 不加载远程图片、远程字体或 CDN 资源。
- 第一阶段不生成和接入任何 bitmap 资产。
- 第二阶段图片只作为产品内置、固定用途的可选资产，不允许主题 manifest 传任意 URL、
  任意 CSS 或任意脚本。
- 资产加载是非关键路径，不能影响启动、Host 连接、会话恢复、消息流和工具执行。
- 主题关闭或资产缺失时，UI 必须和没有水墨资产时一样可用。

### 视觉资产清单

| 资产 | 画面方向 | 计划用途 | 首版限制 |
|---|---|---|---|
| `hero` | 玄黑宣纸、浓墨远山云雾、枯笔飞白、右上单枚朱砂印 | 启动页/欢迎页 | 16:9 或 21:9；不放会话流 |
| `conversation-texture` | 四角极淡墨晕、中心大面积纯黑 | 会话背景层 | 透明度不超过 40%；正文区不得抢对比度 |
| `agent-seal` | 朱文篆刻“砚”，朱砂红印面，玄黑底 | Agent 头像 | 1:1；建议输出 512×512 |
| `dry-brush-divider` | 单道横向枯笔飞白 | 非执行型页面分隔 | 扁平横图；调用链区域禁用 |
| `empty-session` | 未磨墨锭 + 半卷宣纸 | 空会话 | 朱砂一点 |
| `empty-files` | 空笔架 + 一支笔 | 无文件 | 黛青一点 |
| `empty-failure` | 一滴墨溅落宣纸 | 顶层失败空状态 | 藤黄一点；错误卡本身不用图 |
| `empty-complete` | 新篁一枝斜出 | 全部完成/空闲 | 竹青一点 |

### 统一生成提示词骨架

图片生成阶段统一使用以下后缀和负面约束；每个资产只替换主体描述和用途约束。

中文统一后缀：

```text
泼墨写意小景，玄黑背景，大量留白，仅一处点缀色，极简禅意，宣纸肌理，无文字
```

English suffix：

```text
small splash-ink vignette, deep black background, generous negative space,
single accent color only, minimal zen, xuan paper grain, no text
```

统一 negative prompt：

```text
text, watermark, logo, photorealistic, 3D render, colorful, bright background,
cartoon, figures, buildings, heavy symmetry
```

主视觉 prompt：

```text
Bold Chinese splash-ink painting (泼墨), expressive ink poured and splashed onto
deep charcoal-black xuan paper, ink blooming from dense jet black to translucent
misty gray, forming abstract mountain-and-cloud silhouettes, dry-brush flying-white
streaks like torn silk, a single vermilion seal-red accent stamp in the upper right,
vast negative space, minimalist zen atmosphere, visible rice paper fiber grain,
ink in five shades, dark moody elegance, no text, no figures
```

会话底纹 prompt：

```text
Extremely subtle ink-wash background texture, deep black base (#0B0B0C), faint
diluted ink blooms fading like dissipating mist at the four corners only, center
kept almost pure black and empty, ultra-low opacity ink marks, quiet and restrained,
faint warm candlelight tint, no recognizable objects, no text
```

印章头像 prompt：

```text
Close-up of a square Chinese seal stamp (朱文篆刻), vermilion cinnabar-red face
with white seal-script character “砚” carved in relief, slightly rough ink-paste
texture with natural worn flying-white edges, deep black background, soft side
lighting like a desk lamp at night, minimal centered composition, eastern
bronze-and-stone aesthetic, nothing else in frame
```

分隔笔触 prompt：

```text
A single horizontal dry-brush flying-white ink stroke, bristle-split bristles
revealing paper white, ink fading naturally from wet dense black to dry scratchy
gray, pure black background, calligraphic gesture spanning the full frame width,
minimal, no text
```

生成参数只作为候选：主视觉 16:9/21:9，印章 1:1，分隔条 21:9 或更扁；先以实际
可读性和压缩后效果为准，不把模型参数写入运行时契约。

### UI 排版与交互气质

- 正文和代码优先可读性，不能使用难读的书法字体作为全局 UI 字体。
- 标题可以有轻微宋体/碑刻感，但字号、字重和行高仍由现有 UI token 控制。
- 朱砂只承担少量动作/印记/危险强调，不作为大面积主色。
- 墨色层次承担 surface hierarchy；避免用大量卡片、厚阴影和高饱和色制造层级。
- hover、focus、selected、running、error、success 继续使用语义变量，不用图片表达状态。
- 过渡、图片加载和主题切换都必须服从 `prefers-reduced-motion` 和现有主题切换冻结逻辑。

## 2. 增量性与可回滚设计

### 2.1 变更隔离

全部工作只在专用 worktree 中进行：

```text
/Users/yorickjue/Developer/piwin              # 用户当前 worktree，不碰
/Users/yorickjue/Developer/piwin-ink-theme    # 本计划唯一工作区
```

主 worktree 当前已有未提交改动。本 worktree 从当前 `HEAD` 创建，不复制这些未提交
改动，也不对它们做整理、暂存、提交或覆盖。

### 2.2 代码隔离规则

- 新主题使用新 id：`piwin-ink-wash`，不复用现有主题 id。
- 第一阶段只新增主题 manifest、主题测试和必要的预览测试入口。
- 不重写现有 CSS 区域文件；现有 CSS 继续通过现有语义变量取色。
- 不增加全局 `theme.id` 分支，除非确实需要产品拥有的受控视觉模式；需要时使用
  合约中的枚举字段，不把任意 CSS 字符串放入 manifest。
- 不改变默认启动主题和现有亮暗切换行为。
- 不写入真实用户的 `~/.piwin/theme.json` 作为视觉验证手段；预览使用测试 fixture
  或临时 Host/mock 数据。

### 2.3 回滚策略

按关注点拆成独立提交：

1. 计划与验证基线。
2. token-only 主题包和纯函数/manifest 测试。
3. 主题预览入口与视觉回归截图。
4. 通过视觉门槛后才做受控纹理增强。
5. 主题列表/安装/选择器的产品接线（如果需要）。

如果任何阶段不满意，删除对应提交或回滚对应提交即可；不需要回滚 Host、Pi 或
现有主题。若 token-only 阶段不通过，停止在第 3 个提交之前，不进入纹理和主题选择器
阶段。

## 3. 现有架构对接点

当前已经存在的链路：

```text
ThemeManifest
  → @piwin/theme 校验 / 存储 / 安装
  → HostRuntime theme/* 命令
  → Desktop bootstrap 获取 active theme
  → DesktopThemeRoot
  → document CSS variables + Mantine PiwinUiProvider
  → Artifact theme variable mapping
```

主要文件：

- [contracts theme contract](/Users/yorickjue/Developer/piwin/packages/contracts/src/theme.ts)
- [theme store](/Users/yorickjue/Developer/piwin/packages/theme/src/theme-store.ts)
- [manifest validator](/Users/yorickjue/Developer/piwin/packages/theme/src/validate-manifest.ts)
- [Desktop theme root](/Users/yorickjue/Developer/piwin/apps/desktop/src/desktop-theme-root.tsx)
- [appearance projection](/Users/yorickjue/Developer/piwin/apps/desktop/src/appearance-tokens.ts)
- [Mantine UI provider](/Users/yorickjue/Developer/piwin/packages/ui-kit/src/piwin-ui-provider.tsx)
- [Artifact theme mapping](/Users/yorickjue/Developer/piwin/apps/desktop/src/artifact-theme-map.ts)

第一阶段只复用这条链路，不新增跨层依赖，也不让 UI 直接接触 Pi 或 Host 内部实现。

## 4. 分阶段实施

### Phase 0 — 基线与隔离确认

**目的：** 证明 worktree 干净、现有功能可验证，并记录视觉基线。

任务：

1. 在专用 worktree 检查 `git status`、分支和 HEAD。
2. 运行仓库既有的 typecheck 和测试，记录基线结果。
3. 使用现有 Desktop 视觉回归入口记录至少以下画面：
   - 空壳页面
   - 正常聊天消息
   - Markdown 与代码块
   - 工具调用/运行状态
   - 权限等待
   - Settings → Appearance
   - Artifact preview
   - 窄窗口布局
4. 不改应用逻辑；基线失败时先报告，不把基线问题归因到水墨主题。

退出条件：

- worktree 无非计划改动。
- 基线失败项已经记录并能区分“已有问题”和“主题引入问题”。

### Phase 1 — token-only 水墨主题

**目的：** 只验证主题色、字体和基础几何，不引入纹理、不改变默认主题。

#### 1. 新增 manifest

新增：

```text
packages/theme/bundled/piwin-ink-wash/theme.json
```

建议初版定位为“宣纸工作台”：

- `bg`：暖灰宣纸，不使用纯白。
- `panel`：略亮的纸面。
- `panel2`：淡墨灰/米灰，用于 inset、代码背景和控件。
- `border`：低透明度墨线。
- `text`：深墨色，但不使用纯黑。
- `muted`：冷灰或灰青。
- `accent`：黛青/深青，用于主要交互。
- `accent2`：较浅的青灰，用于次级状态。
- `danger`：低饱和朱砂，保证危险状态可识别。
- `ok`：竹青/松绿，保证成功状态和现有语义一致。
- `radius`：比现有主题略克制，但保持现有组件几何兼容。
- `font`：优先使用本机已有的中文阅读字体和系统 fallback，不下载字体。

具体颜色以对比度和截图验证为准，不直接复制设计稿中的未经验证颜色。

#### 2. 主题包验证

为 `packages/theme` 增加以下测试覆盖：

- manifest 能通过现有 token-only validator。
- 不含 `css`、`js`、`script`、远程资源或可执行字段。
- 所有颜色/字体/radius 满足现有安全格式。
- 主题 id、name、mode、artifact fallback 正确。
- 安装、读取、激活后不会覆盖其他主题目录。

如果需要把新主题识别为 bundled，只更新主题包自己的 bundled id 识别逻辑和测试，
不改变用户主题的处理方式。

#### 3. 预览方式

增加一个只在 E2E/开发 fixture 下可用的水墨主题预览入口，复用
`DesktopThemeRoot` 的 `onThemeApplied` 投影，不写真实用户偏好，不修改默认启动路径。

预览入口必须满足：

- 生产构建不可从普通产品导航进入。
- 刷新后默认主题仍是原主题。
- 关闭预览或删除 fixture 后，产品不残留运行时开关。
- 预览实际使用与 manifest 相同的 `ThemeManifest` 值，避免“预览一套、安装另一套”。

如需为浏览器预览提供静态 manifest，优先增加无 Node 副作用的公开 fixture/subpath；
禁止从 Desktop 深层相对路径导入其他 package 的 `src` 文件。

#### 4. Phase 1 不做的事情

- 不增加纸张噪点、毛笔边缘、山水背景图。
- 不新增任意 `background-image` 主题字段。
- 不改变 `applyAppearanceToDocument` 对现有主题的派生逻辑。
- 不修改 Markdown、代码高亮、终端、Artifact 的渲染结构。

### Gate 1 — token-only 视觉验收

Phase 1 完成后必须停下来做一次明确验收。只有通过 Gate 1 才能进入 Phase 2。

#### 自动验收

- `pnpm typecheck` 通过。
- `@piwin/theme` 测试通过。
- Desktop 相关单测通过。
- 现有视觉回归不出现布局、交互、文本溢出、状态颜色回归。
- 主题切换前后 DOM 结构、路由、Host 状态、会话数据不变。

#### 人工/截图验收

至少检查：

1. 空状态是否像宣纸和淡墨，而不是发黄、脏或廉价的米色。
2. 正文、次级文字、占位符是否清晰，不能因为低对比变得发灰。
3. 代码块、终端、diff、工具调用是否仍然有足够层次。
4. 主要按钮、focus ring、危险/成功状态是否仍然明显。
5. Markdown、Artifact、图片预览是否没有主题冲突或白色硬块。
6. Settings 和窄屏布局是否没有因为字体、边框或颜色发生跳动。
7. 水墨感是否已经成立；如果只是“换成了米色 UI”，视为不通过。

#### Gate 1 判定

- 自动验收和人工验收都通过：进入 Phase 2 设计/实现。
- 视觉一般但功能安全：暂停，不继续添加纹理，提交截图和问题清单给用户决定。
- 发现任何功能回归：立即停止，保留基线和失败证据，回滚 Phase 1 增量。
- 用户认为效果差：删除 `piwin-ink-wash` 及其预览/测试提交，主 worktree 不受影响。

### Phase 2 — 受控水墨质感（仅 Gate 1 通过后）

**目的：** 在 token-only 主题可接受的基础上增加“画面感”，但仍保持安全、可移除和
可控。

#### 推荐方案

在 [packages/contracts/src/theme.ts](/Users/yorickjue/Developer/piwin/packages/contracts/src/theme.ts)
中增加一个受限枚举字段，例如：

```ts
visualStyle?: 'flat' | 'paper' | 'ink-wash';
```

约束：

- 只能是固定枚举，不能让 manifest 传任意 CSS。
- validator 只接受固定枚举。
- `appearance-tokens.ts` 根据枚举映射到产品内置、可审查的 CSS 变量/渐变规则。
- 用户主题不能指定远程图片、字体、脚本或任意样式表。
- Artifact iframe 默认仍使用干净的主题变量，不强行注入纹理。

#### Phase 2 资产工作流

1. 使用本计划中的统一提示词骨架生成 `hero`、`conversation-texture`、
   `agent-seal`、`dry-brush-divider` 和空状态小品。
2. 对每张候选图做人工筛选：构图留白、墨色层次、朱砂/黛青/藤黄/竹青点缀是否克制，
   是否出现文字幻觉、建筑、人物、过度对称或彩色插画感。
3. 对通过筛选的图片做裁切、压缩和尺寸控制，放在产品自带的静态资产目录，例如：

   ```text
   apps/desktop/public/ui/ink-wash/
   ```

4. 用一个产品内置的 asset registry 将 `visualStyle: 'ink-wash'` 映射到固定资产；
   不让 `theme.json` 直接提供文件 URL。
5. 所有组件通过 registry 读取可选资产；没有资产、加载失败、主题关闭时返回 `null`
   并使用 token-only fallback。
6. 资产接线按区域逐个开启：先启动页，再空状态，再头像，最后才考虑会话底纹；调用链
   区域永远不接入图片。

图片生成和接线本身也拆成独立提交。任何一张图不满意，只删除该资产和对应 registry
映射，不影响 token-only 主题或其他功能。

视觉层建议只放在：

- shell canvas
- 空状态/欢迎区域
- 非文本主背景

不放在：

- 消息正文底下
- 代码和终端
- 工具输出
- 权限卡片
- Artifact 内容内部

如果需要真实水墨图像，只允许产品随包提供、路径固定、不可由用户 manifest 任意引用的
本地资产；优先使用低成本 CSS 纹理，避免引入大图片和额外资源加载问题。图片不是
启动和会话的关键依赖，不能因为图片未加载而让布局出现空白占位或等待状态。

#### Phase 2 测试

- `visualStyle` 合法枚举和非法输入测试。
- 同一 token theme 在 `flat` 与 `ink-wash` 下只改变允许的背景层变量。
- 现有主题无 `visualStyle` 时行为保持不变。
- reduced motion、低性能设备和 Artifact sandbox 不受影响。
- 视觉回归增加水墨主题截图，但不替换现有主题截图。
- 启动页/空状态允许出现图片；调用链、工具、日志、终端、代码、diff 和权限区域的
  DOM 中不出现装饰图片。
- 模拟静态资源缺失时，所有相关页面仍能完成渲染，并回退到 token-only 版本。

### Phase 3 — 主题选择和持久化接线（可选）

只有当 Phase 1/2 视觉满意后，才补齐完整的产品入口：

1. Settings → Appearance 增加主题列表/预览/应用。
2. 复用已有 `theme/list`、`theme/get-active`、`theme/set-active`、
   `theme/install-local` HostCommand。
3. 明确“主题包选择”和“亮暗模式/本地颜色编辑”的优先级，避免当前自定义主题被
   Appearance 页面重新生成的 `piwin-*-appearance` 覆盖。
4. Desktop 启动、Host 重连、多客户端连接后使用同一个 Host 权威主题状态。
5. CLI 只提供列出/选择/安装命令；CLI 本身不强行模拟 Desktop 纹理。

这一阶段要单独补充 contracts/Host/desktop 的 conformance 测试，不和视觉纹理提交
混在一起。

## 5. 文件变更预估

### Phase 1 允许修改/新增

- `packages/theme/bundled/piwin-ink-wash/theme.json`
- `packages/theme/src/theme-store.ts`（如需 bundled id 识别）
- `packages/theme/src/*.test.ts`（主题包校验/安装测试）
- `apps/desktop/src/e2e/*`（仅测试/开发预览入口）
- `apps/desktop/src/*test*`（投影/预览/回归测试）
- `docs/plans/2026-08-09-ink-theme-incremental-implementation.md`

### Phase 2 允许修改/新增

- `packages/contracts/src/theme.ts`
- `packages/theme/src/validate-manifest.ts`
- `apps/desktop/src/appearance-tokens.ts`
- `apps/desktop/src/styles/*`（只新增语义变量消费，不重写区域结构）
- 对应单测和视觉回归快照

### 明确禁止

- `packages/agent-host/**`
- Pi 依赖或 Pi 配置
- Session/Run/Job/Permission/MCP/Media 业务实现
- 把主题逻辑塞进 `App.tsx` 大组件
- 复制一份新的 UI primitive；共用 `@piwin/ui-kit`
- 修改主 worktree 的未提交文件

## 6. 验证命令与交付物

每个阶段都要记录结果：

```bash
pnpm typecheck
pnpm test
pnpm --filter @piwin/theme test
pnpm --filter @piwin/desktop test
```

Desktop 视觉验证使用现有 Playwright 入口和快照，不新增第二套视觉测试系统。需要
记录：

- 基线截图/快照结果
- 水墨 token-only 截图/快照结果
- Gate 1 通过或不通过的理由
- 发现的问题及是否影响现有功能
- 每个提交对应的文件范围

最终交付必须包含：

1. worktree 路径和分支。
2. 变更文件清单。
3. typecheck/test 结果。
4. 视觉截图和 Gate 1 结论。
5. 如果继续到 Phase 2，说明新增的安全边界和回滚点。

## 7. 停止条件

遇到以下任一情况必须停止并返回，不得自行扩大范围：

- token-only 视觉效果明显不成立。
- 现有默认主题或功能出现回归。
- 需要引入任意 CSS/JS/远程资源才能实现效果。
- 需要修改 Agent Host、Pi 或业务状态才能接入主题。
- 主题选择和本地 Appearance 优先级无法在不破坏兼容性的前提下明确。
- 需要大规模重写现有 CSS 或 UI 组件。

停止时只保留诊断信息和截图；删除/回滚本阶段增量，主 worktree 不受影响。

## 8. 执行顺序

```text
创建 worktree
  → Phase 0 基线
  → Phase 1 token-only
  → Gate 1 视觉验收
      ├─ 不通过 → 返回结果并回滚水墨增量
      └─ 通过   → Phase 2 受控水墨质感
                    → 复验
                    → Phase 3 主题选择/持久化（可选）
```

## 9. 本次执行记录

- worktree 已创建：`/Users/yorickjue/Developer/piwin-ink-theme`
- 分支：`codex/ink-theme`
- Gate 1：通过。token-only primitive gallery 截图、主题 token 单测和 Desktop
  typecheck 均通过；未改默认主题和执行链路。
- Phase 2：已完成。增加 `visualStyle: 'ink-wash'` 固定枚举、产品内置 asset registry、
  可删的本地图像资产和空会话视觉接线。图像只出现在空会话 canvas/空状态小品；调用链、
  工具卡、运行日志、权限、终端、代码和 diff 没有图片接线。
- Phase 3：已完成。Settings → Appearance → 主题包通过现有 Host `theme/list` /
  `theme/set-active` 选择并持久化；主题包激活时保护旧的亮暗切换/颜色编辑路径，避免
  无意覆盖主题包。
- 资产目录：`apps/desktop/public/ui/ink-wash/`，包含 `hero`、会话底纹、`agent-seal`、
  飞白分隔条和四个空状态小品。资产缺失时 registry 返回 `undefined`，CSS/组件回退
  token-only；没有远程资源、manifest 任意 URL、CSS、JS 或脚本。
- 复验命令：`pnpm typecheck` 通过；`@piwin/theme` 8 tests 通过；Desktop 聚焦测试
  16 tests 通过；Playwright ink-theme 2 tests 通过。
- 全量 `pnpm test` 仍有基线中已有的 4 个 Desktop `resolve-document-content.test.ts`
  失败（文档 fence、截断 `write_file` 恢复、两项完整计划提取断言），与本主题变更无关；
  其他已运行 workspace 测试通过。
