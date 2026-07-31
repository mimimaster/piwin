# Agent 状态动效 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 推荐 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans` 逐任务执行。步骤使用 `- [ ]` 复选框语法跟踪。

**Goal:** 在 piwin Desktop 的编码过程中给用户提供更生动的 Agent 运行反馈：发送后模型尚未响应时，用字体轮播 + icon 动效展示当前动态，如 "Planning next moves"；并把这套动效同步接入 `ContextBar`、`TurnWorkDetails` 和聊天占位卡三处。

**Architecture:** 纯 TS 文案/图标/映射层 + `framer-motion` 动画组件，全部放在 `apps/desktop`，不污染 `packages/ui-kit`/`packages/contracts`。图标优先用 imagegen MCP 生成，回退到 `lucide-react`（ISC 可商用）。文案参考 Cursor / Claude Code / Bolt 的 agent 状态风格。

**Tech Stack:**
- React 19 + TypeScript strict
- `framer-motion@12.42.2`（已确认发布超过 7 天）
- `lucide-react@1.25.0`（ISC 授权）
- `vitest + happy-dom` 单元测试

## 原始需求

1. 编码过程加入交互动效，改善等待模型响应的体验。
2. 使用「字体轮播」+ icon 设计展示动态过程。
3. 发送后、模型接口还没响应时，要出现动画并显示如 "plan next move" 之类的文案。
4. 可以引入公共组件库。
5. 使用 `imagegen` mcp 生成 icon。
6. 文案参考其他 agent 产品，不要像机器翻译。
7. 效果必须好。

## 全局约束（AGENTS.md + 设计约束）

- `apps/desktop` 不能 import `@earendil-works/pi-*`；只通过 `@piwin/contracts` 消费类型。
- 纯逻辑文件不得包含 DOM / React；React 组件不得直接读写 fs / child_process。
- 新依赖必须发布超过 7 天；本次使用 `framer-motion@12.42.2`、`lucide-react@1.25.0`。
- TypeScript strict：`no any`，`no non-null assertion` 除非显式检查。
- 单元测试 colocated：`foo.ts` 旁边是 `foo.test.ts`。
- ESM only，相对 import 使用 `.js` 扩展名。
- `prefers-reduced-motion: reduce` 必须关闭动效。
- 图标资产必须是 imagegen 原创或开源授权（Lucide ISC / Phosphor MIT），不得盗用无版权网页图片。

## 文件结构

| 文件 | 责任 |
|---|---|
| `apps/desktop/package.json` | 添加 `framer-motion`、`lucide-react` 依赖 |
| `apps/desktop/src/run-activity-types.ts` | `RunActivityInput`、`ActivityIconSource` 类型 |
| `apps/desktop/src/run-activity-strings.ts` | 根据状态/语言/工具名/计划步骤生成轮播文案 |
| `apps/desktop/src/run-activity-strings.test.ts` | 文案映射单元测试 |
| `apps/desktop/src/run-activity-icon.ts` | 根据状态解析 icon 源（imagegen 路径 / Lucide fallback） |
| `apps/desktop/src/run-activity-icon.test.ts` | icon 映射单元测试 |
| `apps/desktop/src/RunActivityIcon.tsx` | 渲染 `ActivityIconSource`，img 加载失败自动回退 Lucide |
| `apps/desktop/src/RunActivityIcon.test.tsx` | icon 组件测试 |
| `apps/desktop/src/run-activity-hooks.ts` | `useRunActivityPhrases`：管理轮播索引 + 15s 超时切换 |
| `apps/desktop/src/run-activity-hooks.test.ts` | hook 测试 |
| `apps/desktop/src/run-activity-mappers.ts` | 把 `RunStatusView` / `TurnPresentation` / `SessionRunPhase` 转成 `RunActivityInput` |
| `apps/desktop/src/run-activity-mappers.test.ts` | 映射器测试 |
| `apps/desktop/src/run-status.ts` | 扩展 `RunStatusView` 增加 `planStep` |
| `apps/desktop/src/run-status.test.ts` | 更新 `deriveRunStatus` 测试 |
| `apps/desktop/src/RunActivitySplash.tsx` | 完整版动画组件（icon + 文字轮播） |
| `apps/desktop/src/RunActivitySplash.test.tsx` | 完整组件测试 |
| `apps/desktop/src/RunActivityInline.tsx` | 紧凑版，用于 `ContextBar` |
| `apps/desktop/src/RunActivityInline.test.tsx` | 紧凑组件测试 |
| `apps/desktop/src/RunActivitySlot.tsx` | 聊天流占位卡（模型尚未响应时的助手气泡占位） |
| `apps/desktop/src/RunActivitySlot.test.tsx` | 占位卡测试 |
| `apps/desktop/src/styles/run-activity.css` | 动效样式 |
| `apps/desktop/src/styles.css` | import `run-activity.css` |
| `apps/desktop/src/context-bar.tsx` | 用 `RunActivityInline` 替换静态 `context-bar-status-label` |
| `apps/desktop/src/context-bar.test.tsx` | 更新 ContextBar 测试断言 |
| `apps/desktop/src/turn-work-details.tsx` | 用 `RunActivitySplash` 替换 `.turn-waiting-line` |
| `apps/desktop/src/chat-thread.tsx` | 在消息列表末尾按需渲染 `RunActivitySlot`，透传 locale 到工作详情 |
| `apps/desktop/src/chat-thread.test.tsx` | 验证 Slot 显隐与 locale 到 `TurnWorkDetails` 的透传 |
| `apps/desktop/src/App.tsx` | 把 locale 传给 `ChatThread` |

## 参考文档

- `AGENTS.md`
- `docs/prd.md`
- `docs/architecture.md`
- `packages/contracts/src/host.ts`（`SessionRunPhase`）
- `apps/desktop/src/run-status.ts`
- `apps/desktop/src/run-presentation.ts`
- `apps/desktop/src/chat-thread.tsx`
- `apps/desktop/src/context-bar.tsx`
- `apps/desktop/src/turn-work-details.tsx`
- `apps/desktop/src/styles/region-context-bar.css`
- `apps/desktop/src/styles/region-transcript.css`

---

## Task 1：添加依赖与共享类型

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/run-activity-types.ts`

**Interfaces:**
- Produces: `RunActivityInput`, `ActivityIconSource`

- [ ] **Step 1：在 `apps/desktop/package.json` 添加依赖**

修改前：

```json
  "dependencies": {
    "@piwin/artifact": "workspace:*",
    ...
    "react-dom": "^19.2.7"
  },
```

修改后：

```json
  "dependencies": {
    "@piwin/artifact": "workspace:*",
    ...
    "react-dom": "^19.2.7",
    "framer-motion": "12.42.2",
    "lucide-react": "1.25.0"
  },
```

- [ ] **Step 2：安装依赖**

Run: `pnpm install`
Expected: `node_modules` 更新，lockfile 变化。

- [ ] **Step 3：创建 `apps/desktop/src/run-activity-types.ts`**

```ts
import type { RunStatusKind } from './run-status.js';

export type RunActivityInput = {
  kind: RunStatusKind;
  activeToolName?: string;
  planStep?: string;
  elapsedMs?: number;
  locale: 'zh-CN' | 'en';
};

export type ActivityIconSource = {
  kind: RunStatusKind;
  lucideName: string;
  imgSrc?: string;
};
```

- [ ] **Step 4：类型检查**

Run: `pnpm --filter @piwin/desktop typecheck`
Expected: 通过（新文件尚未被引用，不应报错）。

- [ ] **Step 5：Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/run-activity-types.ts
git commit -m "chore(apps/desktop): add framer-motion + lucide-react and run activity types"
```

---

## Task 2：文案生成器 `run-activity-strings`

**Files:**
- Create: `apps/desktop/src/run-activity-strings.ts`
- Create: `apps/desktop/src/run-activity-strings.test.ts`

**Interfaces:**
- Consumes: `RunActivityInput`（Task 1）
- Produces: `buildBasePhrases(input)`, `buildTakingTooLongPhrases(input)`, `buildActivityPhrases(input)`

- [ ] **Step 1：写失败测试**

Create `apps/desktop/src/run-activity-strings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildBasePhrases, buildTakingTooLongPhrases, buildActivityPhrases } from './run-activity-strings.js';
import type { RunActivityInput } from './run-activity-types.js';

const en = (overrides: Partial<RunActivityInput> = {}): RunActivityInput => ({
  kind: 'waiting-first-token',
  locale: 'en',
  ...overrides,
});

describe('buildBasePhrases', () => {
  it('returns "Planning next moves" for waiting-first-token en', () => {
    const phrases = buildBasePhrases(en());
    expect(phrases[0]).toBe('Planning next moves');
    expect(phrases.length).toBeGreaterThanOrEqual(3);
  });

  it('includes tool name for working with activeToolName', () => {
    const phrases = buildBasePhrases(en({ kind: 'working', activeToolName: 'bash' }));
    expect(phrases[0]).toContain('bash');
  });

  it('includes plan step for planning', () => {
    const phrases = buildBasePhrases(en({ kind: 'planning', planStep: 'Add auth' }));
    expect(phrases[0]).toBe('Planning: Add auth');
  });

  it('localizes to zh-CN', () => {
    const phrases = buildBasePhrases({ kind: 'waiting-first-token', locale: 'zh-CN' });
    expect(phrases[0]).toBe('规划下一步');
  });
});

describe('buildTakingTooLongPhrases', () => {
  it('mentions the tool name', () => {
    const phrases = buildTakingTooLongPhrases(en({ kind: 'working', activeToolName: 'bash' }));
    expect(phrases[0]).toContain('bash');
  });

  it('falls back to generic taking-too-long for waiting-first-token', () => {
    const phrases = buildTakingTooLongPhrases(en());
    expect(phrases[0]).toBe('Taking longer than expected…');
  });
});

describe('buildActivityPhrases', () => {
  it('switches to taking-too-long when elapsed > 15s', () => {
    const phrases = buildActivityPhrases(en({ elapsedMs: 20_000 }));
    expect(phrases[0]).toBe('Taking longer than expected…');
  });
});
```

- [ ] **Step 2：运行确认失败**

Run: `pnpm --dir apps/desktop exec vitest run src/run-activity-strings.test.ts`
Expected: FAIL，提示 `run-activity-strings` 模块不存在。

- [ ] **Step 3：实现 `run-activity-strings.ts`**

```ts
import type { RunActivityInput } from './run-activity-types.js';

const TAKING_TOO_LONG_MS = 15_000;

export function buildActivityPhrases(input: RunActivityInput): string[] {
  if (typeof input.elapsedMs === 'number' && input.elapsedMs >= TAKING_TOO_LONG_MS) {
    return buildTakingTooLongPhrases(input);
  }
  return buildBasePhrases(input);
}

export function buildBasePhrases(input: RunActivityInput): string[] {
  const isZh = input.locale === 'zh-CN';
  const toolName = input.activeToolName;
  const planStep = input.planStep;

  switch (input.kind) {
    case 'preparing':
      return isZh ? ['准备中', '加载上下文', '选择合适工具'] : ['Getting ready', 'Loading context', 'Picking tools'];
    case 'connecting-model':
      return isZh ? ['连接模型中…', '预热通道'] : ['Connecting to model…', 'Warming up the link'];
    case 'waiting-first-token':
      return isZh
        ? ['规划下一步', '读取请求', '思考中', '整理上下文']
        : ['Planning next moves', 'Reading your request', 'Thinking it over', 'Gathering context'];
    case 'planning':
      if (planStep) {
        return isZh ? [`规划：${planStep}`, '梳理步骤'] : [`Planning: ${planStep}`, 'Outlining steps'];
      }
      return isZh ? ['规划下一步', '梳理步骤', '完善计划'] : ['Planning next moves', 'Outlining steps', 'Refining the plan'];
    case 'working':
      if (toolName) {
        return isZh
          ? [`运行 ${toolName}`, '收集结果', '组织答案']
          : [`Running ${toolName}`, 'Collecting results', 'Writing it up'];
      }
      return isZh ? ['写代码中', '组装中', '就快好了'] : ['Writing your code', 'Putting it together', 'Almost there'];
    case 'waiting-permission':
      return isZh ? ['需要你确认', '等待你决定'] : ['Needs your approval', 'Waiting for you'];
    case 'compacting':
      return isZh ? ['压缩上下文', '总结记忆'] : ['Trimming context', 'Summarizing memory'];
    case 'stopping':
      return isZh ? ['停止中', '终止运行'] : ['Stopping', 'Halting run'];
    case 'failed':
      return isZh ? ['出错了', '再试一次？'] : ['Hit a snag', 'Try again?'];
    case 'complete':
      return isZh ? ['完成了', '准备就绪', '等待下一轮'] : ['Done', 'All set', 'Ready for what’s next'];
    case 'idle':
      return isZh ? ['就绪'] : ['Ready'];
    case 'stopped':
      return isZh ? ['已停止'] : ['Stopped'];
    default:
      return isZh ? ['工作中'] : ['Working'];
  }
}

export function buildTakingTooLongPhrases(input: RunActivityInput): string[] {
  const isZh = input.locale === 'zh-CN';
  const toolName = input.activeToolName;

  if (input.kind === 'working' && toolName) {
    return isZh
      ? [`${toolName} 比预期久一点…`, '仍在处理…']
      : [`${toolName} is taking longer than expected…`, 'Still working…'];
  }

  return isZh ? ['比预期久一点…', '仍在处理…', '继续等待'] : ['Taking longer than expected…', 'Still working…', 'Hang on'];
}
```

- [ ] **Step 4：运行测试通过**

Run: `pnpm --dir apps/desktop exec vitest run src/run-activity-strings.test.ts`
Expected: PASS。

- [ ] **Step 5：Commit**

```bash
git add apps/desktop/src/run-activity-strings.ts apps/desktop/src/run-activity-strings.test.ts
git commit -m "feat(apps/desktop): run activity phrase builder with carousel and taking-too-long"
```

---

## Task 3：图标解析器 `run-activity-icon`

**Files:**
- Create: `apps/desktop/src/run-activity-icon.ts`
- Create: `apps/desktop/src/run-activity-icon.test.ts`

**Interfaces:**
- Consumes: `RunActivityInput`
- Produces: `resolveActivityIcon(input): ActivityIconSource`

- [ ] **Step 1：写失败测试**

Create `apps/desktop/src/run-activity-icon.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveActivityIcon } from './run-activity-icon.js';
import type { RunActivityInput } from './run-activity-types.js';

const input = (kind: RunActivityInput['kind']): RunActivityInput => ({ kind, locale: 'en' });

describe('resolveActivityIcon', () => {
  it('maps waiting-first-token to Sparkles with generated img path', () => {
    const icon = resolveActivityIcon(input('waiting-first-token'));
    expect(icon.lucideName).toBe('Sparkles');
    expect(icon.imgSrc).toBe('/ui/run-state-waiting-first-token.png');
    expect(icon.kind).toBe('waiting-first-token');
  });

  it('maps connecting-model to the matching generated asset', () => {
    const icon = resolveActivityIcon(input('connecting-model'));
    expect(icon.imgSrc).toBe('/ui/run-state-connecting-model.png');
  });

  it('maps working-with-tool to Terminal', () => {
    const icon = resolveActivityIcon({ kind: 'working', activeToolName: 'bash', locale: 'en' });
    expect(icon.lucideName).toBe('Terminal');
  });

  it('maps working-without-tool to Code', () => {
    const icon = resolveActivityIcon(input('working'));
    expect(icon.lucideName).toBe('Code');
  });
});
```

- [ ] **Step 2：运行确认失败**

Run: `pnpm --dir apps/desktop exec vitest run src/run-activity-icon.test.ts`
Expected: FAIL。

- [ ] **Step 3：实现 `run-activity-icon.ts`**

```ts
import type { RunActivityInput, ActivityIconSource } from './run-activity-types.js';
import type { RunStatusKind } from './run-status.js';

const LUCIDE_NAME: Record<RunStatusKind, string> = {
  idle: 'Circle',
  preparing: 'Settings',
  'connecting-model': 'Wifi',
  'waiting-first-token': 'Sparkles',
  planning: 'Map',
  working: 'Code',
  'waiting-permission': 'ShieldQuestion',
  compacting: 'Minimize2',
  stopping: 'Square',
  stopped: 'Circle',
  failed: 'XCircle',
  complete: 'CheckCircle2',
};

const WORKING_TOOL_ICON = 'Terminal';
const WORKING_ICON = 'Code';

const GENERATED_SRC: Record<RunStatusKind, string | undefined> = {
  idle: '/ui/run-state-idle.png',
  preparing: '/ui/run-state-preparing.png',
  'connecting-model': '/ui/run-state-connecting-model.png',
  'waiting-first-token': '/ui/run-state-waiting-first-token.png',
  planning: '/ui/run-state-planning.png',
  working: '/ui/run-state-working.png',
  'waiting-permission': '/ui/run-state-waiting-permission.png',
  compacting: '/ui/run-state-compacting.png',
  stopping: '/ui/run-state-stopping.png',
  stopped: '/ui/run-state-stopped.png',
  failed: '/ui/run-state-failed.png',
  complete: '/ui/run-state-complete.png',
};

function resolveLucideName(input: RunActivityInput): string {
  if (input.kind === 'working' && input.activeToolName) {
    return WORKING_TOOL_ICON;
  }
  return LUCIDE_NAME[input.kind] ?? 'Loader2';
}

function resolveGeneratedSrc(input: RunActivityInput): string | undefined {
  if (input.kind === 'working' && input.activeToolName) {
    return '/ui/run-state-tool-running.png';
  }
  return GENERATED_SRC[input.kind];
}

export function resolveActivityIcon(input: RunActivityInput): ActivityIconSource {
  const imgSrc = resolveGeneratedSrc(input);
  return {
    kind: input.kind,
    lucideName: resolveLucideName(input),
    ...(imgSrc !== undefined ? { imgSrc } : {}),
  };
}
```

- [ ] **Step 4：运行测试通过**

Run: `pnpm --dir apps/desktop exec vitest run src/run-activity-icon.test.ts`
Expected: PASS。

- [ ] **Step 5：Commit**

```bash
git add apps/desktop/src/run-activity-icon.ts apps/desktop/src/run-activity-icon.test.ts
git commit -m "feat(apps/desktop): run activity icon resolver with lucide + imagegen paths"
```

---

## Task 4：图标组件 `RunActivityIcon`

**Files:**
- Create: `apps/desktop/src/RunActivityIcon.tsx`
- Create: `apps/desktop/src/RunActivityIcon.test.tsx`

**Interfaces:**
- Consumes: `ActivityIconSource`
- Produces: `RunActivityIcon` 组件

- [ ] **Step 1：写失败测试**

Create `apps/desktop/src/RunActivityIcon.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RunActivityIcon } from './RunActivityIcon.js';
import type { ActivityIconSource } from './run-activity-types.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function TestHarness(props: { source: ActivityIconSource }): ReactElement {
  return <RunActivityIcon source={props.source} data-testid="icon" />;
}

describe('RunActivityIcon', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.parentNode?.removeChild(container);
  });

  it('renders an img when imgSrc is provided', () => {
    const source: ActivityIconSource = { kind: 'waiting-first-token', lucideName: 'Sparkles', imgSrc: '/ui/test.png' };
    act(() => root.render(<TestHarness source={source} />));
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/ui/test.png');
  });

  it('renders an svg when no imgSrc', () => {
    const source: ActivityIconSource = { kind: 'working', lucideName: 'Code' };
    act(() => root.render(<TestHarness source={source} />));
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to an svg when the generated image fails to load', () => {
    const source: ActivityIconSource = {
      kind: 'waiting-first-token',
      lucideName: 'Sparkles',
      imgSrc: '/ui/missing.png',
    };
    act(() => root.render(<TestHarness source={source} />));
    const img = container.querySelector<HTMLImageElement>('img');
    if (!img) {
      throw new Error('Expected generated icon image');
    }
    act(() => img.dispatchEvent(new Event('error')));
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
```

- [ ] **Step 2：运行确认失败**

Run: `pnpm --dir apps/desktop exec vitest run src/RunActivityIcon.test.tsx`
Expected: FAIL，提示组件未定义。

- [ ] **Step 3：实现 `RunActivityIcon.tsx`**

```tsx
import { useEffect, useState, type ComponentType, type ReactElement } from 'react';
import {
  Loader2,
  Settings,
  Wifi,
  Sparkles,
  Map,
  Code,
  Terminal,
  ShieldQuestion,
  Minimize2,
  Square,
  Circle,
  XCircle,
  CheckCircle2,
  type LucideProps,
} from 'lucide-react';
import type { ActivityIconSource } from './run-activity-types.js';

const iconMap: Record<string, ComponentType<LucideProps>> = {
  Loader2,
  Settings,
  Wifi,
  Sparkles,
  Map,
  Code,
  Terminal,
  ShieldQuestion,
  Minimize2,
  Square,
  Circle,
  XCircle,
  CheckCircle2,
};

export type RunActivityIconProps = {
  source: ActivityIconSource;
  className?: string;
  'data-testid'?: string;
};

export function RunActivityIcon(props: RunActivityIconProps): ReactElement {
  const [imgError, setImgError] = useState(false);
  const LucideIcon = iconMap[props.source.lucideName] ?? Loader2;

  useEffect(() => {
    setImgError(false);
  }, [props.source.imgSrc, props.source.lucideName]);

  if (props.source.imgSrc && !imgError) {
    return (
      <img
        className={props.className}
        src={props.source.imgSrc}
        alt=""
        aria-hidden
        data-testid={props['data-testid']}
        onError={() => setImgError(true)}
      />
    );
  }

  return <LucideIcon className={props.className} aria-hidden data-testid={props['data-testid']} />;
}
```

- [ ] **Step 4：运行测试通过**

Run: `pnpm --dir apps/desktop exec vitest run src/RunActivityIcon.test.tsx`
Expected: PASS。

- [ ] **Step 5：Commit**

```bash
git add apps/desktop/src/RunActivityIcon.tsx apps/desktop/src/RunActivityIcon.test.tsx
git commit -m "feat(apps/desktop): RunActivityIcon with img + lucide fallback"
```

---

## Task 5：轮播 Hook `useRunActivityPhrases`

**Files:**
- Create: `apps/desktop/src/run-activity-hooks.ts`
- Create: `apps/desktop/src/run-activity-hooks.test.ts`

**Interfaces:**
- Consumes: `RunActivityInput`, `buildBasePhrases`, `buildTakingTooLongPhrases`
- Produces: `useRunActivityPhrases(input): { phrases, currentPhrase, isTakingTooLong }`

- [ ] **Step 1：写失败测试**

Create `apps/desktop/src/run-activity-hooks.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
const reducedMotion = vi.hoisted(() => ({ current: false }));

vi.mock('framer-motion', () => ({
  useReducedMotion: () => reducedMotion.current,
}));

import { useRunActivityPhrases } from './run-activity-hooks.js';
import type { RunActivityInput } from './run-activity-types.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function TestHarness(props: { input: RunActivityInput }): ReactElement {
  const result = useRunActivityPhrases(props.input);
  return <span data-testid="current">{result.currentPhrase}</span>;
}

describe('useRunActivityPhrases', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    reducedMotion.current = false;
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    container.parentNode?.removeChild(container);
  });

  it('returns the first base phrase initially', () => {
    const input: RunActivityInput = { kind: 'waiting-first-token', locale: 'en' };
    act(() => root.render(<TestHarness input={input} />));
    expect(container.textContent).toBe('Planning next moves');
  });

  it('advances to the next phrase after 1.8s', () => {
    const input: RunActivityInput = { kind: 'waiting-first-token', locale: 'en' };
    act(() => root.render(<TestHarness input={input} />));
    act(() => vi.advanceTimersByTime(1800));
    expect(container.textContent).toBe('Reading your request');
  });

  it('does not rotate phrases when reduced motion is enabled', () => {
    reducedMotion.current = true;
    const input: RunActivityInput = { kind: 'waiting-first-token', locale: 'en' };
    act(() => root.render(<TestHarness input={input} />));
    act(() => vi.advanceTimersByTime(3600));
    expect(container.textContent).toBe('Planning next moves');
  });

  it('switches to taking-too-long after 15s elapsed', () => {
    const input: RunActivityInput = { kind: 'waiting-first-token', locale: 'en', elapsedMs: 0 };
    act(() => root.render(<TestHarness input={input} />));
    act(() => vi.advanceTimersByTime(15000));
    expect(container.textContent).toBe('Taking longer than expected…');
  });

  it('immediately shows taking-too-long at 15s elapsed', () => {
    const input: RunActivityInput = { kind: 'waiting-first-token', locale: 'en', elapsedMs: 15000 };
    act(() => root.render(<TestHarness input={input} />));
    expect(container.textContent).toBe('Taking longer than expected…');
  });

  it('resets taking-too-long when the next run starts', () => {
    act(() =>
      root.render(
        <TestHarness input={{ kind: 'waiting-first-token', locale: 'en', elapsedMs: 20000 }} />,
      ),
    );
    expect(container.textContent).toBe('Taking longer than expected…');
    act(() =>
      root.render(
        <TestHarness input={{ kind: 'waiting-first-token', locale: 'en', elapsedMs: 0 }} />,
      ),
    );
    expect(container.textContent).toBe('Planning next moves');
  });
});
```

- [ ] **Step 2：运行确认失败**

Run: `pnpm --dir apps/desktop exec vitest run src/run-activity-hooks.test.ts`
Expected: FAIL。

- [ ] **Step 3：实现 `run-activity-hooks.ts`**

```ts
import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { buildBasePhrases, buildTakingTooLongPhrases } from './run-activity-strings.js';
import type { RunActivityInput } from './run-activity-types.js';

const TAKING_TOO_LONG_MS = 15_000;
const CYCLE_INTERVAL_MS = 1800;

export type UseRunActivityPhrasesResult = {
  phrases: string[];
  currentPhrase: string;
  isTakingTooLong: boolean;
};

export function useRunActivityPhrases(input: RunActivityInput): UseRunActivityPhrasesResult {
  const reduced = useReducedMotion() ?? false;
  const base = useMemo(
    () => buildBasePhrases(input),
    [input.kind, input.activeToolName, input.planStep, input.locale],
  );
  const takingTooLong = useMemo(
    () => buildTakingTooLongPhrases(input),
    [input.kind, input.activeToolName, input.planStep, input.locale],
  );
  const [isTakingTooLong, setIsTakingTooLong] = useState(
    typeof input.elapsedMs === 'number' && input.elapsedMs >= TAKING_TOO_LONG_MS,
  );
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const elapsedMs = input.elapsedMs;
    const hasTimedOut =
      typeof elapsedMs === 'number' && elapsedMs >= TAKING_TOO_LONG_MS;
    setIsTakingTooLong(hasTimedOut);

    if (elapsedMs === undefined || hasTimedOut) {
      return;
    }
    const id = window.setTimeout(
      () => setIsTakingTooLong(true),
      TAKING_TOO_LONG_MS - elapsedMs,
    );
    return () => window.clearTimeout(id);
  }, [input.elapsedMs]);

  const phrases = isTakingTooLong ? takingTooLong : base;

  useEffect(() => {
    setIndex(0);
    if (reduced || phrases.length <= 1) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % phrases.length), CYCLE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [phrases, reduced]);

  return {
    phrases,
    currentPhrase: phrases[index] ?? phrases[0] ?? '',
    isTakingTooLong,
  };
}
```

- [ ] **Step 4：运行测试通过**

Run: `pnpm --dir apps/desktop exec vitest run src/run-activity-hooks.test.ts`
Expected: PASS。

- [ ] **Step 5：Commit**

```bash
git add apps/desktop/src/run-activity-hooks.ts apps/desktop/src/run-activity-hooks.test.ts
git commit -m "feat(apps/desktop): useRunActivityPhrases hook with 15s taking-too-long switch"
```

---

## Task 6：状态映射器与 `run-status` `planStep` 扩展

**Files:**
- Create: `apps/desktop/src/run-activity-mappers.ts`
- Create: `apps/desktop/src/run-activity-mappers.test.ts`
- Modify: `apps/desktop/src/run-status.ts`
- Modify: `apps/desktop/src/run-status.test.ts`

**Interfaces:**
- Consumes: `RunStatusView`, `TurnPresentation`, `ChatMessageUi`, `SessionRunPhase`
- Produces: `runStatusToActivityInput`, `turnPresentationToActivityInput`, `sessionRunPhaseToActivityKind`

- [ ] **Step 1：写失败测试**

Create `apps/desktop/src/run-activity-mappers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  runStatusToActivityInput,
  sessionRunPhaseToActivityKind,
  turnPresentationToActivityInput,
} from './run-activity-mappers.js';
import type { RunStatusView } from './run-status.js';
import type { SessionRunPhase } from '@piwin/contracts';

describe('sessionRunPhaseToActivityKind', () => {
  it('maps streaming to working', () => {
    expect(sessionRunPhaseToActivityKind('streaming')).toBe('working');
  });

  it('maps tool-running to working', () => {
    expect(sessionRunPhaseToActivityKind('tool-running')).toBe('working');
  });

  it('maps waiting-first-token directly', () => {
    expect(sessionRunPhaseToActivityKind('waiting-first-token')).toBe('waiting-first-token');
  });

  it('maps cancelling to stopping', () => {
    expect(sessionRunPhaseToActivityKind('cancelling')).toBe('stopping');
  });
});

describe('runStatusToActivityInput', () => {
  it('copies fields and locale', () => {
    const runState: RunStatusView = {
      kind: 'working',
      label: 'Working',
      summary: 'Working…',
      activeToolName: 'bash',
      completedToolCount: 1,
      runningProcessCount: 0,
      primaryAction: 'view-activity',
      canStop: true,
      elapsedMs: 3000,
      planStep: 'Auth',
    };
    const input = runStatusToActivityInput(runState, 'zh-CN');
    expect(input.kind).toBe('working');
    expect(input.activeToolName).toBe('bash');
    expect(input.locale).toBe('zh-CN');
    expect(input.elapsedMs).toBe(3000);
    expect(input.planStep).toBe('Auth');
  });
});

describe('turnPresentationToActivityInput', () => {
  it('maps latest phase and running tool', () => {
    const presentation = {
      runId: null,
      phaseHistory: [{ phase: 'waiting-first-token' as const, at: 1 }],
      isWaitingForModel: true,
      isActive: true,
      hasFailure: false,
      answerStarted: false,
      workItems: [],
      summaryLabel: '',
      toolCallCount: 0,
    } as unknown as import('./run-presentation.js').TurnPresentation;

    const message = {
      id: 'm1',
      role: 'assistant' as const,
      text: '',
      thinking: '',
      tools: [{ toolCallId: 't1', toolName: 'read_file', status: 'running' as const, output: '' }],
      attachments: [],
      status: 'streaming' as const,
      runId: 'r1',
    };

    const input = turnPresentationToActivityInput(presentation, message, 'en');
    expect(input.kind).toBe('waiting-first-token');
    expect(input.activeToolName).toBe('read_file');
  });
});
```

- [ ] **Step 2：运行确认失败**

Run: `pnpm --dir apps/desktop exec vitest run src/run-activity-mappers.test.ts`
Expected: FAIL。

- [ ] **Step 3：实现 `run-activity-mappers.ts`**

```ts
import type { SessionRunPhase } from '@piwin/contracts';
import type { RunStatusView, RunStatusKind } from './run-status.js';
import type { RunActivityInput } from './run-activity-types.js';
import type { TurnPresentation } from './run-presentation.js';
import type { ChatMessageUi } from './chat-reducer.js';

export function runStatusToActivityInput(
  runState: RunStatusView,
  locale: 'zh-CN' | 'en',
): RunActivityInput {
  return {
    kind: runState.kind,
    locale,
    ...(runState.activeToolName !== undefined
      ? { activeToolName: runState.activeToolName }
      : {}),
    ...(runState.planStep !== undefined ? { planStep: runState.planStep } : {}),
    ...(runState.elapsedMs !== undefined ? { elapsedMs: runState.elapsedMs } : {}),
  };
}

export function turnPresentationToActivityInput(
  presentation: TurnPresentation,
  message: ChatMessageUi,
  locale: 'zh-CN' | 'en',
  now = Date.now(),
): RunActivityInput {
  const latestPhase = presentation.phaseHistory[presentation.phaseHistory.length - 1]?.phase;
  const kind = latestPhase ? sessionRunPhaseToActivityKind(latestPhase) : 'connecting-model';
  const activeToolName = message.tools.find((tool) => tool.status === 'running')?.toolName;
  // Round to nearest second so `input.elapsedMs` is stable across sub-second `TurnWorkDetails` re-renders.
  const elapsedMs =
    typeof presentation.startedAt === 'number'
      ? Math.floor((Math.max(0, now - presentation.startedAt)) / 1000) * 1000
      : undefined;

  return {
    kind,
    locale,
    ...(activeToolName !== undefined ? { activeToolName } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };
}

export function sessionRunPhaseToActivityKind(phase: SessionRunPhase): RunStatusKind {
  switch (phase) {
    case 'accepted':
    case 'preparing':
      return 'preparing';
    case 'connecting-model':
      return 'connecting-model';
    case 'waiting-first-token':
      return 'waiting-first-token';
    case 'streaming':
    case 'tool-running':
      return 'working';
    case 'waiting-permission':
      return 'waiting-permission';
    case 'cancelling':
      return 'stopping';
    default:
      return 'working';
  }
}
```

- [ ] **Step 4：扩展 `run-status.ts` 的 `RunStatusView`**

在 `run-status.ts` 中：

1. 给 `RunStatusView` 增加 `planStep?: string;`：

```ts
export type RunStatusView = {
  kind: RunStatusKind;
  label: string;
  summary: string;
  activeToolName?: string;
  completedToolCount: number;
  runningProcessCount: number;
  primaryAction?: RunStatusPrimaryAction;
  canStop: boolean;
  elapsedMs?: number;
  planStep?: string;
};
```

2. 在 `planInProgress` 分支的 return 中加入 `planStep` 和 `elapsedMs`：

找到这段（约 124-135 行）：

```ts
    if (planInProgress && input.plan) {
      const step =
        input.plan.steps.find((item) => item.status === 'active') ??
        input.plan.steps.find((item) => item.status !== 'done');
      return {
        kind: 'planning',
        label: 'Planning',
        summary: step?.title ?? input.plan.title ?? 'Building a plan',
        ...baseCounts,
        primaryAction: 'view-plan',
        canStop: true,
      };
    }
```

替换为：

```ts
    if (planInProgress && input.plan) {
      const step =
        input.plan.steps.find((item) => item.status === 'active') ??
        input.plan.steps.find((item) => item.status !== 'done');
      return {
        kind: 'planning',
        label: 'Planning',
        summary: step?.title ?? input.plan.title ?? 'Building a plan',
        ...baseCounts,
        primaryAction: 'view-plan',
        canStop: true,
        ...(step?.title !== undefined ? { planStep: step.title } : {}),
        ...(input.chat.activeRunStartedAt !== null
          ? { elapsedMs: Math.max(0, Date.now() - input.chat.activeRunStartedAt) }
          : {}),
      };
    }
```

- [ ] **Step 5：更新 `run-status.test.ts`**

在 `apps/desktop/src/run-status.test.ts` 末尾追加：

```ts
  it('includes planStep when planning', () => {
    const chat = {
      ...createInitialChatUiState(),
      runPhase: 'streaming' as const,
      streaming: true,
    };
    const plan = {
      id: 'p1',
      sessionId: 's1',
      projectPath: '/tmp',
      status: 'executing' as const,
      title: 'Implement auth',
      goal: 'Add auth',
      steps: [{ id: 's1', title: 'Add login', status: 'active' as const }],
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const status = deriveRunStatus({ chat, tools: [], plan, processes: [] });
    expect(status.kind).toBe('planning');
    expect(status.planStep).toBe('Add login');
  });
```

- [ ] **Step 6：运行映射器 + run-status 测试通过**

Run: `pnpm --dir apps/desktop exec vitest run src/run-activity-mappers.test.ts src/run-status.test.ts`
Expected: PASS。

- [ ] **Step 7：Commit**

```bash
git add apps/desktop/src/run-activity-mappers.ts apps/desktop/src/run-activity-mappers.test.ts apps/desktop/src/run-status.ts apps/desktop/src/run-status.test.ts
git commit -m "feat(apps/desktop): run activity mappers and run-status planStep"
```

---

## Task 7：`RunActivitySplash` 完整动画组件

**Files:**
- Create: `apps/desktop/src/RunActivitySplash.tsx`
- Create: `apps/desktop/src/RunActivitySplash.test.tsx`

**Interfaces:**
- Consumes: `useRunActivityPhrases`, `resolveActivityIcon`, `RunActivityIcon`, `RunActivityInput`
- Produces: `RunActivitySplash` 组件

- [ ] **Step 1：写失败测试**

Create `apps/desktop/src/RunActivitySplash.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RunActivitySplash } from './RunActivitySplash.js';
import type { RunActivityInput } from './run-activity-types.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function TestHarness(props: { input: RunActivityInput }): ReactElement {
  return <RunActivitySplash input={props.input} />;
}

describe('RunActivitySplash', () => {
  let container: HTMLElement;
  let root: Root;
  let previousMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    previousMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.parentNode?.removeChild(container);
    window.matchMedia = previousMatchMedia;
  });

  it('renders the first phrase and status role', () => {
    act(() => root.render(<TestHarness input={{ kind: 'waiting-first-token', locale: 'en' }} />));
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-label')).toBe('Planning next moves');
    expect(container.textContent).toContain('Planning next moves');
  });

  it('mentions the tool when working', () => {
    act(() =>
      root.render(<TestHarness input={{ kind: 'working', activeToolName: 'bash', locale: 'en' }} />),
    );
    expect(container.textContent).toContain('bash');
  });

  it('shows taking-too-long when elapsed > 15s', () => {
    act(() =>
      root.render(<TestHarness input={{ kind: 'waiting-first-token', locale: 'en', elapsedMs: 20000 }} />),
    );
    expect(container.textContent).toContain('Taking longer than expected…');
  });
});
```

- [ ] **Step 2：运行确认失败**

Run: `pnpm --dir apps/desktop exec vitest run src/RunActivitySplash.test.tsx`
Expected: FAIL。

- [ ] **Step 3：实现 `RunActivitySplash.tsx`**

```tsx
import { useMemo, type ReactElement } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useRunActivityPhrases } from './run-activity-hooks.js';
import { resolveActivityIcon } from './run-activity-icon.js';
import { RunActivityIcon } from './RunActivityIcon.js';
import type { RunActivityInput } from './run-activity-types.js';

export type RunActivitySplashProps = {
  input: RunActivityInput;
};

export function RunActivitySplash(props: RunActivitySplashProps): ReactElement {
  const reduced = useReducedMotion() ?? false;
  const { phrases, currentPhrase } = useRunActivityPhrases(props.input);
  const iconSource = useMemo(() => resolveActivityIcon(props.input), [props.input]);
  const ariaLabel = phrases[0] ?? '';

  return (
    <div
      className="run-activity-splash"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={ariaLabel}
      data-kind={props.input.kind}
    >
      <span className="sr-only">{ariaLabel}</span>
      <div className="run-activity-splash-icon-wrap" data-kind={props.input.kind}>
        <RunActivityIcon source={iconSource} className="run-activity-splash-icon" />
      </div>
      <div className="run-activity-splash-text" aria-hidden>
        <span className="run-activity-splash-label">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={currentPhrase}
              className="run-activity-splash-phrase"
              initial={reduced ? false : { y: 14, opacity: 0, filter: 'blur(4px)' }}
              animate={
                reduced
                  ? { opacity: 1 }
                  : { y: 0, opacity: 1, filter: 'blur(0px)' }
              }
              exit={
                reduced
                  ? { opacity: 1 }
                  : { y: -14, opacity: 0, filter: 'blur(4px)' }
              }
              transition={
                reduced
                  ? { duration: 0 }
                  : { duration: 0.35, ease: [0.22, 1, 0.36, 1] }
              }
            >
              {currentPhrase}
            </motion.span>
          </AnimatePresence>
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4：运行测试通过**

Run: `pnpm --dir apps/desktop exec vitest run src/RunActivitySplash.test.tsx`
Expected: PASS。

- [ ] **Step 5：Commit**

```bash
git add apps/desktop/src/RunActivitySplash.tsx apps/desktop/src/RunActivitySplash.test.tsx
git commit -m "feat(apps/desktop): RunActivitySplash with framer-motion text carousel"
```

---

## Task 8：`RunActivityInline` 紧凑版 + `RunActivitySlot` 占位卡

**Files:**
- Create: `apps/desktop/src/RunActivityInline.tsx`
- Create: `apps/desktop/src/RunActivityInline.test.tsx`
- Create: `apps/desktop/src/RunActivitySlot.tsx`
- Create: `apps/desktop/src/RunActivitySlot.test.tsx`

**Interfaces:**
- Consumes: `useRunActivityPhrases`, `resolveActivityIcon`, `RunActivityIcon`, `runStatusToActivityInput`, `sessionRunPhaseToActivityKind`
- Produces: `RunActivityInline`, `RunActivitySlot` 组件

- [ ] **Step 1：写 `RunActivityInline` 失败测试**

Create `apps/desktop/src/RunActivityInline.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RunActivityInline } from './RunActivityInline.js';
import type { RunStatusView } from './run-status.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function TestHarness(props: { runState: RunStatusView }): ReactElement {
  return <RunActivityInline runState={props.runState} locale="en" />;
}

describe('RunActivityInline', () => {
  let container: HTMLElement;
  let root: Root;
  let previousMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    previousMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.parentNode?.removeChild(container);
    window.matchMedia = previousMatchMedia;
  });

  it('returns null when idle', () => {
    act(() =>
      root.render(
        <TestHarness
          runState={{
            kind: 'idle',
            label: 'Idle',
            summary: 'Ready',
            completedToolCount: 0,
            runningProcessCount: 0,
            canStop: false,
          }}
        />,
      ),
    );
    expect(container.textContent).toBe('');
  });

  it('renders the first phrase for working', () => {
    act(() =>
      root.render(
        <TestHarness
          runState={{
            kind: 'working',
            label: 'Working',
            summary: 'Working…',
            completedToolCount: 0,
            runningProcessCount: 0,
            canStop: true,
          }}
        />,
      ),
    );
    expect(container.textContent).toContain('Writing your code');
  });

  it('can transition from idle to working without a Hooks-order error', () => {
    const idle: RunStatusView = {
      kind: 'idle',
      label: 'Idle',
      summary: 'Ready',
      completedToolCount: 0,
      runningProcessCount: 0,
      canStop: false,
    };
    const working: RunStatusView = {
      ...idle,
      kind: 'working',
      label: 'Working',
      summary: 'Working…',
      canStop: true,
    };
    act(() => root.render(<TestHarness runState={idle} />));
    act(() => root.render(<TestHarness runState={working} />));
    expect(container.textContent).toContain('Writing your code');
  });
});
```

- [ ] **Step 2：写 `RunActivitySlot` 失败测试**

Create `apps/desktop/src/RunActivitySlot.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RunActivitySlot } from './RunActivitySlot.js';
import type { RunRecordUi } from './chat-reducer.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function TestHarness(props: { activeRunId: string | null; runRecordsById: Record<string, RunRecordUi> }): ReactElement {
  return <RunActivitySlot activeRunId={props.activeRunId} runRecordsById={props.runRecordsById} locale="en" />;
}

describe('RunActivitySlot', () => {
  let container: HTMLElement;
  let root: Root;
  let previousMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    previousMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.parentNode?.removeChild(container);
    window.matchMedia = previousMatchMedia;
  });

  it('renders a waiting assistant placeholder', () => {
    const runRecordsById: Record<string, RunRecordUi> = {
      'run-1': {
        runId: 'run-1',
        phaseHistory: [{ phase: 'connecting-model', at: Date.now() }],
        startedAt: Date.now(),
        endedAt: null,
      },
    };
    act(() => root.render(<TestHarness activeRunId="run-1" runRecordsById={runRecordsById} />));
    expect(container.querySelector('[data-testid="run-activity-slot"]')).not.toBeNull();
    expect(container.textContent).toContain('Connecting to model…');
  });

  it('renders connecting placeholder when no active run', () => {
    act(() => root.render(<TestHarness activeRunId={null} runRecordsById={{}} />));
    expect(container.querySelector('[data-testid="run-activity-slot"]')).not.toBeNull();
    expect(container.textContent).toContain('Connecting to model…');
  });
});
```

- [ ] **Step 3：运行确认失败**

Run: `pnpm --dir apps/desktop exec vitest run src/RunActivityInline.test.tsx src/RunActivitySlot.test.tsx`
Expected: FAIL。

- [ ] **Step 4：实现 `RunActivityInline.tsx`**

```tsx
import { type ReactElement } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useRunActivityPhrases } from './run-activity-hooks.js';
import { resolveActivityIcon } from './run-activity-icon.js';
import { RunActivityIcon } from './RunActivityIcon.js';
import { runStatusToActivityInput } from './run-activity-mappers.js';
import type { RunStatusView } from './run-status.js';

export type RunActivityInlineProps = {
  runState: RunStatusView;
  locale?: 'zh-CN' | 'en';
};

export function RunActivityInline(props: RunActivityInlineProps): ReactElement | null {
  if (props.runState.kind === 'idle') {
    return null;
  }
  return <RunActivityInlineContent {...props} />;
}

function RunActivityInlineContent(props: RunActivityInlineProps): ReactElement {
  const reduced = useReducedMotion() ?? false;
  const locale = props.locale ?? 'zh-CN';
  const input = runStatusToActivityInput(props.runState, locale);
  const { phrases, currentPhrase } = useRunActivityPhrases(input);
  const iconSource = resolveActivityIcon(input);

  return (
    <span className="run-activity-inline" data-kind={input.kind}>
      <span className="sr-only">{phrases[0] ?? ''}</span>
      <span className="run-activity-inline-icon-wrap" data-kind={input.kind}>
        <RunActivityIcon source={iconSource} className="run-activity-inline-icon" />
      </span>
      <span className="run-activity-inline-label" aria-hidden>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={currentPhrase}
            className="run-activity-inline-phrase"
            initial={reduced ? false : { y: 10, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 1 } : { y: -10, opacity: 0 }}
            transition={
              reduced
                ? { duration: 0 }
                : { duration: 0.25, ease: [0.22, 1, 0.36, 1] }
            }
          >
            {currentPhrase}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
```

- [ ] **Step 5：实现 `RunActivitySlot.tsx`**

```tsx
import { type ReactElement } from 'react';
import { RunActivitySplash } from './RunActivitySplash.js';
import { sessionRunPhaseToActivityKind } from './run-activity-mappers.js';
import { IconAgent } from './shell-icons.js';
import type { RunRecordUi } from './chat-reducer.js';
import type { RunActivityInput } from './run-activity-types.js';

export type RunActivitySlotProps = {
  activeRunId: string | null;
  runRecordsById: Record<string, RunRecordUi>;
  locale?: 'zh-CN' | 'en';
};

export function RunActivitySlot(props: RunActivitySlotProps): ReactElement | null {
  const runRecord = props.activeRunId ? props.runRecordsById[props.activeRunId] : undefined;
  const latestPhase = runRecord?.phaseHistory[runRecord.phaseHistory.length - 1]?.phase;
  const kind = latestPhase ? sessionRunPhaseToActivityKind(latestPhase) : 'connecting-model';
  // Round to nearest second so `input.elapsedMs` is stable across sub-second re-renders
  // (text deltas) and the 15s taking-too-long timer is not constantly reset.
  const elapsedMs =
    typeof runRecord?.startedAt === 'number'
      ? Math.floor((Math.max(0, Date.now() - runRecord.startedAt)) / 1000) * 1000
      : undefined;

  const input: RunActivityInput = {
    kind,
    locale: props.locale ?? 'zh-CN',
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };

  return (
    <article
      className="bubble role-assistant is-streaming"
      data-testid="run-activity-slot"
      {...(props.activeRunId ? { 'data-run-id': props.activeRunId } : {})}
    >
      <header className="bubble-header">
        <span className="bubble-agent-icon" aria-hidden>
          <IconAgent />
        </span>
        <strong className="bubble-role">piwin</strong>
        <span className="stream-dot" aria-label="Streaming" />
      </header>
      <RunActivitySplash input={input} />
    </article>
  );
}
```

- [ ] **Step 6：运行测试通过**

Run: `pnpm --dir apps/desktop exec vitest run src/RunActivityInline.test.tsx src/RunActivitySlot.test.tsx`
Expected: PASS。

- [ ] **Step 7：Commit**

```bash
git add apps/desktop/src/RunActivityInline.tsx apps/desktop/src/RunActivityInline.test.tsx apps/desktop/src/RunActivitySlot.tsx apps/desktop/src/RunActivitySlot.test.tsx
git commit -m "feat(apps/desktop): RunActivityInline and RunActivitySlot components"
```

---

## Task 9：接入现有 UI（ContextBar / TurnWorkDetails / ChatThread / App）并补充样式

**Files:**
- Modify: `apps/desktop/src/context-bar.tsx`
- Modify: `apps/desktop/src/context-bar.test.tsx`
- Modify: `apps/desktop/src/turn-work-details.tsx`
- Modify: `apps/desktop/src/chat-thread.tsx`
- Modify: `apps/desktop/src/chat-thread.test.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/styles/run-activity.css`
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1：修改 `context-bar.tsx`**

Imports 顶部添加：

```tsx
import { RunActivityInline } from './RunActivityInline.js';
```

把这段：

```tsx
        {runState.kind !== 'idle' ? (
          <span className="context-bar-status-label">{runState.label}</span>
        ) : null}
```

替换为：

```tsx
        {runState.kind !== 'idle' ? (
          <RunActivityInline runState={runState} locale={props.locale} />
        ) : null}
```

- [ ] **Step 2：修改 `context-bar.test.tsx` 断言**

`shows stop when primary run can be stopped` 测试中：

把：

```ts
    expect(container.textContent).toContain('Working');
```

改为：

```ts
    expect(container.textContent).toContain('Running read_file');
```

> `createWorkingRunStatus()` 含 `activeToolName: 'read_file'`，`buildBasePhrases` 会优先输出 `Running read_file`。

- [ ] **Step 3：修改 `turn-work-details.tsx`**

Imports 顶部添加：

```tsx
import { RunActivitySplash } from './RunActivitySplash.js';
import { turnPresentationToActivityInput } from './run-activity-mappers.js';
```

把这段：

```tsx
        {presentation.isWaitingForModel ? (
          <div className="turn-waiting-line" data-testid="turn-waiting-line" role="status">
            <span className="turn-shimmer-text">
              {locale === 'zh-CN' ? '正在连接模型…' : 'Connecting to model…'}
            </span>
          </div>
        ) : null}
```

替换为：

```tsx
        {presentation.isWaitingForModel ? (
          <div className="turn-waiting-line" data-testid="turn-waiting-line">
            <RunActivitySplash
              input={turnPresentationToActivityInput(presentation, props.message, locale)}
            />
          </div>
        ) : null}
```

- [ ] **Step 4：修改 `chat-thread.tsx` 类型与渲染**

在 `ChatThreadProps` 中新增：

```ts
  /** Locale used by all run activity components. */
  locale?: 'zh-CN' | 'en';
```

在 `ChatThread` 的 messages map 中，给 `<ChatMessageRow>` 新增：

```tsx
          locale={props.locale}
```

在 `ChatMessageRowProps` 中新增：

```ts
  locale?: 'zh-CN' | 'en';
```

并在其中的 `<TurnWorkDetails>` 调用中新增：

```tsx
            locale={props.locale}
```

并在 `apps/desktop/src/chat-thread.test.tsx` 的现有 `ChatThread render isolation (E1)` suite 中新增以下覆盖（复用该文件已有的 `root`、`container`、`PiwinUiProvider` 与完整 `composerCard` fixture）：

1. `streaming: true`、末条消息为 user、没有 `permissionPrompt` 时，渲染 `[data-testid="run-activity-slot"]`，并传入 `locale="en"` 后断言文本为 `Connecting to model…`。
2. rerender 为末条 assistant streaming message（模拟 `message/start` 已到达）后，slot 不存在。
3. rerender 为 `permissionPrompt` 非 null 或 `streaming: false` 后，slot 不存在。
4. 末条 assistant 在 `isWaitingForModel` 时，通过 `locale="en"` 断言其 `turn-waiting-line` 内显示 `Connecting to model…`，证明 `ChatThread → ChatMessageRow → TurnWorkDetails` 的 locale 透传没有回退为中文。

该测试文件使用 Framer Motion 前，在 suite 的 `beforeEach` 中将 `window.matchMedia` mock 为 `matches: false`；在 `afterEach` 中恢复原值，避免其影响已有渲染隔离测试。

`RunActivitySlot` 保持接收相同的 `props.locale`：

```tsx
      {props.streaming &&
      !props.permissionPrompt &&
      (props.messages.length === 0 || props.messages[props.messages.length - 1].role === 'user') ? (
        <RunActivitySlot
          activeRunId={props.activeRunId ?? null}
          runRecordsById={props.runRecordsById ?? {}}
          locale={props.locale}
        />
      ) : null}
```

并在 `chat-thread.tsx` 顶部 `RunActivitySlot` import：

```tsx
import { RunActivitySlot } from './RunActivitySlot.js';
```

- [ ] **Step 5：修改 `App.tsx` 传 locale 给 `ChatThread`**

找到 `<ChatThread` 调用处（约 1216 行），在 props 中新增：

```tsx
                    locale={desktopLocale}
```

- [ ] **Step 6：创建 `apps/desktop/src/styles/run-activity.css`**

```css
/* Run activity animation component styles.
   Used by RunActivitySplash, RunActivityInline, and RunActivitySlot. */

.run-activity-splash {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.run-activity-splash-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  color: var(--accent);
}

.run-activity-splash-icon {
  width: 22px;
  height: 22px;
}

.run-activity-splash-icon-wrap[data-kind="connecting-model"] .run-activity-splash-icon,
.run-activity-splash-icon-wrap[data-kind="waiting-first-token"] .run-activity-splash-icon,
.run-activity-splash-icon-wrap[data-kind="preparing"] .run-activity-splash-icon {
  animation: run-activity-breathe 1.6s ease-in-out infinite;
}

.run-activity-splash-icon-wrap[data-kind="working"] .run-activity-splash-icon {
  animation: run-activity-spin 2s linear infinite;
}

.run-activity-splash-icon-wrap[data-kind="failed"] .run-activity-splash-icon {
  color: var(--danger);
}

.run-activity-splash-icon-wrap[data-kind="complete"] .run-activity-splash-icon {
  color: var(--ok);
}

.run-activity-splash-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.run-activity-splash-label {
  position: relative;
  height: 1.4em;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.run-activity-splash-phrase {
  display: inline-block;
  white-space: nowrap;
}

.run-activity-inline {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--content-secondary);
}

.run-activity-inline-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--accent);
}

.run-activity-inline-icon {
  width: 14px;
  height: 14px;
}

.run-activity-inline-icon-wrap[data-kind="working"] .run-activity-inline-icon {
  animation: run-activity-spin 2s linear infinite;
}

.run-activity-inline-icon-wrap[data-kind="connecting-model"] .run-activity-inline-icon,
.run-activity-inline-icon-wrap[data-kind="waiting-first-token"] .run-activity-inline-icon,
.run-activity-inline-icon-wrap[data-kind="preparing"] .run-activity-inline-icon {
  animation: run-activity-breathe 1.6s ease-in-out infinite;
}

.run-activity-inline-label {
  position: relative;
  height: 1.3em;
  overflow: hidden;
  font-size: 12px;
}

.run-activity-inline-phrase {
  display: inline-block;
  white-space: nowrap;
}

@keyframes run-activity-breathe {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.12); opacity: 0.8; }
}

@keyframes run-activity-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .run-activity-splash-icon,
  .run-activity-inline-icon {
    animation: none;
  }
}
```

- [ ] **Step 7：把 `run-activity.css` 加入 `styles.css`**

在 `apps/desktop/src/styles.css` 的 `@import './styles/region-transcript.css';` 下一行添加：

```css
@import './styles/run-activity.css';
```

- [ ] **Step 8：类型检查 + 运行相关测试**

Run: `pnpm --filter @piwin/desktop typecheck`
Expected: 通过。

Run: `pnpm --dir apps/desktop exec vitest run src/context-bar.test.tsx src/chat-thread.test.tsx src/RunActivitySlot.test.tsx`
Expected: PASS。

- [ ] **Step 9：Commit**

```bash
git add apps/desktop/src/context-bar.tsx apps/desktop/src/context-bar.test.tsx apps/desktop/src/turn-work-details.tsx apps/desktop/src/chat-thread.tsx apps/desktop/src/chat-thread.test.tsx apps/desktop/src/App.tsx apps/desktop/src/styles/run-activity.css apps/desktop/src/styles.css
git commit -m "feat(apps/desktop): wire RunActivitySplash/Inline/Slot into UI"
```

---

## Task 10：生成图标资产 + 全量测试与类型检查

**Files:**
- Output: `apps/desktop/public/ui/run-state-*.png`
- No code files (except optional script)

- [ ] **Step 1：使用 imagegen MCP 生成图标（批量；服务可用时必须执行）**

每个状态生成一张 128×128 PNG，透明背景。Prompt 模板：

> "A clean, minimalist flat icon for a coding agent in the "[STATE]" state. [DESCRIPTION]. Purple and teal accent colors, simple vector-like style, no text, no shadows, centered, transparent background, 128x128."

状态与描述：

| 状态 | 描述 |
|---|---|
| idle | a calm robot head with a soft glow |
| preparing | a small gear being placed into position |
| connecting-model | a wifi/signal beam connecting to a node |
| waiting-first-token | a lightbulb turning on above a robot head |
| planning | a small map or checklist being sketched |
| working | a robot writing code at a keyboard |
| tool-running | a terminal or command prompt in motion |
| waiting-permission | a shield with a question mark |
| compacting | pages folding into a small cube |
| stopping | a square stop button being pressed |
| stopped | a robot in a resting pose |
| failed | a warning triangle with a broken gear |
| complete | a checkmark badge |

执行（以 `connecting` 为例，其他循环）：

```bash
# 示例：单笔生成，使用 imagegen MCP
# 实际在实现时通过 MCP tool 调用，替换 [STATE] 和 [DESCRIPTION]
```

执行前先发现 imagegen MCP 的实际工具 schema；可用时，必须为 13 个状态各调用一次并保存输出。对每一个写入的文件验证：路径存在、PNG 解码成功、尺寸为 128×128、具有 alpha 通道。仅在 MCP 未配置、调用被拒绝或服务实际失败时才可走 Lucide fallback；记录失败原因，不要为了跳过生成而创建空提交。

保存路径示例：

```
apps/desktop/public/ui/run-state-idle.png
apps/desktop/public/ui/run-state-preparing.png
...
apps/desktop/public/ui/run-state-complete.png
```

- [ ] **Step 2：验证图标资产或确认受阻 fallback**

imagegen 成功时，确认以下 13 个文件全部存在并满足 Step 1 的格式验证：`idle`、`preparing`、`connecting-model`、`waiting-first-token`、`planning`、`working`、`tool-running`、`waiting-permission`、`compacting`、`stopping`、`stopped`、`failed`、`complete`。

只有 imagegen 不可用时，确认 `RunActivityIcon` 的 `onError` 测试已通过，Lucide fallback 可以使无 `public/ui/run-state-*.png` 的 UI 正常可用；在执行记录中保留 MCP 的实际失败原因。

- [ ] **Step 3：运行全量测试**

Run: `pnpm --filter @piwin/desktop test`
Expected: PASS。

- [ ] **Step 4：运行全量类型检查**

Run: `pnpm typecheck`
Expected: 通过。

- [ ] **Step 5：手动烟雾测试（开发环境）**

Run: `pnpm dev:desktop` 或 `pnpm dev:cli --mock` 触发一次对话，观察：
1. 发送后顶部 ContextBar 出现紧凑版 icon + 轮播文案。
2. 助手气泡出现前，聊天流末尾出现占位卡。
3. 助手气泡内 `.turn-waiting-line` 显示完整版动效。
4. 等待超过 15s 文案切换到 "Taking longer than expected…"。
5. macOS 系统 `prefers-reduced-motion` 或浏览器设置减少动效时，轮播停止切换，且状态切换不播放文字的淡入、淡出或位移动画。

- [ ] **Step 6：Commit 生成的图标**

仅当 imagegen 成功生成并验证图标后，单独提交资产：

```bash
git add apps/desktop/public/ui/run-state-*.png
git commit -m "assets(apps/desktop): generated run state icons via imagegen MCP"
```

若 imagegen 不可用且本任务没有其他改动，不创建空提交。

---

## Self-Review

**1. Spec coverage:**
- 文字轮播：Task 2, 5, 7, 8 覆盖。
- icon 设计：Task 3, 4, 8, 10 覆盖。
- 发送后模型未响应动效：Task 8 (Slot) + Task 9 (ChatThread) 覆盖。
- "plan next move" 文案：Task 2 `waiting-first-token` 英文短语首条为 `Planning next moves`，中文为 `规划下一步`。
- 公共组件库：`framer-motion` 与 `lucide-react` 已在 Task 1 引入。
- imagegen MCP：Task 10 明确生成流程，代码中预留 `imgSrc` fallback。
- 效果：`framer-motion` 文字淡入淡出 + icon 呼吸/旋转，15s 切换 taking-too-long。

**2. Placeholder scan:**
- 无 "TBD" / "TODO" / "implement later"。
- 无未给出代码的 "add appropriate error handling"。
- 每个 task 都有失败测试、实现、通过测试、commit。

**3. Type consistency：**
- `RunActivityInput` 类型在所有新文件保持一致。
- `RunStatusView` 增加 `planStep?: string` 后，`runStatusToActivityInput` 消费它。
- `sessionRunPhaseToActivityKind` 返回值统一为 `RunStatusKind`。
- `ResolveActivityIcon` 返回 `ActivityIconSource`，`RunActivityIcon` 渲染它。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-29-agent-status-animation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 每个 Task 派一个独立 subagent，Task 之间我 review 并修正，快速迭代。

**2. Inline Execution** - 在当前 session 用 `superpowers:executing-plans` 批量执行，关键节点 checkpoint 给你确认。

**Which approach?**

---

## 修订记录

- 2026-07-29: 将 `lucide-react` 版本从 `1.27.0` 降至 `1.25.0`（满足发布超过 7 天规则）。
- 2026-07-29: 修复 `context-bar.test.tsx` 断言为 `Running read_file`（与 `createWorkingRunStatus()` 中 `activeToolName: 'read_file'` 一致）。
- 2026-07-29: 修复 `RunActivityIcon.tsx` 中 Lucide 组件 props 的类型兼容性（使用 `ComponentType<LucideProps>`，支持 SVG 的标准属性）。
- 2026-07-29: 修复 `RunActivitySlot` / `turnPresentationToActivityInput` 中 `elapsedMs` 在每次渲染重新计算导致 15s 计时器被频繁重置的问题（按秒取整，保持稳定）。
- 2026-07-29: `RunActivitySlot` 仅在 `activeRunId` 存在时设置 `data-run-id` 属性，避免空字符串。
- 2026-07-29: Hook 测试 mock `useReducedMotion`，组件测试的 `matchMedia` mock 同时提供 legacy listeners 且在测试后恢复，避免依赖真实系统偏好与跨测试污染。
- 2026-07-29: 对齐 connecting-model 资产文件名，补全它的映射断言、`IconAgent` import 与 carousel 在 reduced-motion 下的索引重置。
