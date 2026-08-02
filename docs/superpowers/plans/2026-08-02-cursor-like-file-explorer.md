# Cursor-like File Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the right-inspector Files tab into a Cursor-like workspace explorer: system UI font + JetBrains Mono for code, per-extension icons, full-height tree (preview via DocPreview), client filter, keyboard nav, and git status decorations — without becoming a full IDE.

**Architecture:** All work stays in `apps/desktop` except optional pure helpers colocated there. Tree still lazy-loads via host `project/list-dir` / `project/read-file`. Git decorations reuse existing `git/status` IPC (same as GitPanel/Changes). File open routes through existing `handleOpenDocument` → `docPreview` tab. Pure tree logic (filter, flatten, keyboard, git map) lives in small testable modules next to the panel.

**Tech Stack:** React 19, TypeScript strict, Vitest + happy-dom, existing `@piwin/contracts` (`ProjectDirEntry`, `GitStatusSnapshot`, `GitChangedFile`), `FileTypeIcon`, CSS semantic tokens (`appearance-tokens.ts`, `region-inspector.css`).

## Global Constraints

- TypeScript strict / `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` stay on.
- No `apps/desktop` imports of `@earendil-works/pi-*`.
- No new contracts/host commands unless a pure desktop approach is impossible (it is possible).
- PRD non-goal: **no Full IDE** — no Monaco, no LSP, no Material Icon Theme package, no virtualized monorepo index in this plan.
- No emoji in chrome UI (SVG only).
- Colocated tests; `pnpm --filter @piwin/desktop test` + `pnpm typecheck` green.
- Prefer minimal diffs; do not drive-by refactor unrelated packages.
- Fonts: UI = system SF Pro stack first; mono = JetBrains Mono (already loaded). Do not add new font CDNs.
- Chinese copy: keep bilingual where the panel already has locale patterns; default English labels OK if matching existing Files panel.

---

## Spec recap (A + B + C)

| Slice | Deliverable |
|-------|-------------|
| **A Visual** | System sans for tree labels; mono for paths/preview; `FileTypeIcon`; Cursor-like row density |
| **B Layout** | Full-height tree; remove 44%/56% split preview; click file → DocPreview via App |
| **C UX** | Filter input; ↑↓←→/Enter keyboard; git status color dots; expand-state memory per project |

---

## File map

| File | Responsibility |
|------|----------------|
| `apps/desktop/src/appearance-tokens.ts` | UI font stack: system first (Cursor-like) |
| `apps/desktop/src/styles/tokens.css` | Fallback `--font-sans` match |
| `apps/desktop/src/file-tree-model.ts` **(new)** | Pure: flatten visible rows, filter, keyboard target, git status map |
| `apps/desktop/src/file-tree-model.test.ts` **(new)** | Unit tests for pure model |
| `apps/desktop/src/file-tree-panel.tsx` | Panel UI: tree-first, filter, keyboard, icons, git dots |
| `apps/desktop/src/file-tree-panel.test.tsx` **(new)** | Component tests (filter, select, open callback) |
| `apps/desktop/src/file-type-icon.tsx` | Optional: `isDirectory` / open-folder hint if needed |
| `apps/desktop/src/styles/region-inspector.css` | Tree density, filter bar, git dots; remove split-preview layout |
| `apps/desktop/src/App.tsx` | Wire `onOpenFile` / `onInsertPath`; pass git request if needed |
| `apps/desktop/index.html` | Comment only if font strategy changes; keep JetBrains Mono link |
| `apps/desktop/e2e/shell.spec.ts` | Smoke: files panel still opens; no hard dependency on split preview |

---

## Task 1: Cursor-like UI font stack (system first)

**Files:**
- Modify: `apps/desktop/src/appearance-tokens.ts`
- Modify: `apps/desktop/src/styles/tokens.css`
- Test: `apps/desktop/src/appearance-tokens.test.ts` (only if font string is asserted; otherwise visual/manual)

**Interfaces:**
- Produces: `SHARED_FONT` / `--font-sans` with system SF Pro first
- Consumes: existing `applyAppearanceToDocument`

- [ ] **Step 1: Update `SHARED_FONT` in `appearance-tokens.ts`**

Replace:

```ts
const SHARED_FONT =
  'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif';
```

With (Cursor workbench order + CJK fallbacks):

```ts
/** UI sans — system first (Cursor uses SF Pro / -apple-system; Inter is optional fallback). */
const SHARED_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Inter, sans-serif';
```

Keep `SHARED_MONO` as-is (JetBrains Mono first).

- [ ] **Step 2: Mirror fallback in `tokens.css`**

```css
--font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', Inter, sans-serif;
```

- [ ] **Step 3: Run appearance tests**

Run: `pnpm --filter @piwin/desktop test src/appearance-tokens.test.ts`
Expected: PASS (variable set unchanged; only values of `--font` / applied font string change)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/appearance-tokens.ts apps/desktop/src/styles/tokens.css
git commit -m "$(cat <<'EOF'
style(desktop): prefer system SF Pro stack for UI fonts

Match Cursor workbench UI font order; keep JetBrains Mono for code.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 2: Pure file-tree model (flatten, filter, keyboard, git map)

**Files:**
- Create: `apps/desktop/src/file-tree-model.ts`
- Create: `apps/desktop/src/file-tree-model.test.ts`

**Interfaces:**
- Produces:
  - `FileTreeNodeState` type (or re-export shape used by panel)
  - `buildGitStatusByPath(files: GitChangedFile[]): Map<string, GitFileStatusCode>`
  - `filterTreeNodes(nodes, query): FileTreeNodeState[]` — case-insensitive substring on `name` / path segments; directories kept if any descendant matches (auto-expand filter mode)
  - `flattenVisibleRows(nodes): FlatTreeRow[]` where `FlatTreeRow = { relativePath, depth, kind, name, expanded?, loading? }`
  - `keyboardMove(rows, selectedPath, key): { nextPath, expandPath?, collapsePath? } | null` for `ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Enter|Home|End`
- Consumes: `GitChangedFile`, `GitFileStatusCode` from `@piwin/contracts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/desktop/src/file-tree-model.test.ts
import { describe, expect, it } from 'vitest';
import type { GitChangedFile } from '@piwin/contracts';
import {
  buildGitStatusByPath,
  filterTreeNodes,
  flattenVisibleRows,
  keyboardMove,
  type FileTreeNodeState,
} from './file-tree-model';

function file(name: string, relativePath: string): FileTreeNodeState {
  return {
    entry: { name, relativePath, kind: 'file' },
    expanded: false,
    loading: false,
    children: [],
    error: null,
  };
}

function dir(
  name: string,
  relativePath: string,
  children: FileTreeNodeState[] | null,
  expanded = false,
): FileTreeNodeState {
  return {
    entry: { name, relativePath, kind: 'directory' },
    expanded,
    loading: false,
    children,
    error: null,
  };
}

describe('buildGitStatusByPath', () => {
  it('maps path → status; last write wins on duplicates', () => {
    const files: GitChangedFile[] = [
      { path: 'src/a.ts', status: 'modified', staged: false, unstaged: true },
      { path: 'src/b.ts', status: 'added', staged: true, unstaged: false },
    ];
    const map = buildGitStatusByPath(files);
    expect(map.get('src/a.ts')).toBe('modified');
    expect(map.get('src/b.ts')).toBe('added');
  });
});

describe('filterTreeNodes', () => {
  const tree = [
    dir('src', 'src', [file('App.tsx', 'src/App.tsx'), file('util.ts', 'src/util.ts')], true),
    file('README.md', 'README.md'),
  ];

  it('returns all when query empty', () => {
    expect(filterTreeNodes(tree, '')).toEqual(tree);
  });

  it('keeps matching files and ancestor dirs', () => {
    const filtered = filterTreeNodes(tree, 'app');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.entry.relativePath).toBe('src');
    expect(filtered[0]?.children?.map((c) => c.entry.name)).toEqual(['App.tsx']);
    expect(filtered[0]?.expanded).toBe(true);
  });
});

describe('flattenVisibleRows', () => {
  it('emits only expanded directory children', () => {
    const tree = [
      dir('src', 'src', [file('a.ts', 'src/a.ts')], true),
      dir('docs', 'docs', [file('x.md', 'docs/x.md')], false),
    ];
    const rows = flattenVisibleRows(tree);
    expect(rows.map((r) => r.relativePath)).toEqual(['src', 'src/a.ts', 'docs']);
  });
});

describe('keyboardMove', () => {
  const rows = [
    { relativePath: 'src', depth: 0, kind: 'directory' as const, name: 'src', expanded: true },
    { relativePath: 'src/a.ts', depth: 1, kind: 'file' as const, name: 'a.ts' },
    { relativePath: 'README.md', depth: 0, kind: 'file' as const, name: 'README.md' },
  ];

  it('ArrowDown moves to next row', () => {
    expect(keyboardMove(rows, 'src', 'ArrowDown')?.nextPath).toBe('src/a.ts');
  });

  it('ArrowUp moves to previous row', () => {
    expect(keyboardMove(rows, 'src/a.ts', 'ArrowUp')?.nextPath).toBe('src');
  });

  it('ArrowLeft on expanded dir requests collapse', () => {
    expect(keyboardMove(rows, 'src', 'ArrowLeft')).toEqual({
      nextPath: 'src',
      collapsePath: 'src',
    });
  });

  it('ArrowRight on collapsed dir requests expand', () => {
    const collapsed = [{ ...rows[0]!, expanded: false }, rows[2]!];
    expect(keyboardMove(collapsed, 'src', 'ArrowRight')).toEqual({
      nextPath: 'src',
      expandPath: 'src',
    });
  });

  it('Enter on file returns activate', () => {
    expect(keyboardMove(rows, 'README.md', 'Enter')).toEqual({
      nextPath: 'README.md',
      activatePath: 'README.md',
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @piwin/desktop test src/file-tree-model.test.ts`
Expected: FAIL module not found / exports missing

- [ ] **Step 3: Implement `file-tree-model.ts`**

```ts
/**
 * Pure helpers for the workspace file tree (filter, flatten, keyboard, git map).
 * No React / DOM / host I/O.
 */
import type { GitChangedFile, GitFileStatusCode, ProjectDirEntry } from '@piwin/contracts';

export type FileTreeNodeState = {
  entry: ProjectDirEntry;
  expanded: boolean;
  loading: boolean;
  children: FileTreeNodeState[] | null;
  error: string | null;
};

export type FlatTreeRow = {
  relativePath: string;
  depth: number;
  kind: 'file' | 'directory';
  name: string;
  expanded?: boolean;
  loading?: boolean;
};

export type KeyboardMoveResult = {
  nextPath: string;
  expandPath?: string;
  collapsePath?: string;
  activatePath?: string;
};

export function buildGitStatusByPath(
  files: readonly GitChangedFile[],
): Map<string, GitFileStatusCode> {
  const map = new Map<string, GitFileStatusCode>();
  for (const file of files) {
    map.set(file.path.replace(/\\/g, '/'), file.status);
    if (file.previousPath) {
      map.set(file.previousPath.replace(/\\/g, '/'), file.status);
    }
  }
  return map;
}

/** Directory status: strongest dirty signal among descendants (for optional folder tint). */
export function gitStatusForPath(
  map: Map<string, GitFileStatusCode>,
  relativePath: string,
  kind: 'file' | 'directory',
): GitFileStatusCode | null {
  const key = relativePath.replace(/\\/g, '/');
  if (kind === 'file') {
    return map.get(key) ?? null;
  }
  // Folder: any changed path under prefix
  const prefix = key === '' ? '' : `${key}/`;
  let found: GitFileStatusCode | null = null;
  for (const [path, status] of map) {
    if (path === key || (prefix && path.startsWith(prefix))) {
      if (status === 'conflicted') return 'conflicted';
      if (status === 'modified' || status === 'added' || status === 'untracked') {
        found = status;
      } else if (!found) {
        found = status;
      }
    }
  }
  return found;
}

export function filterTreeNodes(
  nodes: FileTreeNodeState[],
  query: string,
): FileTreeNodeState[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  function filterNode(node: FileTreeNodeState): FileTreeNodeState | null {
    const nameHit = node.entry.name.toLowerCase().includes(q);
    const pathHit = node.entry.relativePath.toLowerCase().includes(q);
    if (node.entry.kind === 'file') {
      return nameHit || pathHit ? node : null;
    }
    const childSource = node.children ?? [];
    const filteredChildren = childSource
      .map(filterNode)
      .filter((n): n is FileTreeNodeState => n !== null);
    if (nameHit || pathHit || filteredChildren.length > 0) {
      return {
        ...node,
        expanded: true,
        children: node.children === null && filteredChildren.length === 0 ? null : filteredChildren,
      };
    }
    return null;
  }

  return nodes.map(filterNode).filter((n): n is FileTreeNodeState => n !== null);
}

export function flattenVisibleRows(
  nodes: FileTreeNodeState[],
  depth = 0,
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  for (const node of nodes) {
    rows.push({
      relativePath: node.entry.relativePath,
      depth,
      kind: node.entry.kind,
      name: node.entry.name,
      ...(node.entry.kind === 'directory'
        ? { expanded: node.expanded, loading: node.loading }
        : {}),
    });
    if (node.entry.kind === 'directory' && node.expanded && node.children) {
      rows.push(...flattenVisibleRows(node.children, depth + 1));
    }
  }
  return rows;
}

export function keyboardMove(
  rows: readonly FlatTreeRow[],
  selectedPath: string | null,
  key: string,
): KeyboardMoveResult | null {
  if (rows.length === 0) return null;
  const index = selectedPath
    ? rows.findIndex((r) => r.relativePath === selectedPath)
    : -1;

  if (key === 'Home') {
    const first = rows[0];
    return first ? { nextPath: first.relativePath } : null;
  }
  if (key === 'End') {
    const last = rows[rows.length - 1];
    return last ? { nextPath: last.relativePath } : null;
  }

  if (key === 'ArrowDown') {
    const next = rows[Math.min(index + 1, rows.length - 1)] ?? rows[0];
    return next ? { nextPath: next.relativePath } : null;
  }
  if (key === 'ArrowUp') {
    const next = rows[Math.max(index - 1, 0)] ?? rows[0];
    return next ? { nextPath: next.relativePath } : null;
  }

  const current = index >= 0 ? rows[index] : null;
  if (!current) {
    const first = rows[0];
    return first ? { nextPath: first.relativePath } : null;
  }

  if (key === 'ArrowRight') {
    if (current.kind === 'directory' && !current.expanded) {
      return { nextPath: current.relativePath, expandPath: current.relativePath };
    }
    const next = rows[index + 1];
    return next ? { nextPath: next.relativePath } : { nextPath: current.relativePath };
  }

  if (key === 'ArrowLeft') {
    if (current.kind === 'directory' && current.expanded) {
      return { nextPath: current.relativePath, collapsePath: current.relativePath };
    }
    // Move to parent: nearest previous row with smaller depth
    for (let i = index - 1; i >= 0; i--) {
      const row = rows[i];
      if (row && row.depth < current.depth) {
        return { nextPath: row.relativePath };
      }
    }
    return { nextPath: current.relativePath };
  }

  if (key === 'Enter') {
    if (current.kind === 'directory') {
      return current.expanded
        ? { nextPath: current.relativePath, collapsePath: current.relativePath }
        : { nextPath: current.relativePath, expandPath: current.relativePath };
    }
    return { nextPath: current.relativePath, activatePath: current.relativePath };
  }

  return null;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @piwin/desktop test src/file-tree-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/file-tree-model.ts apps/desktop/src/file-tree-model.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): pure file-tree model for filter, flatten, keyboard, git map

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 3: Tree-first layout + FileTypeIcon + open via DocPreview

**Files:**
- Modify: `apps/desktop/src/file-tree-panel.tsx`
- Modify: `apps/desktop/src/App.tsx` (wire `onOpenFile`)
- Modify: `apps/desktop/src/styles/region-inspector.css` (remove split; tree full height)
- Create: `apps/desktop/src/file-tree-panel.test.tsx`

**Interfaces:**
- Consumes: `FileTypeIcon` from `./file-type-icon`; model types from `./file-tree-model`
- Produces: `FileTreePanelProps` extended:

```ts
export type FileTreePanelProps = {
  projectPath: string | null;
  request: (command: FileTreeRequest) => Promise<HostResponse>;
  onInsertPath?: (absolutePath: string, relativePath: string) => void;
  /** Open file in DocPreview (App handleOpenDocument). */
  onOpenFile?: (absolutePath: string, relativePath: string) => void;
  locale?: 'zh-CN' | 'en';
};
```

- Remove embedded split preview UI (`file-tree-panel-split`, `file-tree-preview*`) from panel render.
- File click: call `onOpenFile?.(absolute, relative)` (and still set local `selectedPath` for highlight).
- Directory click: toggle expand (unchanged).
- Icons: `<FileTypeIcon filePathOrExt={isDir ? `${name}/` : name} />` (existing resolver treats trailing `/` as folder).

- [ ] **Step 1: Write component test (open callback, no split preview)**

```tsx
// apps/desktop/src/file-tree-panel.test.tsx
// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FileTreePanel } from './file-tree-panel';
import type { HostResponse } from '@piwin/contracts';

function okList(entries: Array<{ name: string; relativePath: string; kind: 'file' | 'directory' }>): HostResponse {
  return {
    success: true,
    id: '1',
    command: 'project/list-dir',
    data: { projectPath: '/proj', relativePath: '', entries },
  };
}

describe('FileTreePanel', () => {
  it('renders full-height tree without split preview and opens file via callback', async () => {
    const onOpenFile = vi.fn();
    const request = vi.fn(async (cmd: { type: string; relativePath?: string }) => {
      if (cmd.type === 'project/list-dir') {
        return okList([
          { name: 'README.md', relativePath: 'README.md', kind: 'file' },
          { name: 'src', relativePath: 'src', kind: 'directory' },
        ]);
      }
      return { success: false, id: '1', command: cmd.type, error: 'unexpected' };
    });

    const { container } = render(
      <FileTreePanel
        projectPath="/proj"
        request={request as never}
        onOpenFile={onOpenFile}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy();
    });

    expect(container.querySelector('.file-tree-panel-split')).toBeNull();
    expect(container.querySelector('[data-testid="file-tree-preview"]')).toBeNull();

    fireEvent.click(screen.getByText('README.md'));
    expect(onOpenFile).toHaveBeenCalledWith('/proj/README.md', 'README.md');
  });
});
```

Adjust `HostResponse` shape if the project's type requires extra fields — mirror patterns from other desktop tests (`host-client-mock` / existing panel tests).

- [ ] **Step 2: Run test — expect FAIL** (still has split / no onOpenFile)

Run: `pnpm --filter @piwin/desktop test src/file-tree-panel.test.tsx`
Expected: FAIL

- [ ] **Step 3: Refactor `FileTreePanel`**

Key changes (implement fully in file):

1. Import `FileTypeIcon` instead of generic `IconFile`/`IconFolder` for row icons.
2. Add `onOpenFile` prop; on file click call it with absolute + relative path.
3. Remove `preview` / `previewLoading` / `previewError` state and the entire `file-tree-preview` block.
4. Root class: `file-tree-panel` only (drop `file-tree-panel-split`).
5. Keep drag + Insert path footer action if useful: optional context — at minimum keep drag-to-composer.
6. Use `FileTreeNodeState` from `file-tree-model` (or keep local type identical and re-export).

Pseudo for node icon:

```tsx
<span className="file-tree-icon" aria-hidden>
  <FileTypeIcon
    filePathOrExt={isDir ? `${node.entry.name}/` : node.entry.name}
  />
</span>
```

- [ ] **Step 4: Wire App.tsx**

```tsx
<FileTreePanel
  projectPath={state.projectPath}
  request={(command) => hostClient.request(command)}
  onInsertPath={(absolutePath) => {
    setComposer((current) =>
      current.trim().length > 0
        ? `${current.replace(/\s+$/, '')}\n${absolutePath}`
        : absolutePath,
    );
  }}
  onOpenFile={(absolutePath, relativePath) => {
    handleOpenDocument({
      title: relativePath.split(/[\\/]/).pop() || relativePath,
      path: absolutePath,
    });
  }}
  locale={desktopLocale}
/>
```

Note: `handleOpenDocument` already loads via `project/read-file` when path is absolute under project — verify absolute path works with existing logic (it strips project prefix when `cleanPath.startsWith(state.projectPath)`). Prefer passing **absolute** path as today for drag MIME consistency.

- [ ] **Step 5: CSS — full height tree**

In `region-inspector.css`:

- Delete or stop using `.file-tree-panel-split` grid rows.
- `.file-tree-panel` / `.file-tree-main`: `flex: 1; min-height: 0; height: 100%; display: flex; flex-direction: column;`
- `.file-tree-list`: `flex: 1; overflow: auto;`
- Row typography:

```css
.file-tree-row {
  height: 24px;
  border-radius: 4px;
  font-family: var(--font-sans, var(--font));
  font-size: 12px;
  color: var(--text);
  /* ... keep flex layout */
}
.file-tree-row .file-tree-name {
  font-family: inherit;
}
```

Keep mono only for optional path footer / binary meta if any remain.

- [ ] **Step 6: Run unit tests**

Run: `pnpm --filter @piwin/desktop test src/file-tree-panel.test.tsx src/file-tree-model.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/file-tree-panel.tsx apps/desktop/src/file-tree-panel.test.tsx apps/desktop/src/App.tsx apps/desktop/src/styles/region-inspector.css
git commit -m "$(cat <<'EOF'
feat(desktop): tree-first Files panel with type icons and DocPreview open

Remove split text preview; open files via existing document inspector.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 4: Filter input (client-side)

**Files:**
- Modify: `apps/desktop/src/file-tree-panel.tsx`
- Modify: `apps/desktop/src/styles/region-inspector.css`
- Modify: `apps/desktop/src/file-tree-panel.test.tsx`

**Interfaces:**
- Consumes: `filterTreeNodes` from `file-tree-model`
- Local state: `filterQuery: string`
- Display tree = `filterTreeNodes(rootNodes, filterQuery)` when query non-empty; note: filter only sees **already loaded** children (lazy tree). Document in UI placeholder: "Filter loaded files…" / 中文「筛选已加载文件…」
- When filter active, do not mutate expand state on disk; filter helper forces expanded on matching ancestors for display only (returns new tree).

- [ ] **Step 1: Extend test**

```tsx
it('filters visible names by query', async () => {
  // same mock with README.md + src
  // type "readme" into [data-testid="file-tree-filter"]
  // expect README visible, src not
});
```

- [ ] **Step 2: Implement filter UI under header**

```tsx
<input
  data-testid="file-tree-filter"
  className="file-tree-filter"
  type="search"
  value={filterQuery}
  onChange={(e) => setFilterQuery(e.target.value)}
  placeholder={locale === 'zh-CN' ? '筛选已加载文件…' : 'Filter loaded files…'}
  aria-label={locale === 'zh-CN' ? '筛选文件' : 'Filter files'}
/>
```

Render list from `const displayNodes = filterTreeNodes(rootNodes, filterQuery)`.

- [ ] **Step 3: CSS for filter**

```css
.file-tree-filter {
  width: 100%;
  height: 28px;
  margin: 0 10px 8px;
  padding: 0 8px;
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: var(--panel2, var(--control));
  color: var(--text);
  font-family: var(--font-sans, var(--font));
  font-size: 12px;
}
.file-tree-filter:focus {
  outline: none;
  border-color: var(--border-interactive, var(--accent));
  box-shadow: 0 0 0 2px var(--focus-ring, var(--accent-ring));
}
```

Header layout: keep title + refresh; filter full width below.

- [ ] **Step 4: Tests pass + commit**

```bash
git add apps/desktop/src/file-tree-panel.tsx apps/desktop/src/file-tree-panel.test.tsx apps/desktop/src/styles/region-inspector.css
git commit -m "$(cat <<'EOF'
feat(desktop): client-side filter for workspace file tree

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 5: Keyboard navigation

**Files:**
- Modify: `apps/desktop/src/file-tree-panel.tsx`
- Modify: `apps/desktop/src/file-tree-panel.test.tsx`
- Modify: `apps/desktop/src/styles/region-inspector.css` (focus-visible ring on selected row)

**Interfaces:**
- Consumes: `flattenVisibleRows`, `keyboardMove`
- Tree container: `tabIndex={0}`, `onKeyDown`, `role="tree"`, `aria-activedescendant` optional
- Selected path state drives highlight; keyboard updates selection and expand/collapse/activate

- [ ] **Step 1: Test keyboard down + enter**

```tsx
it('ArrowDown then Enter opens file', async () => {
  // load tree with two files
  // focus [data-testid="file-tree-list"] or panel
  // fireEvent.keyDown(..., { key: 'ArrowDown' })
  // fireEvent.keyDown(..., { key: 'Enter' })
  // expect onOpenFile called
});
```

- [ ] **Step 2: Implement handler**

```tsx
const displayNodes = filterTreeNodes(rootNodes, filterQuery);
const visibleRows = flattenVisibleRows(displayNodes);

function handleTreeKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
  const result = keyboardMove(visibleRows, selectedPath, event.key);
  if (!result) return;
  event.preventDefault();
  setSelectedPath(result.nextPath);
  if (result.expandPath) void handleToggle(result.expandPath); // ensure expand path
  if (result.collapsePath) void handleToggle(result.collapsePath);
  if (result.activatePath) {
    const abs = absoluteFor(result.activatePath);
    props.onOpenFile?.(abs, result.activatePath);
  }
}
```

**Toggle semantics:** existing `handleToggle` flips expand. For keyboard, `keyboardMove` already decides expand vs collapse; if `handleToggle` only flips, calling it when already expanded for `expandPath` is wrong.

Fix: add `setExpanded(relativePath: string, expanded: boolean)` in panel that:

- if expanding and children null → load then expand
- if collapsing → set expanded false
- if expanding and children loaded → set expanded true

Refactor `toggleNode` into `updateNodeExpanded(nodes, path, nextExpanded)` used by click and keyboard.

- [ ] **Step 3: Focus styles**

```css
.file-tree-list:focus {
  outline: none;
}
.file-tree-list:focus-visible {
  box-shadow: inset 0 0 0 1px var(--focus-ring, var(--accent-ring));
}
.file-tree-node.selected > .file-tree-row {
  background: var(--hover);
  color: var(--text);
}
```

- [ ] **Step 4: Tests + commit**

```bash
git add apps/desktop/src/file-tree-panel.tsx apps/desktop/src/file-tree-panel.test.tsx apps/desktop/src/styles/region-inspector.css
git commit -m "$(cat <<'EOF'
feat(desktop): keyboard navigation for workspace file tree

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 6: Git status decorations

**Files:**
- Modify: `apps/desktop/src/file-tree-panel.tsx`
- Modify: `apps/desktop/src/file-tree-panel.test.tsx`
- Modify: `apps/desktop/src/styles/region-inspector.css`
- Modify: `apps/desktop/src/App.tsx` only if request union needs `git/status` (prefer extending panel `request` type)

**Interfaces:**
- Extend `FileTreeRequest`:

```ts
export type FileTreeRequest =
  | { type: 'project/list-dir'; projectPath: string; relativePath?: string }
  | { type: 'project/read-file'; projectPath: string; relativePath: string; maxBytes?: number }
  | { type: 'git/status'; projectPath: string };
```

- On projectPath set / Refresh: also `git/status` (ignore failure if not a repo).
- Map via `buildGitStatusByPath` + `gitStatusForPath`.
- UI: trailing status letter or dot:

| status | class | glyph |
|--------|-------|-------|
| modified | `file-tree-git--modified` | M |
| added | `file-tree-git--added` | A |
| untracked | `file-tree-git--untracked` | U |
| deleted | `file-tree-git--deleted` | D |
| conflicted | `file-tree-git--conflicted` | C |
| renamed/copied | `file-tree-git--renamed` | R |

Colors: use existing `--add-text` / `--del-text` / muted yellow for modified if tokens exist; else:

```css
.file-tree-git--modified { color: #e2b340; }
.file-tree-git--added, .file-tree-git--untracked { color: var(--ok, #3ecf8e); }
.file-tree-git--deleted, .file-tree-git--conflicted { color: var(--danger, #eb3946); }
```

Optional: tint folder name when any descendant dirty (via `gitStatusForPath`).

Refresh button reloads root **and** git status.

- [ ] **Step 1: Test mock git/status**

```tsx
it('shows M badge for modified file', async () => {
  request mock:
    list-dir → a.ts
    git/status → { snapshot: { changedFiles: [{ path: 'a.ts', status: 'modified', staged: false, unstaged: true }], ... } }
  expect(screen.getByTestId('file-tree-git-a.ts')).toHaveTextContent('M');
});
```

- [ ] **Step 2: Implement load + badge in row**

```tsx
<span
  className={`file-tree-git file-tree-git--${status}`}
  data-testid={`file-tree-git-${node.entry.relativePath}`}
  title={status}
>
  {letter}
</span>
```

- [ ] **Step 3: Debounce optional** — not required; load on mount + refresh is enough. No file watcher in this plan.

- [ ] **Step 4: Tests + commit**

```bash
git add apps/desktop/src/file-tree-panel.tsx apps/desktop/src/file-tree-panel.test.tsx apps/desktop/src/styles/region-inspector.css
git commit -m "$(cat <<'EOF'
feat(desktop): git status decorations on workspace file tree

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 7: Expand-state memory per project

**Files:**
- Create: `apps/desktop/src/file-tree-expand-memory.ts`
- Create: `apps/desktop/src/file-tree-expand-memory.test.ts`
- Modify: `apps/desktop/src/file-tree-panel.tsx`

**Interfaces:**

```ts
const STORAGE_KEY = 'piwin.fileTree.expanded.v1';

export function loadExpandedPaths(projectPath: string): Set<string>;
export function saveExpandedPaths(projectPath: string, paths: Iterable<string>): void;
```

- Storage: `localStorage` JSON `{ [projectPath]: string[] }` capped to e.g. 200 paths.
- On expand/collapse success, persist set of expanded relative paths.
- On root load complete, re-expand remembered paths **depth-first** (load children as needed) — careful of infinite loops; only paths that still exist.

- [ ] **Step 1: Unit tests for memory helpers** (mock localStorage in happy-dom)

```ts
it('round-trips expanded paths per project', () => {
  saveExpandedPaths('/a', ['src', 'src/components']);
  expect([...loadExpandedPaths('/a')].sort()).toEqual(['src', 'src/components']);
  expect(loadExpandedPaths('/b').size).toBe(0);
});
```

- [ ] **Step 2: Integrate restore after `reloadRoot`**

After setting root nodes, if memory non-empty, async walk:

```ts
async function restoreExpanded(nodes, paths: Set<string>): Promise<FileTreeNodeState[]>
```

For each node where `paths.has(relativePath)` and kind directory: load children if needed, set expanded true, recurse.

- [ ] **Step 3: On toggle, update memory**

```ts
function collectExpanded(nodes: FileTreeNodeState[]): string[] { ... }
// after each setRootNodes that changes expand, saveExpandedPaths(projectPath, collectExpanded(next))
```

- [ ] **Step 4: Tests + commit**

```bash
git add apps/desktop/src/file-tree-expand-memory.ts apps/desktop/src/file-tree-expand-memory.test.ts apps/desktop/src/file-tree-panel.tsx
git commit -m "$(cat <<'EOF'
feat(desktop): persist file tree expand state per project

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Task 8: Visual polish pass + e2e smoke

**Files:**
- Modify: `apps/desktop/src/styles/region-inspector.css`
- Modify: `apps/desktop/e2e/shell.spec.ts` only if selectors break
- Optional: `apps/desktop/src/file-type-icon.tsx` — ensure `name/` folder detection works for extensionless files that are files (only treat as folder when `kind === 'directory'` path uses trailing slash from caller — already planned)

**Checklist:**

| Item | Target |
|------|--------|
| Row height | 22–24px |
| Indent | 12–14px per depth |
| Twistie | 12px chevron, muted |
| Icon | 14–16px FileTypeIcon |
| Selection | soft `--hover` fill, not loud accent bar |
| Header | compact; kicker optional |
| Empty / no workspace | existing EmptyState |
| Binary open | DocPreview may show binary message via read-file — acceptable |

- [ ] **Step 1: Manual smoke (or e2e)**

Run: `pnpm --filter @piwin/desktop test`
Run: `pnpm typecheck`
Optional e2e: `pnpm --filter @piwin/desktop e2e e2e/shell.spec.ts` (if env ready)

- [ ] **Step 2: Fix e2e if `file-tree-preview` was asserted** — grep e2e for `file-tree-preview`; remove or replace with `file-tree-panel` + filter.

- [ ] **Step 3: Final commit if CSS-only leftovers**

```bash
git add apps/desktop/src/styles/region-inspector.css apps/desktop/e2e/shell.spec.ts
git commit -m "$(cat <<'EOF'
style(desktop): polish file tree density to match Cursor explorer

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

## Out of scope (explicit)

- Monaco / CodeMirror editor in inspector
- Full-repo search index / `rg` host command
- File watchers / live tree updates
- Material Icon Theme / vscode-icons package
- Drag-reorder, multi-select, delete/rename in tree
- Virtualization (`react-window`)
- Changing `project/list-dir` contract

---

## Self-review

| Spec item | Task |
|-----------|------|
| System UI font + JetBrains Mono | Task 1 |
| FileTypeIcon on rows | Task 3 |
| Full-height tree, no split preview | Task 3 |
| Open via DocPreview | Task 3 + App wire |
| Filter | Task 4 |
| Keyboard | Task 5 |
| Git decorations | Task 6 |
| Expand memory | Task 7 |
| Density polish | Task 8 |
| No Full IDE | Out of scope |
| No contracts change | All tasks desktop-only |

**Placeholder scan:** none intentional.  
**Type consistency:** `FileTreeNodeState` / `FlatTreeRow` / `KeyboardMoveResult` defined in Task 2 and consumed in 3–7; `FileTreeRequest` gains `git/status` in Task 6.

---

## Verification commands (every task)

```bash
pnpm --filter @piwin/desktop test src/file-tree-model.test.ts src/file-tree-panel.test.tsx src/file-tree-expand-memory.test.ts
pnpm typecheck
```

Manual: open workspace → Inspector Files → expand dirs → filter → keyboard → click file opens Document tab → git dirty files show M/A/U.
