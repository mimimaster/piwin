# Skill / 文档预览资源解析修复 — 完整执行计划

| Field | Value |
|---|---|
| Date | 2026-08-11 |
| Status | Draft v2 — review 后修订，await approve before implementation |
| Scope | Host 项目文件读取加固、Desktop 文档预览打开链路、Skill 逻辑身份与只读预览、工具文档目标、transcript 快照兜底 |
| Non-goals | Skill 在线编辑器、任意系统路径浏览、通用 Host 文件浏览器、改 agent 工具权限模型、修 agent 反复读 skill 的行为优化（单列 follow-up） |
| Related | apps/desktop/src/App.tsx（handleOpenDocument）、resolve-document-content.ts、project/read-file、skills catalog、ResourceCatalog、ADR 0036 |

---

## 0. 原始需求与调查结论

### 0.1 用户看到的现象

在 Desktop 会话中：

1. Agent 执行用户请求时，工具时间线出现大量“读取 SKILL.md”。
2. 用户点击工具结果或路径 chip，右侧 Inspector 打开 Doc Preview。
3. 面板标题只显示 SKILL，并提示：

~~~text
暂未在路径
/Applications/piwinwin.app/Contents/Resources/host/skills/executing-plans/SKILL.md
找到文件内容
~~~

4. 用户无法判断：
   - 读的是哪个 skill；
   - agent 是否真的读成功；
   - 右侧为什么没有正文；
   - 当前展示的是 agent 当时读取的版本，还是现在安装的版本。

### 0.2 原始产品诉求

| ID | 原始诉求 | 可验收表述 |
|---|---|---|
| R1 | 弄清楚“他读的什么 skill” | 面板明确显示 skill id、name、effective source，不只显示 SKILL 和 Host 绝对路径 |
| R2 | 打开后不应空白 | 优先显示 agent 当时读取的快照；快照不可用时显示当前有效资源，并明确标注二者差异 |
| R3 | 路径要可信 | 主展示使用逻辑资源身份，例如 skill:executing-plans；本地路径只能作为辅助证据，不得成为公共协议身份 |
| R4 | 失败要说人话 | 显示稳定原因分类、已尝试来源和可操作建议 |
| R5 | 不破坏现有项目文件预览 | 项目内 docs、file tree、plan 文档打开行为保持正确 |
| R6 | 安全边界不能因预览被打开 | Host 拒绝任意 caller-supplied root、路径穿越和越界 symlink；Desktop 不能靠伪造 project root 读任意文件 |
| R7 | 本地与远程 Host 语义一致 | 新协议使用 Host-issued 或 session-scoped 逻辑引用；远程客户端不拼接 Host 绝对路径 |

### 0.3 已确认事实

1. 截图路径指向内置 executing-plans。
2. 仓库源和当前用户安装目录都有完整正文：
   - 源：skills/executing-plans/SKILL.md
   - 当前安装副本：~/.piwin/skills/executing-plans/SKILL.md
3. 当前截图中的 app bundle 路径在本机已不存在，因此无法作为稳定预览路径。
4. App.tsx 的 handleOpenDocument 在无 inline content 时会调用 project/read-file。
5. 对项目外绝对路径，当前 Desktop 会把 dirname 当 projectPath、basename 当 relativePath。这是直接故障点。
6. project/read-file 当前只保证 relativePath 不逃离“调用方传入的 root”；它没有验证该 root 是已登记项目，也没有做 realpath symlink containment。因此它还不是 Host 权威的项目沙箱。
7. resolveDocumentContentFromMessages 并非完全不认 read output：带 targetPaths 的工具有机会被采用，但规则依赖输出格式。
8. 历史 transcript 的 UI projection 会主动清空 tool.output 和 presentation.output。只扫描 state.messages 无法可靠恢复历史工具正文。
9. 当前 ResourceCatalog 已表达 logical resource id、source、重复 ID 与 shadowing；本计划不得另写一套简化 precedence。
10. ~/.piwin/skills 当前在 scanner 中标记为 user location。ensureBundledSkillsInstalled 没有持久化 origin，因此 location source 与 bundled origin 不能混为一个字段。

### 0.4 根因结论

直接故障链是：

~~~text
旧工具记录只有 Host 绝对路径
  → Desktop 把外部路径伪造成 project root
  → project/read-file 读取已经失效的 app bundle 路径
  → 磁盘失败
  → live read output 识别不稳定，历史 output 又未 hydrate
  → Doc Preview 显示空 stub
~~~

更深层问题是：

- 文档预览把“路径字符串”当成资源身份；
- Host 与 Desktop 的分类职责颠倒；
- “实际工具目标”“agent 当时看到的快照”“当前有效 Skill”没有 provenance 区分；
- project/read-file 的 root 仍由客户端决定。

### 0.5 Done means

同类操作完成后：

1. 面板显示 Skill · executing-plans · effective source。
2. 有 agent read 快照时显示快照，并标注“来自该次工具调用”。
3. 快照不可用时显示当前有效 Skill，并标注“当前安装版本，可能不同于历史读取内容”。
4. 新工具卡使用逻辑身份 skill:executing-plans；实际 target path 不被篡改。
5. 项目文档预览无回归。
6. Host 直接拒绝任意未登记 project root 和越界 symlink。
7. 远程客户端无需知道 Host home、app bundle 或 project 绝对路径。

---

## 1. Goal

把 Doc Preview 从“猜路径并读盘”改成“按 Host 解析的资源身份读取”，同时加固 project/read-file：

- Host 负责权限、scope、catalog、路径和 provenance；
- Desktop 负责发起逻辑读取、展示状态和来源；
- ToolPresentation 保留实际执行证据，并额外携带可打开的文档资源引用；
- 旧 transcript 的绝对路径只走受限兼容解析，不能成为新的协议主路径。

---

## 2. Constraints

- Host 是文件、session scope、ResourceCatalog 和 allowlist 权威。
- Desktop 不推导 Host home、bundle root、Skill precedence 或 realpath。
- Apps 不读取文件系统，不导入 Pi。
- packages/skills 拥有 Skill 扫描、解析、读取和 allowlist 逻辑；host-runtime 只做命令编排。
- packages/project 拥有项目根验证与安全路径解析；host-runtime 只接入。
- 不改变 Pi-native 原始事件形状；允许扩展产品 contracts 中的 ToolPresentation。
- targetPaths 表示工具实际目标，禁止为展示方便改写成另一个路径。
- 新协议必须能被 local HostClient 和 Host Server 共用；远程投影不得泄露 Host 绝对路径。
- 预览只读，不扩大 agent 工具读写权限。
- 保留现有 uncommitted 工作，不做无关重构。
- 至少完成 zh-CN 文案；新增稳定错误 id。
- agent 重复 read skill 不在本计划内。

---

## 3. Architecture

### 3.1 资源身份优先，不再由 Desktop 猜 PathKind

新工具事件优先携带结构化文档目标：

~~~ts
export type DocumentTargetRef =
  | {
      kind: 'project-file';
      relativePath: string;
      displayRef: string;
    }
  | {
      kind: 'skill';
      skillId: ResourceId;
      displayRef: string;
      effectiveSource?: ResourceSource;
    };

export type ToolPresentation = {
  // existing fields...
  targetPaths?: string[]; // 实际工具目标；保留审计事实
  documentTargets?: DocumentTargetRef[]; // 产品可打开资源
};
~~~

规则：

1. agent-host 继续把 Pi 工具参数归一化为 targetPaths。
2. host-runtime 使用当前 SessionBlueprint.resourceManifest 和 session scope，在 push/persist 前补充 documentTargets。
3. Desktop 优先使用 documentTargets。
4. 本地旧 transcript 只有 targetPaths 时，允许走 legacy resolver。
5. 远程投影可以传 documentTargets，但不传 Host absolute targetPaths。

### 3.2 打开流程

~~~text
用户点击文档目标
        │
        ├─ inline content 明确存在
        │      └─ 直接展示（包括空字符串）
        │
        ├─ project-file ref
        │      └─ project/read-file（sessionId + relativePath）
        │
        ├─ skill ref
        │      └─ skills/read（sessionId + skillId）
        │
        └─ legacy local path
               ├─ Host 受限解析为 skill/project resource
               ├─ 失败后尝试已持久化 read snapshot
               └─ unavailable state
~~~

Desktop 不判断一个 Host 绝对路径是否位于 ~/.piwin 或 app bundle；这属于 Host。

### 3.3 Project read authority

project/read-file 保留 file tree 能力，但命令输入分为两种明确模式：

~~~ts
export type ProjectReadFileCommand =
  | {
      type: 'project/read-file';
      sessionId: string;
      relativePath: string;
      maxBytes?: number;
    }
  | {
      type: 'project/read-file';
      projectPath: string; // local compatibility/file tree only
      relativePath: string;
      maxBytes?: number;
    };
~~~

Host 规则：

1. sessionId 模式从 session authority 取得 scope/project root。
2. projectPath 兼容模式必须精确匹配 project store 中已登记项目。
3. 对 root 与目标执行 realpath containment；目标 symlink 若落到 root 外则拒绝。
4. relativePath 继续拒绝 parent traversal、绝对路径和不同 drive。
5. Host Server 只开放 sessionId 或 Host-issued projectId 模式；不接受远程 caller-supplied projectPath。

### 3.4 Skill read authority

skills/read 使用 session scope 和现有 ResourceCatalog，不直接按目录顺序猜 precedence：

~~~ts
export type SkillsReadCommand = {
  type: 'skills/read';
  sessionId: string;
  skillId?: ResourceId;
  legacyPath?: string; // local legacy compatibility hint only
  maxBytes?: number;
};

export type SkillPreviewFailureReason =
  | 'not-found'
  | 'outside-catalog'
  | 'not-a-file'
  | 'binary'
  | 'too-large'
  | 'skill-unresolved'
  | 'snapshot-unavailable';

export type SkillsReadData =
  | {
      status: 'ready';
      skillId: ResourceId;
      name: string;
      effectiveSource: ResourceSource;
      origin: 'bundled-installed' | 'user-installed' | 'project' | 'mapped' | 'unknown';
      displayRef: string;
      content: string;
      byteSize: number;
      truncated: boolean;
      provenance: 'current-resource';
      resourceCatalogRevision?: string;
    }
  | {
      status: 'unavailable';
      reason: SkillPreviewFailureReason;
      skillId?: ResourceId;
      displayRef: string;
      suggestion?: string;
    };
~~~

输入约束：

- skillId 与 legacyPath 至少有一个。
- 远程 Host 只接受 skillId；legacyPath 仅限本地旧 transcript。
- legacyPath 不能直接成为 read root。它只能：
  - 与 session catalog 中的候选路径精确/realpath 匹配；
  - 或从已验证 bundled layout 提取 skillId，再回到 catalog 解析。
- 解析必须覆盖现有 roots：
  - ~/.piwin/skills；
  - trusted project 的 .pi/skills 与 .agents/skills；
  - config.skills.extraPaths mapped roots；
  - catalog 中未来加入的 Pi native roots。
- 单文件 user Skill 与目录/SKILL.md 两种形态都要支持。
- duplicate ID 必须使用现有 effective resource/diagnostics，不允许 installed-first 或 basename-first 自创 precedence。

实现归属：

- packages/skills：Skill preview resolver、realpath allowlist、文本读取、frontmatter/name 解析。
- packages/host-runtime：取得 session scope/catalog，调用 packages/skills，包装 HostResponse。
- packages/contracts：命令、结果、DocumentTargetRef。

### 3.5 当前资源与工具快照

必须区分：

| Provenance | 含义 | UI 文案 |
|---|---|---|
| tool-snapshot | 该次 read 工具持久化的 bounded output | 来自该次工具调用，可能截断 |
| current-resource | Host 当前 catalog 的有效 Skill 内容 | 当前安装版本，可能不同于历史读取内容 |
| inline | 调用方已经提供的明确内容 | 来自当前消息 |
| project-current | 当前项目磁盘内容 | 当前磁盘版本 |

禁止：

- 把 current installed content 标成“agent 当时读取的原文”；
- 用 current canonical path 覆盖 targetPaths；
- 将 provenance 仅编码进一段 Markdown stub。

### 3.6 Transcript 快照按需读取

历史 transcript 为控制体积会移除 UI tool output，因此不再以扫描 state.messages 作为唯一历史兜底。

新增受限命令：

~~~ts
export type SessionToolOutputCommand = {
  type: 'session/tool-output';
  sessionId: string;
  messageId: string;
  toolCallId: string;
  maxBytes?: number;
};

export type SessionToolOutputData =
  | {
      status: 'ready';
      output: string;
      truncated: boolean;
      redacted: boolean;
      provenance: 'tool-snapshot';
    }
  | {
      status: 'unavailable';
      reason: 'not-found' | 'not-readable-tool' | 'snapshot-unavailable';
    };
~~~

约束：

- 仅允许读取调用方可访问 session 中指定 toolCallId 的已持久化 bounded output。
- 只为已归类的 filesystem read 工具提供文档快照。
- 返回前再次执行 secret redaction 和最大字节限制。
- local HostClient 可启用；远程必须有显式 toolOutputRead capability 和 remote projection 后才开放。
- live tool card 已有 output 时可以立即 seed；Host refresh 或 snapshot response 用 request token 防止竞态。

### 3.7 Desktop 状态模型

activeDocument 改为判别联合，不把加载/失败伪装成文档正文：

~~~ts
export type ActiveDocument =
  | { status: 'loading'; requestId: string; target: DocumentTargetRef }
  | {
      status: 'ready';
      requestId: string;
      title: string;
      content: string;
      displayRef: string;
      provenance: 'inline' | 'project-current' | 'current-resource' | 'tool-snapshot';
      warning?: string;
    }
  | {
      status: 'unavailable';
      requestId: string;
      title: string;
      displayRef: string;
      reason: string;
      suggestion?: string;
    };
~~~

规则：

- inline content 用 content !== undefined 判断，空文件合法。
- 每次打开生成 requestId；过期 response 不得覆盖新文档。
- 捕获 Host reject、timeout 和 aborted request。
- unavailable 使用 Notice/empty state 展示，不参与 Copy/Export。
- DocPreview 标明 Skill id、effective source 与 provenance。

### 3.8 远程 Host

需要同步完成：

- Host Server command allowlist 与 isSafeRemoteCommand；
- skills/read 的 remote-safe response projection；
- documentTargets 保留逻辑 ref、移除 Host absolute path；
- capability 中声明 skillPreview；session/tool-output 单独声明 toolOutputRead；
- 远程客户端不得提交 legacyPath 或 projectPath；
- 测试响应中不出现 /Users、/home、drive absolute path。

### 3.9 通用 host/read-preview

本计划不新增通用 host/read-preview。它容易重新形成“任意 Host 路径预览”能力。

若未来 media/config/artifact 需要统一预览，应单独立项并使用逻辑 asset/config/artifact ref，而不是 absolutePath allowlist。

---

## 4. Implementation slices

每个 slice 小步、可测、可停；实现发现与本文不符时先修订计划。

### Slice 1 — Host 项目读取加固与 Desktop 止血

目标：关闭任意 project root，不再只修客户端表象。

改动：

1. packages/project 增加已登记 root 验证与 realpath containment helper。
2. project/read-file：
   - projectPath 模式必须匹配 project store；
   - sessionId 模式从 session scope 取 root；
   - 拒绝越界 symlink。
3. Desktop 删除 dirname + basename 伪造 project 的逻辑。
4. 项目外旧路径暂进入 legacy/unavailable 流，不再误调 project/read-file。

验收：

- [ ] 项目内 docs/foo.md 仍可读。
- [ ] Host 直接请求 projectPath=/etc、relativePath=passwd 被拒绝。
- [ ] 未登记临时目录被拒绝。
- [ ] root 内 symlink 指向 root 外文件被拒绝。
- [ ] /tmp/outside.md 不再产生 projectPath=/tmp 请求。
- [ ] Windows drive、斜杠和大小写边界有平台适配测试。

Verify：

~~~text
pnpm --filter @piwin/project test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/desktop test
~~~

### Slice 2 — Contracts + packages/skills 权威读取

目标：建立 logical Skill preview，不在 host-runtime 重写 scanner。

改动：

1. contracts 增加 DocumentTargetRef、skills/read、typed data/reason。
2. packages/skills 新增 focused skill-preview-reader.ts：
   - 接受 Host 已解析的 catalog/effective entry；
   - realpath 验证 entry 位于该 catalog 授权 root；
   - 支持目录 Skill 和单文件 Skill；
   - bounded UTF-8 读取。
3. host-runtime 取得 session scope、当前 catalog/effective resource，调用 packages/skills。
4. origin 不能确认时返回 unknown，不把 ~/.piwin location 自动称为 bundled。
5. Desktop mock 增加命令实现。

验收：

- [ ] skillId=executing-plans 返回正文和 current-resource provenance。
- [ ] trusted project、mapped extraPath、single-file Skill 均可读。
- [ ] duplicate ID 使用 existing effective resource。
- [ ] legacy bundle path 只能映射到 catalog resource，不能变成任意 read root。
- [ ] /etc/passwd、catalog 外目录、越界 symlink 均拒绝。
- [ ] typed unavailable reason 不依赖解析 error 字符串。

### Slice 3 — ToolPresentation 文档资源引用

目标：新会话不再依赖 bundle absolute path 才能打开 Skill。

改动：

1. contracts 给 ToolPresentation 增加 documentTargets。
2. host-runtime 在拥有 SessionBlueprint.resourceManifest 的边界补充：
   - project relative path → project-file ref；
   - catalog Skill path → skill ref。
3. targetPaths 保持实际值，不做 canonical rewrite。
4. transcript 持久化 documentTargets；UI projection 保留该轻量字段。
5. remote projection 只传逻辑 documentTargets。

验收：

- [ ] executing-plans read 工具卡有 skill:executing-plans ref。
- [ ] targetPaths 仍保持工具实际输入。
- [ ] project 文件产生 project-file relative ref。
- [ ] remote push/transcript 不包含 Host absolute path。
- [ ] SDK 与 worker/RPC fixture 一致。

### Slice 4 — Desktop 结构化打开与 provenance UI

目标：完成 R1、R3、R4、R5 的主要 UI。

改动：

1. 抽出 document-open-target.ts：
   - structured target 路由；
   - local legacy target 兼容；
   - 不包含 Host root/Skill precedence 判断。
2. handleOpenDocument 使用 ActiveDocument 判别联合。
3. project-file 使用 sessionId + relativePath。
4. skill 使用 sessionId + skillId。
5. DocPreviewPanel 展示：
   - Skill name/id/effective source；
   - provenance badge；
   - loading、unavailable、warning；
   - unavailable 时禁止 Copy/Export。
6. 加 requestId/abort，防止旧 response 覆盖新文档。

验收：

- [ ] 点击 executing-plans 显示正文和来源。
- [ ] 空字符串文档显示为空，不触发二次读。
- [ ] 打开 A 后立刻打开 B，A 的慢响应不能覆盖 B。
- [ ] Host timeout/reject 显示明确失败状态。
- [ ] 项目文件和 file tree 无回归。

### Slice 5 — 历史 read snapshot 兜底

目标：当前资源缺失或发生版本变化时，尽可能展示 agent 当时实际看到的 bounded 内容。

改动：

1. packages/session 增加按 session/message/toolCall 查询已持久化 tool output 的只读接口。
2. host-runtime 实现 session/tool-output，验证 session ownership、tool family、redaction 和 bounds。
3. live tool path 点击可先 seed tool.output。
4. 历史会话按需请求 snapshot，不依赖 UI hydrate 全量工具正文。
5. current-resource 与 tool-snapshot 同时可用时：
   - 默认展示 tool-snapshot；
   - 提供“查看当前版本”切换或 refresh；
   - 明确截断与版本差异。

验收：

- [ ] 历史 UI message 的 output 为空时仍可按需取得 persisted snapshot。
- [ ] 非 read 工具不能通过该命令泄露任意 output。
- [ ] snapshot 截断、redacted 状态可见。
- [ ] snapshot 不可用时回退 current-resource 并显示正确 warning。

### Slice 6 — 展示收口与远程能力

目标：新会话默认展示逻辑资源身份，同时保持执行证据。

改动：

1. tool chip 主标签显示 skill:executing-plans 或短 project relative path。
2. 本地详情可展示 actual target path；远程不展示 Host path。
3. Host Server 开放安全的 skills/read 并投影结果。
4. session/tool-output 仅在 capability 和安全投影完成后开放远程。
5. 旧 bundle path 继续走 local legacy mapping。

验收：

- [ ] 新会话主 UI 不再依赖 /Applications/... 路径。
- [ ] actual target 未被改写。
- [ ] 远程 Skill 预览只使用 sessionId + skillId。
- [ ] 远程 payload 无 Host absolute path。

---

## 5. 文件触点地图

| 区域 | 路径 | 动作 |
|---|---|---|
| Contracts | packages/contracts/src/resource.ts、host.ts、ipc.ts、skills.ts | DocumentTargetRef、commands、typed data |
| Project policy | packages/project/src | registered root + realpath containment |
| Project command | packages/host-runtime/src/commands/project-commands.ts | session/root authority wiring |
| Skill service | packages/skills/src/skill-preview-reader.ts（新） | catalog entry 读取与 allowlist |
| Skill command | packages/host-runtime/src/commands/catalog-commands.ts 或 focused command module | command adapter only |
| Resource enrichment | packages/host-runtime/src | ToolPresentation.documentTargets |
| Transcript query | packages/session/src + host-runtime command | bounded tool snapshot |
| Remote | packages/host-server/src/host-server.ts、remote-projection.ts | allowlist、capability、projection |
| Desktop open | apps/desktop/src/App.tsx、document-open-target.ts（新） | structured routing + race control |
| Preview UI | apps/desktop/src/DocPreviewPanel.tsx | loading/ready/unavailable + provenance |
| Tool click | tool-call-card.tsx、turn-tool-group.tsx、chat-thread.tsx | 传 DocumentTargetRef/tool identity |
| Mock | apps/desktop/src/host-client-mock.ts | 新命令 |

---

## 6. 测试计划

### 6.1 自动化

| 层 | 必须覆盖 |
|---|---|
| Project security | registered root、unknown root、traversal、absolute relativePath、symlink escape、Windows drive |
| Skill reader | user/project/mapped/single-file、duplicate precedence、missing、binary、truncation、symlink escape |
| Resource target | project-file/skill ref、targetPaths 不变、manifest mismatch |
| Transcript snapshot | historical query、read-only gate、redaction、truncation、missing |
| Desktop open | inline empty、project、skill、legacy、timeout、A/B race、unavailable |
| Remote | logical ref survives、absolute path removed、command policy、capability |
| Regression | file tree、SkillsPanel list、resolve-document-content write fallback |

### 6.2 手动验收

1. 启动 Desktop 并打开项目会话。
2. 让 agent read executing-plans。
3. 点击工具卡文档目标。
4. 期望看到：
   - Skill · executing-plans；
   - effective source；
   - tool-snapshot 或 current-resource 标注；
   - 正文内容。
5. 打开项目 docs/*.md，确认正常。
6. 重启 Desktop 后重新打开历史会话，再点同一工具目标。
7. 临时移走当前 installed Skill：
   - 有 snapshot 时展示 snapshot；
   - 无 snapshot 时显示 typed unavailable，不显示假正文。
8. 使用远程 HostClient 验证 Skill preview 不依赖 Host 绝对路径。

### 6.3 命令门禁

~~~text
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/project test
pnpm --filter @piwin/skills test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/host-server test
pnpm --filter @piwin/desktop test
pnpm typecheck
pnpm test:architecture
pnpm test
~~~

若全仓测试有既有失败，必须记录具体命令、失败用例和与本变更无关的证据；不得用“pre-existing”替代触及测试。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| project/read-file 加固影响 file tree | 保留 registered projectPath compatibility；补 file-tree integration |
| symlink 是项目合法内容 | 允许 root 内 symlink，拒绝 realpath 落到 root 外 |
| duplicate Skill 显示错误副本 | 复用 ResourceCatalog effective entry，不 basename-first |
| installed 与历史 bundle 内容不同 | provenance 分离；优先 tool-snapshot |
| Tool output 过大或含秘密 | 按需读取、family gate、redaction、hard byte cap |
| 远程泄露 Host path | logical refs + remote projection golden tests |
| activeDocument 类型扩散 | focused union + 单一 open coordinator |
| 新命令扩大 remote surface | capability gate；legacyPath/projectPath 远程禁用 |

---

## 8. 明确不做

1. 限制 agent 重复读取同一 SKILL.md。
2. Skill 编辑或保存。
3. 任意 Host 文件预览。
4. 把 project/read-file 改成全局读。
5. 重做 Inspector 信息架构。
6. 为远程客户端暴露 Host home、bundle path 或任意 tool output。

---

## 9. Follow-ups

| ID | 项 |
|---|---|
| F1 | Agent 对已注入 Skill 避免重复 read（缓存、prompt、遥测） |
| F2 | Skills 面板复用 logical skills/read，但使用 Host-issued project/session scope |
| F3 | Resource origin metadata：区分 bundled-installed 与 user-installed |
| F4 | doc open miss rate、snapshot hit rate、legacy path rate |
| F5 | 英文文案完整化 |
| F6 | 通用 asset/config/artifact 预览必须单独设计 logical ref，不做 host/read-preview absolutePath |

---

## 10. 执行顺序与 checkpoint

~~~text
S1 Host project read 加固
   └─ checkpoint：任意 root 与 symlink escape 被 Host 拒绝

S2 contracts + packages/skills 权威读取
   └─ checkpoint：Host 按 session + skillId 读取 effective Skill

S3 ToolPresentation documentTargets
   └─ checkpoint：新工具记录有 logical ref，actual target 不变

S4 Desktop structured open + provenance
   └─ checkpoint：点击 Skill 有正文、身份和明确状态

S5 historical tool snapshot
   └─ checkpoint：重启后的历史 read 仍可按需恢复

S6 remote/display 收口
   └─ checkpoint：远程无 Host path，新 UI 不依赖 bundle path
~~~

建议合并发版最小安全集：S1 + S2 + S3 + S4。

完整关闭 R1–R7：再完成 S5 + S6。

不得只合并 Desktop S1 止血而宣称 R6 已关闭。

---

## 11. 验收总表

| 需求 | 关闭切片 | 验收信号 |
|---|---|---|
| R1 Skill 身份明确 | S2、S3、S4 | id/name/effective source |
| R2 打开非空且来源真实 | S2、S4、S5 | snapshot/current provenance |
| R3 路径可信 | S3、S6 | logical ref；actual target 保留 |
| R4 失败明确 | S2、S4 | typed reason + suggestion |
| R5 项目预览无回归 | S1、S4 | docs/file tree 通过 |
| R6 Host 安全边界 | S1、S2 | unknown root、outside catalog、symlink escape 拒绝 |
| R7 本地/远程一致 | S3、S6 | remote logical ref，无 Host absolute path |

---

## 12. 一句话

> 这不是单纯的“路径改一下”：应把文档预览从客户端猜 Host 路径，升级为 Host 解析逻辑资源身份；同时保留工具实际目标、区分历史快照与当前 Skill，并真正封死 project/read-file 的 caller-supplied root。

---

## 13. 批准后执行须知

- 本文件是 reviewable plan；批准前不改产品代码。
- 批准后按 S1 → S6 推进，每个 checkpoint 留下测试 evidence。
- 实现发现 session catalog、tool output retention 或 remote policy 与本文不符时，先修订计划再写代码。
- 不得把 current installed content 冒充历史 tool snapshot。
- 不得通过重写 targetPaths 获得“看起来正确”的 UI。
