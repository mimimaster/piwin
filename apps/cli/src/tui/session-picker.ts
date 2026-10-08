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
import { frameOverlay, prefillInput } from './overlay-frame.js';
import type { SessionRow } from './session-list-model.js';
import { style } from './tui-theme.js';

const MAX_VISIBLE_ROWS = 12;

export type SessionPickerActions = {
  onOpen: (sessionId: string) => void;
  onNew: () => void;
  onRename: (sessionId: string, name: string) => void;
  onArchive: (sessionId: string) => void;
  onToggleArchived: () => void;
  onClose: () => void;
};

/**
 * Session switcher overlay. It lists and edits the Host's session index —
 * the same records Desktop's sidebar shows — and owns no session state itself.
 */
export class SessionPicker implements Component, Focusable {
  private readonly input = new Input();
  private rows: SessionRow[] = [];
  private filtered: SessionRow[] = [];
  private selectedIndex = 0;
  private mode: 'browse' | 'rename' = 'browse';
  private showingArchived = false;
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

  public setRows(rows: SessionRow[], showingArchived: boolean, currentSessionId: string | undefined): void {
    const selectedId = this.filtered[this.selectedIndex]?.sessionId;
    this.rows = rows;
    this.showingArchived = showingArchived;
    this.currentSessionId = currentSessionId;
    this.applyFilter(selectedId);
  }

  public invalidate(): void {
    this.input.invalidate();
  }

  public handleInput(data: string): void {
    if (this.mode === 'rename') {
      this.handleRenameInput(data);
      return;
    }
    const selected = this.filtered[this.selectedIndex];
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
        this.actions.onArchive(selected.sessionId);
      } else {
        this.archiveArmedFor = selected.sessionId;
      }
    } else if (matchesKey(data, Key.tab)) {
      this.actions.onToggleArchived();
    } else {
      this.input.handleInput(data);
      this.applyFilter(undefined);
    }
  }

  public render(width: number): string[] {
    const inner = Math.max(4, width - 4);
    const body: string[] = [];
    const prompt = this.mode === 'rename' ? style.yellow('重命名 ') : style.gray('搜索 ');
    body.push(`${prompt}${this.input.render(Math.max(4, inner - visibleWidth(prompt))).join('')}`);
    body.push('');
    if (this.filtered.length === 0) {
      const emptyText = this.showingArchived ? '没有已归档的会话' : '还没有会话';
      body.push(style.gray(this.rows.length === 0 ? emptyText : '没有匹配的会话'));
    }
    const start = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE_ROWS / 2), this.filtered.length - MAX_VISIBLE_ROWS),
    );
    for (let index = start; index < Math.min(this.filtered.length, start + MAX_VISIBLE_ROWS); index += 1) {
      const row = this.filtered[index];
      if (row !== undefined) body.push(this.renderRow(row, index === this.selectedIndex, inner));
    }
    if (this.filtered.length > MAX_VISIBLE_ROWS) {
      body.push(style.gray(`${this.selectedIndex + 1}/${this.filtered.length}`));
    }
    const footer =
      this.mode === 'rename'
        ? 'Enter 确认 · Esc 取消'
        : this.archiveArmedFor !== undefined
          ? `再按 Ctrl+X ${this.showingArchived ? '取消归档' : '归档'}`
          : `Enter 打开 · ^N 新建 · ^R 重命名 · ^X ${this.showingArchived ? '取消归档' : '归档'} · Tab ${this.showingArchived ? '活动' : '已归档'} · Esc`;
    return frameOverlay(this.showingArchived ? '已归档会话' : '会话', body, footer, width);
  }

  private renderRow(row: SessionRow, selected: boolean, inner: number): string {
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
      const selected = this.filtered[this.selectedIndex];
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
    this.applyFilter(this.filtered[this.selectedIndex]?.sessionId);
  }

  private moveSelection(delta: number): void {
    if (this.filtered.length === 0) return;
    this.archiveArmedFor = undefined;
    this.selectedIndex = (this.selectedIndex + delta + this.filtered.length) % this.filtered.length;
  }

  private applyFilter(keepSessionId: string | undefined): void {
    const query = this.mode === 'rename' ? '' : this.input.getValue().trim();
    this.filtered = query.length === 0 ? this.rows : fuzzyFilter(this.rows, query, (row) => row.searchText);
    this.archiveArmedFor = undefined;
    const kept = keepSessionId === undefined ? -1 : this.filtered.findIndex((row) => row.sessionId === keepSessionId);
    this.selectedIndex = kept === -1 ? 0 : kept;
  }
}
