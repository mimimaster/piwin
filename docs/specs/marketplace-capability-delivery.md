# piwin 能力市场可执行 Spec

| 字段 | 值 |
|---|---|
| 状态 | P0（Slice 1 + 2）已实现，2026-09-25；Slice 3–5 待做。实现与本文差异见 §11 |
| 日期 | 2026-09-12 |
| 产品依据 | [`../plans/2026-09-12-marketplace-product-direction.md`](../plans/2026-09-12-marketplace-product-direction.md) |
| 相关 | [`pi-extension-productization.md`](./pi-extension-productization.md)、[`w3-marketplace-automation.md`](./w3-marketplace-automation.md)、ADR 0033、ADR 0047 |
| 涉及包 | contracts、marketplace、extensions、skills、mcp、host-runtime、desktop、cli |

## 1. 目标

市场是 piwin 的统一能力发现入口。用户应能从一个真实目录找到 Agent 扩展、Skill、MCP 和 Plugin，完成安装或连接，并确认该能力是否已经能在当前会话使用。

本 Spec 交付以下结果：

1. 市场目录、Host 库存和当前会话有效能力明确分离。
2. Desktop 不再用 mock 数据、定时器或本地布尔值宣称安装、密钥保存、激活或卸载成功。
3. 市场和设置页复用同一组 Host 命令与状态，不产生第二套安装实现。
4. 四种能力保留各自的安装和运行语义，同时提供统一的用户状态摘要。
5. Plugin 安装记录组件归属；卸载不会删除用户已有、已修改或仍被其他 Plugin 使用的 Skill/MCP。
6. 首期目录可以完全离线浏览；本地、Git 和自定义来源仍作为高级入口。

## 2. 非目标

- 不建设 piwin 公共托管市场、作者后台、评分、支付或分成。
- 不自动收录整个 Pi、npm、GitHub 或 MCP 生态。
- 不为 Plugin 创建新的执行环境；Plugin 仍是 Skill、MCP 和密钥声明的组合包。
- 不把 Pi TUI 扩展自动改写成 Desktop 组件。
- 不在本期实现 Agent 自动安装市场条目；Agent 可以推荐，安装仍走既有用户授权路径。
- 不在本期实现无人值守自动更新、复杂依赖求解或 Host 间库存同步。
- 不重做市场全部视觉。先完成真实闭环和必要的信息结构。

## 3. 关键约束

1. Host 是目录解析、安装结果、配置和运行状态的唯一权威。
2. `@piwin/marketplace` 负责目录、安装来源解析和市场关联元数据；它不创建 Agent Runtime，不直接控制 MCP 进程。
3. Extension、Skill、MCP、Plugin 的写操作继续由各自应用服务执行，`@piwin/host-runtime` 负责组合。
4. Desktop/CLI 只使用 `@piwin/contracts` 公共命令；Desktop 不扫描本地目录，也不根据卡片状态推断成功。
5. Extension 只在 Run 边界更换能力，沿用 ADR 0047 的不可变 revision 和 deployment。
6. MCP 不进入权限规则层，沿用 ADR 0033；市场只负责如实展示运行权限和来源。
7. Skill 可能携带脚本或依赖。UI 不使用“纯文本所以绝对安全”之类表述。
8. 目录中的验证证据只对精确版本和记录的环境有效。

现有 `@piwin/marketplace → @piwin/extensions` 依赖不符合应用包只向 contracts 依赖的架构规则，本 Spec 实施时一并移除：Extension 获取与 staged revision 写入迁到 `@piwin/extensions`；Skill 安装迁到 `@piwin/skills`；Plugin manifest/materialization 和归属记录留在 marketplace，调用 Skill/MCP/secret 的端口由 host-runtime 注入。

## 4. 产品信息结构

### 4.1 一级页面

市场只保留两个一级页签：

- **发现**：精选分组、搜索、类型和兼容性筛选。
- **已安装**：当前 Host 上的全部已安装项，包括禁用、待配置、待应用、失败和待移除项。

发现页默认按使用场景分组：代码开发、设计与内容、文档与研究、外部服务。没有条目的分组不显示。Agent 扩展、Skill、连接服务、Plugin 是类型筛选，不作为四个必须浏览的一级页面。

设置页继续承担高级配置和诊断：

- Extension：revision、兼容详情、部署记录、回退。
- Skill：来源、作用域、启用状态、内容预览。
- MCP：配置表单、原始 JSON、进程健康、工具列表。
- Plugin：组件归属、密钥补录、卸载报告。

市场详情中的“高级管理”跳到对应设置项。两处读取相同 Host 状态。

### 4.2 卡片与详情

发现卡片只显示：名称、一句话用途、类型、兼容/验证摘要、当前状态和主操作。

详情页显示：

- 可完成的任务和预期结果；
- 至少一个可直接填入输入框的示例请求；
- 作者、源码、精确版本和更新时间；
- Host 系统、命令、账号、第三方套餐等前提；
- 安装内容和支持范围；
- Extension 的兼容项与缺失项；
- 验证证据；
- 安装后如何确认可用。

市场顶栏显示当前 Host 名称和连接状态。`Runtime Gen`、revision、内容摘要等内部字段只在详情或诊断页显示。

## 5. 合同

所有新增跨边界类型先加入 `packages/contracts`，从 `src/index.ts` 导出。建议新文件为 `marketplace.ts`，不要继续扩大 `marketplace-registry.ts`。

### 5.1 目录模型

```ts
export type MarketplaceCapabilityKind = 'extension' | 'skill' | 'mcp' | 'plugin';

export type MarketplaceCategory =
  | 'code-development'
  | 'design-content'
  | 'docs-research'
  | 'external-service';

export type MarketplaceLocalizedText = {
  en: string;
  zhCN: string;
};

export type MarketplaceRequirement = {
  kind: 'host-os' | 'command' | 'account' | 'subscription' | 'environment';
  value: string;
  required: boolean;
  description: MarketplaceLocalizedText;
};

export type MarketplaceVerification = {
  level: 'author-declared' | 'static-scan' | 'piwin-tested';
  testedVersion?: string;
  piwinVersion?: string;
  piVersion?: string;
  hostOs?: 'macos' | 'windows' | 'linux';
  backend?: 'sdk' | 'rpc';
  testedAt?: string;
  notes?: MarketplaceLocalizedText;
};

export type MarketplaceInstallDescriptor =
  | { kind: 'extension'; source: InstallSource; name?: string }
  | { kind: 'skill'; source: InstallSource; name?: string }
  | { kind: 'mcp'; serverId: string; draft: McpServerConfig }
  | { kind: 'plugin'; source: PluginInstallSource };

export type MarketplaceCatalogEntry = {
  entryId: string;
  capabilityId: string;
  kind: MarketplaceCapabilityKind;
  category: MarketplaceCategory;
  name: MarketplaceLocalizedText;
  summary: MarketplaceLocalizedText;
  description: MarketplaceLocalizedText;
  version: string;
  author: string;
  homepage?: string;
  sourceLabel: string;
  install: MarketplaceInstallDescriptor;
  requirements: MarketplaceRequirement[];
  examples: Array<{
    title: MarketplaceLocalizedText;
    prompt: MarketplaceLocalizedText;
    expectedResult?: MarketplaceLocalizedText;
  }>;
  extensionCompatibility?: ExtensionCompatibility;
  verification: MarketplaceVerification[];
  relatedEntryIds?: string[];
  featured: boolean;
  withdrawn?: { reason: MarketplaceLocalizedText; replacementEntryId?: string };
};
```

约束：

- `entryId` 使用 `<kind>:<stable-id>`，不得依赖展示名称。
- Extension 复用现有 `ExtensionCompatibility`，不另建第二套兼容枚举。
- `piwin-tested` 必须同时提供 `testedVersion`、`piwinVersion`、`piVersion`、`hostOs`、`backend` 和 `testedAt`。
- `withdrawn` 条目不出现在默认发现页，但用于解释已安装项和给出替代项。
- 目录元数据不包含密钥值。Plugin 只声明密钥名称和用途，值通过现有安装命令发送并由 Host 写入 keychain。

### 5.2 统一库存投影

统一库存是 Host 实时计算的只读投影，不持久化为新的配置权威。

```ts
export type MarketplaceAvailability =
  | 'installed'
  | 'configuration-required'
  | 'pending-apply'
  | 'available'
  | 'disabled'
  | 'failed'
  | 'pending-removal';

export type MarketplaceInstalledComponent = {
  kind: 'skill' | 'mcp';
  id: string;
  availability: MarketplaceAvailability;
  ownership: 'created' | 'reused' | 'legacy-unknown';
  message?: string;
};

export type MarketplaceInstalledItem = {
  installationKey: string;
  capabilityId: string;
  kind: MarketplaceCapabilityKind;
  name: string;
  version?: string;
  catalogEntryId?: string;
  availability: MarketplaceAvailability;
  enabled?: boolean;
  source: string;
  installedAt?: string;
  message?: string;
  components?: MarketplaceInstalledComponent[];
  managementTarget: { kind: MarketplaceCapabilityKind; id: string };
};
```

`MarketplaceInstalledItem.message` 是可展示的短原因；堆栈、原始 stderr 和路径详情留在诊断数据中。

只读响应固定为：

```ts
export type MarketplaceCatalogListData = { entries: MarketplaceCatalogEntry[] };
export type MarketplaceCatalogGetData = { entry: MarketplaceCatalogEntry };
export type MarketplaceInstalledListData = {
  revision: string;
  items: MarketplaceInstalledItem[];
};
```

`revision` 是规范化库存内容的稳定摘要，不依赖某个 Desktop 进程内计数。Host 重启后相同库存得到相同 revision。

### 5.3 Host 命令

新增只读市场命令：

```ts
| {
    type: 'marketplace/catalog-list';
    query?: string;
    kinds?: MarketplaceCapabilityKind[];
    category?: MarketplaceCategory;
    includeWithdrawn?: boolean;
  }
| { type: 'marketplace/catalog-get'; entryId: string }
| {
    type: 'marketplace/installed-list';
    sessionId?: string;
    projectPath?: string;
  }
```

不新增通用 `marketplace/install`。用户从目录发起安装时，Desktop 根据 `MarketplaceInstallDescriptor.kind` 调用已有领域命令：

| 类型 | 安装/配置命令 | 后续确认 |
|---|---|---|
| Extension | `extensions/install` → `extensions/set_enabled` → `extensions/apply` | `extension/deployment-updated` + `marketplace/installed-list` |
| Skill | `skills/install`，需要时 `skills/set_enabled` | `skills/list` + 统一库存 |
| MCP | `mcp/registry-install-draft` 或编辑后 `mcp/save` → `mcp/start` → `mcp/list_tools` | `mcp/status` + 统一库存 |
| Plugin | `plugins/install` → 分组件查询 Skill/MCP 状态 | `plugins/list` + 统一库存 |

Pi 生态实时搜索结果不是精选目录中的单一 Extension descriptor；一个 Pi package 可能同时包含 Extension、Skill 和 Prompt，并需要 npm 依赖或生命周期脚本。因此它使用专用的用户手势命令：

```ts
| {
    type: 'marketplace/package-install';
    source:
      | { kind: 'npm'; packageName: string }
      | { kind: 'git'; repositoryUrl: string };
  }
```

Host 只接受合法 npm 包名或 `https://github.com/<owner>/<repo>`，通过 `@piwin/agent-host` 调用 Pi PackageManager 的 `installAndPersist`，不在 Desktop 执行 shell。未实测社区包在执行前必须展示 Host 用户权限和安装脚本风险；成功后有当前会话则调用 `extensions/apply`，没有当前会话则在新会话生效。该命令是明确的 Pi 原生包安装，不替代本地/Git 受管 Extension 的 `extensions/install`。

这种分派只负责选择已有命令，不允许 Desktop 自己改配置或文件。

从市场发起时，在现有 `extensions/install`、`skills/install`、`mcp/registry-install-draft`、`plugins/install` 增加可选 `catalogEntryId`。Host 校验该 entry 的类型、capability ID 和 install descriptor 与请求一致，安装成功后自行写 install link。高级本地、Git 或 JSON 安装不传该字段。

为完成真实管理闭环，新增以下领域命令：

```ts
| {
    type: 'extensions/uninstall';
    extensionId: string;
    sessionId?: string;
    when?: 'now' | 'after-current-run' | 'new-sessions-only';
  }
| { type: 'skills/uninstall'; skillId: string }
| { type: 'mcp/remove'; serverId: string }
```

- `extensions/uninstall` 先禁用并标记 `pending-removal`。如果提供 `sessionId`，使用现有 deployment 在 Run 边界应用；没有 Runtime 引用后再清理 revision。
- `skills/uninstall` 只删除 `~/.piwin/skills` 中由 piwin 管理的 Skill。bundled、project、mapped、pi-native 只能禁用。
- `mcp/remove` 先停止 server，再从 Host 配置移除；停止失败时保留配置并返回失败，避免 UI 宣称已经删除。

对应 mutation 响应至少返回被操作 ID、最终领域状态和最新 inventory revision。`extensions/uninstall` 还返回 `deploymentId?` 与 `pendingRemoval`；`plugins/install` / `plugins/uninstall` 返回逐组件结果，Desktop 不从成功布尔值自行补全组件状态。

### 5.4 变更通知

新增轻量 push：

```ts
| {
    type: 'marketplace/inventory-updated';
    revision: string;
    changedKinds: MarketplaceCapabilityKind[];
  }
```

该 push 不携带完整库存。Desktop/远程客户端收到后重新调用 `marketplace/installed-list`。Extension 的详细过程仍由现有 `extension/catalog-updated` 和 `extension/deployment-updated` 提供。

所有安装、启停、应用、移除、Plugin 组件变更和 MCP 运行状态变更完成后，Host 更新 inventory revision 并发 push。目录内容本期随应用版本发布，不需要目录变更 push。

## 6. 数据与所有权

### 6.1 精选目录

目录放在 `packages/marketplace/src/catalog/`，按类型拆分：

```text
catalog/
  extensions.ts
  skills.ts
  mcp.ts
  plugins.ts
  catalog.ts
```

`catalog.ts` 只做组合、校验、搜索和筛选。现有 `catalog.ts`、`skill-store.ts`、`mcp-registry.ts` 和 `plugin/featured-catalog.ts` 的静态内容迁入这一目录，旧 public exports 在迁移期保留薄适配，调用方切完后删除。

首批条目必须使用真实来源、精确版本或 Git ref；示例条目不得进入生产目录。未经实测的条目可以存在，但只能显示作者声明或静态扫描证据。

标记为 `piwin-tested` 的 Git 来源必须固定到 commit；可移动 branch/tag 只能作为更新发现来源，不能作为验证身份。

### 6.2 目录安装关联

为了把高级安装与目录安装区分开，在 `~/.piwin/marketplace/install-links.json` 保存轻量关联：

```ts
type MarketplaceInstallLinkDocument = {
  version: 1;
  revision: string;
  links: Array<{
    entryId: string;
    kind: MarketplaceCapabilityKind;
    capabilityId: string;
    installedVersion?: string;
    installedAt: string;
  }>;
};
```

它只负责将真实资源关联到目录条目。资源是否存在、是否启用和是否可用仍从 Extension registry、Skill scanner、MCP config/manager、Plugin store 读取。资源被外部删除时忽略陈旧 link，并在下一次成功 mutation 时清理。

### 6.3 Plugin 组件归属

扩展 `InstalledPlugin`：

```ts
type InstalledPluginComponentRef = {
  kind: 'skill' | 'mcp';
  id: string;
  ownership: 'created' | 'reused' | 'legacy-unknown';
  contentRevision?: string;
  retainedByUser?: boolean;
};

type InstalledPlugin = {
  // 保留现有字段用于兼容读取
  components?: InstalledPluginComponentRef[];
};
```

安装流程固定为：解析来源 → 校验 manifest → 计算组件 revision → 预检冲突和必需密钥 → 创建/复用组件 → 保存 Plugin record。安装过程中维护内存回滚日志；任一步失败，撤销本次新建且未被复用的内容，然后返回失败。

组件规则：

- Skill ID 不存在：创建并记录 `created + contentRevision`。
- Skill ID 已存在且内容相同：不覆盖，记录 `reused`。
- Skill ID 已存在但内容不同：安装失败，要求用户先解决冲突。
- MCP 使用 namespaced ID；若同名配置完全相同则 `reused`，不同则安装失败。
- 安装失败或部分回滚失败不能返回统一成功；返回错误并附加保留内容的诊断清单。

卸载 Plugin 时，仅删除满足以下全部条件的 `created` 组件：当前内容仍匹配记录的 revision、没有其他 Plugin 引用、组件没有被标记为独立保留。`reused`、`legacy-unknown`、被用户修改的组件全部保留，并在卸载结果中说明。

用户通过独立 Skill/MCP 安装流程再次选择同一组件时，Host 将 `retainedByUser` 设为 true。用户直接修改 MCP 配置或覆盖 Skill 内容后，revision 不匹配也会触发保留。

旧 `InstalledPlugin` 记录迁移时：namespaced MCP 可记为 `created`；无法证明归属的 Skill 记为 `legacy-unknown`。旧 Plugin 卸载默认保留这些 Skill，优先避免数据丢失。

## 7. 状态计算

### 7.1 Extension

优先级从上到下：

1. registry 已标记移除 → `pending-removal`。
2. 最近关联 deployment 为 `failed`、`rolled-back` 或 `restart-required` → `failed`，message 说明旧能力是否仍可用。
3. `configuredEnabled=false` → `disabled`。
4. 当前 session 的 Runtime binding 未包含 selected revision，且已有/待处理 deployment → `pending-apply`。
5. 当前 session binding 包含 selected revision → `available`。
6. 未提供 sessionId 时，已启用但无法判断某个会话 binding → `installed`。

静态扫描的 `compatible` 不得直接映射成 `available`。

`InstalledExtensionRecord` 增加可选 `installationState: 'installed' | 'pending-removal'`，缺省按 `installed` 读取。pending-removal 记录继续保存 selected revision 和历史 revisions，直到所有引用该 revision 的 Runtime 退出；清理完成后才从 registry 移除记录和文件。

### 7.2 Skill

- 扫描到且 enabled → `available`，含义是下一次 prompt preparation 可选择使用。
- 扫描到且 disabled → `disabled`。
- 安装记录存在但扫描失败 → `failed`。
- 项目或 mapped Skill 在“已安装”中显示来源，但管理动作根据来源限制为禁用或打开高级管理。

Skill 安装先复制到临时目录，验证 `SKILL.md` 并计算内容 revision，再原子发布到目标目录。首次安装遇到同 ID 不同内容时失败，不静默覆盖；显式更新留到后续更新 Slice。相同内容可以复用并补写 install link。

### 7.3 MCP

- 配置缺少必需值或占位符未解析 → `configuration-required`。
- manager health 为 running 且工具发现成功 → `available`。
- 配置存在但 server 停止 → `installed`。
- 启动或工具发现失败 → `failed`。
- disabled config → `disabled`。

“进程已启动”和“业务账号权限足够”不是同一事实。只有执行了安全的示例调用后，详情页才可显示该示例验证成功；一般 MCP 状态仍只承诺连接和工具发现。

`mcp/save` 已保存配置但 runtime apply 失败时，统一库存显示 `failed` 并保留“配置已保存，可重试启动”的原因；不得回退成未安装，也不得显示全部成功。

### 7.4 Plugin

Plugin 本身不单独执行。其状态由必需组件计算：

- 缺必需密钥或组件配置 → `configuration-required`。
- 所有必需组件 `available` → `available`。
- 已安装，但存在尚未启动的 MCP → `installed`。
- 某组件失败 → `failed`，同时展示分组件状态。
- Plugin 删除不改变 `reused` 组件的状态。

## 8. Desktop 行为

重构 `MarketplaceWorkspaceView`：

1. 删除 `INITIAL_EXTENSIONS`、`INITIAL_PLUGINS` 作为生产数据源；测试 fixture 移入测试文件。
2. 首次进入并行请求 `marketplace/catalog-list` 和 `marketplace/installed-list`。
3. 页面只在 HostResponse 成功后更新库存；失败保留先前状态并显示可重试错误。
4. 安装中的状态由当前请求和 Host push 驱动，不使用定时器伪造阶段或 generation。
5. Secret dialog 将值提交给 `plugins/install` 或 `plugins/secrets/collect`；响应失败时保持弹窗和输入，不显示“已保存”。
6. Extension 安装拆成三个真实阶段：已安装未启用、已启用待应用、当前可用。任一步失败停在真实状态，提供继续操作。
7. “已安装”数量来自 `MarketplaceInstalledItem` 总数，不再只统计 active Extension 和 Plugin。
8. 搜索匹配本地化名称、摘要、场景和能力 ID；不在没有查询时显示 withdrawn/incompatible 条目。
9. 收到 `marketplace/inventory-updated` 后去重刷新；收到 Extension deployment push 时即时更新相关项并在终态刷新库存。

设置页的 `ExtensionsPanel`、`SkillsPanel`、`McpPanel`、`PluginsPanel` 暂不删除。将可复用的数据请求与 mutation 封装为领域 hooks/client modules，市场和设置页共同调用，禁止复制安装逻辑。

“试一下”行为：

- Skill/可提示调用的能力：把示例填入当前会话输入框，用户自行发送。
- MCP：先通过 `mcp/list_tools` 确认可见，再填入示例；不自动执行有副作用的业务调用。
- 运行行为型 Extension：展示验证方法或等待下一次触发，不伪造成工具调用。
- 没有当前会话时，“试一下”引导用户选择或创建会话。

## 9. CLI

CLI 共享 Host 命令，提供最小对应能力：

```text
piwin market search [query] [--type extension|skill|mcp|plugin]
piwin market show <entry-id>
piwin market installed
piwin extension uninstall <id>
piwin skill uninstall <id>
piwin mcp remove <id>
```

安装继续复用已有 `extension install`、`skill install`、`mcp` 和 `plugin` 命令；可以接受市场 `entry-id` 作为来源解析快捷方式，但内部仍发送对应领域命令。CLI 必须展示“已安装”“待应用”“当前可用”的差异。

## 10. 实施顺序

### Slice 1：合同与真实读模型

- 新增市场目录、库存类型和三个只读命令。
- 在 `@piwin/marketplace` 建立统一精选目录并迁移现有静态条目。
- 将 Extension/Skill installer 迁到各自所属包，移除 `marketplace → extensions` 依赖；Plugin 跨域操作改为 host-runtime 注入端口。
- 在 host-runtime 组合 Extension/Skill/MCP/Plugin 状态，生成统一库存。
- 增加 install link store 和 inventory revision/push。

完成后，Desktop 可以显示真实目录与库存，但暂不替换写操作。

### Slice 2：Desktop 真实安装闭环

- 市场页改用 Host 目录和库存。
- Extension 复用现有 install/set_enabled/apply/deployment 路径。
- Skill 复用 install/set_enabled 路径。
- MCP 复用 draft/save/start/list_tools 路径。
- Plugin 复用 install/secrets 路径。
- 删除生产 mock 成功、模拟 generation 和未提交密钥的分支。

### Slice 3：真实卸载与 Plugin 归属

- 增加 Extension pending-removal 和安全清理。
- 增加 managed Skill uninstall、MCP remove。
- 扩展 Plugin component ownership，加入预检、回滚和保守卸载。
- 迁移旧 Plugin records。

### Slice 4：详情、配置与首次使用

- 完成详情信息、验证证据和系统前提。
- 补齐 MCP 配置/工具发现、Plugin 分组件状态和“试一下”。
- 打通市场到设置高级管理的定位参数。
- 增加 CLI search/show/installed 和卸载命令。

### Slice 5：精选内容发布

- 按真实维护能力加入条目，不为达到数量目标收录未维护内容。
- 每个精选条目固定来源版本，补齐一个示例和验证记录。
- 校准 `docs/guides/pi-extensions.md` 与实际兼容结果；如产品行为改变 ADR 0047，再同步更新 ADR。

## 11. 文件落点

| 包 | 主要改动 |
|---|---|
| `packages/contracts` | `marketplace.ts`、HostCommand/Response/Push、Extension pending-removal、Plugin component refs |
| `packages/marketplace` | 统一 catalog、install-link-store、目录校验、Plugin manifest/materialization、归属与迁移；移除对 extensions 的依赖 |
| `packages/extensions` | 接收现有 Extension installer、pending-removal、引用安全检查与最终清理 |
| `packages/skills` | 接收现有 Skill installer、managed install provenance、uninstall |
| `packages/mcp` | remove 服务、占位符/配置状态判定，复用现有 metadata/manager |
| `packages/host-runtime` | marketplace commands、统一库存投影、inventory push、领域命令编排 |
| `apps/desktop` | 市场真实数据、共享领域 hooks、详情与状态 UI |
| `apps/cli` | market 查询与领域卸载命令 |

所有应用包只依赖 contracts，不在 marketplace、extensions、skills、mcp 之间增加边。不得让 `@piwin/marketplace` 依赖 host-runtime、agent-host 或 Pi；不得让 Desktop 直接读取文件系统或 Pi 类型。

## 12. 必要验收

只保留以下阻断发布的验收：

1. 一个真实 Extension 在 SDK 和 RPC 两种后端均能完成安装、任务边界应用和失败保留旧 Runtime；刷新页面后状态一致。
2. 一个带必需密钥和 MCP 的现有 Plugin 只有在 Host 真正写入密钥并保存组件后才显示成功；组件失败时显示具体失败项。
3. Plugin 卸载不会删除安装前已经存在、安装后被修改、或仍被其他 Plugin 引用的 Skill/MCP。
4. Desktop 不再包含生产路径的 mock 安装成功和定时器模拟激活；Host 返回失败时不会显示成功。
5. 两个连接同一 Host 的客户端在一次库存 mutation 后，通过 push/refetch 得到相同状态。

实现完成运行 `pnpm typecheck`，以及 contracts、marketplace、extensions、mcp、host-runtime、desktop 中与上述五项直接相关的测试。无需为静态文案、纯布局或每一种筛选组合增加重复测试。

## 13. 发布与迁移

- 首次启动读取旧 Plugin records 并惰性补全 component refs；迁移使用原子写，失败保留旧文件。
- 现有 Skill、MCP、Extension 和 Plugin 均出现在统一库存，即使没有 catalog link；此时不显示市场详情链接。
- 旧市场 mock 条目只允许保留在测试 fixture 和视觉 gallery，不参与生产构建的数据请求。
- 新市场可用 feature flag 分阶段打开。打开前仍可使用现有设置页管理能力。
- 目录条目下架不删除已安装内容；库存显示下架原因和替代条目。
- 实施本 Spec 后更新 `docs/prd.md`、`docs/architecture.md` 的市场边界和 `~/.piwin/marketplace/` 存储说明。

## 11. 实现记录（2026-09-25，P0）

产品负责人确认本轮范围：P0 真实闭环；市场包含 Agent 扩展、Skill、MCP 三类，Plugin 继续按 2026-09-14 决定不进市场。

已交付：

- 合同：`packages/contracts/src/marketplace.ts`（目录条目、库存投影、移除路线）；命令 `marketplace/catalog-list|catalog-get|installed-list`、`marketplace/package-remove`、`extensions/uninstall`、`mcp/remove`；推送 `marketplace/inventory-updated`。`MarketplacePiPackageSource` 的 npm 源可固定 `version`。
- 精选目录：`packages/marketplace/src/catalog/`，首发 8 条真实条目（1 个 Pi 扩展包 pi-fff、5 个 anthropics/skills Skill、2 个 MCP：memory 与 sequential-thinking），全部固定版本或完整 commit，验证级别如实标为 `author-declared`。只收录安装路径已端到端跑通的条目；pi-lens（依赖 LSP/lint 工具链）、Langfuse（需环境变量且数据外传）、time MCP（依赖 uv）暂缓，实测后再加入。目录在模块加载时校验，未固定版本即拒绝。旧 `RECOMMENDED_SKILLS`、`STATIC_MCP_REGISTRY` 改为从目录派生，删除了 “Example SSE server” 占位条目。
- Skill 的 git 安装支持固定到 commit（`init + fetch <sha> + checkout`）。
- 库存：`host-runtime/src/marketplace/inventory-projection.ts`（纯函数）按 §7 计算状态；`SessionRuntimeController` 记录每个 runtime generation 实际编译进去的扩展（来自 Blueprint `resourceManifest.extensions`），据此区分“已安装 / 待应用 / 当前可用”，不把静态兼容当成可用。
- 卸载：受管扩展先标记 `pending-removal` 并停止加载，没有任何 runtime（含待发布候选）引用其 revision 后再删文件；清理时机为卸载时、每次 apply 完成后、每次读库存时。Pi 包扩展通过 `piPackageSource` 走 Pi `removeAndPersist`，只接受已在用户 settings 中登记的来源。MCP 先停进程再删配置，停不下来则保留配置并报错。`mcp/registry-install-draft` 不再静默覆盖同名但配置不同的服务。
- Desktop：市场页改为 Host 目录 + Host 库存；删除 mock 数据、定时器进度、`Runtime Gen` 徽章和未提交的插件密钥分支；安装/卸载/启停走各自领域命令，结束后重读库存；扩展变更调用 `extensions/apply` 并如实区分“已生效 / 当前任务结束后生效 / 新会话生效 / 同步失败”；详情对话框展示前提、证据、风险与示例，已可用时可把示例填入输入框。
- CLI：`piwin market search|show|installed|uninstall-extension|remove-mcp`。
- 远程：三个只读市场命令加入默认远程白名单；`marketplace/installed-list` 远程不接受 `projectPath`。安装与移除沿用 ADR 0047，不进默认远程白名单。

与本文设计的差异（以实现为准）：

- 未实现 `install-links.json`。目录与库存按 `capabilityId` 关联；Pi 包扩展按规范化包名命名空间匹配（多入口包为 `<包名>-<入口>`），足以覆盖当前目录。
- `MarketplaceInstallDescriptor` 的扩展分为 `pi-package`（Pi PackageManager）与 `managed-extension`（受管 revision）两种，因为 npm 社区扩展只能经 Pi 包管理安装。
- 各领域安装命令暂未增加 `catalogEntryId` 参数。
- 市场库存只看 Host 全局范围，Desktop 不再传项目路径。
- `@piwin/marketplace → @piwin/extensions` 依赖与 Skill/Extension 安装器迁移尚未处理，留作单独重构。

未做（后续 Slice）：Plugin 组件归属与保守卸载、MCP 配置表单与需密钥的服务、条目更新与下架流程、piwin 实测记录。
