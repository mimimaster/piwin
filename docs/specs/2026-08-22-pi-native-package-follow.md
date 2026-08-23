# Pi 原生包跟随：catalog 同步

| 字段 | 值 |
|------|------|
| 状态 | Proposed |
| 日期 | 2026-08-22 |
| 决策 | [ADR 0060](../adr/0060-pi-native-package-follow.md) |
| 相关 | [ADR 0010](../adr/0010-pi-extensions-channel.md)、[ADR 0047](../adr/0047-managed-pi-extension-activation.md)、[ADR 0048](../adr/0048-settings-runtime-hot-apply.md) |

## 1. 问题

`pi install npm:pi-build-ios-apps` 已写入 `~/.pi/agent`，设置页「技能与扩展」看不到，当前会话也没加载。

根因：catalog **没把 Pi 的包清单读进来**。不是缺一个热补丁，也不是缺一个看门狗。

设置页已经有列表和 **刷新**。刷新今天只是再打一次 `extensions/list`。缺的是 list / 编 Blueprint 时把 Pi 清单并进同一份 catalog；刷新在有当前会话时再走现成的 `extensions/apply`。

## 2. 产品行为

| 动作 | 结果 |
|------|------|
| `pi install` / `pi remove` / `pi update` | 只改 `~/.pi`。piwin 不写回。 |
| 打开扩展列表 | `extensions/list` 从磁盘重读，Pi 包出现在列表（`source: pi-native`，默认开）。 |
| 点 **刷新** | 再读一遍；若有 `sessionId`，再 `extensions/apply`（闲着 `now`，忙着 `after-current-run`）。 |
| 新开会话 / 下次编 Blueprint | 直接带上当前磁盘上的 Pi 包，不用先刷新。 |
| piwin 手动安装 | 只写 `~/.piwin`，流程不变。 |

两句话：**列表 = 同步视图。刷新 = 同步视图 + 应用到当前 Agent。**

## 3. 不做什么（避免叠一层）

- 不拦 `pi`、不 `fs.watch`、不轮询、不在每条 `bash` 后对账
- 不在 HostRuntime 里再做 fingerprint 缓存 / coordinator
- 不把 Pi 包装进 `~/.piwin/extensions/revisions`
- 不把手动安装登记进 `packages[]`
- 不打开 `noExtensions: false`
- **不拆掉 Phase A**：managed revision、local/git `extensions/install`、`set_enabled`、`extensions/apply`、`scanExtensions` 扫描 `~/.piwin`、extraPaths、shadow 诊断全部保留
- 不跟随 Pi themes

Phase A 已经是「piwin 自己的包」的完整路径。本次只给 catalog **多一个只读源**，激活继续用 `extensions/apply`。叠 bash 钩子才是屎山。

## 4. 两条磁盘，一份视图

```text
~/.pi/agent/settings.json  packages[] / extensions[] / skills[] / prompts[]
~/.pi/agent/npm|git|{extensions,skills,prompts}
        只读
           \                  只读
            \               /
         loadDiscoveredResources()     ← 唯一合并点
            /               \
~/.piwin  scanExtensions    scanSkills / scanPrompts
(managed + 扁平 + extraPaths + 项目)

         → ResourceCatalog
         → list IPC
         → Blueprint additional*Paths
```

禁止回写。同 `(kind, id)` 只激活一份：`bundled → user → project → mapped → pi-native`。手动安装（user）赢 Pi 包。

关掉 Pi 包：写 piwin `disabledIds`，不改 `packages[]`。`pi remove` 后下次 list 自然消失。

## 5. 代码怎么接（一条路径）

今天 list 和 Blueprint 各自调用 `scanExtensions` / `scanSkills` / `scanPrompts`。若只在其中一处 concat Pi 源，另一处会漏，这就是堆叠。

**只加一个 host-runtime 门面，两处都改成走它：**

```ts
// packages/host-runtime/src/discovered-resources.ts
loadDiscoveredResources(options) → {
  extensions: ExtensionSummary[];
  skills: SkillSummary[];
  prompts: PromptTemplateSummary[];
}
```

内部顺序固定：

1. 现有 `scanExtensions` / `scanSkills` / `scanPrompts`（不动它们的 Piwin 语义）
2. `loadPiNativeInventory(agentDir, project?)` 追加 `pi-native` / 信任项目的 `project` 包
3. 调用方仍用现有 `collectExtensionEntryPaths`、`buildResourceShadowDiagnostics`、`resolveResourceActivations`

`catalog-commands.ts` 的三个 `*/list` 和 `createPiResourceLoader` **只通过这个门面拿列表**。`@piwin/skills` 继续不读 `~/.pi`。

`defaultSources()` 必须加入 `'pi-native'`，否则扫进来也会被 policy 判 disabled。

刷新：Desktop `ExtensionsPanel` 已有 `sessionId`。刷新按钮在 `loadExtensions()` 成功后，若 `sessionId` 有值则 `extensions/apply`。技能/提示刷新只重新 list；资源都在同一次 Blueprint 里，扩展刷新的 apply 会整代重编。技能页若也有刷新，同样可在有会话时 apply，避免只刷技能看不见能力变化。

## 6. Pi 清单怎么读

模块：`packages/host-runtime/src/pi-package-inventory.ts`。纯函数，fs + JSON，不 import Pi。

### 6.1 settings

- `~/.pi/agent/settings.json`
- 信任项目才读 `<project>/.pi/settings.json`（general / 未信任不读，ADR 0016）

`packages` 按 Pi 0.84 文档，**不是只有** `npm:foo`：

| 形状 | 含义 |
|------|------|
| `"npm:name"` / `"npm:@scope/name"`（可带 `@version`） | `agentDir/npm/node_modules/<name>` |
| `"name"` / `"@scope/name"`（无前缀，官方例子） | 同上，当 npm 包名 |
| `"git:…"` / `https://` / `ssh://` / `git://` | `agentDir/git/<host>/<path>`，用一次真实 `pi install git:` 钉目录 |
| 本地绝对/相对路径 | 相对 **该 settings 文件** 目录 |
| `{ source, extensions?, skills?, prompts? }` | 先解析 `source`，再用过滤（`[]` = 不要这类；省略 = 全要） |

另读同文件的 `extensions` / `skills` / `prompts` 路径数组（Pi 的本地资源列表），source=`pi-native`。再扫 `agentDir/{extensions,skills,prompts}` 松散目录。

坏 JSON / 缺包根：该条 diagnostic，不抛垮 Host，也不拿去 apply。

插入序：piwin 扫描结果在前，松散 `agentDir` 目录，再用户 `packages[]`，最后项目 `packages[]`（source=`project`）。

### 6.2 包内

`package.json#pi` 的 `extensions` / `skills` / `prompts`（忽略 themes）；无 manifest 则约定目录。`contentRevision` = 入口文件哈希，给 Blueprint 判断内容是否变。

解析允许稍笨，但必须有 npm 字符串、无前缀包名、对象过滤的测试。git 路径不靠猜。

## 7. 热应用

不新做。刷新带会话 → 现有 `extensions/apply` → `SessionRuntimeReplacementEngine`（ADR 0048）。失败留旧代。

新会话不依赖刷新：`createPiResourceLoader` 每次编 Blueprint 都经同一门面重读磁盘。

列表上 pi-native 显示「已启用」只表示 **配置态**；没 apply 前当前 Runtime 可能还没装上。这是 Phase A 已有的配置态 / 装载态分离。刷新就是把装载态跟上。

## 8. 合约 / UI

- `ExtensionSource` / `SkillSource` / `PromptTemplateSource` 加 `'pi-native'`
- 不新 HostCommand，不新 push 类型
- 刷新文案可改为「刷新并同步到当前会话」（有 session 时）；无会话则仍只刷新列表
- pill 显示 `pi-native` 即可

## 9. 验收

1. 已装的 `npm:pi-build-ios-apps`：打开扩展列表能看见，source=`pi-native`，默认开；技能 tab 有对应 skill。
2. 点刷新：有当前会话则 apply；闲着立刻换代，忙着等这轮结束。失败旧 Agent 还在。
3. 手动安装仍只写 `~/.piwin`，`packages[]` 不变。
4. 同 id：列表一项，user 赢，Blueprint 只有 user 路径。
5. `disabledIds` 关掉后路径不进 Blueprint。
6. `pi remove` 后再刷新，列表没有该项。
7. host-runtime **没有** `fs.watch` / `watchFile` / 按 bash 对账。
8. `extensions/list` 与 `createPiResourceLoader` 走同一 `loadDiscoveredResources`（测试或结构约束：Pi fixture 在两处都能见到）。

## 10. 文件

| 文件 | 动作 |
|------|------|
| `packages/host-runtime/src/pi-package-inventory.ts` | **新建** 只读解析 |
| `packages/host-runtime/src/pi-package-inventory.test.ts` | **新建** |
| `packages/host-runtime/src/discovered-resources.ts` | **新建** 门面：scan* + inventory。`createPiResourceLoader` 和 list 只调这里 |
| `packages/host-runtime/src/pi-resource-loader.ts` | 改：用门面，不再直接 scan 三份再偷偷 concat |
| `packages/host-runtime/src/commands/catalog-commands.ts` | 改：list 用门面 |
| `packages/host-runtime/src/capabilities/resource-policy-resolver.ts` | 改：`defaultSources` 加 `pi-native` |
| `packages/contracts/src/extensions.ts` 等 | 改：source 联合类型 |
| `apps/desktop/src/ExtensionsPanel.tsx` | 改：刷新在 list 成功后 apply |
| `scanExtensions` / managed store / `extensions/install` | **不改语义** |

`pi-resource-loader.ts` 里的 `collectSkillPaths` / diagnostics 留下。不要把 inventory 逻辑写进 `host-runtime.ts` 或 `extension-scanner.ts`。

## 11. 切片

1. `pi-package-inventory` + 测试（含无 `npm:` 前缀、对象过滤、缺包）
2. `loadDiscoveredResources` 门面；list + Blueprint 都改用它；`defaultSources` 加 `pi-native`
3. 刷新 → apply；idle `now` / busy `after-current-run`
4. 碰撞与「手动安装不写 packages[]」回归
5. 项目级 packages 仅信任项目

切片 1 可单独合。没有门面不要先改 UI。
