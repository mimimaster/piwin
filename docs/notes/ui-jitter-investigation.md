# UI 抖动排查笔记（2026-07-29）

## 现象（用户报告）

- 右上角展开/收起工作面板：对话区抖，其它页按钮字也抖
- 设置「会话」开关（复选/Switch）点击也会抖
- 全局感觉像整页刷新

## 根因清单（按证据强度）

### 1. 文档流内插入/移除 Notice（主因 · 设置与列表开关）

**证据**

- 设置会话页 `session-page.tsx`：开关成功 → `setInfo(...)` → `SettingsPanel` 在 `settings-main` **正文上方**渲染 `<Notice>`
- info 有 **3.5s TTL** 后 `setInfo(null)` → Notice 卸载 → 内容再跳回去（二次抖动）
- 同样模式：`SkillsPanel` / `ExtensionsPanel` / `ThemePanel` / `AutomationPanel` / `McpPanel` 在列表 **上方** 条件渲染 Notice

**机制**

```
点击 Switch → save → Notice 插入文档流 → 下方所有内容（含按钮文字）整体下移
3.5s 后 Notice 消失 → 整体上移
用户感知：整页刷新 / 字体抖
```

**修复**

- `.ui-feedback-host`：绝对定位浮层，不占文档流
- 设置 banners、技能/扩展/MCP/主题/自动化 Notice 均挂入 host

### 2. OS 窗口 setSize + grid 第三列（右栏展开历史主因）

**证据**

- `window-outward-expand.ts` 曾对 Tauri `setSize`
- macOS 改窗宽会 **整窗重新栅格化文字**（侧栏、设置、状态栏字体一起抖）
- `has-right-panel` 曾改 `grid-template-columns` → 舞台宽度变 → 居中对话区（`--chat-max`）水平位移

**修复**

- 停用 setSize（API 保留为 no-op）
- 右栏改为 fixed 抽屉，不改 shell grid

### 3. `transition: all` 与亚像素 transform

**证据**

- `.session-status-dot { transition: all 0.2s }` 等
- `.sidebar-new-agent:hover { transform: translateY(-0.5px) }` → 亚像素层导致字形重绘

**修复**

- 收窄 transition 属性
- 去掉 hover 的 translateY

### 4. 滚动条出现/消失（次要）

**证据**

- 部分滚动容器未 `scrollbar-gutter: stable`，内容高度变化时视口宽度变 ~15px

**修复**

- `html { scrollbar-gutter: stable }`
- 设置主区原本已有 gutter

## 非根因 / 已排除

- 单点「开关组件尺寸不固定」：Switch 已锁 track 几何，无法解释「其它页字体一起抖」
- 单纯 React re-render：无 layout 变化时文字不会「抖」，只会瞬间更新

## 验证清单

1. 设置 → 会话 → 连点「自动上下文压缩」：正文不应上下跳；Notice 以浮层出现在右上
2. 技能/扩展列表开关：列表行不应整体下移
3. 右上角工作面板开关：对话区水平位置稳定；侧栏字不闪
4. 连点会话列表项：仅高亮切换，无整页位移（大 transcript 替换是内容切换，非布局抖动）


## 2026-07-29 产品决策：in-flow 重排，不改窗

用户反馈 setSize 外扩仍抖，改为产品方案：

| 项 | 决策 |
|----|------|
| OS 窗口 | **不** `setSize` |
| 桌面右栏 | **第三列 in-flow**（保留侧栏占位） |
| 聊天区 | 舞台 `1fr` 随开合变窄/变宽，一帧完成 |
| 动画 | 无 grid / opacity 过渡（中间帧像刷新） |

实现：`window-outward-expand` no-op；`use-shell-layout` 同步 `setOverlay`；CSS 注释与 `transition: none`。

抗抖仍保留：Notice 浮层、`transition:all` 收窄、scrollbar-gutter。
