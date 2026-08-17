# Knowledge Center Loop Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Desktop Knowledge Center 从「git 项目 + Wiki/闪卡工作台」收成文件夹学习环：选文件夹 → 勾选文件入库 → 生成闪卡 → 结果页 → 用户点开聊天翻卡器。

**Architecture:** 纯函数 `deriveKnowledgeLoop` 是唯一阶段真源。`KnowledgeCenterPanel` 只编排 scan / index / generate / documents / dismiss。新批次复习仍是 `DocCardSequenceView`（Host 在 created>0 时建指针会话；Desktop 不再自动 resume）。到期 FSRS 走已有 `FlashcardsPanel`，先补入口再删 KC 内嵌复习。Host 双流水线、CardStore、Job 队列本轮不改。

**Tech Stack:** TypeScript strict / React 19 / Vitest + happy-dom / 现有 Host IPC（`doccards/*`）/ `@piwin/ui-kit`

**Design:** [`docs/superpowers/specs/2026-08-17-knowledge-center-loop-repair-design.md`](../specs/2026-08-17-knowledge-center-loop-repair-design.md)

**Product locks:** [`docs/notes/2026-08-16-doccards-v2-product-decisions.md`](../../notes/2026-08-16-doccards-v2-product-decisions.md)

## Global Constraints

- 双流水线：Generate **绝不**调用 Index。
- CardStore markdown 是卡片真源。不造第二套卡片库 / 任务队列。
- 展示会话 = `{ sequenceId, cardIds, generationId, workspaceName }`。Desktop **禁止** `session/create` 补开会话。
- 空 topic 省略字段；Host 用 `workspaceName`（文件夹 basename）当 query。禁止把绝对路径当 query。
- 无 STALE。`reindexEnabled` 只看「有文件夹且两边都不是 RUNNING」。
- Generate 门闩只走 `selectedDocumentsReady(selected, documents)`。禁止在状态机里重写 READY。
- `includeFiles` = 非空的已勾选 **supported** `relativePath`。永不 `[]`，永不 unsupported。0 勾选 = 不发命令。
- created=0 → Job `COMPLETED`，不开会话，不是 `role="alert"`。
- Lock 11：Host 仍在 created>0 时建指针会话。Desktop 不再自动 `onOpenSession`。
- 芯片条已不存在。不要再做能力条。未配 embedding 的单颗 pill 可留。
- PR1 **不接线**。PR2 **不是可演示环**（自动跳还在）。PR2 合入后必须立刻做 PR3。
- 「浏览卡片库」按钮 PR5 前恒不画。`KnowledgeLoopView` **不含** `showBrowseLibrary`。
- 禁止在 PR5a 之前删除 `KnowledgeCardsView` 的 FSRS。
- 文件硬顶 1000 行；编排器目标 <400。apps 不 import Pi。
- 新视图 `request` 用 `DoccardsHostRequest`，禁止 `any`。
- 测试：`pnpm --dir apps/desktop test -- src/<file>`
- 提交只包含本任务文件。commit 信息用完整句子。

---

## File map

| 文件 | 任务 | 职责 |
|------|------|------|
| `apps/desktop/src/knowledge/knowledge-loop-state.ts` | 1 | 七态纯派生 |
| `apps/desktop/src/knowledge/knowledge-loop-state.test.ts` | 1 | 表驱动锁优先级与 resultKind |
| `apps/desktop/src/knowledge/knowledge-host-request.ts` | 3 | `DoccardsHostRequest` 类型（无 `open-review-session`） |
| `apps/desktop/src/knowledge/KnowledgeFileChecklist.tsx` | 2 | 受控文件清单 |
| `apps/desktop/src/knowledge/KnowledgeFileChecklist.test.tsx` | 2 | 勾选 / READY 标记 / 不勾 unsupported |
| `apps/desktop/src/knowledge/KnowledgeReadyView.tsx` | 3 | topic + Generate |
| `apps/desktop/src/knowledge/KnowledgeResultView.tsx` | 3 | 结果页，点击才打开会话 |
| `apps/desktop/src/knowledge/KnowledgeLibraryView.tsx` | 7 | 画廊 + 导出，无 FSRS |
| `apps/desktop/src/KnowledgeCenterPanel.tsx` | 2, 3, 4, 7 | 编排器 |
| `apps/desktop/src/KnowledgeCenterPanel.test.tsx` | 3, 4 | 停自动跳；不默认 git 项目 |
| `apps/desktop/src/DocCardsPanel.tsx` | 2 抽出 / 7 删除 | 过渡复用 checklist |
| `apps/desktop/src/App.tsx` | 4, 6 | 忽略 initialSubTab；`handleOpenCardsPanel` |
| `apps/desktop/src/composer-dock.tsx` | 6 | `onOpenCardsPanel` 下传 |
| `apps/desktop/src/composer-plus-menu.tsx` | 6 | Flashcards 改道 |
| `apps/desktop/src/slash/*` | 6 | `/flashcards` → `cards-panel` |
| `apps/desktop/src/right-panel-sections.tsx` | 6 | 可见 Cards 瓷砖 |
| `apps/desktop/src/right-panel-memory.ts` | 6 | `ALLOWED_KINDS` 含 `'cards'` |

本轮 **不做** `doccards/open-review-session`（设计里可选；degraded 结果页只「留在此文件夹」）。

---

### Task 1: 纯阶段状态机（不接线）

**Files:**
- Create: `apps/desktop/src/knowledge/knowledge-loop-state.ts`
- Create: `apps/desktop/src/knowledge/knowledge-loop-state.test.ts`

**Interfaces:**
- Consumes: `selectedDocumentsReady` from `apps/desktop/src/doccards-progress.ts`; `DocumentManifest`, `IngestionJob`, `GenerationJob` from `@piwin/contracts`
- Produces: `deriveKnowledgeLoop(input: KnowledgeLoopInput): KnowledgeLoopView`, `generateDisabledCopy(...)`, types below

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/knowledge/knowledge-loop-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DocumentManifest, GenerationJob, IngestionJob } from '@piwin/contracts';
import {
  deriveKnowledgeLoop,
  generateDisabledCopy,
  type KnowledgeLoopInput,
} from './knowledge-loop-state.js';

function document(relativePath: string, status: DocumentManifest['status'] = 'READY'): DocumentManifest {
  return {
    documentId: relativePath,
    folderKey: 'fk',
    relativePath,
    extension: '.md',
    fileSize: 1,
    fileHash: relativePath,
    status,
  };
}

function indexJob(status: IngestionJob['status']): IngestionJob {
  return {
    id: 'ing_1',
    folderKey: 'fk',
    workspaceName: 'Notes',
    folderPath: '/docs/Notes',
    includeFiles: ['a.md'],
    status,
    totalFiles: 1,
    completedFiles: status === 'COMPLETED' ? 1 : 0,
    failedFiles: 0,
    skippedUnsupported: 0,
    stageCounts: { parsing: 0, chunking: 0, embedding: 0, indexing: 0 },
    warnings: [],
  };
}

function generationJob(
  status: GenerationJob['status'],
  extra: Partial<GenerationJob> = {},
): GenerationJob {
  return {
    id: extra.id ?? 'gen_1',
    folderKey: 'fk',
    folderPath: '/docs/Notes',
    workspaceName: 'Notes',
    includeFiles: ['a.md'],
    status,
    ...extra,
  };
}

function input(overrides: Partial<KnowledgeLoopInput> = {}): KnowledgeLoopInput {
  return {
    folderPath: '/docs/Notes',
    selectedSupported: ['a.md'],
    documents: [document('a.md')],
    indexJob: indexJob('COMPLETED'),
    generationJob: null,
    userView: 'loop',
    dismissedGenerationId: null,
    ...overrides,
  };
}

describe('deriveKnowledgeLoop priority', () => {
  it('1. empty folderPath → pick-folder', () => {
    const view = deriveKnowledgeLoop(input({ folderPath: null, selectedSupported: [], documents: [] }));
    expect(view.stage).toBe('pick-folder');
    expect(view.primary).toBe('pick-folder');
    expect(view.generateEnabled).toBe(false);
    expect(view.generateBlockReason).toBe('no-folder');
    expect(view.indexEnabled).toBe(false);
    expect(view.reindexEnabled).toBe(false);
  });

  it('2. userView library wins over ready jobs', () => {
    const view = deriveKnowledgeLoop(input({ userView: 'library' }));
    expect(view.stage).toBe('library');
    expect(view.primary).toBeNull();
  });

  it('3. ingestion PENDING or RUNNING → indexing (beats generate)', () => {
    const view = deriveKnowledgeLoop(
      input({
        indexJob: indexJob('RUNNING'),
        generationJob: generationJob('RETRIEVING'),
      }),
    );
    expect(view.stage).toBe('indexing');
    expect(view.primary).toBeNull();
    expect(view.generateEnabled).toBe(false);
    expect(view.generateBlockReason).toBe('indexing');
    expect(view.indexEnabled).toBe(false);
    expect(view.reindexEnabled).toBe(false);
  });

  it('4. generation non-terminal → generating', () => {
    const view = deriveKnowledgeLoop(input({ generationJob: generationJob('GENERATING_CARDS') }));
    expect(view.stage).toBe('generating');
    expect(view.generateEnabled).toBe(false);
    expect(view.generateBlockReason).toBe('generating');
    expect(view.reindexEnabled).toBe(false);
  });

  it('5. terminal generation not dismissed → result', () => {
    const view = deriveKnowledgeLoop(
      input({
        generationJob: generationJob('COMPLETED', {
          created: 2,
          createdCardIds: ['c1', 'c2'],
          sessionId: 'sess-1',
        }),
      }),
    );
    expect(view.stage).toBe('result');
    expect(view.resultKind).toBe('created');
    expect(view.primary).toBe('open-review');
    expect(view.showOpenReview).toBe(true);
  });

  it('dismissed generation id returns to ready', () => {
    const view = deriveKnowledgeLoop(
      input({
        generationJob: generationJob('COMPLETED', {
          id: 'gen_9',
          created: 2,
          sessionId: 'sess-1',
        }),
        dismissedGenerationId: 'gen_9',
      }),
    );
    expect(view.stage).toBe('ready');
    expect(view.resultKind).toBe('none');
    expect(view.primary).toBe('generate');
  });

  it('6. selected supported all READY → ready', () => {
    const view = deriveKnowledgeLoop(input());
    expect(view.stage).toBe('ready');
    expect(view.primary).toBe('generate');
    expect(view.generateEnabled).toBe(true);
    expect(view.generateBlockReason).toBeNull();
    expect(view.indexEnabled).toBe(true);
    expect(view.reindexEnabled).toBe(true);
  });

  it('7. folder selected but not ready → select-files', () => {
    const view = deriveKnowledgeLoop(
      input({
        documents: [document('a.md', 'DISCOVERED')],
        indexJob: null,
      }),
    );
    expect(view.stage).toBe('select-files');
    expect(view.primary).toBe('index');
    expect(view.indexEnabled).toBe(true);
    expect(view.generateEnabled).toBe(false);
    expect(view.generateBlockReason).toBe('selected-not-ready');
  });

  it('no supported selected → select-files and cannot index', () => {
    const view = deriveKnowledgeLoop(input({ selectedSupported: [], documents: [] }));
    expect(view.stage).toBe('select-files');
    expect(view.indexEnabled).toBe(false);
    expect(view.generateBlockReason).toBe('no-supported-selected');
  });
});

describe('resultKind', () => {
  it('created=0 is zero, no open-review', () => {
    const view = deriveKnowledgeLoop(
      input({ generationJob: generationJob('COMPLETED', { created: 0, createdCardIds: [] }) }),
    );
    expect(view.stage).toBe('result');
    expect(view.resultKind).toBe('zero');
    expect(view.primary).toBeNull();
    expect(view.showOpenReview).toBe(false);
  });

  it('COMPLETED_DEGRADED with cards is degraded, no auto open-review primary', () => {
    const view = deriveKnowledgeLoop(
      input({
        generationJob: generationJob('COMPLETED_DEGRADED', {
          created: 3,
          createdCardIds: ['a', 'b', 'c'],
        }),
      }),
    );
    expect(view.resultKind).toBe('degraded');
    expect(view.primary).toBeNull();
    expect(view.showOpenReview).toBe(false);
  });

  it('FAILED and CANCELED have no open-review', () => {
    expect(deriveKnowledgeLoop(input({ generationJob: generationJob('FAILED') })).resultKind).toBe(
      'failed',
    );
    expect(deriveKnowledgeLoop(input({ generationJob: generationJob('CANCELED') })).resultKind).toBe(
      'canceled',
    );
    expect(deriveKnowledgeLoop(input({ generationJob: generationJob('FAILED') })).showOpenReview).toBe(
      false,
    );
  });

  it('KnowledgeLoopView has no showBrowseLibrary field', () => {
    const view = deriveKnowledgeLoop(input());
    expect('showBrowseLibrary' in view).toBe(false);
  });
});

describe('generateDisabledCopy', () => {
  it('returns zh and en for each reason', () => {
    expect(generateDisabledCopy('indexing', {}, 'zh-CN')).toBe('正在入库…');
    expect(generateDisabledCopy('indexing', {}, 'en')).toBe('Indexing…');
    expect(generateDisabledCopy('generating', {}, 'zh-CN')).toBe('正在生成闪卡…');
    expect(generateDisabledCopy('no-supported-selected', {}, 'en')).toBe(
      'Select at least one supported file',
    );
    expect(generateDisabledCopy('selected-not-ready', {}, 'zh-CN')).toBe('请先入库所选文件');
    expect(generateDisabledCopy('no-folder', {}, 'zh-CN')).toBe('请先选择文件夹');
    expect(generateDisabledCopy(null, { mineruMissing: true }, 'zh-CN')).toBe(
      'PDF 需要在知识设置里启用 MinerU',
    );
    expect(generateDisabledCopy(null, {}, 'en')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test -- src/knowledge/knowledge-loop-state.test.ts`

Expected: FAIL — cannot find module `./knowledge-loop-state.js`

- [ ] **Step 3: Write minimal implementation**

Create `apps/desktop/src/knowledge/knowledge-loop-state.ts`:

```ts
import type { DocumentManifest, GenerationJob, IngestionJob } from '@piwin/contracts';
import { selectedDocumentsReady } from '../doccards-progress.js';

export type KnowledgeLoopStage =
  | 'pick-folder'
  | 'select-files'
  | 'indexing'
  | 'ready'
  | 'generating'
  | 'result'
  | 'library';

export type GenerateBlockReason =
  | 'no-folder'
  | 'no-supported-selected'
  | 'indexing'
  | 'generating'
  | 'selected-not-ready'
  | null;

export type KnowledgeLoopInput = {
  folderPath: string | null;
  selectedSupported: string[];
  documents: DocumentManifest[];
  indexJob: IngestionJob | null;
  generationJob: GenerationJob | null;
  userView: 'loop' | 'library';
  dismissedGenerationId: string | null;
};

export type KnowledgeLoopView = {
  stage: KnowledgeLoopStage;
  primary: 'pick-folder' | 'index' | 'generate' | 'open-review' | null;
  generateEnabled: boolean;
  generateBlockReason: GenerateBlockReason;
  indexEnabled: boolean;
  reindexEnabled: boolean;
  showOpenReview: boolean;
  resultKind: 'none' | 'created' | 'zero' | 'degraded' | 'failed' | 'canceled';
};

const INDEX_RUNNING: ReadonlySet<IngestionJob['status']> = new Set(['PENDING', 'RUNNING']);
const GENERATION_TERMINAL: ReadonlySet<GenerationJob['status']> = new Set([
  'COMPLETED',
  'COMPLETED_DEGRADED',
  'FAILED',
  'CANCELED',
]);

function isGenerationRunning(job: GenerationJob | null): boolean {
  return Boolean(job) && !GENERATION_TERMINAL.has(job.status);
}

function createdCount(job: GenerationJob): number {
  return job.created ?? job.createdCardIds?.length ?? 0;
}

function resultKindOf(job: GenerationJob): KnowledgeLoopView['resultKind'] {
  if (job.status === 'FAILED') return 'failed';
  if (job.status === 'CANCELED') return 'canceled';
  if (job.status === 'COMPLETED_DEGRADED' && createdCount(job) > 0) return 'degraded';
  if (job.status === 'COMPLETED' && createdCount(job) === 0) return 'zero';
  if (job.status === 'COMPLETED' && createdCount(job) > 0 && job.sessionId) return 'created';
  if (job.status === 'COMPLETED' && createdCount(job) > 0) return 'degraded';
  return 'none';
}

export function deriveKnowledgeLoop(input: KnowledgeLoopInput): KnowledgeLoopView {
  const selectedReady = selectedDocumentsReady(input.selectedSupported, input.documents);
  const hasFolder = Boolean(input.folderPath);
  const indexRunning = Boolean(input.indexJob && INDEX_RUNNING.has(input.indexJob.status));
  const genRunning = isGenerationRunning(input.generationJob);
  const terminalGen =
    input.generationJob &&
    GENERATION_TERMINAL.has(input.generationJob.status) &&
    input.generationJob.id !== input.dismissedGenerationId
      ? input.generationJob
      : null;

  const reindexEnabled = hasFolder && !indexRunning && !genRunning;
  const indexEnabled = hasFolder && !indexRunning && !genRunning && input.selectedSupported.length > 0;

  let generateBlockReason: GenerateBlockReason = null;
  if (!hasFolder) generateBlockReason = 'no-folder';
  else if (input.selectedSupported.length === 0) generateBlockReason = 'no-supported-selected';
  else if (indexRunning) generateBlockReason = 'indexing';
  else if (genRunning) generateBlockReason = 'generating';
  else if (!selectedReady) generateBlockReason = 'selected-not-ready';

  const generateEnabled = generateBlockReason === null;

  if (!hasFolder) {
    return {
      stage: 'pick-folder',
      primary: 'pick-folder',
      generateEnabled,
      generateBlockReason,
      indexEnabled: false,
      reindexEnabled: false,
      showOpenReview: false,
      resultKind: 'none',
    };
  }

  if (input.userView === 'library') {
    return {
      stage: 'library',
      primary: null,
      generateEnabled,
      generateBlockReason,
      indexEnabled,
      reindexEnabled,
      showOpenReview: false,
      resultKind: 'none',
    };
  }

  if (indexRunning) {
    return {
      stage: 'indexing',
      primary: null,
      generateEnabled,
      generateBlockReason,
      indexEnabled: false,
      reindexEnabled: false,
      showOpenReview: false,
      resultKind: 'none',
    };
  }

  if (genRunning) {
    return {
      stage: 'generating',
      primary: null,
      generateEnabled,
      generateBlockReason,
      indexEnabled: false,
      reindexEnabled: false,
      showOpenReview: false,
      resultKind: 'none',
    };
  }

  if (terminalGen) {
    const resultKind = resultKindOf(terminalGen);
    const showOpenReview = resultKind === 'created';
    return {
      stage: 'result',
      primary: showOpenReview ? 'open-review' : null,
      generateEnabled,
      generateBlockReason,
      indexEnabled,
      reindexEnabled,
      showOpenReview,
      resultKind,
    };
  }

  if (selectedReady) {
    return {
      stage: 'ready',
      primary: 'generate',
      generateEnabled,
      generateBlockReason,
      indexEnabled,
      reindexEnabled,
      showOpenReview: false,
      resultKind: 'none',
    };
  }

  return {
    stage: 'select-files',
    primary: indexEnabled ? 'index' : null,
    generateEnabled,
    generateBlockReason,
    indexEnabled,
    reindexEnabled,
    showOpenReview: false,
    resultKind: 'none',
  };
}

const COPY: Record<
  Exclude<GenerateBlockReason, null>,
  { en: string; zh: string }
> = {
  indexing: { en: 'Indexing…', zh: '正在入库…' },
  generating: { en: 'Generating cards…', zh: '正在生成闪卡…' },
  'no-supported-selected': {
    en: 'Select at least one supported file',
    zh: '请至少选择一个支持的文件',
  },
  'selected-not-ready': { en: 'Index the selected files first', zh: '请先入库所选文件' },
  'no-folder': { en: 'Choose a folder first', zh: '请先选择文件夹' },
};

export function generateDisabledCopy(
  reason: GenerateBlockReason,
  extras: { mineruMissing?: boolean },
  locale: 'zh-CN' | 'en',
): string | null {
  if (reason) {
    const pair = COPY[reason];
    return locale === 'zh-CN' ? pair.zh : pair.en;
  }
  if (extras.mineruMissing) {
    return locale === 'zh-CN'
      ? 'PDF 需要在知识设置里启用 MinerU'
      : 'PDF needs MinerU in Knowledge settings';
  }
  return null;
}
```

Do **not** add `showBrowseLibrary`. Do **not** import this from `KnowledgeCenterPanel.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test -- src/knowledge/knowledge-loop-state.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/knowledge/knowledge-loop-state.ts apps/desktop/src/knowledge/knowledge-loop-state.test.ts
git commit -m "$(cat <<'EOF'
test(desktop): add Knowledge Center loop stage deriver

Pure seven-stage deriveKnowledgeLoop with dismissedGenerationId.
Not wired into the overlay yet.
EOF
)"
```

---

### Task 2: 文件清单 + 选中文件 Index（不是可演示环）

**Files:**
- Create: `apps/desktop/src/knowledge/KnowledgeFileChecklist.tsx`
- Create: `apps/desktop/src/knowledge/KnowledgeFileChecklist.test.tsx`
- Modify: `apps/desktop/src/DocCardsPanel.tsx` — replace inline list (~586–660) with the extracted component; keep its own `selectedFiles` state
- Modify: `apps/desktop/src/KnowledgeCenterPanel.tsx` — add `selectedSupported` + `documents` state; scan defaults all supported checked; index/generate send non-empty `includeFiles`; still auto-`onOpenSession`
- Modify: `apps/desktop/src/styles/region-knowledge.css` — checklist rows (reuse `.doc-cards-file-list` classes if cheaper)

**Interfaces:**
- Consumes: `ScannedDocFile`, `ScannedFileV2`, `DocumentManifest`
- Produces: controlled `KnowledgeFileChecklist`; KC `includeFiles` payload = checked supported paths

**Do not** stop auto-jump in this task. Do not switch the panel onto `deriveKnowledgeLoop` stages yet (still use hero vs wiki/cards). After this commit, do not treat main as a finished loop.

- [ ] **Step 1: Write the failing checklist test**

Create `apps/desktop/src/knowledge/KnowledgeFileChecklist.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { KnowledgeFileChecklist } from './KnowledgeFileChecklist.js';
import type { DocumentManifest, ScannedDocFile, ScannedFileV2 } from '@piwin/contracts';

describe('KnowledgeFileChecklist', () => {
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
    container.remove();
  });

  const files: ScannedDocFile[] = [
    { relativePath: 'a.md', sizeBytes: 10, language: 'markdown' },
    { relativePath: 'b.md', sizeBytes: 20, language: 'markdown' },
  ];
  const unsupported: ScannedFileV2[] = [
    {
      relativePath: 'scan.pdf',
      extension: '.pdf',
      sizeBytes: 100,
      support: 'unsupported',
      unsupportedReason: 'MINERU_NOT_CONFIGURED',
    },
  ];
  const documents: DocumentManifest[] = [
    {
      documentId: '1',
      folderKey: 'fk',
      relativePath: 'a.md',
      extension: '.md',
      fileSize: 10,
      fileHash: 'a',
      status: 'READY',
    },
  ];

  it('toggles a supported file and never checks unsupported', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeFileChecklist
            files={files}
            unsupported={unsupported}
            selected={['a.md', 'b.md']}
            documents={documents}
            disabled={false}
            onChange={onChange}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="file-ready-a.md"]')).not.toBeNull();
    expect(container.textContent).toContain('未配置 MinerU');
    const pdfBox = container.querySelector<HTMLInputElement>('input[data-path="scan.pdf"]');
    expect(pdfBox).toBeNull();
    const b = container.querySelector<HTMLInputElement>('input[data-path="b.md"]');
    expect(b?.checked).toBe(true);
    act(() => {
      b?.click();
    });
    expect(onChange).toHaveBeenCalledWith(['a.md']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test -- src/knowledge/KnowledgeFileChecklist.test.tsx`

Expected: FAIL — module not found

- [ ] **Step 3: Implement the controlled checklist**

`KnowledgeFileChecklist` props:

```ts
export type KnowledgeFileChecklistProps = {
  files: ScannedDocFile[];
  unsupported: ScannedFileV2[];
  selected: string[];
  documents: DocumentManifest[];
  disabled: boolean;
  onChange: (nextSelected: string[]) => void;
};
```

Rules:

- Only `files` get checkboxes. `unsupported` is a read-only list with reason copy (`MINERU_NOT_CONFIGURED` → 「未配置 MinerU」 / `UNSTRUCTURED_NOT_CONFIGURED` → 「未配置 Unstructured」 / else 「不支持的格式」).
- READY mark: `documents.find(d => d.relativePath === file.relativePath)?.status === 'READY'` → `data-testid={`file-ready-${relativePath}`}`.
- Toggle calls `onChange` with the new supported-only array. Never insert unsupported paths.
- Include Select all / Deselect all that only touch `files`.
- No free-text path input.
- `data-testid="knowledge-file-checklist"`.

Wire `DocCardsPanel` to render this component instead of the inline `<ul className="doc-cards-file-list">` block. Keep `selectedFiles` in the panel. Do not bring DocCardsPanel's path text field into KC.

- [ ] **Step 4: Wire KC index/generate `includeFiles` (still auto-jump)**

In `KnowledgeCenterPanel.tsx`:

```ts
const [documents, setDocuments] = useState<DocumentManifest[]>([]);
const [selectedSupported, setSelectedSupported] = useState<string[]>([]);
```

On successful `scan-folder`:

```ts
const files = scanData.files ?? [];
setScannedFiles(files);
setUnsupportedFiles(scanData.unsupported ?? []);
setSelectedSupported(files.map((file) => file.relativePath));
```

On `index-status` (initial load **and** every poll tick): persist `statusData.documents ?? []` into `documents`. Do not throw them away after computing `isReady`.

`handleStartIndexing` / `handleStartGeneration`:

```ts
if (selectedSupported.length === 0) {
  setActionError(t('Select at least one supported file', '请至少选择一个支持的文件'));
  return;
}
const includeFiles = selectedSupported;
await props.request({ type: 'doccards/index-folder', folderPath: selectedPath, includeFiles });
// generate:
await runDoccardsGenerate(props.request, { folderPath: selectedPath, includeFiles, ...(topic ? { topic } : {}), onProgress: setGenerationJob });
```

When `!isReady && cards.length === 0`, render `KnowledgeFileChecklist` above / inside the hero (checklist + existing Index CTA). Do not invent a new stage machine render yet.

Keep `if (job.sessionId) props.onOpenSession(job.sessionId)`.

- [ ] **Step 5: Run tests**

Run:

```
pnpm --dir apps/desktop test -- src/knowledge/KnowledgeFileChecklist.test.tsx src/KnowledgeCenterPanel.test.tsx
```

Expected: checklist PASS; existing KC tests still PASS (auto-jump still asserted).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/knowledge/KnowledgeFileChecklist.tsx apps/desktop/src/knowledge/KnowledgeFileChecklist.test.tsx apps/desktop/src/DocCardsPanel.tsx apps/desktop/src/KnowledgeCenterPanel.tsx apps/desktop/src/styles/region-knowledge.css
git commit -m "$(cat <<'EOF'
feat(desktop): index only checked supported files in Knowledge Center

Extract a controlled file checklist and always send a non-empty
includeFiles list. Auto-open review session is unchanged; do not
demo this commit as the finished loop.
EOF
)"
```

---

### Task 3: 停自动跳 + 结果页 + 真正接线状态机

**Files:**
- Create: `apps/desktop/src/knowledge/knowledge-host-request.ts`
- Create: `apps/desktop/src/knowledge/KnowledgeReadyView.tsx`
- Create: `apps/desktop/src/knowledge/KnowledgeReadyView.test.tsx`
- Create: `apps/desktop/src/knowledge/KnowledgeResultView.tsx`
- Create: `apps/desktop/src/knowledge/KnowledgeResultView.test.tsx`
- Modify: `apps/desktop/src/KnowledgeCenterPanel.tsx`
- Modify: `apps/desktop/src/KnowledgeCenterPanel.test.tsx`
- Modify: `apps/desktop/src/knowledge/KnowledgeCardsView.test.tsx` — move the open-session button case to ResultView; keep gallery/FSRS tests

**Interfaces:**
- Consumes: `deriveKnowledgeLoop`, `generateDisabledCopy`, `selectedDocumentsReady`
- Produces: overlay stays open after generate; `onOpenSession` only from Result primary click

This is the first task that **renders** `view.stage`. Hide 「浏览卡片库」. Do **not** add `doccards/open-review-session`.

- [ ] **Step 1: Write failing Result + KC tests**

`KnowledgeResultView.test.tsx` (happy-dom, same root/act harness as CardsView tests):

- `resultKind='created'` + `sessionId` → button `data-testid="open-review-session-btn"`; click calls `onOpenSession(sessionId)`.
- `resultKind='zero'` → no that button; text contains 「没有新卡片」/ “No new cards”; container `role="status"`; **not** `role="alert"`.
- `resultKind='degraded'` → no open button; copy says cards were saved.
- Secondary 「再生成」calls `onGenerateAgain`. 「留在此文件夹」calls `onDismiss`.

Rewrite `KnowledgeCenterPanel.test.tsx` case `opens the review session after generate completes`:

After clicking `generate-cards-btn` (or Ready view's generate):

```ts
expect(onOpenSession).not.toHaveBeenCalled();
expect(container.querySelector('[data-testid="knowledge-result-view"]')).not.toBeNull();
const open = container.querySelector<HTMLButtonElement>('[data-testid="open-review-session-btn"]');
expect(open).not.toBeNull();
await act(async () => {
  open?.click();
});
expect(onOpenSession).toHaveBeenCalledWith('session-review');
```

Add cases in the same file:

1. generate returns `created: 0`, no `sessionId` → `onOpenSession` not called; `knowledge-action-error` absent; `[role="status"]` present.
2. generate returns `COMPLETED_DEGRADED` with `createdCardIds` and no `sessionId` → `onOpenSession` not called; overlay still has `knowledge-center-panel`.
3. mock `generation-status` on mount (folder already has a COMPLETED job) → Result restores without clicking Generate.

Move `offers opening the review session created by generate` from `KnowledgeCardsView.test.tsx` onto ResultView (delete it from CardsView so FSRS removal later does not lose it).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/desktop test -- src/KnowledgeCenterPanel.test.tsx src/knowledge/KnowledgeResultView.test.tsx`

Expected: FAIL — still auto-calls `onOpenSession`; Result view missing.

- [ ] **Step 3: Implement Ready / Result views and rewire the orchestrator**

`knowledge-host-request.ts`:

```ts
import type { HostCommand, HostResponse } from '@piwin/contracts';

export type DoccardsHostRequest = (
  command: Extract<
    HostCommand,
    {
      type:
        | 'doccards/scan-folder'
        | 'doccards/index-folder'
        | 'doccards/index-status'
        | 'doccards/cancel-index'
        | 'doccards/generate'
        | 'doccards/generation-status'
        | 'doccards/cancel-generation'
        | 'doccards/list-by-folder'
        | 'doccards/retrieve'
        | 'doccards/open-source'
        | 'doccards/forget-folder'
        | 'config/get'
        | 'flashcards/rate';
    }
  >,
) => Promise<HostResponse>;
```

Do not include `doccards/open-review-session`.

`KnowledgeReadyView` props: `folderName`, `topic`, `onTopicChange`, `onGenerate`, `generateEnabled`, `disabledReason`, `busy`, `retrievalLine` (string | null). Primary button `data-testid="generate-cards-btn"` label 「生成闪卡」/ “Generate cards”. Topic optional. No library button.

`KnowledgeResultView` props: `resultKind`, `created`, `skipped`, `sessionId`, `error`, `onOpenSession`, `onGenerateAgain`, `onDismiss`. Root `data-testid="knowledge-result-view"`. created=0 uses `role="status"`. Failures use `role="alert"` only for `failed`.

In `KnowledgeCenterPanel`:

```ts
const [dismissedGenerationId, setDismissedGenerationId] = useState<string | null>(null);
const [userView, setUserView] = useState<'loop' | 'library'>('loop');
// userView stays 'loop' until Task 7
```

On mount and whenever `selectedPath` changes:

1. scan + list-by-folder as today
2. `index-status` → set `indexingJob` + **`documents`**
3. `generation-status` → set `generationJob` (may restore Result)
4. **delete** the `notes/list` call from this load path

```ts
const view = deriveKnowledgeLoop({
  folderPath: selectedPath || null,
  selectedSupported,
  documents,
  indexJob: indexingJob,
  generationJob,
  userView,
  dismissedGenerationId,
});
```

Render by `view.stage`:

| stage | UI |
|-------|-----|
| `pick-folder` | existing Hero `empty` |
| `select-files` | checklist + Index (`view.indexEnabled`) |
| `indexing` | progress ring (`ingestionProgress`) + checklist disabled |
| `ready` | `KnowledgeReadyView` |
| `generating` | `generationProgress` ring + Ready form disabled |
| `result` | `KnowledgeResultView` |
| `library` | do not reach (userView locked to `'loop'`) |

**Delete** `if (job.sessionId && props.onOpenSession) props.onOpenSession(job.sessionId)`.

**Delete** the created=0 `setActionError(...)` branch. Result view owns that copy.

`onDismiss` → `setDismissedGenerationId(generationJob.id)`.

Keep Wiki/Cards tab strip for this task if removing it now breaks too many tests; Task 4 removes it. If `view.stage` is ready/result/generating, **do not** show Cards FSRS as the primary body — Ready/Result replace it. Cards view may remain imported but unused until Task 7.

Poll `generation-status` while `view.stage === 'generating'` (already inside `runDoccardsGenerate`); also poll once on folder change as above.

- [ ] **Step 4: Run tests**

Run:

```
pnpm --dir apps/desktop test -- src/knowledge/knowledge-loop-state.test.ts src/knowledge/KnowledgeResultView.test.tsx src/knowledge/KnowledgeReadyView.test.tsx src/KnowledgeCenterPanel.test.tsx src/knowledge/KnowledgeCardsView.test.tsx
```

Expected: PASS. Auto-jump test no longer expects immediate `onOpenSession`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/knowledge/knowledge-host-request.ts apps/desktop/src/knowledge/KnowledgeReadyView.tsx apps/desktop/src/knowledge/KnowledgeReadyView.test.tsx apps/desktop/src/knowledge/KnowledgeResultView.tsx apps/desktop/src/knowledge/KnowledgeResultView.test.tsx apps/desktop/src/KnowledgeCenterPanel.tsx apps/desktop/src/KnowledgeCenterPanel.test.tsx apps/desktop/src/knowledge/KnowledgeCardsView.test.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): Knowledge Center result page instead of auto-opening review

Keep the Host pointer session on created>0, but only resume it when
the user clicks Open review session. Zero-card jobs are status, not errors.
EOF
)"
```

---

### Task 4: IA — 默认文件夹、Wiki 降级、文案

**Files:**
- Modify: `apps/desktop/src/KnowledgeCenterPanel.tsx`
- Modify: `apps/desktop/src/KnowledgeCenterPanel.test.tsx`
- Modify: `apps/desktop/src/knowledge/KnowledgeProjectList.tsx`
- Modify: `apps/desktop/src/knowledge/KnowledgeProjectList.test.tsx`
- Modify: `apps/desktop/src/knowledge/KnowledgeUnindexedHero.tsx`
- Modify: `apps/desktop/src/knowledge/KnowledgeUnindexedHero.test.tsx`
- Modify: `apps/desktop/src/knowledge/KnowledgeWikiView.tsx`
- Modify: `apps/desktop/src/knowledge/KnowledgeWikiView.test.tsx`
- Modify: `apps/desktop/src/App.tsx` — stop using `knowledgeInitialTab` to switch Wiki/Cards (prop may remain for compile)
- Modify: `apps/desktop/src/styles/region-knowledge.css` — remove stage tab strip if still present

**Do not** delete the settings gear or embedding pill. **Do not** retarget `/flashcards` (Task 6).

- [ ] **Step 1: Write failing IA tests**

`KnowledgeCenterPanel.test.tsx`:

- `projectPath="/Users/test/piwin"` + empty `loadRecentFolders` → **no** auto-select: `hero-pick-folder-btn` present; title/kicker uses 「从文件夹学习」or “Learn from folder”; text does **not** assume piwin is selected as the knowledge folder.
- Mock `localStorage` `piwin.doccards.recent_folders` = `["/notes/os"]` → selected folder basename `os`, scan called with that path, **not** `projectPath`.
- No `[data-testid="tab-wiki-btn"]` / `tab-cards-btn`.
- Secondary search control `data-testid="open-folder-search-btn"` opens the retrieve drawer; empty hits copy is 「这个文件夹还没有检索结果。」
- Optional secondary on pick-folder: `data-testid="use-current-project-btn"` only if `projectPath` set; click mounts that path via `saveRecentFolder`.

`KnowledgeProjectList.test.tsx`:

- Props: `folders={['/notes/os']}`, `activeProjectPath="/Users/test/piwin"` **not** in folders → list shows `os` only (no automatic piwin / recent git projects).
- Stats `fileCount: 12, cardCount: 8` → text `12 个文件` / `12 files`, **not** `12 切片`.
- Delete or rewrite 「renders active project and recent projects」 and the leftover footer embedding-button test if the prop is unused (KC does not pass `onConfigureEmbedding` today). Prefer drop the unused prop.

`KnowledgeUnindexedHero.test.tsx`: assert title 「从文件夹学习」/ “Learn from folder”; Index CTA 「入库这些文件」/ “Index these files”; **not** 「构建知识库」.

`KnowledgeWikiView.test.tsx`: `notes={[]}` no longer shows 「项目知识库已就绪」or “All source files have been parsed”. Empty search: 「这个文件夹还没有检索结果。」 Remove the test that requires `notes[0]` as default article, or keep it only if you still pass notes (you should not).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/desktop test -- src/KnowledgeCenterPanel.test.tsx src/knowledge/KnowledgeProjectList.test.tsx src/knowledge/KnowledgeUnindexedHero.test.tsx src/knowledge/KnowledgeWikiView.test.tsx`

Expected: FAIL on default projectPath / 切片 / Wiki empty copy / tab buttons.

- [ ] **Step 3: Implement IA**

Default selection on mount:

```ts
const [selectedPath, setSelectedPath] = useState('');
useEffect(() => {
  const recent = loadRecentFolders();
  setMountedFolders(recent);
  if (recent[0]) setSelectedPath(recent[0]);
}, []);
```

**Delete** `initialSelected = props.projectPath || recentProjects[0]`. **Delete** the effect that sets `selectedPath` when `projectPath` arrives.

`KnowledgeProjectList` props become:

```ts
export type KnowledgeProjectListProps = {
  folders: string[];
  selectedPath: string;
  activeProjectPath: string | null;
  projectStats?: Record<string, { status: 'ready' | 'indexing' | 'unindexed'; fileCount?: number; cardCount?: number }>;
  onSelectProject: (path: string) => void;
  onMountFolder: (path: string) => void;
};
```

List = `folders` only (`loadRecentFolders()`). If `activeProjectPath` is in that list, badge 「当前」. Sidebar title 「文档文件夹」/ “Document folders”. Mount CTA 「添加文档文件夹」.

Hero / kicker copy per design table. Search is a drawer wrapping retrieve-only `KnowledgeWikiView` (drop `notes` prop or ignore it). Delete `notes` state from KC if unused.

Keep single settings gear + unconfigured embedding pill.

- [ ] **Step 4: Run tests**

Run the same four test files plus `src/knowledge/knowledge-loop-state.test.ts`.

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/KnowledgeCenterPanel.tsx apps/desktop/src/KnowledgeCenterPanel.test.tsx apps/desktop/src/knowledge/KnowledgeProjectList.tsx apps/desktop/src/knowledge/KnowledgeProjectList.test.tsx apps/desktop/src/knowledge/KnowledgeUnindexedHero.tsx apps/desktop/src/knowledge/KnowledgeUnindexedHero.test.tsx apps/desktop/src/knowledge/KnowledgeWikiView.tsx apps/desktop/src/knowledge/KnowledgeWikiView.test.tsx apps/desktop/src/App.tsx apps/desktop/src/styles/region-knowledge.css
git commit -m "$(cat <<'EOF'
fix(desktop): Knowledge Center is a folder learning loop, not a repo wiki

Do not auto-select the current git project. Search is a drawer.
Copy talks about files and folders, not slices or a repo wiki.
EOF
)"
```

---

### Task 5: 检索质量一行（小，可并进 Task 4 若文件已开）

Only if Task 4 did not already add it.

**Files:**
- Modify: `apps/desktop/src/knowledge/KnowledgeReadyView.tsx`
- Modify: `apps/desktop/src/knowledge-capabilities.ts` (optional helper)

- [ ] **Step 1: Test**

Ready view with `embeddingConfigured={false}` shows 「检索质量：仅关键词（无向量）」/ “Search quality: keyword-only (no embedding)”. True → 「检索质量：向量 + 全文」/ “Search quality: vector + full-text”. Not a chip strip.

- [ ] **Step 2–4:** implement with existing `knowledgeCapabilityLights` embedding flag; run Ready view tests; commit only if this is a separate commit (`fix(desktop): show one retrieval-quality line on Ready`).

If already in Task 4, skip the extra commit.

---

### Task 6: PR5a — 恢复右栏 Cards 入口并改道 `/flashcards`

**Files:**
- Modify: `apps/desktop/src/right-panel-sections.tsx`
- Modify: `apps/desktop/src/right-panel-memory.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/composer-dock.tsx`
- Modify: `apps/desktop/src/composer-plus-menu.tsx`
- Modify: `apps/desktop/src/composer-plus-menu.test.tsx`
- Modify: `apps/desktop/src/slash/slash-types.ts`
- Modify: `apps/desktop/src/slash/slash-parse.ts`
- Modify: `apps/desktop/src/slash/slash-parse.test.ts`
- Modify: `apps/desktop/src/slash/slash-catalog.ts`
- Modify: `apps/desktop/src/hooks/use-composer-media.ts`
- Test: existing right-panel tests if any (`right-panel-*.test.ts*`); add assertions if missing

**Do not** delete `KnowledgeCardsView` FSRS.

- [ ] **Step 1: Write failing tests**

`slash-parse.test.ts` — change the `/flashcards` and `/cards` expectations:

```ts
expect(parseComposerSlashSubmit('/flashcards', skills)).toEqual({
  kind: 'cards-panel',
  name: 'flashcards',
  args: '',
});
expect(parseComposerSlashSubmit('/cards', skills)).toEqual({
  kind: 'cards-panel',
  name: 'cards',
  args: '',
});
```

`/knowledge` and `/doccards` stay `{ kind: 'knowledge', subTab: 'doccards' }`. `/notes` and `/wiki` stay knowledge (open KC overlay; no wiki tab).

`composer-plus-menu.test.tsx` — add:

```ts
it('routes Flashcards through onOpenCardsPanel, not onOpenKnowledge', () => {
  const onOpenKnowledge = vi.fn();
  const onOpenCardsPanel = vi.fn();
  render(createBaseProps({ submenu: 'knowledge', onOpenKnowledge, onOpenCardsPanel }), root);
  clickItem('plus-menu-open-flashcards');
  expect(onOpenCardsPanel).toHaveBeenCalledTimes(1);
  expect(onOpenKnowledge).not.toHaveBeenCalledWith('cards');
});
```

Update flyout copy assertion: Flashcards label may stay; Wiki item must **not** say `Repo Wiki`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/desktop test -- src/slash/slash-parse.test.ts src/composer-plus-menu.test.tsx`

Expected: FAIL — still `kind: 'knowledge', subTab: 'cards'`.

- [ ] **Step 3: Implement entry retarget**

`slash-types.ts` add:

```ts
| { kind: 'cards-panel'; name: string; args: string }
```

`slash-parse.ts`: `/flashcards` `/cards` return `cards-panel`, not knowledge.

`slash-catalog.ts`: flashcards description → 到期复习 / due-queue review; notes/wiki description → 从文件夹学习 / Learn from folder (open KC). Drop 「Repo Wiki」「打开知识中心」from the flashcards item.

`right-panel-sections.tsx`: visible tile

```ts
{ id: 'cards', icon: <IconCards />, labelEn: 'Flashcards', labelZh: '知识卡片' },
```

Import `IconCards` from `shell-icons`.

`right-panel-memory.ts`:

```ts
const ALLOWED_KINDS: RightPanelTabKind[] = [
  'files',
  'terminal',
  'review',
  'browser',
  'cards',
  'docPreview',
];
```

`App.tsx`:

```ts
const handleOpenCardsPanel = useCallback(() => {
  openRightTab('cards');
}, [/* openRightTab / shell */]);

const handleOpenKnowledge = useCallback(
  (subTab: 'doccards' | 'cards' | 'wiki' = 'doccards') => {
    if (subTab === 'cards') {
      handleOpenCardsPanel();
      return;
    }
    setKnowledgeOpen(true);
  },
  [handleOpenCardsPanel],
);
```

Pass `onOpenCardsPanel={handleOpenCardsPanel}` into composer dock (the object that already gets `onOpenKnowledge` around `App.tsx` ~1455 and ~2206).

`composer-dock.tsx`: new optional `onOpenCardsPanel?: () => void`; pass through to `ComposerPlusMenu` at the existing `onOpenKnowledge={props.onOpenKnowledge}` site (~1173).

`composer-plus-menu.tsx`: Flashcards `onSelect={() => props.onOpenCardsPanel?.()}`; Wiki/Doc Cards still `onOpenKnowledge`. Relabel Wiki to 「从文件夹学习」/ “Learn from folder” (or 「搜索文件夹」). Relabel Doc Cards to the same overlay (“Learn from folder” is fine; one item is enough if you collapse Doc Cards + Wiki into a single “Learn from folder” entry — **prefer two items**: Learn from folder → `onOpenKnowledge()`, Flashcards → `onOpenCardsPanel()`). Dropping the third Repo Wiki item is OK.

`use-composer-media.ts`:

```ts
if (parsed.kind === 'cards-panel') {
  setComposer('');
  clearPendingAttachments();
  args.onOpenCardsPanel?.();
  return;
}
```

Add `onOpenCardsPanel?: () => void` to that hook's args type.

`RightPanel.sectionContent` `case 'cards'` and `cardsContent={<DeferredFlashcardsPanel .../>}` already exist — do not rewrite the panel.

- [ ] **Step 4: Run tests**

Run:

```
pnpm --dir apps/desktop test -- src/slash/slash-parse.test.ts src/composer-plus-menu.test.tsx src/slash/slash-match.ts
```

Also run any `right-panel` tests and `src/hooks/use-composer-media` tests if present.

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/right-panel-sections.tsx apps/desktop/src/right-panel-memory.ts apps/desktop/src/App.tsx apps/desktop/src/composer-dock.tsx apps/desktop/src/composer-plus-menu.tsx apps/desktop/src/composer-plus-menu.test.tsx apps/desktop/src/slash apps/desktop/src/hooks/use-composer-media.ts
git commit -m "$(cat <<'EOF'
feat(desktop): restore Flashcards inspector tile and route /flashcards to it

Plus-menu Flashcards goes App → composer-dock.onOpenCardsPanel →
openRightTab('cards'). Leftover handleOpenKnowledge('cards') redirects
so missed callers cannot reopen in-panel FSRS.
EOF
)"
```

---

### Task 7: 卡片库 + 删内嵌 FSRS + 删孤儿 DocCardsPanel

**Depends on Task 6.** Do not start if `/flashcards` still opens KC.

**Files:**
- Create: `apps/desktop/src/knowledge/KnowledgeLibraryView.tsx`
- Create: `apps/desktop/src/knowledge/KnowledgeLibraryView.test.tsx`
- Modify: `apps/desktop/src/KnowledgeCenterPanel.tsx` — `userView` can become `'library'`; show 「浏览卡片库」when `cards.length > 0 || resultKind !== 'none'`
- Delete FSRS block / or delete `KnowledgeCardsView.tsx` after moving export actions into Library
- Delete: `apps/desktop/src/DocCardsPanel.tsx` (and its tests if any)
- Grep + fix docs that still call `DocCardsPanel` the mounted surface: `docs/specs/doc-flashcards.md`, `docs/plans/2026-08-16-doccards-rag-flashcard-execution-plan.md`, `docs/notes/2026-08-16-doc-flashcards-current-implementation-report.md`

**Interfaces:**
- Library is gallery + export + open-source + send-to-chat + danger Forget. Footer link `onOpenCardsPanel` → 到期复习.
- Orchestrator flag, **not** `deriveKnowledgeLoop` output, decides whether the browse button exists.

- [ ] **Step 1: Write failing library tests**

- Renders fronts from `cards`.
- No `[data-testid="review-mode-btn"]` / `fsrs-review-container`.
- Export buttons still present (reuse `formatDeckMarkdown` / `formatCardsAnkiTsv`).
- Forget confirm then `doccards/forget-folder`.
- 「到期复习」calls `onOpenCardsPanel`.

KC test: after generate result, 「浏览卡片库」appears; click → library; back → result if not dismissed.

- [ ] **Step 2: Run to see fail**

Run: `pnpm --dir apps/desktop test -- src/knowledge/KnowledgeLibraryView.test.tsx`

- [ ] **Step 3: Implement and delete the dual UI**

`KnowledgeLibraryView` takes `cards`, `folderName`, `request: DoccardsHostRequest`, `onBack`, `onOpenCardsPanel`, `onSendToChat`, `onOpenSourceFile`.

Forget: existing `ConfirmDialog` pattern from `DocCardsPanel` (~836–849). Do not invent a new data model.

Remove `KnowledgeCardsView` production imports. Delete `DocCardsPanel.tsx`. Grep:

```
rg -n "DocCardsPanel|KnowledgeCardsView" apps/desktop docs
```

Keep `renderer-resource-boundaries.test.ts` forbidding a static App import of the heavy KC panel; do **not** re-import DocCardsPanel into App.

If `KnowledgeCardsView.test.tsx` only covered FSRS + generate banner, delete or shrink it. Generate banner now lives on Ready.

- [ ] **Step 4: Run desktop knowledge tests**

```
pnpm --dir apps/desktop test -- src/knowledge src/KnowledgeCenterPanel.test.tsx src/slash/slash-parse.test.ts src/composer-plus-menu.test.tsx
pnpm --dir apps/desktop typecheck
```

Expected: PASS. No leftover production import of `DocCardsPanel`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/knowledge apps/desktop/src/KnowledgeCenterPanel.tsx apps/desktop/src/KnowledgeCenterPanel.test.tsx apps/desktop/src/DocCardsPanel.tsx docs/specs/doc-flashcards.md docs/plans/2026-08-16-doccards-rag-flashcard-execution-plan.md docs/notes/2026-08-16-doc-flashcards-current-implementation-report.md
git commit -m "$(cat <<'EOF'
refactor(desktop): folder card library without in-panel FSRS

Scheduled review stays on FlashcardsPanel. Remove the unmounted
DocCardsPanel so two learning UIs cannot ship.
EOF
)"
```

---

## Spec coverage (self-review)

| 设计要求 | 任务 |
|----------|------|
| 七态 + `dismissedGenerationId` + 无 `showBrowseLibrary` | 1 |
| READY 只走 `selectedDocumentsReady` | 1, 3 |
| 文件勾选 + 非空 `includeFiles` | 2 |
| 存 `documents`，poll 两个 status | 2（存）, 3（generation-status 恢复） |
| 结果页，禁止自动 resume；Lock 11 Host 仍建会话 | 3 |
| created=0 = status，不是 alert | 3 |
| 不默认 git 项目；recent = `piwin.doccards.recent_folders` | 4 |
| Wiki 抽屉；切断 `notes/list`；诚实空态 | 4 |
| 文案：从文件夹学习 / 个文件 / 生成闪卡 | 4 |
| 检索质量一行 | 5（或并进 4） |
| `/flashcards` + plus-menu + `composer-dock.onOpenCardsPanel` | 6 |
| 遗留 `handleOpenKnowledge('cards')` 转调 | 6 |
| 库 + 删 FSRS + 删 DocCardsPanel | 7 |
| 不做 `open-review-session` | 刻意：degraded 只留在文件夹 |
| 不做 STALE / 第二 CardStore / 视觉翻卡打磨 | 全局 |

## Out of order warning

- Task 2 单独合 main = 能勾文件，出完卡仍被拽进聊天。必须马上做 Task 3。
- Task 7 早于 Task 6 = `/flashcards` 死链。禁止。
- 不要把 Task 4 和 Task 7 揉成一个大爆炸。
