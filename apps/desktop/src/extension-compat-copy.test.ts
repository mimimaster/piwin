import { describe, expect, it } from 'vitest';
import { extensionCompatCopy } from './extension-compat-copy.js';

describe('extensionCompatCopy', () => {
  it('states the Agent Runtime surface and names the TUI gaps in English', () => {
    const copy = extensionCompatCopy(false);
    expect(copy.noticeTitle).toMatch(/Agent/i);
    expect(copy.pageDescription).toMatch(/Agent Runtime/);
    expect(copy.body.join(' ')).toMatch(/confirm \/ select \/ input \/ notify/);
    expect(copy.body.join(' ')).toMatch(/\/reload/);
    expect(copy.unsupported.join(' ')).toMatch(/ctx\.ui\.custom/);
    expect(copy.privilege).toMatch(/OS privileges/);
  });

  it('states the same boundary in Chinese without claiming TUI support', () => {
    const copy = extensionCompatCopy(true);
    expect(copy.noticeTitle).toContain('Agent');
    expect(copy.pageDescription).toContain('Agent Runtime');
    expect(copy.pageDescription).toContain('不是 Pi 终端插件');
    expect(copy.unsupported.join(' ')).toContain('ctx.ui.custom');
    expect(copy.privilege).toContain('系统权限');
  });
});
