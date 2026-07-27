import { describe, expect, it } from 'vitest';
import { PtyHost } from './pty-host.js';

describe('PtyHost', () => {
  it('rejects a sibling-prefix cwd outside the trusted project', async () => {
    const host = new PtyHost({
      isProjectTrusted: async () => true,
      onOutput: () => undefined,
      onExit: () => undefined,
    });

    await expect(
      host.open({
        projectPath: '/tmp/piwin-project',
        cwd: '/tmp/piwin-project-untrusted',
      }),
    ).rejects.toThrow('PTY cwd must be inside the project path');
  });
});
