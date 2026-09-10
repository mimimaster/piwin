// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { LibraryWorkspaceView } from './index';
import {
  findButton,
  flush,
  flushLibrary,
  makeLibraryItem,
  makeMediaListRequester,
  makePagedRequester,
  setInputValue,
} from './workspace-subpages-test-helpers';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function waitMs(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  });
}

describe('LibraryWorkspaceView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
  });

  function render(overrides: Partial<Parameters<typeof LibraryWorkspaceView>[0]> = {}): void {
    const request = overrides.request ?? makeMediaListRequester([]).request;
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <LibraryWorkspaceView
            locale="zh-CN"
            onClose={vi.fn()}
            request={request}
            {...overrides}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders library chrome and closes via back button', async () => {
    const onClose = vi.fn();
    render({ onClose });
    await flushLibrary();

    expect(container.textContent).toContain('图片');
    expect(container.textContent).toContain('资料库');
    expect(container.querySelector('[data-testid="library-search"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="library-new-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="library-sort-btn"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="library-thumb-fit-btn"]')).toBeNull();
    expect(container.querySelector('.lib-composer')).toBeNull();
    expect(container.querySelector('[data-testid="composer-input"]')).toBeNull();
    expect(container.querySelector('.vault-bar.is-page')).not.toBeNull();

    const backBtn = container.querySelector<HTMLButtonElement>('[data-testid="library-back-btn"]');
    expect(backBtn).not.toBeNull();
    act(() => {
      backBtn?.click();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('sends the header search to media/list', async () => {
    const fake = makeMediaListRequester([makeLibraryItem()]);
    render({ request: fake.request });
    await flushLibrary();

    const input = container.querySelector<HTMLInputElement>('[data-testid="library-search"]');
    expect(input).not.toBeNull();
    act(() => {
      setInputValue(input, 'neon');
    });
    await flushLibrary();

    expect(
      fake.calls.some(
        (command) => command.type === 'media/list' && command.input.query === 'neon',
      ),
    ).toBe(true);
  });

  it('exposes a native window drag region while the library covers shell chrome', async () => {
    render();
    await flushLibrary();

    const titlebar = container.querySelector('[data-testid="studio-topbar"]');
    const dragStrip = container.querySelector('[data-testid="studio-topbar-drag"]');
    expect(titlebar).not.toBeNull();
    expect(container.querySelector('.vault-stage')).not.toBeNull();
    expect(titlebar?.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(dragStrip).not.toBeNull();
    expect(dragStrip?.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(
      container.querySelector('[data-testid="library-back-btn"]')?.closest('[data-no-window-drag]'),
    ).not.toBeNull();
  });

  it('lists host vault images instead of the demo set', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    expect(container.querySelector('[data-testid="image-card-asset-1"]')).not.toBeNull();
    expect(container.textContent).toContain('neon street');
    expect(container.textContent).not.toContain('Unsplash');
  });

  it('does not fetch original media bytes for gallery tiles', async () => {
    const fake = makeMediaListRequester([makeLibraryItem()]);
    render({ request: fake.request });
    await flushLibrary();
    expect(fake.calls.filter((command) => command.type === 'media/read')).toEqual([]);
  });

  it('opens the inspector drawer when a card is clicked', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    expect(container.querySelector('[data-testid="library-inspector-drawer"]')).toBeNull();

    const card = container.querySelector<HTMLButtonElement>('[data-testid="image-card-asset-1"]');
    expect(card).not.toBeNull();
    act(() => {
      card?.click();
    });
    await flush(2);

    expect(container.querySelector('[data-testid="library-inspector-drawer"]')).not.toBeNull();
    expect(container.textContent).toContain('资产检查器');
    expect(container.textContent).toContain('flux');
    expect(container.querySelector('[data-testid="images-lightbox"]')).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush(2);
    expect(container.querySelector('[data-testid="library-inspector-drawer"]')).toBeNull();
    expect(container.querySelector('[data-testid="images-lightbox"]')).toBeNull();
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).not.toBeNull();
  });

  it('opens the lightbox from the card theater control', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    const theaterBtn = container.querySelector<HTMLElement>('.lib-card-theater-btn');
    expect(theaterBtn).not.toBeNull();
    act(() => {
      theaterBtn?.click();
    });
    await flush(2);

    expect(container.querySelector('[data-testid="images-lightbox"]')).not.toBeNull();
    expect(document.body.textContent).toContain('图片详情');
    expect(document.body.textContent).toContain('flux');
  });

  it('shows an empty library when the vault has no images', async () => {
    render({ request: makeMediaListRequester([]).request });
    await flushLibrary();
    expect(container.textContent).toContain('还没有图片');
  });

  it('deletes a tile through media/delete once the undo window closes', async () => {
    const items = [makeLibraryItem()];
    const fake = makeMediaListRequester(items);
    render({ request: fake.request, deleteUndoWindowMs: 60 });
    await flushLibrary();

    const deleteBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="media-delete-asset-1"]',
    );
    expect(deleteBtn).not.toBeNull();
    act(() => {
      deleteBtn?.click();
    });
    await flush(8);

    // Staged, not sent: the tile is gone but the vault file is still there.
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="library-toast-action"]')).not.toBeNull();
    expect(fake.calls.some((command) => command.type === 'media/delete')).toBe(false);

    await waitMs(120);
    await flush(8);

    expect(fake.calls).toContainEqual({
      type: 'media/delete',
      input: { sessionId: 'sess-1', assetId: 'asset-1' },
    });
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).toBeNull();
    expect(container.textContent).toContain('还没有图片');
  });

  it('undo restores the tile and never sends media/delete', async () => {
    const items = [makeLibraryItem()];
    const fake = makeMediaListRequester(items);
    render({ request: fake.request, deleteUndoWindowMs: 60 });
    await flushLibrary();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="media-delete-asset-1"]')
        ?.click();
    });
    await flush(8);
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).toBeNull();

    const undoBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="library-toast-action"]',
    );
    expect(undoBtn?.textContent).toContain('撤销');
    act(() => {
      undoBtn?.click();
    });
    await flush(4);

    expect(container.querySelector('[data-testid="image-card-asset-1"]')).not.toBeNull();

    await waitMs(120);
    await flush(8);
    expect(fake.calls.some((command) => command.type === 'media/delete')).toBe(false);
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).not.toBeNull();
  });

  it('confirms before a batch delete and only then calls the host', async () => {
    const items = [makeLibraryItem(), makeLibraryItem({ assetId: 'asset-2' })];
    const fake = makeMediaListRequester(items);
    render({ request: fake.request });
    await flushLibrary();

    const checkbox = container.querySelector<HTMLInputElement>('.lib-card-batch-cb');
    expect(checkbox).not.toBeNull();
    act(() => {
      checkbox?.click();
    });
    await flush(4);

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="library-batch-delete"]')?.click();
    });
    await flush(4);

    expect(container.querySelector('[data-testid="library-batch-delete-confirm"]')).not.toBeNull();
    expect(fake.calls.some((command) => command.type === 'media/delete')).toBe(false);

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="library-batch-delete-confirm-btn"]')
        ?.click();
    });
    await flush(8);

    expect(container.querySelector('[data-testid="library-batch-delete-confirm"]')).toBeNull();
    expect(fake.calls).toContainEqual({
      type: 'media/delete',
      input: { sessionId: 'sess-1', assetId: 'asset-1' },
    });
  });

  it('hides the model filter when the catalog only has one model', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();
    expect(container.querySelector('[data-testid="library-model-filter"]')).toBeNull();
  });

  it('builds the model filter from the models actually in the catalog', async () => {
    render({
      request: makeMediaListRequester([
        makeLibraryItem(),
        makeLibraryItem({ assetId: 'asset-2', model: 'gpt-image-2.5' }),
      ]).request,
    });
    await flushLibrary();

    const select = container.querySelector<HTMLSelectElement>(
      '[data-testid="library-model-filter"]',
    );
    expect(select).not.toBeNull();
    const values = Array.from(select?.options ?? []).map((option) => option.value);
    expect(values).toEqual(['all', 'flux', 'gpt-image-2.5']);
    expect(select?.textContent).toContain('gpt-image-2.5 (1)');
  });

  it('reports the catalog total rather than the loaded page', async () => {
    const fake = makeMediaListRequester([makeLibraryItem()]);
    render({ request: fake.request });
    await flushLibrary();
    expect(
      container.querySelector('[data-testid="library-asset-count"]')?.textContent,
    ).toContain('1');
  });

  it('keeps paging until a favorite on a later page shows up', async () => {
    window.localStorage.setItem(
      'piwin.media_vault.favorites',
      JSON.stringify(['sess-1:asset-page2']),
    );
    const fake = makePagedRequester([
      [makeLibraryItem()],
      [makeLibraryItem({ assetId: 'asset-page2', prompt: 'buried favorite' })],
    ]);
    render({ request: fake.request });
    await flushLibrary();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="library-tab-favorites"]')?.click();
    });
    await flushLibrary();
    await flush(12);

    // Page 1 holds no favorite; the empty showcase must not win the race.
    expect(container.textContent).not.toContain('暂无收藏素材');
    expect(container.querySelector('[data-testid="image-card-asset-page2"]')).not.toBeNull();
    window.localStorage.removeItem('piwin.media_vault.favorites');
  });

  it('leaves every card unhighlighted until one is picked', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    expect(container.querySelector('.lib-card.is-active')).toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="image-card-asset-1"]')?.click();
    });
    await flush(2);

    expect(container.querySelector('.lib-card.is-active')).not.toBeNull();
  });

  it('filters images and videos in-page without leaving the library', async () => {
    const items = [
      makeLibraryItem(),
      makeLibraryItem({
        assetId: 'vid-1',
        kind: 'video',
        mimeType: 'video/mp4',
        prompt: 'drone valley',
      }),
    ];
    render({ request: makeMediaListRequester(items).request });
    await flushLibrary();

    expect(container.querySelector('[data-testid="library-tab-all"]')).toBeNull();
    expect(container.querySelector('[data-testid="library-tab-files"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="library-tab-images"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );

    // Defaults to Images: image card is present, video is filtered out
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="video-card-vid-1"]')).toBeNull();

    // Switch to Videos tab
    const videoTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="library-tab-videos"]',
    );
    expect(videoTab).not.toBeNull();
    act(() => {
      videoTab?.click();
    });
    await flushLibrary();
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="video-card-vid-1"]')).not.toBeNull();

    // Switch back to Images tab
    const imagesTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="library-tab-images"]',
    );
    expect(imagesTab).not.toBeNull();
    act(() => {
      imagesTab?.click();
    });
    await flushLibrary();
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="video-card-vid-1"]')).toBeNull();
  });

  it('renders a flat photo grid without magazine chrome', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    expect(container.querySelector('.lib-grid')).not.toBeNull();
    expect(container.querySelector('[data-testid="library-search"]')).not.toBeNull();
    expect(container.textContent).not.toContain('生成内容库');
    expect(container.textContent).not.toContain('CREATIVE VAULT');
    expect(container.querySelector('.studio-page-intro')).toBeNull();
    expect(findButton(container, '小')).toBeUndefined();
    expect(container.querySelector('.lib-inspiration-wrap')).toBeNull();
    expect(container.textContent).not.toContain('✦');
  });

  it('has no separate batch-mode toggle — checking a tile is the whole gesture', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    // There's nothing to enter: the checkbox is already on the card, and
    // the action bar is absent until something is actually selected.
    expect(findButton(container, '批量管理')).toBeUndefined();
    expect(container.querySelector('.lib-batch-bar')).toBeNull();
    const checkbox = container.querySelector<HTMLInputElement>('.lib-card-batch-cb');
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox?.click();
    });
    await flushLibrary();

    expect(container.querySelector('.lib-batch-bar')).not.toBeNull();
    expect(container.querySelector('[data-testid="library-deselect"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="library-deselect"]')?.click();
    });
    await flushLibrary();

    // Deselecting collapses the bar again — no "exit" step either.
    expect(container.querySelector('.lib-batch-bar')).toBeNull();
  });

  it('selects a range with Shift-click and a single item with ⌘/Ctrl-click', async () => {
    const items = [
      makeLibraryItem({ assetId: 'asset-1' }),
      makeLibraryItem({ assetId: 'asset-2' }),
      makeLibraryItem({ assetId: 'asset-3' }),
    ];
    render({ request: makeMediaListRequester(items).request });
    await flushLibrary();

    const open = (id: string) =>
      container.querySelector<HTMLButtonElement>(`[data-testid="image-card-${id}"]`);

    act(() => {
      open('asset-1')?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }),
      );
    });
    await flush(2);
    expect(container.querySelectorAll('.lib-card.is-selected').length).toBe(1);
    // ⌘-click selects without opening the inspector.
    expect(container.querySelector('[data-testid="library-inspector-drawer"]')).toBeNull();

    act(() => {
      open('asset-3')?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }),
      );
    });
    await flush(2);
    // Shift extends the range from asset-1 through asset-3: all three.
    expect(container.querySelectorAll('.lib-card.is-selected').length).toBe(3);

    // With a selection already live, a plain click keeps selecting instead
    // of navigating into the inspector.
    act(() => {
      open('asset-2')?.click();
    });
    await flush(2);
    expect(container.querySelectorAll('.lib-card.is-selected').length).toBe(2);
    expect(container.querySelector('[data-testid="library-inspector-drawer"]')).toBeNull();
  });

  it('toggles inspector drawer and displays asset parameters', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    expect(container.querySelector('[data-testid="library-inspector-drawer"]')).toBeNull();

    const inspectorToggleBtn = container.querySelector<HTMLButtonElement>(
      'button[title="切换属性面板"]',
    );
    expect(inspectorToggleBtn).not.toBeNull();
    act(() => {
      inspectorToggleBtn?.click();
    });
    await flush(4);

    expect(container.querySelector('[data-testid="library-inspector-drawer"]')).not.toBeNull();
    expect(container.textContent).toContain('资产检查器');
    expect(container.textContent).toContain('flux');
  });

  it('favorites the whole selection when any item is unfavorited, and clears it when all are favorited', async () => {
    const items = [
      makeLibraryItem({ assetId: 'asset-1' }),
      makeLibraryItem({ assetId: 'asset-2' }),
    ];
    render({ request: makeMediaListRequester(items).request });
    await flushLibrary();

    const checkboxes = container.querySelectorAll<HTMLInputElement>('.lib-card-batch-cb');
    expect(checkboxes.length).toBe(2);
    act(() => {
      checkboxes[0]?.click();
      checkboxes[1]?.click();
    });
    await flush(4);

    // findButton would also match the "Favorites" kind tab (same label,
    // earlier in the DOM) — scope to the selection dock specifically.
    const batchActions = container.querySelector('.lib-batch-bar');
    expect(batchActions).not.toBeNull();
    const favoriteBtn = findButton(batchActions!, '收藏');
    expect(favoriteBtn).toBeDefined();

    // Neither item is favorited yet: the action favorites both.
    act(() => {
      favoriteBtn?.click();
    });
    await flush(4);
    expect(container.querySelectorAll('.lib-card-fav-flag').length).toBe(2);

    // Both are now favorited: the same action clears both, not a per-item flip.
    act(() => {
      favoriteBtn?.click();
    });
    await flush(4);
    expect(container.querySelectorAll('.lib-card-fav-flag').length).toBe(0);
  });

  it('marks the active sort option in the menu and updates it after a change', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    function openSortMenu(): void {
      const btn = container.querySelector<HTMLButtonElement>('[data-testid="library-sort-btn"]');
      btn?.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      btn?.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      btn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    act(openSortMenu);
    await flush(4);

    const newestItem = document.querySelector('[data-testid="library-sort-newest"]');
    const oldestItem = document.querySelector('[data-testid="library-sort-oldest"]');
    expect(newestItem).not.toBeNull();
    expect(oldestItem).not.toBeNull();
    expect(newestItem!.querySelector('.ui-menu-item-icon svg')).not.toBeNull();
    expect(oldestItem!.querySelector('.ui-menu-item-icon svg')).toBeNull();

    act(() => {
      (oldestItem as HTMLElement).click();
    });
    await flush(4);

    act(openSortMenu);
    await flush(4);
    const newestItem2 = document.querySelector('[data-testid="library-sort-newest"]');
    const oldestItem2 = document.querySelector('[data-testid="library-sort-oldest"]');
    expect(newestItem2).not.toBeNull();
    expect(oldestItem2).not.toBeNull();
    expect(oldestItem2!.querySelector('.ui-menu-item-icon svg')).not.toBeNull();
    expect(newestItem2!.querySelector('.ui-menu-item-icon svg')).toBeNull();
  });

  it('hides the per-card model badge when every visible tile shares one model', async () => {
    render({
      request: makeMediaListRequester([
        makeLibraryItem({ assetId: 'asset-1', model: 'flux' }),
        makeLibraryItem({ assetId: 'asset-2', model: 'flux' }),
      ]).request,
    });
    await flushLibrary();
    expect(container.querySelector('.lib-card-overlay-model')).toBeNull();
  });

  it('shows the per-card model badge once more than one model is present', async () => {
    render({
      request: makeMediaListRequester([
        makeLibraryItem({ assetId: 'asset-1', model: 'flux' }),
        makeLibraryItem({ assetId: 'asset-2', model: 'gpt-image-2.5' }),
      ]).request,
    });
    await flushLibrary();
    expect(container.querySelector('.lib-card-overlay-model')).not.toBeNull();
  });

  it('groups tiles under date-range headers instead of one flat run', async () => {
    const daysAgoIso = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    render({
      request: makeMediaListRequester([
        makeLibraryItem({ assetId: 'asset-1', createdAt: daysAgoIso(0) }),
        makeLibraryItem({ assetId: 'asset-2', createdAt: daysAgoIso(100) }),
      ]).request,
    });
    await flushLibrary();

    const labels = Array.from(container.querySelectorAll('.lib-date-group-label')).map(
      (el) => el.textContent,
    );
    expect(labels).toContain('今天');
    expect(labels.length).toBe(2);
  });

  it('toggles thumbnail fit between fill and contain, and remembers the choice', async () => {
    window.localStorage.removeItem('piwin.media_vault.thumb_fit');
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    const fitBtn = () =>
      container.querySelector<HTMLButtonElement>('[data-testid="library-thumb-fit-btn"]');
    expect(fitBtn()?.classList.contains('is-active')).toBe(false);
    expect(window.localStorage.getItem('piwin.media_vault.thumb_fit')).toBeNull();

    act(() => {
      fitBtn()?.click();
    });
    await flush(2);

    expect(fitBtn()?.classList.contains('is-active')).toBe(true);
    expect(window.localStorage.getItem('piwin.media_vault.thumb_fit')).toBe('contain');

    // The choice survives a remount, reading back from storage.
    act(() => {
      root.unmount();
    });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();
    expect(fitBtn()?.classList.contains('is-active')).toBe(true);
    expect(fitBtn()?.closest('.lib-view-toggle')).toBeNull();
    expect(fitBtn()?.closest('.lib-main')).not.toBeNull();

    const listBtn = container.querySelector<HTMLButtonElement>('button[aria-label="列表视图"]');
    act(() => {
      listBtn?.click();
    });
    await flush(2);
    expect(fitBtn()).toBeNull();

    const gridBtn = container.querySelector<HTMLButtonElement>('button[aria-label="网格视图"]');
    act(() => {
      gridBtn?.click();
    });
    await flush(2);
    expect(fitBtn()).not.toBeNull();

    window.localStorage.removeItem('piwin.media_vault.thumb_fit');
  });

  it('routes Remix through onRemixToComposer instead of copy-and-close when the host wires it', async () => {
    const onRemixToComposer = vi.fn();
    const onClose = vi.fn();
    render({
      request: makeMediaListRequester([
        makeLibraryItem({ assetId: 'asset-1', prompt: 'neon street' }),
      ]).request,
      onRemixToComposer,
      onClose,
    });
    await flushLibrary();

    const remixBtn = container.querySelector<HTMLButtonElement>(
      '.lib-card-hover-btn[title="在会话中重绘"]',
    );
    expect(remixBtn).not.toBeNull();
    act(() => {
      remixBtn?.click();
    });
    await flush(2);

    expect(onRemixToComposer).toHaveBeenCalledTimes(1);
    const call = onRemixToComposer.mock.calls[0]![0];
    expect(call.text).toBe('neon street');
    expect(call.item?.assetId).toBe('asset-1');
    // Closing is the composer callback's job now, not the library's.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to copy-and-close when onRemixToComposer is not provided', async () => {
    const onClose = vi.fn();
    render({
      request: makeMediaListRequester([
        makeLibraryItem({ assetId: 'asset-1', prompt: 'neon street' }),
      ]).request,
      onClose,
    });
    await flushLibrary();

    const remixBtn = container.querySelector<HTMLButtonElement>(
      '.lib-card-hover-btn[title="在会话中重绘"]',
    );
    act(() => {
      remixBtn?.click();
    });
    await flush(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('navigates tile focus with the arrow keys, opens the lightbox with Space, and deletes with Delete', async () => {
    const items = [
      makeLibraryItem({ assetId: 'asset-1' }),
      makeLibraryItem({ assetId: 'asset-2' }),
    ];
    const fake = makeMediaListRequester(items);
    render({ request: fake.request, deleteUndoWindowMs: 60_000 });
    await flushLibrary();

    expect(
      container.querySelector('[data-testid="library-tile-nav-region"]'),
    ).not.toBeNull();
    const first = container.querySelector<HTMLElement>('[data-testid="image-card-asset-1"]');
    const second = container.querySelector<HTMLElement>('[data-testid="image-card-asset-2"]');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    // A real keydown fires on whichever element has focus and bubbles up to
    // the nav region's listener — dispatch it the same way here.
    function pressKey(key: string): void {
      document.activeElement?.dispatchEvent(
        new window.KeyboardEvent('keydown', { key, bubbles: true }),
      );
    }

    act(() => {
      first?.focus();
    });
    expect(document.activeElement).toBe(first);

    act(() => {
      pressKey('ArrowRight');
    });
    await flush(2);
    expect(document.activeElement).toBe(second);

    act(() => {
      pressKey('Home');
    });
    await flush(2);
    expect(document.activeElement).toBe(first);

    act(() => {
      pressKey(' ');
    });
    await flush(2);
    expect(container.querySelector('[data-testid="images-lightbox"]')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush(2);

    act(() => {
      first?.focus();
    });
    act(() => {
      pressKey('Delete');
    });
    await flush(2);
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).toBeNull();
  });
});

describe('LibraryWorkspaceView videos tab', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
  });

  function render(overrides: Partial<Parameters<typeof LibraryWorkspaceView>[0]> = {}): void {
    const request = overrides.request ?? makeMediaListRequester([]).request;
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <LibraryWorkspaceView
            locale="en"
            onClose={vi.fn()}
            request={request}
            initialKind="video"
            {...overrides}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders studio chrome and an empty library', async () => {
    render();
    await flushLibrary();
    expect(container.textContent).toContain('Videos');
    expect(container.textContent).toContain('No videos yet');
  });

  it('opens the inspector drawer when a video card is clicked', async () => {
    render({
      request: makeMediaListRequester([
        makeLibraryItem({
          assetId: 'vid-1',
          kind: 'video',
          mimeType: 'video/mp4',
          prompt: 'drone valley',
          model: 'kling',
        }),
      ]).request,
    });
    await flushLibrary();

    const card = container.querySelector<HTMLDivElement>('[data-testid="video-card-vid-1"]');
    expect(card).not.toBeNull();
    act(() => {
      card?.click();
    });
    await flush(2);

    expect(container.querySelector('[data-testid="library-inspector-drawer"]')).not.toBeNull();
    expect(container.textContent).toContain('Asset Inspector');
    expect(container.textContent).toContain('kling');
    expect(container.querySelector('[data-testid="videos-theater"]')).toBeNull();
  });
});
