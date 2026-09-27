# 扩展仓库：发布与接入说明

| 字段 | 值 |
|------|----|
| 状态 | Living document |
| 决策 | [ADR 0077 扩展仓库](../adr/0077-github-extension-registry.md)、[ADR 0078 扩展 UI 桥接](../adr/0078-extension-ui-surface-bridge.md)、[ADR 0079 声明式面板（提案）](../adr/0079-declarative-extension-ui.md) |
| 相关 | [Pi Extensions in piwin](./pi-extensions.md)、[ADR 0047 托管扩展](../adr/0047-managed-pi-extension-activation.md) |

piwin 的扩展就是 **Pi 扩展**，没有另一套格式。扩展仓库只是分发渠道：一个 GitHub
仓库（默认 `mimimaster/piwin-extensions`），每个扩展一个条目文件，指向作者仓库里
**固定 commit** 的源码。别人要上架，就提一个 PR。

```
作者仓库 (源码)          piwin-extensions (条目 + CI)            piwin Host
alice/git-autopilot ──▶ extensions/alice/git-autopilot.json ──▶ index.json (Pages)
      @ 9f3c2e1…         PR → CI 校验 → 合并 → 发布                 │
                                                                    ├─ marketplace/search：排在 npm/GitHub 前
                                                                    └─ extensions/install {kind:'registry'}
                                                                         → 拉取固定 commit → 不可变 revision
```

## 1. 写一个能上架的扩展

```ts
// index.ts —— 默认导出 Pi 扩展工厂
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'git_staged_summary',
    description: 'Summarize staged changes',
    parameters: { type: 'object', properties: {} },
    async execute() {
      return { content: [{ type: 'text', text: '…' }] };
    },
  });

  pi.registerCommand('autopilot', {
    description: 'Stage and commit with a generated message',
    async handler(args, ctx) {
      const ok = await ctx.ui.confirm('Commit?', args || 'Use the generated message');
      if (ok) ctx.ui.notify('Committed', 'info');
    },
  });

  pi.on('session_start', (_event, ctx) => {
    ctx.ui.setStatus('autopilot', 'autopilot: on');
    ctx.ui.setWidget('autopilot-hint', ['/autopilot 暂存并提交'], { placement: 'belowEditor' });
  });
}
```

源码约束（CI 和 piwin 都会检查）：

- 目录里有 `index.ts`，或 `subdir` 直接指向一个 `.ts` 文件；
- `package.json` 不能有 `dependencies`，不能有 `preinstall` / `install` / `postinstall` / `prepare`；
  Pi 包只用 `import type` 或放 `peerDependencies`，其它依赖打包进源码；
- 不能有符号链接或 `node_modules`；≤ 5 MB，≤ 2000 个文件。

原因：piwin 把固定 commit 的源码原样放进不可变 revision，**不跑 npm、不跑任何脚本**。
扩展只在用户启用后、在 Run 边界加载（ADR 0047）。

## 2. 条目格式

每个扩展一个文件：`extensions/<owner>/<name>.json`。`<owner>` 是 GitHub 用户名或组织（小写），
`<name>` 只用小写字母、数字和 `-`，扩展 id 是 `<owner>/<name>`，由路径决定。

```json
{
  "name": "Git Autopilot",
  "description": "暂存改动并生成提交信息。",
  "owners": ["alice"],
  "repository": "https://github.com/alice/git-autopilot",
  "subdir": "extension",
  "license": "MIT",
  "keywords": ["git", "commit"],
  "homepage": "https://alice.dev/git-autopilot",
  "versions": [
    { "version": "1.1.0", "commit": "9f3c2e1d4b5a6978a1b2c3d4e5f60718293a4b5c", "publishedAt": "2026-09-01T00:00:00Z" }
  ]
}
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `name` | ✓ | ≤ 80 字 |
| `description` | | ≤ 500 字 |
| `owners` | ✓ | 非空，小写 GitHub 用户名；只有这些人能改条目 |
| `repository` | ✓ | `https://github.com/<owner>/<repo>`，不带 `.git` 和结尾 `/` |
| `subdir` | | 仓库内的相对路径（目录或 `.ts` 文件），不能以 `/`、`./` 开头，不能含 `..` |
| `license` | ✓ | SPDX 标识 |
| `keywords` | | ≤ 20 个，每个 ≤ 40 字 |
| `homepage` | | https 链接 |
| `forkOf` | | 改装版：`{ "id": "<owner>/<name>", "version": "…" }`，不能指向自己 |
| `versions` | ✓ | 每项 `{ version, commit, publishedAt?, yanked? }`；`commit` 为完整 40 位小写 SHA；`version` 匹配 `^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$` |

`id`、owners、仓库地址、subdir、commit、版本号、`forkOf` 不能指向自己，这几条规则在
扩展仓库的 CI（`scripts/lib/entry.mjs`）和 piwin 客户端解析器（`parse-registry-index.ts`）里
完全一致，两边用同一份 `schema/fixtures` 测试。CI 在格式上更严（未知字段、大写、`.git`
一律拒绝），piwin 解析器则把这些规范化后接受，所以 CI 放行的条目 piwin 一定能读。

## 3. 发布、发版、改装、撤回

扩展仓库网页：<https://mimimaster.github.io/piwin-extensions/>。也可以直接 fork 仓库手动提 PR。

### 发布新扩展

**一键发布（推荐）**：网页「发布扩展」→ 用 GitHub 登录 → 拖入扩展文件夹、zip 或单个 `.ts` →
确认页面从 `package.json` 读出的名称、版本、许可证 →「一键发布」。页面用**你自己的 token**：
在你的账号下创建 `piwin-<扩展名>` 并推送代码 → fork 扩展仓库 → 写入固定到该 commit 的条目 → 开 PR。
PR 作者就是你，所以 CI 的所有权检查依然成立。发布前页面会用 CI 同一套规则（`entry.mjs` +
`source-rules.mjs`）检查上传的文件。登录用的是 OAuth App（`public_repo` 权限），授权码由一个
不存储、不记录的 Cloudflare Worker 换成 token，token 只保存在浏览器标签页里（ADR 0077 §5）。

**手动填写**（源码已在 GitHub、发到组织名下，或不想授权）：「手动填写」里贴仓库地址自动填表 →
「生成 PR 链接」→ GitHub 新建文件页（已预填）：

```
https://github.com/mimimaster/piwin-extensions/new/main/extensions/<你的用户名>?filename=<name>.json&value=<URL 编码的 JSON>
```

没有写权限时 GitHub 会自动 fork 并替你开 PR，PR 作者同样是你。条目太长放不进链接时，
页面先把 JSON 复制到剪贴板，再打开空白的新建页。

所有权规则：新条目放在你自己的用户名下，或者放在你**公开**所属的组织下；`owners` 必须包含你。

### 发新版本

一键：网页扩展详情 →「我是作者：上传新版本」→ 登录 → 拖入新代码 → 填版本号 → 发布。

手动：「手动：填 commit 发版本 / 撤回版本」→「用最新 commit」或手填 → 生成完整 JSON →
复制 →「打开 GitHub 编辑页」→ 全选粘贴 → Propose changes（GitHub 编辑页不能预填内容）。

手动：在 `versions` 里加一项。顺序无所谓，`build-index` 发布时按版本号从新到旧排序
（非 semver 的版本号保持文件里的顺序）。已发布的 version → commit 永远不能改，条目不能删。
只有 base 版本 `owners` 里的人提的 PR 会通过。

### 撤回版本

给那一版加 `"yanked": { "reason": "为什么" }`，这是已发布版本唯一允许的改动，撤回后不能恢复。
撤回的版本不出现在 piwin 搜索里，安装时也会被拒绝。

### 发布改装版

在**你自己的**命名空间建新条目并填 `forkOf`（网页里选「改装自」和基于的版本）。
原扩展必须是允许修改的开源许可证；原扩展是 copyleft（GPL/LGPL/AGPL/MPL）时，改装版要沿用同一许可证。
CI 会在 PR 评论里贴出原版和改装版两个 commit 的链接。piwin 里改装版装成独立扩展
（`yorick-git-autopilot`），和原版（`alice-git-autopilot`）互不覆盖，市场卡片显示「基于 … 改装」。

### CI 怎么判

`validate submission` 运行在 `pull_request_target` 上：只检出目标分支，通过 GitHub API 把 PR
改动的文件当数据读取，不执行 PR 里的任何东西；新版本的源码用 `git fetch --depth 1` 只读检查。
结果写成 PR 评论并体现在 check 状态上。详见扩展仓库的 `CONTRIBUTING.md`。

## 4. piwin 里怎么接（给客户端 / 集成方）

### 4.1 搜索

`marketplace/search` 同时查三个来源，扩展仓库排第一，并去掉 npm/GitHub 里指向同一仓库的重复项：

```ts
const res = await host.request({ type: 'marketplace/search', query: 'git' });
// res.data.hits[i].source === 'piwin-registry' 时：
// hit.registry = { id: 'alice/git-autopilot', owners, commit, license, forkOf? }
// hit.version  = 最新未撤回版本
```

### 4.2 安装

扩展仓库的结果走现有的 `extensions/install`，没有新的通用安装命令：

```ts
await host.request({
  type: 'extensions/install',
  source: { kind: 'registry', id: 'alice/git-autopilot', version: '1.0.0' }, // version 可省
});
// → data.registry = { id, version, commit }，data.extensionId = 'alice-git-autopilot'
await host.request({ type: 'extensions/set_enabled', extensionId: 'alice-git-autopilot', enabled: true });
await host.request({ type: 'extensions/apply', sessionId, when: 'after-current-run' });
```

Host 做的事：读索引 → 解析版本（拒绝已撤回版本）→ `git fetch` 那个 commit 并核对 `HEAD`
→ 去掉 `.git` → 写入 `~/.piwin/extensions/revisions/<id>/<内容哈希>/`，默认不启用。
安装后的 id 带上作者（`<owner>-<name>`），原版和改装版不会互相覆盖。

命令行：

```bash
piwin extension install --registry alice/git-autopilot@1.0.0
piwin extension enable alice-git-autopilot
```

### 4.3 换成自己的扩展仓库

在运行 Host 的机器上设置环境变量：

```bash
PIWIN_EXTENSION_REGISTRY_URL=https://<you>.github.io/<repo>/index.json
```

团队 fork `piwin-extensions`、开启 Pages，就是一个私有扩展仓库；网页前台会根据
`<you>.github.io/<repo>` 自动指向这个 fork。Host 端索引缓存 5 分钟。桌面端市场和
`piwin extension install --registry` 都读这个地址。

### 4.4 索引格式（`index.json`，schemaVersion 1）

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-27T00:00:00Z",
  "extensions": [
    {
      "id": "alice/git-autopilot",          // 来自文件路径
      "name": "Git Autopilot",
      "description": "…",
      "owners": ["alice"],
      "repository": "https://github.com/alice/git-autopilot",
      "subdir": "extension",                 // 可选
      "license": "MIT",
      "keywords": ["git"],                   // 可选
      "forkOf": { "id": "bob/x", "version": "1.1.0" }, // 可选
      "versions": [                          // build-index 按版本号从新到旧排序
        { "version": "1.0.0", "commit": "<40 位 SHA>", "yanked": { "reason": "…" } }
      ]
    }
  ]
}
```

契约类型：`@piwin/contracts` 的 `ExtensionRegistryIndex` / `ExtensionRegistryEntry` /
`ExtensionInstallSource`。piwin 按不可信输入解析：整份格式不对就失败，单个条目不合法就丢弃并记日志。

## 5. 扩展能用的 UI（桌面端 / CLI）

扩展运行在 Host 上，Host 可能在远程并同时服务多个客户端，所以 UI 一律以**数据**经
`HostPush` 下发，扩展代码不会跑进客户端。

| Pi 调用 | 桌面端 | CLI | 说明 |
|---|---|---|---|
| `ctx.ui.confirm / select / input` | 弹窗 | TTY 问答 | `extension/ui_request` |
| `ctx.ui.notify(msg, level)` | toast | `[extension] msg` | `extension/ui_notice`，一次性 |
| `ctx.ui.setStatus(key, text)` | 输入框下方的状态标签 | 文本变化时打印 | 并入 `extension/ui_surface` 快照 |
| `ctx.ui.setWidget(key, string[], { placement })` | 输入框上方/下方的文本块 | 变化时打印 | 只支持文本行；组件工厂被忽略 |
| `ctx.ui.setWorkingMessage(msg)` | 状态行里的斜体标签 | — | |
| `pi.registerCommand(name, …)` | 出现在 `/` 菜单「扩展」分组 | 直接输入 `/name` | 名字来自静态扫描；与技能/保留命令同名时让位 |
| `ctx.ui.theme.fg/bg/bold…` | 返回原文本 | 同左 | 不再抛错；ANSI 转义被剥掉 |
| `setHeader / setFooter / custom()`、快捷键、编辑器钩子、主题 | 不支持 | 不支持 | 保持 no-op |

限制：每个会话最多 16 个状态、8 个面板；状态 ≤ 240 字，面板 ≤ 24 行 × 400 字；
更新合并约 50 ms 推送一次。新的运行时代（例如启用/停用扩展后）会清空旧状态。
晚连上的客户端用 `extension/ui_surface_get { sessionId }` 取当前快照。移动端暂不渲染。

需要表单、按钮、表格等可交互面板时，见 [ADR 0079 提案](../adr/0079-declarative-extension-ui.md)，尚未实现。

## 6. 安全边界

- CI 通过 = 结构检查 + 维护者合并，**不是安全审查**。
- 启用后的扩展以 Host 用户的系统权限运行；权限规则不是沙箱。
- 桌面端安装确认框会展示作者、commit 前缀、改装来源，并说明上述风险；装完即启用。
