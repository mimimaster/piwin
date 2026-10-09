import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from '@earendil-works/pi-tui';
import type { SessionSearchHit, SessionSearchResult } from '@piwin/contracts';
import { frameOverlay, prefillInput } from './overlay-frame.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import { style } from './tui-theme.js';

const MAX_VISIBLE = 12;
const SEARCH_LIMIT = 30;

export type TuiSessionSearchOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  onOpen: (sessionId: string, messageId?: string) => void;
  onError: (error: unknown) => void;
  requestRender: () => void;
};

/**
 * Cross-session search overlay. Hits come from Host `session/search` — the
 * same command `piwin session search` uses — so Desktop and CLI stay aligned.
 */
export class TuiSessionSearch {
  public constructor(private readonly options: TuiSessionSearchOptions) {}

  public async open(initialQuery = ''): Promise<void> {
    const view = new SessionSearchView({
      initialQuery,
      onClose: () => this.options.modals.close(),
      onOpen: (sessionId, messageId) => {
        this.options.modals.close();
        this.options.onOpen(sessionId, messageId);
      },
      onSearch: (query) => this.search(query),
      onError: this.options.onError,
      requestRender: this.options.requestRender,
    });
    this.options.modals.show(view);
    if (initialQuery.trim().length > 0) {
      await view.runSearch(initialQuery);
    } else {
      this.options.requestRender();
    }
  }

  private async search(query: string): Promise<SessionSearchHit[]> {
    const result = hostData<SessionSearchResult>(
      await this.options.link.request({
        type: 'session/search',
        query: { query, limit: SEARCH_LIMIT },
      }),
    );
    return result.hits;
  }
}

type SessionSearchViewActions = {
  initialQuery: string;
  onClose: () => void;
  onOpen: (sessionId: string, messageId?: string) => void;
  onSearch: (query: string) => Promise<SessionSearchHit[]>;
  onError: (error: unknown) => void;
  requestRender: () => void;
};

type SearchLoadState = 'idle' | 'loading' | 'ready' | 'error';

class SessionSearchView implements Component, Focusable {
  private readonly input = new Input();
  private hits: SessionSearchHit[] = [];
  private selectedIndex = 0;
  private loadState: SearchLoadState = 'idle';
  private errorMessage = '';
  private searchToken = 0;
  private focusedState = false;

  public constructor(private readonly actions: SessionSearchViewActions) {
    if (actions.initialQuery.length > 0) prefillInput(this.input, actions.initialQuery);
  }

  public get focused(): boolean {
    return this.focusedState;
  }

  public set focused(value: boolean) {
    this.focusedState = value;
    this.input.focused = value;
  }

  public invalidate(): void {
    this.input.invalidate();
  }

  public async runSearch(query: string): Promise<void> {
    const token = ++this.searchToken;
    this.loadState = 'loading';
    this.errorMessage = '';
    this.actions.requestRender();
    try {
      const hits = await this.actions.onSearch(query);
      if (token !== this.searchToken) return;
      this.hits = hits;
      this.selectedIndex = 0;
      this.loadState = 'ready';
      this.actions.requestRender();
    } catch (error) {
      if (token !== this.searchToken) return;
      this.loadState = 'error';
      this.errorMessage = error instanceof Error ? error.message : '搜索失败';
      this.actions.requestRender();
    }
  }

  public handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.actions.onClose();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.move(-1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.move(1);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const query = this.input.getValue().trim();
      if (this.loadState === 'ready' && this.hits.length > 0) {
        const hit = this.hits[this.selectedIndex];
        if (hit !== undefined) {
          this.actions.onOpen(hit.sessionId, hit.messageId);
          return;
        }
      }
      if (query.length === 0) {
        this.loadState = 'error';
        this.errorMessage = '请输入搜索词';
        return;
      }
      void this.runSearch(query);
      return;
    }
    this.input.handleInput(data);
    this.loadState = 'idle';
    this.hits = [];
  }

  public render(width: number): string[] {
    const inner = Math.max(4, width - 4);
    const body: string[] = [
      `${style.gray('搜索 ')}${this.input.render(Math.max(4, inner - 5)).join('')}`,
      '',
    ];
    if (this.loadState === 'loading') {
      body.push(style.gray('搜索中…'));
    } else if (this.loadState === 'error') {
      body.push(style.red(`搜索失败：${this.errorMessage}`));
    } else if (this.loadState === 'idle') {
      body.push(style.gray('输入关键词后按 Enter 搜索跨会话全文'));
    } else if (this.hits.length === 0) {
      body.push(style.gray('没有命中'));
    } else {
      const start = Math.max(
        0,
        Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE / 2), this.hits.length - MAX_VISIBLE),
      );
      for (let index = start; index < Math.min(this.hits.length, start + MAX_VISIBLE); index += 1) {
        const hit = this.hits[index];
        if (hit !== undefined) body.push(this.renderHit(hit, index === this.selectedIndex, inner));
      }
      if (this.hits.length > MAX_VISIBLE) {
        body.push(style.gray(`${this.selectedIndex + 1}/${this.hits.length}`));
      }
    }
    return frameOverlay('跨会话搜索', body, 'Enter 搜索/打开 · ↑↓ 选择 · Esc 关闭', width);
  }

  private renderHit(hit: SessionSearchHit, selected: boolean, inner: number): string {
    const title = hit.name?.trim() || hit.sessionId;
    const when = hit.updatedAt ? hit.updatedAt.slice(0, 10) : '';
    const snippet = (hit.snippet ?? '').replace(/\s+/g, ' ').trim();
    const meta = [when, snippet].filter((part) => part.length > 0).join(' · ');
    const metaWidth = Math.min(visibleWidth(meta), Math.floor((inner * 2) / 3));
    const titleWidth = Math.max(4, inner - metaWidth - 4);
    const titleText = truncateToWidth(title, titleWidth);
    const gap = ' '.repeat(Math.max(1, titleWidth - visibleWidth(titleText) + 1));
    const line = `${selected ? '›' : ' '} ${titleText}${gap}${style.gray(truncateToWidth(meta, metaWidth))}`;
    return selected ? style.cyan(line) : line;
  }

  private move(delta: number): void {
    if (this.hits.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.hits.length) % this.hits.length;
  }
}
