# M4 Spec — Skills + MCP

| Field | Value |
|-------|-------|
| Status | **Implemented (partial)** |
| Date | 2026-07-20 |
| Packages | `skills`, `mcp`, `marketplace`, `agent-host`, `contracts`, `apps/desktop`, `apps/cli` |
| Deferred source | [todo-deferred.md](../todo-deferred.md) §3 |
| Principle | **协议与发现尽量用官方/Pi 已有能力；UI 与 `~/.piwin` 映射自研** |

---

## Implementation status (2026-07-20)

**Partial — packages + CLI done; desktop panels remaining.**

| Area | Status | Notes |
|------|--------|-------|
| `@piwin/skills` scan + ensure-bundled | Done | user/project/extraPaths + disabledIds |
| `@piwin/marketplace` local/git install | Done | InstallSource; recommended catalog |
| `@piwin/mcp` config validate/load/save + client | Done | Cursor/Claude-compatible mcp.json shape |
| Host skillsPaths + MCP paths | Done | `getPiwinSkillsDir` / `getPiwinMcpConfigPath` |
| CLI skill list/install/ensure-bundled | Done | |
| CLI mcp list/validate/add | Done | |
| Desktop Skills panel | **Not done** | list/enable UI |
| Desktop MCP form + raw JSON editor | **Not done** | |
| Live MCP tool bridge into running session | **Partial** | client + naming ready; full Pi registerTool path may need more host work |

## 1. Goal

1. **Skills**：列/启停/安装（user & project）；默认捆绑一组；内置 **find-skill**、**create-skill** 工作流。  
2. **MCP**：JSON 配置（Cursor/Claude 兼容 shape）+ 表单；list tools；把 MCP tools 暴露给 agent。  
3. **Marketplace（薄）**：统一「从 local path / git URL / 目录 安装」，不做自建中央商店。

---

## 2. Non-goals (M4)

| 不做 | 原因 |
|------|------|
| 自建 skill/MCP 中央商城后端 | 直接用 git/npm/目录；可链到公开目录网站 |
| Fork 整个 Pi 的 skill 加载器 | **复用 Pi 的 skills 发现**（`~/.pi/agent/skills`、Agent Skills 标准） |
| 从零实现 MCP 协议 | 用 **官方 `@modelcontextprotocol/sdk`** |
| 复制 Cursor 闭源市场 UI | 只借鉴信息架构（搜索 / 已安装 / 配置） |

---

## 3. 开源调研：抄什么

### 3.1 Skills

| 来源 | 能抄什么 |
|------|----------|
| **[Agent Skills 标准](https://agentskills.io)** / Pi skills 文档 | `SKILL.md` frontmatter、progressive disclosure、目录约定 |
| **Pi coding-agent** | 已实现 skill 扫描与 `/skill:name`；**host 应委托 Pi 加载**，piwin 做「安装到正确目录 + UI 索引」 |
| **[anthropics/skills](https://github.com/anthropics/skills)** | 默认 skill 内容参考（文档/模板），注意 license |
| **[microsoft/skills](https://github.com/microsoft/skills)** | 额外模板与 Azure 向 skill，可选 |
| **SkillsMP / Awesome Skills 目录站** | **只作发现入口链接**，不爬站洗数据进私服 |
| **本机 Cursor skills**（`create-skill` 等） | 可做「导入路径映射」：settings 里加 `~/.cursor/skills`（Pi 已支持 skills 数组） |

**结论：**  
- **运行时加载 = 抄/用 Pi**  
- **安装器 + 面板 + 默认包 = 自研薄层**  
- **find-skill / create-skill = 两个 bundled SKILL.md**（可从 Cursor 工作流改写，不必依赖闭源）

### 3.2 MCP

| 来源 | 能抄什么 |
|------|----------|
| **[@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)** | Client：stdio/SSE、`listTools`、`callTool` |
| **Cursor / Claude Desktop 配置 shape** | `mcpServers: { name: { command, args, env } }` —— **兼容用户已有 JSON** |
| **mcp-builder skill / create-mcp-use-app** | 仅文档级；不绑死框架 |
| **各 MCP server 仓库** | 安装 = `npx -y @scope/server` 或 git clone；市场 UI 只展示「命令模板」 |

**结论：**  
- 协议栈 **必须用官方 SDK**  
- 配置 schema + 校验 + 启停进程 = 自研 `@piwin/mcp`  
- 与 Pi 的衔接：优先查 Pi 是否已有 MCP 插件；**有则适配，无则 host 侧把 MCP tools 映射为 Pi `registerTool`**

### 3.3 Marketplace（统一安装源）

| 策略 | 说明 |
|------|------|
| **不要自建 registry 服务** | M4 只做 Source 抽象 |
| Source 类型 | `local-dir` / `git` / `npm`（可选） |
| UI | 搜索 = 本地已装 + 用户添加的 source 索引；远程热门列表可硬编码「推荐 git URL」表 |

可参考（模式，非 fork）：

- `pi install` / Pi packages（extensions+skills 捆绑）  
- 社区 skill 目录的「一键 clone 到 skills 目录」脚本

---

## 4. 架构

```text
apps/desktop
  SkillsPanel / McpPanel / 简单 InstallDialog
apps/cli
  piwin skill list|install|enable
  piwin mcp list|add|validate
        │
        ▼
@piwin/marketplace     InstallSource 抽象（git/local）
@piwin/skills          索引、默认包、find/create skill 文件
@piwin/mcp             mcp.json schema、进程生命周期、tools 缓存
        │
        ▼
@piwin/agent-host      session 启动：通知 Pi skills 路径；挂载 MCP→tools
@piwin/contracts       SkillSummary, McpServerConfig, InstallSource
```

配置布局：

```text
~/.piwin/
  skills/                 # 用户 skill（或 symlink）
  mcp.json                # mcpServers map
  config.json             # skills.paths[], mcp.enabled
# Pi 原生（映射，不破坏升级）
~/.pi/agent/skills/
~/.pi/agent/settings.json  # 如需写入 skills 数组则文档化
```

**原则：** 产品状态以 `~/.piwin` 为准；对 Pi 用 **映射/写入 settings 的 skills 路径**，避免用户只认一套目录。

---

## 5. 数据模型（contracts 草案）

```ts
// skills
type SkillSummary = {
  id: string;           // name from frontmatter
  name: string;
  description: string;
  source: 'bundled' | 'user' | 'project' | 'mapped';
  path: string;         // directory containing SKILL.md
  enabled: boolean;
};

// mcp — Cursor-compatible
type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
};

type McpConfigDocument = {
  mcpServers: Record<string, McpServerConfig>;
};

type InstallSource =
  | { kind: 'local'; path: string }
  | { kind: 'git'; url: string; ref?: string; subdir?: string };
```

---

## 6. 功能拆解

### M4.A Skills 内核

| ID | Task | 抄/自研 | Exit |
|----|------|---------|------|
| M4.A1 | 扫描 `~/.piwin/skills`、project `.pi/skills`、mapped 路径 | 仿 Pi 扫描规则 | list |
| M4.A2 | 解析 SKILL.md frontmatter（name/description） | 标准 frontmatter；可用 `gray-matter` | 单测 |
| M4.A3 | enable/disable（维护 enabled 集合到 config） | 自研 | 持久化 |
| M4.A4 | 安装：local copy / `git clone` 到 skills 目录 | 薄封装 | 目录出现 |
| M4.A5 | bundled：`find-skill`、`create-skill` + 精简默认集 | 写 md，参考公开 skill 仓库 | 开箱有 |
| M4.A6 | 把路径同步给 Pi（settings 或 env/cwd 约定） | 读 Pi 文档后适配 | doctor 可查 |

### M4.B MCP 内核

| ID | Task | 抄/自研 | Exit |
|----|------|---------|------|
| M4.B1 | `mcp.json` 读写 + JSON Schema 校验 | 兼容 Cursor shape | validate CLI |
| M4.B2 | Client connect stdio（官方 SDK） | **@modelcontextprotocol/sdk** | listTools |
| M4.B3 | 进程启停 / 崩溃标记 | 自研 | health |
| M4.B4 | tool 名冲突：前缀 `mcp__<server>__<tool>` | 常见约定 | 无覆盖 |
| M4.B5 | callTool 桥到 Pi registerTool | host 适配 | 模型可调 |
| M4.B6 | env 中 `${ENV}` 展开 | 自研 | 不写死 secret |

### M4.C Marketplace 薄层

| ID | Task | 抄/自研 | Exit |
|----|------|---------|------|
| M4.C1 | `InstallSource` + installSkill / install hint for MCP | 自研 | API |
| M4.C2 | 推荐列表（静态 JSON：git URL + 说明） | 可手维 | UI 能装 1 个 |
| M4.C3 | **不做** 账号/付费/远程搜索后端 | — | — |

### M4.D UI + CLI

| ID | Task | Exit |
|----|------|------|
| M4.D1 | SkillsPanel：已安装 / 启用开关 / 打开目录 / 安装 local|git | 可用 |
| M4.D2 | McpPanel：表单字段 + Raw JSON tab + 校验错误 | 可用 |
| M4.D3 | tools 预览表（listTools） | 可见 |
| M4.D4 | CLI：`skill list\|install`，`mcp list\|add\|validate` | parity 薄 |

---

## 7. 默认 bundled skills（建议最小集）

| Skill | 作用 |
|-------|------|
| `find-skill` | 如何检索本地/已映射 skill |
| `create-skill` | SKILL.md 模板与验收清单 |
| `web-research` | 指导何时用 web_search/fetch（依赖 M3） |
| （可选）`verification-before-completion` | 从公开工作流精简改写 |

其余 Cursor 默认集 **映射目录即可**，不必全部 vendoring。

---

## 8. 与 Pi 的衔接决策（实现前必须验证一次）

动手 M4.B5 / M4.A6 前，用半小时做 spike（写进 ADR）：

1. Pi 当前版本是否内置 MCP？配置文件在哪？  
2. `createAgentSession` 如何附加 custom tools？  
3. skills 路径是否仅通过 `DefaultResourceLoader` / settings.skills？  

**Spike 结论写入 `docs/adr/0008-skills-mcp-pi-wiring.md`（实现时建）。**  
若 Pi 已支持 MCP：piwin 只做配置 UI + 映射。  
若否：mcp client 活在 agent-host，tools 动态 register。

---

## 9. 验收

1. 安装一个 git skill → 出现在列表 → enable → 新 session 的 agent 能按 skill 描述触发（或 `/skill:name` 若 Pi 暴露）。  
2. `find-skill` / `create-skill` 在 bundled 中可读。  
3. 写入兼容 Cursor 的 `mcp.json` → validate 通过 → listTools 非空（对一个官方示例 server，如 filesystem）。  
4. 模型在授权下能调用至少一个 MCP tool。  
5. CLI 能 list skill/mcp。  
6. 无 apps → Pi 直连；无 secrets 进日志。

---

## 10. 建议实现顺序

1. **Spike Pi skills/MCP/tool API**（0.5–1 天）→ ADR  
2. contracts：SkillSummary / McpConfigDocument  
3. `@piwin/skills` 扫描 + bundled  
4. `@piwin/mcp` sdk client + mcp.json  
5. host 接线  
6. Desktop 两面板 + CLI  
7. marketplace git install  

**预估：** spike+内核 1 周；UI/CLI 1 周（含摩擦）。

---

## 11. 风险

| 风险 | 缓解 |
|------|------|
| Pi 版本升级破坏 tool 注册 | 隔离在 agent-host；测一个固定 pi 版本 |
| MCP server 供应链 | 安装前展示 command/args；默认不自动 --yes 乱装 |
| Skill 可含恶意指令 | 安装提示 + 只从用户指定 git |
| 与 Claude/Cursor 配置双份 | 提供「导入 ~/.cursor/mcp.json」一次性复制 |
