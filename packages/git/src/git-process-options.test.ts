import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { gitExecOptions } from './git-process-options.js';

const execFileAsync = promisify(execFile);

describe('gitExecOptions', () => {
  it('hides the Windows console and refuses interactive git prompts', () => {
    const options = gitExecOptions({
      cwd: '/repo',
      timeout: 1_000,
      maxBuffer: 64,
      env: { GIT_AUTHOR_NAME: 'Ada' },
    });

    expect(options.windowsHide).toBe(true);
    expect(options.env.GIT_AUTHOR_NAME).toBe('Ada');
    expect(options.env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(options.env.GIT_SSH_COMMAND).toContain('BatchMode=yes');
    expect(options.env.GCM_INTERACTIVE).toBe('never');
    // Error text is classified by English prefixes; a localized git breaks it.
    expect(options.env.LANG).toBe('C');
  });

  it('keeps a path argument that contains spaces intact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin git no window '));
    try {
      const options = gitExecOptions({
        cwd: directory,
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      });
      await execFileAsync('git', ['init', '-b', 'main'], options);
      await writeFile(join(directory, 'note.txt'), 'quiet\n');
      const { stdout } = await execFileAsync('git', ['status', '--short'], options);
      expect(String(stdout)).toContain('note.txt');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
