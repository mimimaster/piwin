import { act } from 'react';
import { vi } from 'vitest';
import type { HostCommand, HostResponse, MediaLibraryItem } from '@piwin/contracts';

export function setInputValue(
  input: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
): void {
  if (!input) return;
  const proto =
    input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function findButton(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(text),
  );
}

/** Drain the microtask queue after fake-requester resolves. */
export async function flush(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** media/list is debounced 200ms before the host request. */
export async function flushLibrary(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      window.setTimeout(resolve, 220);
    });
  });
  await flush(12);
}

export function makeLibraryItem(overrides: Partial<MediaLibraryItem> = {}): MediaLibraryItem {
  return {
    assetId: 'asset-1',
    sessionId: 'sess-1',
    mimeType: 'image/png',
    byteSize: 2048,
    createdAt: '2026-08-27T12:00:00.000Z',
    kind: 'image',
    prompt: 'neon street',
    model: 'flux',
    ...overrides,
  };
}

export function makeMediaListRequester(items: MediaLibraryItem[]): {
  request: (command: HostCommand) => Promise<HostResponse>;
  calls: HostCommand[];
} {
  const calls: HostCommand[] = [];
  return {
    calls,
    request: vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      calls.push(command);
      if (command.type === 'media/delete') {
        const index = items.findIndex(
          (item) =>
            item.sessionId === command.input.sessionId && item.assetId === command.input.assetId,
        );
        if (index >= 0) {
          items.splice(index, 1);
        }
        return {
          type: 'response',
          command: 'media/delete',
          success: true,
          data: {
            deleted: index >= 0,
            sessionId: command.input.sessionId,
            assetId: command.input.assetId,
          },
        };
      }
      if (command.type !== 'media/list') {
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      }
      const query = command.input.query?.trim().toLowerCase() ?? '';
      const kind = command.input.kind;
      const filtered = items.filter((item) => {
        if (kind !== undefined && item.kind !== kind) {
          return false;
        }
        return query === '' || item.prompt?.toLowerCase().includes(query) === true;
      });
      return {
        type: 'response',
        command: 'media/list',
        success: true,
        data: { items: filtered, total: filtered.length },
      };
    }),
  };
}

/** media/list that pages: the caller must follow `nextCursor` to see page 2. */
export function makePagedRequester(pages: MediaLibraryItem[][]): {
  request: (command: HostCommand) => Promise<HostResponse>;
  calls: HostCommand[];
} {
  const calls: HostCommand[] = [];
  const total = pages.reduce((sum, page) => sum + page.length, 0);
  return {
    calls,
    request: vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      calls.push(command);
      if (command.type !== 'media/list') {
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      }
      const index = command.input.cursor ? Number(command.input.cursor) : 0;
      const page = pages[index] ?? [];
      const nextCursor = index + 1 < pages.length ? String(index + 1) : undefined;
      return {
        type: 'response',
        command: 'media/list',
        success: true,
        data: { items: page, total, ...(nextCursor ? { nextCursor } : {}) },
      };
    }),
  };
}
