import {
  fuzzyFilter,
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from '@earendil-works/pi-tui';
import type { RemoteProjectSummary } from '@piwin/contracts';
import { frameOverlay, prefillInput } from './overlay-frame.js';
import {
  filterSessionRows,
  flattenSessionGroups,
  groupSessionRows,
  listProjectFilterOptions,
  SESSION_FILTER_ALL,
  type ProjectFilterOption,
  type SessionListEntry,
  type SessionRow,
} from './session-list-model.js';
import { style } from './tui-theme.js';

const MAX_VISIBLE_ROWS = 12;

export type SessionPickerActions = {
  onOpen: (sessionId: string) => void;
  onNew: () => void;
  onRename: (sessionId: string, name: string) => void;
  onArchive: (sessionId: string, archived: boolean) => void;
  onClose: () => void;
};

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Session switcher overlay. It lists and edits the Host's session index —
 * the same records Desktop's sidebar shows — and owns no session state itself.
 * Grouping and project filtering run on the rows already loaded.
 */
export class SessionPicker implements Component, Focusable {
  private readonly input = new Input();
  private rows: SessionRow[] = [];
  private projectOptions: ProjectFilterOption[] = [{ key: SESSION_FILTER_ALL, label: '全部' }];
  private projectKey = SESSION_FILTER_ALL;
  private entries: SessionListEntry[] = [];
  private selectable: SessionRow[] = [];
  private matchedCount = 0;
  private selectedIndex = 0;
  private mode: 'browse' | 'rename' = 'browse';
  private loadState: LoadState = 'loading';
  private errorMessage = '';
  /** Archived group starts collapsed; Tab expands it without another Host read. */
  private archivedExpanded = false;
  private groupedAt = new Date();
  /** Archive needs a second press on the same row. */
  private archiveArmedFor: string | undefined;
  private focusedState = false;

  public constructor(
    private readonly actions: SessionPickerActions,
    private currentSessionId: string | undefined,
  ) {}

  public get focused(): boolean {
    return this.focusedState;
  }

  /** Propagated so the IME candidate window follows the search field's cursor. */
  public set focused(value: boolean) {
    this.focusedState = value;
    this.input.focused = value;
  }

  public setLoading(): void {
    this.loadState = 'loading';
    this.errorMessage = '';
  }

  public setError(message: string): void {
    this.loadState = 'error';
    this.errorMessage = message;
  }

  public setRows(
    rows: SessionRow[],
    currentSessionId: string | undefined,
    projects: readonly RemoteProjectSummary[] = [],
  ): void {
    const selectedId = this.selectable[this.selectedIndex]?.sessionId;
    this.rows = rows;
    this.currentSessionId = currentSessionId;
    this.groupedAt = new Date();
    this.loadState = 'ready';
    this.errorMessage = '';
    this.projectOptions = listProjectFilterOptions(rows, projects);
    if (!this.projectOptions.some((option) => option.key === this.projectKey)) {
      this.projectKey = SESSION_FILTER_ALL;
    }
    this.applyFilter(selectedId, false);
  }

  public invalidate(): void {
    this.input.invalidate();
  }

  public handleInput(data: string): void {
    if (this.loadState !== 'ready') {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) this.actions.onClose();
      else if (this.loadState === 'loading') this.input.handleInput(data);
      return;
    }
    if (this.mode === 'rename') {
      this.handleRenameInput(data);
      return;
    }
    const selected = this.selectable[this.selectedIndex];
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.actions.onClose();
    } else if (matchesKey(data, Key.up)) {
      this.moveSelection(-1);
    } else if (matchesKey(data, Key.down)) {
      this.moveSelection(1);
    } else if (matchesKey(data, Key.enter)) {
      if (selected !== undefined) this.actions.onOpen(selected.sessionId);
    } else if (matchesKey(data, Key.ctrl('n'))) {
      this.actions.onNew();
    } else if (matchesKey(data, Key.ctrl('r'))) {
      if (selected === undefined) return;
      this.mode = 'rename';
      prefillInput(this.input, selected.title);
    } else if (matchesKey(data, Key.ctrl('x'))) {
      if (selected === undefined) return;
      if (this.archiveArmedFor === selected.sessionId) {
        this.archiveArmedFor = undefined;
        this.actions.onArchive(selected.sessionId, selected.archived);
      } else {
        this.archiveArmedFor = selected.sessionId;
      }
    } else if (matchesKey(data, Key.ctrl('p'))) {
      this.cycleProject();
    } else if (matchesKey(data, Key.tab)) {
      this.archivedExpanded = !this.archivedExpanded;
      this.applyFilter(selected?.sessionId);
    } else {
      this.input.handleInput(data);
      this.applyFilter(undefined);
    }
  }

  public render(width: number): string[] {
    const inner = Math.max(4, width - 4);
    const body: string[] = [];
    if (this.loadState === 'loading') {
      body.push(style.gray('加载中…'));
    } else if (this.loadState === 'error') {
      body.push(style.red(`加载失败：${this.errorMessage}`));
    } else {
      const prompt = this.mode === 'rename' ? style.yellow('重命名 ') : style.gray('搜索 ');
      body.push(
        `${prompt}${this.input.render(Math.max(4, inner - visibleWidth(prompt))).join('')}`,
      );
      body.push('');
      body.push(...this.renderList(inner));
    }
    return frameOverlay(this.overlayTitle(), body, this.footer(), width);
  }

  private overlayTitle(): string {
    if (this.loadState !== 'ready') return '会话';
    return `会话 · ${this.currentProjectLabel()}`;
  }

  private currentProjectLabel(): string {
    return this.projectOptions.find((option) => option.key === this.projectKey)?.label ?? '全部';
  }

  private footer(): string {
    if (this.loadState !== 'ready') return 'Esc 关闭';
    if (this.mode === 'rename') return 'Enter 确认 · Esc 取消';
    const selected = this.selectable[this.selectedIndex];
    if (this.archiveArmedFor !== undefined) {
      return `再按 Ctrl+X ${selected?.archived === true ? '取消归档' : '归档'}`;
    }
    const archiveKey = selected?.archived === true ? '取消归档' : '归档';
    const archivedKey = this.archivedExpanded ? '折叠' : '展开归档';
    return `Enter 打开 · ^N 新建 · ^R 重命名 · ^X ${archiveKey} · ^P 项目 · Tab ${archivedKey} · Esc`;
  }

  private renderList(inner: number): string[] {
    if (this.rows.length === 0) return [style.gray('还没有会话')];
    if (this.matchedCount === 0) return [style.gray('没有匹配的会话')];
    const lines: string[] = [];
    const selectedId = this.selectable[this.selectedIndex]?.sessionId;
    const selectedEntry = this.entries.findIndex(
      (entry) => entry.kind === 'row' && entry.row.sessionId === selectedId,
    );
    const anchor = selectedEntry === -1 ? 0 : selectedEntry;
    const start = Math.max(
      0,
      Math.min(anchor - Math.floor(MAX_VISIBLE_ROWS / 2), this.entries.length - MAX_VISIBLE_ROWS),
    );
    const end = Math.min(this.entries.length, start + MAX_VISIBLE_ROWS);
    for (let index = start; index < end; index += 1) {
      const entry = this.entries[index];
      if (entry === undefined) continue;
      lines.push(
        entry.kind === 'header'
          ? this.renderHeader(entry, inner)
          : this.renderRow(entry.row, inner),
      );
    }
    if (this.entries.length > MAX_VISIBLE_ROWS) {
      lines.push(style.gray(`${this.selectedIndex + 1}/${this.selectable.length}`));
    }
    return lines;
  }

  private renderHeader(
    entry: Extract<SessionListEntry, { kind: 'header' }>,
    inner: number,
  ): string {
    const suffix =
      entry.id === 'archived' ? ` · ${entry.count}${entry.collapsed ? ' · 已折叠' : ''}` : '';
    return style.gray(truncateToWidth(`${entry.label}${suffix}`, inner));
  }

  private renderRow(row: SessionRow, inner: number): string {
    const selected = row.sessionId === this.selectable[this.selectedIndex]?.sessionId;
    const marker = row.sessionId === this.currentSessionId ? '●' : row.pinned ? '★' : ' ';
    const meta = [row.agentId, row.scopeLabel, row.updatedLabel].filter(Boolean).join(' · ');
    const metaWidth = Math.min(visibleWidth(meta), Math.floor(inner / 2));
    const titleWidth = Math.max(4, inner - metaWidth - 5);
    const title = truncateToWidth(row.title, titleWidth);
    const gap = ' '.repeat(Math.max(1, titleWidth - visibleWidth(title) + 1));
    const line = `${selected ? '›' : ' '} ${marker} ${title}${gap}${style.gray(truncateToWidth(meta, metaWidth))}`;
    return selected ? style.cyan(line) : line;
  }

  private handleRenameInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.leaveRename();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const selected = this.selectable[this.selectedIndex];
      const name = this.input.getValue().trim();
      this.leaveRename();
      if (selected !== undefined && name.length > 0 && name !== selected.title) {
        this.actions.onRename(selected.sessionId, name);
      }
      return;
    }
    this.input.handleInput(data);
  }

  private leaveRename(): void {
    this.mode = 'browse';
    this.input.setValue('');
    this.applyFilter(this.selectable[this.selectedIndex]?.sessionId);
  }

  private moveSelection(delta: number): void {
    if (this.selectable.length === 0) return;
    this.archiveArmedFor = undefined;
    this.selectedIndex =
      (this.selectedIndex + delta + this.selectable.length) % this.selectable.length;
  }

  private cycleProject(): void {
    const options = this.projectOptions;
    if (options.length < 2) return;
    const index = Math.max(
      0,
      options.findIndex((option) => option.key === this.projectKey),
    );
    const next = options[(index + 1) % options.length];
    if (next === undefined) return;
    this.projectKey = next.key;
    this.applyFilter(this.selectable[this.selectedIndex]?.sessionId);
  }

  private applyFilter(keepSessionId: string | undefined, clearArm = true): void {
    const query = this.mode === 'rename' ? '' : this.input.getValue().trim();
    const projectFiltered = filterSessionRows(this.rows, { projectKey: this.projectKey });
    const matched =
      query.length === 0
        ? projectFiltered
        : fuzzyFilter(projectFiltered, query, (row) => row.searchText);
    this.matchedCount = matched.length;
    // A search has to see archived hits; clearing the query restores the fold.
    const archivedExpanded = this.archivedExpanded || query.length > 0;
    this.entries = flattenSessionGroups(
      groupSessionRows(matched, this.groupedAt),
      archivedExpanded,
    );
    this.selectable = this.entries.flatMap((entry) => (entry.kind === 'row' ? [entry.row] : []));
    // A Host refresh must not cancel a confirm that is still on the same row.
    if (
      clearArm ||
      this.archiveArmedFor === undefined ||
      !this.selectable.some((row) => row.sessionId === this.archiveArmedFor)
    ) {
      this.archiveArmedFor = undefined;
    }
    const kept =
      keepSessionId === undefined
        ? -1
        : this.selectable.findIndex((row) => row.sessionId === keepSessionId);
    this.selectedIndex = kept === -1 ? 0 : kept;
  }
}
