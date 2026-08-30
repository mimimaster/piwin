import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn }));

import { openLocalAuthUrl } from './open-local-auth-url.js';

describe('openLocalAuthUrl', () => {
  afterEach(() => {
    spawn.mockReset();
  });

  it('ignores non-http URLs', () => {
    openLocalAuthUrl('javascript:alert(1)');
    openLocalAuthUrl('/relative');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('spawns the platform opener for https', () => {
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = () => undefined;
    spawn.mockReturnValue(child);
    openLocalAuthUrl('https://chatgpt.com/oauth');
    expect(spawn).toHaveBeenCalledWith(
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'rundll32'
          : 'xdg-open',
      process.platform === 'win32'
        ? ['url.dll,FileProtocolHandler', 'https://chatgpt.com/oauth']
        : ['https://chatgpt.com/oauth'],
      { stdio: 'ignore', detached: true },
    );
  });
});
