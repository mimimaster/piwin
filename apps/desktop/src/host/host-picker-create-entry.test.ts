import { describe, expect, it, vi } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import { requestHostPickerEntry } from './host-picker-create-entry.js';

describe('picker creation request adapter', () => {
  it('sends a Host command and returns its entry', async () => {
    const entry = { name: 'notes.md', path: '/Host/notes.md', kind: 'file' } as const;
    const request = vi.fn(async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'host/create-entry',
      success: true,
      data: entry,
    }));
    const input = { parentPath: '/Host', name: entry.name, kind: entry.kind };
    expect(await requestHostPickerEntry(request, input, 'en')).toEqual(entry);
    expect(request).toHaveBeenCalledWith({ type: 'host/create-entry', input });
  });
  it('maps a collision into Chinese copy and preserves other Host errors', async () => {
    const request = async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'host/create-entry',
      success: false,
      error: 'Already exists.',
      problem: { code: 'host-entry-already-exists' },
    });
    const input = { parentPath: '/Host', name: 'notes.md', kind: 'file' } as const;
    await expect(requestHostPickerEntry(request, input, 'zh-CN')).rejects.toThrow('已存在同名');
    await expect(requestHostPickerEntry(request, input, 'en')).rejects.toThrow('Already exists.');
  });
});
