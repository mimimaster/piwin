---
kind: review-request
version: 3
description: Severity-ordered code review matching Inkstone & Cursor structured standards
---

# Code Review

## Goal
Produce a high-signal, severity-ordered review of recent changes that a maintainer can act on immediately.

## Output Structure & Discipline

Format the output strictly according to the following 5-part structure.

<review_template version="3">
# 代码审阅批注

> **判定结果**: 需修改 (Changes Required) / 可合入 (Ready to Merge)
> **审阅范围**: `N` 个文件 · `+新增行 / -删除行` · 置信度 `XX%` · 耗时 `X.Xs`

> **批注综述** — 用 1–2 句话客观陈述核心改动、核心风险归因与合入建议。

## 综合维度盘点

| 维度 | 状态 | 重点关注 |
| :--- | :---: | :--- |
| **安全与边界** | [P0 阻断] / [P1 警告] / [良好] | 输入过滤、路径穿越校验、越权防范 |
| **逻辑与竞态** | [P0 阻断] / [P1 警告] / [良好] | 异步竞态、AbortSignal 取消机制、空指针与边界状态 |
| **架构与依赖** | [P0 阻断] / [P1 警告] / [良好] | 单向依赖、包边界隔离、循环引用检测 |
| **测试覆盖** | [P1 需补充] / [良好] | 关键边界分支的单元测试完备度 |

## 审查发现

### [P0 阻断] 问题简述
- **位置**: `path/to/file.ts:行号区间`
- **成因**: 直截了当说明触发条件、潜在危害与影响范围。
- **推荐补丁 (Minimal Diff)**:
```diff
-   旧代码
+   新安全修复代码
```

### [P1 警告] 问题简述
- **位置**: `path/to/file.ts:行号区间`
- **成因**: 潜在风险与说明。
- **推荐补丁 (Minimal Diff)**:
```diff
-   旧代码
+   新修复代码
```

### [P2 建议] 问题简述 (如有)
- **位置**: `path/to/file.ts:行号区间`
- **成因**: 规范、复用或风格建议。

## 验证清单
- [x] TypeScript 类型推导检查 (`pnpm typecheck`)
- [x] 现有功能单元测试无回归
- [ ] 建议补充的测试场景 (如有)
</review_template>

## Critical Constraints
1. **Zero Emojis**: NEVER output colorful emojis (e.g., no 🚦, 🚨, 💬, ✨, 📋, 🔴, 🟡, 🟢). Use clean text badges like `[P0 阻断]`, `[P1 警告]`, `[良好]`.
2. **Minimal Diffs Only**: Provide precise, minimal `diff` snippets targeting the exact lines to fix. Never dump full files or large unrelated blocks.
3. **Restraint Over Padding**: If there are no material bugs or security issues, explicitly state `判定结果: 可合入 (Ready to Merge)` with a brief 1-line confirmation. NEVER invent trivial complaints to pad length.
4. **Verifiable Claims**: Every finding MUST cite exact file paths and line ranges existing in the change set.

