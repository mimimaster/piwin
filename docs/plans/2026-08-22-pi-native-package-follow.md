# Pi 原生包跟随 — 实施计划

> Spec: [`../specs/2026-08-22-pi-native-package-follow.md`](../specs/2026-08-22-pi-native-package-follow.md)
> ADR: [`../adr/0060-pi-native-package-follow.md`](../adr/0060-pi-native-package-follow.md)

**Goal:** 设置页列表/刷新能同步 Pi 的 `packages[]`；刷新带当前会话时走现成 `extensions/apply`。

**Keep:** Phase A managed store、`scanExtensions`、local/git install、`extensions/apply`。

**Do not add:** bash 钩子、watch、HostRuntime fingerprint coordinator、把 Pi 包装进 revisions。

**Clean path:** 一个 `loadDiscoveredResources()` 给 list 和 Blueprint 共用。

## Slice 1 — inventory 纯函数

- Create `packages/host-runtime/src/pi-package-inventory.ts` + test
- Contracts：`ExtensionSource` / `SkillSource` / `PromptTemplateSource` 加 `'pi-native'`

覆盖：`npm:pkg`、无前缀 `"pkg"`、对象 `{ source, skills: [] }`、缺目录 unresolved、坏 JSON。不读开发者本机 `~/.pi`，用 temp fixture。git 路径用一次真实落盘样例钉死，没有样例就标 skip 并只保证 npm。

`pnpm --filter @piwin/host-runtime test -- pi-package-inventory`

## Slice 2 — 唯一门面

- Create `packages/host-runtime/src/discovered-resources.ts`：先 `scan*`，再 append inventory
- `createPiResourceLoader` 与 `catalog-commands` 三个 list **都只调门面**
- `defaultSources()` 加 `'pi-native'`
- 测试：同一 fixture 在 `extensions/list` 和 `createPiResourceLoader().resourceCatalog` 都出现；同 id user 赢

不要改 `scanExtensions` 去读 `~/.pi`。

## Slice 3 — 刷新即 apply

- `ExtensionsPanel` 刷新：`list` 成功且有 `sessionId` → `extensions/apply`（闲 `now` / 忙交给 Host 的 after-current-run；面板可固定 `after-current-run`，idle 时 Host 已允许立刻换 — 跟现有 toggle 行为对齐，toggle 已用 `after-current-run`）
- 文案：有会话时「刷新」保持，info 提示已请求应用到当前会话
- 测试：现有 panel 测补一条 refresh 会发 apply

## Slice 4 — 回归

- `extensions/install` 后 `packages[]` 不变
- `disabledIds` 排除 pi-native 路径
- general / untrusted 不含项目 `.pi` 包

## 验证

```bash
pnpm --filter @piwin/contracts test
pnpm --filter @piwin/host-runtime test
pnpm --filter @piwin/desktop test -- ExtensionsPanel
pnpm typecheck
```

人工：设置 → 扩展 → 刷新，已 `pi install` 的包出现；当前对话下一轮能用。
