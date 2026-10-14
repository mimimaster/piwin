# Inline Artifact 完成后样式丢失：定位与修复

## 根因

用户的 OSI/TCP-IP Artifact 在生成中、全屏预览正常，完成后的 Inline
显示为普通块级文本。读取对应会话原始 Artifact（`style="host"`）后确认
模型输出包含完整网格、卡片、徽标样式。

`materializeArtifact` 在 stream-preview 使用沙箱，在完成后将 inert flow
交给 `ArtifactStatic`。Tauri 构建时为宿主启动样式及 `style-src` 注入 nonce；
出现 nonce 后 `'unsafe-inline'` 不再授权任意样式块。静态渲染通过 JavaScript
创建的基础样式及模型样式没有该 nonce，因而被 CSP 阻止。

依据：本机 Tauri 2.11.5 的 `manager/mod.rs`（`replace_csp_nonce`）、
`tauri-utils` 的 `inject_nonce_token`，以及
[Tauri CSP 文档](https://v2.tauri.app/security/csp/)。

无 CSP 的 Chromium/WebKit 页面正常。对同一份会话 HTML 添加等价宿主
nonce CSP 后，两个引擎均复现：`.grid` / `.layer` 从 `grid` 变为 `block`，
标题 margin 变回约 `21.44px 0px`，两份 Shadow DOM 样式表 `sheet` 为 null。
因此旧 Vite 浏览器测试缺少正式包安全策略，是此次漏检的原因。

## 修复

- 新增 `artifact-static-styles.ts`，只从宿主 head 的启动样式读取 nonce
  （使用 `.nonce` 属性，而非浏览器会隐藏值的 `getAttribute`）。
- 在安全清洗之后、挂到 Shadow DOM 之前，为基础及模型样式赋予宿主 nonce。
  模型提供的 nonce 不参与授权。
- nonce 不授权 `style` 属性。对清洗后存活的 HTML/SVG 内联声明，逐个通过
  CSSOM `setProperty` 应用，保留 `!important` 优先级。
- 不改变源码、主题映射、安全清洗、CSP、沙箱权限、Canvas 或导出契约。
- 生产改动为一个 31 行样式模块，以及 `ArtifactStatic` 两行接入。

## 验证

| 检查 | 结果 |
| --- | --- |
| 修复前组件 nonce 回归 | 按预期失败，两份样式都没有宿主 nonce |
| 修复前 CSP 浏览器回归 | Chromium/WebKit 均按预期失败，grid 退化为 block |
| 完成态、流式、能力开关、溢出相关组件 | 30 项通过 |
| 最终 nonce 与会话内容相关组件复验 | 46 项通过 |
| 新增正式包 CSP 浏览器回归 | Chromium/WebKit 各 1 项通过，含网格、徽标、容器查询、HTML/SVG 内联样式 |
| 原有 Artifact 渲染与 Canvas 连续性回归 | 19 项通过 |
| 完整 Desktop 单工作线程最终复跑 | 784 文件、5776 项全部通过 |
| `pnpm typecheck` | 通过（默认脚本不含 Mobile） |
| `pnpm test:architecture` | 通过 |
| 生产文件行数 | `ArtifactStatic.tsx` 259 行；新样式模块 31 行 |

完整 Desktop 首次运行：5775 项通过，1 项在 5000ms 超时。
超时用例是 `ConversationResponseContent` 的完整 HTML 文档首次出现，
走沙箱分支，未执行此次修改的静态样式模块。整个相关文件独立复跑通过，
该用例约 2.4 秒。随后按单工作线程复跑完整套件：784 个测试文件、5776 项全部通过。

## 原生 WKWebView

在 macOS 26.5 上用独立的原生 WKWebView 加载当前 Desktop fixture 页面，
采用 Tauri 等价 nonce CSP，输入截图会话中的原始 HTML。使用纸主题变量
作为宿主输入进行截图（独立测试窗口，不是已安装 App）。

原生返回：

```json
{"grid":"grid","layer":"grid","headingMargin":"0px 0px 6px","nonceStyles":true,"stylesheets":[72,23]}
```

原生复验截图：
`/Users/yorickjue/.codex/visualizations/2026/10/12/01a12f6a-529d-7ae0-8eb2-ccfddee5bce4/inline-artifact-wkwebview-after.png`。

## 交付范围

修复在源码工作区；未提交或推送，未重新打包或替换 `/Applications/piwin.app`。
当前已安装 App 要重新打包更新后才会得到修复。本轮未执行完整的 Artifact
原生桥/Canvas 安装包 smoke 清单；原生复验仅验证本次静态样式 CSP 修复。
