import { describe, expect, it } from 'vitest';
import { sidecarCliInvocation } from './embedded-tui-serve.js';

describe('sidecarCliInvocation', () => {
  it('reruns the packaged entry with the same Node', () => {
    expect(sidecarCliInvocation({ execPath: '/app/piwin-host', execArgv: [], argv: ['/app/piwin-host', '/app/host.js', 'host', 'serve'] }))
      .toEqual({ program: '/app/piwin-host', args: ['/app/host.js'] });
  });

  it('keeps loader flags and drops debugger flags', () => {
    expect(sidecarCliInvocation({
      execPath: '/usr/bin/node',
      execArgv: ['--import', 'file:///tsx/loader.mjs', '--inspect=9229', '--inspect-brk'],
      argv: ['/usr/bin/node', '/src/index.ts', 'host', 'serve'],
    })).toEqual({ program: '/usr/bin/node', args: ['--import', 'file:///tsx/loader.mjs', '/src/index.ts'] });
  });

  it('gives up without an entry script', () => {
    expect(sidecarCliInvocation({ execPath: '/usr/bin/node', execArgv: [], argv: ['/usr/bin/node'] })).toBeUndefined();
  });
});
