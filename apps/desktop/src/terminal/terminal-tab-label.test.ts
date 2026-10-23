import { describe, expect, it } from 'vitest';
import { terminalTabLabel } from './terminal-tab-label';

describe('terminalTabLabel', () => {
  it('keeps the session name until the shell reports a title', () => {
    expect(terminalTabLabel(undefined, 'zsh1')).toBe('zsh1');
    expect(terminalTabLabel('   ', 'zsh1')).toBe('zsh1');
  });

  it('reduces a user@host:path title to the directory', () => {
    expect(terminalTabLabel('yorick@mac-mini:~/Developer/piwin', 'zsh1')).toBe('piwin');
    expect(terminalTabLabel('yorick@mac-mini: /usr/local/bin/', 'zsh1')).toBe('bin');
    expect(terminalTabLabel('yorick@mac-mini:~', 'zsh1')).toBe('~');
  });

  it('reduces a bare path to its last segment', () => {
    expect(terminalTabLabel('/Volumes/BigDisk/Developer/piwin', 'zsh1')).toBe('piwin');
    expect(terminalTabLabel('/', 'zsh1')).toBe('/');
  });

  it('shows a running program as reported', () => {
    expect(terminalTabLabel('pnpm dev', 'zsh1')).toBe('pnpm dev');
    expect(terminalTabLabel('vim', 'zsh1')).toBe('vim');
  });
});
