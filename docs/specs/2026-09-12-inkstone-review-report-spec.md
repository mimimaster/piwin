# Inkstone · 代码审查报告设计规范 (proto-10)

- 日期：2026-09-12
- 状态：已定稿 (Accepted)
- 原型参考：[`docs/design/inkstone/proto-10-review-report.html`](../design/inkstone/proto-10-review-report.html)
- 关联：Cursor Agent Review / Bugbot 机制对齐；Inkstone 纸墨设计语言规范 (`shell-foundation.css`, `shell-transcript.css`)

---

## 1. 设计目标与原则

1. **高信噪比与极简克制**：
   - 摒弃 AI 常见的长篇抒情、夸赞或套话，遵循“3 秒看结论，30 秒看重点，按需看补丁”。
   - 严格禁止使用任何彩色系统 Emoji（如 🚦、🚨、💬、✨、📋、🔴、🟡、🟢），避免廉价混乱感。
   - 图标严格控制在 **1-2 笔以内的极简单色线框 SVG**（与 Inkstone 核心书法意境一致）。
2. **结构化判决与可行动性 (Actionable)**：
   - 吸收 Cursor Review 核心机制：Verdict 判决胶囊、置信度（Confidence）、按 P0/P1/P2 分级的问题发现、以及精确到行号的**最小代码补丁 (Minimal Diff Patch)**。
3. **Inkstone 纸墨美学自适应**：
   - 完美适配纸面 (`paper` / 暖白宣纸) 与墨面 (`ink` / 深色松烟) 双主题。
   - 统一采用 1px 细水墨分割线 (`var(--l2)`)、噪点纹理 (`fractalNoise`)、直朱砂强调线 (`::before`，3px 宽平齐直线)。

---

## 2. 报告标准五段式结构契约

### 2.1 刊头与判决栏 (Verdict Bar)
- **大标题**：宋体/衬线字形（`Noto Serif SC` / `Songti SC`），14px，平直沉稳。
- **判决徽标 (Verdict Pill)**：
  - `需修改 (Changes Required)`：`var(--zhu-wash)` 浅朱砂底 + `var(--zhu)` 字体 + 5px 纯色微点。
  - `可合入 (Ready to Merge)`：`var(--pine-wash)` 浅松绿底 + `var(--pine)` 字体 + 5px 纯色微点。
- **元数据行 (Meta Row)**：
  - 单行展示：审阅文件数、变更增减行数 (`+86 -24`，松绿与朱砂色)、置信度 (`94%`)、耗时 (`1.4s`)。

### 2.2 批注综述卡片 (Summary Gate)
- **视觉特征**：独立浅纸色卡片 (`var(--s3)`)，左侧采用 **笔直朱砂线** (`::before` 伪元素：`position:absolute; left:0; top:10px; bottom:10px; width:3px; border-radius:2px; background:var(--zhu);`)，非圆角弯折线。
- **内容**：1-2 句话客观陈述核心改动、阻断风险归因与合入建议。

### 2.3 综合维度盘点表 (Overview Metrics)
固定采用 4 个标准工程维度进行盘点，不允许随机变更维度名称：
1. **安全与边界 (Security & Boundaries)**：输入校验、防路径穿越、越权检测。
2. **逻辑与竞态 (Logic & Concurrency)**：状态机闭环、异步请求 Abort 信号、竞态条件、空指针异常。
3. **架构与依赖 (Architecture & Contracts)**：单向依赖遵守、包边界、循环引用检查。
4. **测试覆盖 (Test Verification)**：核心分支与边界测试覆盖度。

每个维度状态固定为三级胶囊：
- `P0 阻断`：`var(--zhu)` 徽标
- `P1 警告` / `需补充`：`var(--lamp)` 暖金徽标
- `良好`：`var(--pine)` 松绿徽标

### 2.4 重点审查发现 (Findings & Minimal Patches)
- **严重度分级**：
  - **P0**：阻断级（重大 Bug、安全漏洞、破坏性变更）
  - **P1**：警告级（潜在竞态、错误捕获缺漏、边界未处理）
  - **P2**：建议级（代码复用、样式规范、命名优化）
- **单项卡片标准要素**：
  - 标题行：P0/P1/P2 纯色标签 + 一句话问题概括 + 精确位置锚点 (`file.ts:line_start-line_end`)。
  - 成因分析：直截了当说明触发危害与边界条件。
  - **最小补丁 (Minimal Diff Patch)**：仅展示必要差异，包含文件头与关键上下文，带有语法高亮与删除/新增着色。
  - 操作按钮：`忽略`、`讨论`、`采纳补丁`。

### 2.5 验证清单 (Verification Checklist)
- 采用 Inkstone 会话节点 (`.node`) 标识：
  - 已确认通过项：松绿实心微点 (`done`)。
  - 待补充/警示项：暖金方形微点 (`wait`)。
- 交代 TypeScript 类型推导 (`pnpm typecheck`) 与单测覆盖情况。

---

## 3. 图标与视觉细节规范

- **极简 1-2 笔 SVG 符号**：
  - 盘点图标：`#bars`（3 条不等长水平横线，1 个 path 搞定）
  - 发现图标：`#bang`（一竖加一点，极简感叹号）
  - 验证图标：`#checks`（两个极简短勾）
  - 闪电图标：`#bolt`（单折线）
  - 气泡图标：`#chat`（极简带尾矩形）
- **无问题时的克制原则**：
  若本轮改动无实质性风险，必须直接输出：
  `判决结果: 🟢 可合入 (Ready to Merge)`，并附带 1 句简要评估，**严禁为凑字数而挑剔虚构问题**。
