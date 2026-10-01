import { describe, expect, it } from 'vitest';
import type { RunIdleLoopNotice } from '@piwin/contracts';
import { RunIdleLoopMonitor } from './run-idle-loop-monitor.js';

function harness() {
  let clock = 1_000_000;
  const published: RunIdleLoopNotice[] = [];
  const timers: Array<{ at: number; run: () => void; cleared: boolean }> = [];
  const monitor = new RunIdleLoopMonitor({
    publish: (_runId, notice) => published.push(notice),
    now: () => clock,
    setTimer: (run, delayMs) => {
      const timer = { at: clock + delayMs, run, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  });
  return {
    monitor,
    published,
    bash: (command: string) => monitor.observeTool('run-1', { toolName: 'bash', command }),
    advance: (ms: number) => {
      clock += ms;
      for (const timer of timers) {
        if (!timer.cleared && timer.at <= clock) {
          timer.cleared = true;
          timer.run();
        }
      }
    },
  };
}

describe('RunIdleLoopMonitor', () => {
  it('publishes detection at once and throttles count-only refreshes', () => {
    const h = harness();
    for (let index = 0; index < 12; index += 1) h.bash('pwd; ls');
    expect(h.published).toHaveLength(1);
    expect(h.published[0]).toMatchObject({ state: 'looping', repeatedCalls: 12 });

    h.advance(500);
    h.bash('pwd; ls');
    h.bash('pwd; ls');
    expect(h.published).toHaveLength(1);

    h.advance(2_500);
    // Trailing flush lands the latest count once the refresh window passes.
    expect(h.published).toHaveLength(2);
    expect(h.published[1]?.repeatedCalls).toBe(14);
  });

  it('publishes a dismissal immediately and keeps it', () => {
    const h = harness();
    for (let index = 0; index < 12; index += 1) h.bash('pwd; ls');
    expect(h.monitor.dismiss('run-1')).toBe(true);
    expect(h.published.at(-1)?.dismissed).toBe(true);
    expect(h.monitor.dismiss('missing')).toBe(false);
  });

  it('does not flag paged reads plus distinct python split scripts as an idle loop', () => {
    // session-munjeatf-fkfl3naa tools 163–174: locale vitest, then 10 paged reads of
    // EnhancedMarkdownView plus one python outline. The 96-char preview + path-only
    // fingerprint collapsed that window to 3 signatures and raised the notice.
    const h = harness();
    const markdown = '/Volumes/BigDisk/Projects/Projects/piwin/apps/desktop/src/EnhancedMarkdownView.tsx';
    const clippedPython =
      '{"command":"python3 << \'PY\'\nfrom pathlib import Path\nsrc = Path(\'/Volumes/BigDisk/Projects/Pr…';
    h.monitor.observeTool('run-1', {
      toolName: 'bash',
      command: 'pnpm --dir apps/desktop exec vitest run src/desktop-locale.test.ts',
      inputPreview: '{"command":"pnpm --dir apps/desktop exec vitest run src/desktop-loca…',
    });
    for (const lineRange of [
      'L100-129',
      'L900-939',
      'L1110-1139',
      'L1210-1229',
      'L1520-1569',
    ]) {
      h.monitor.observeTool('run-1', {
        toolName: 'read',
        targetPaths: [markdown],
        lineRange,
        inputPreview: `{"path":"${markdown}","o…`,
      });
    }
    h.monitor.observeTool('run-1', {
      toolName: 'bash',
      command:
        "python3 << 'PY'\nfrom pathlib import Path\np = Path('/repo/EnhancedMarkdownView.tsx')\nprint(len(p.read_text().splitlines()))\nPY",
      inputPreview: clippedPython,
    });
    for (const lineRange of ['L1-25', 'L50-109', 'L270-294', 'L930-949', 'L1655-1669']) {
      h.monitor.observeTool('run-1', {
        toolName: 'read',
        targetPaths: [markdown],
        lineRange,
        inputPreview: `{"path":"${markdown}","o…`,
      });
    }
    expect(h.published).toEqual([]);
    expect(h.monitor.snapshot('run-1')).toBeUndefined();
  });

  it('does not collapse distinct python split scripts that share a 96-char preview', () => {
    // session-munjeatf-fkfl3naa tools 184–195: eight different python bodies, all
    // clipped to the same inputPreview, plus paged file-tree/web-page reads.
    const h = harness();
    const clipped =
      '{"command":"python3 << \'PY\'\nfrom pathlib import Path\nsrc = Path(\'/Volumes/BigDisk/Projects/Pr…';
    const src = "python3 << 'PY'\nfrom pathlib import Path\nsrc = Path('/repo/apps/desktop/src')\n";
    const scripts = [
      `${src}legacy_p = src / 'enhanced-markdown-legacy.tsx'\nprint('functions')\nPY`,
      `${src}legacy_p = src / 'enhanced-markdown-legacy.tsx'\n(src / 'enhanced-markdown-code-block.tsx').write_text('x')\nPY`,
      `${src}legacy_p = src / 'enhanced-markdown-legacy.tsx'\nprint('total', len(legacy_p.read_text().splitlines()))\nPY`,
      `${src}legacy_p = src / 'enhanced-markdown-legacy.tsx'\n(src / 'enhanced-markdown-format.tsx').write_text('x')\nPY`,
    ];
    for (const command of scripts) {
      h.monitor.observeTool('run-1', { toolName: 'bash', command, inputPreview: clipped });
    }
    h.monitor.observeTool('run-1', {
      toolName: 'read',
      targetPaths: ['/repo/apps/desktop/src/file-tree-panel.tsx'],
      lineRange: 'L160-269',
    });
    h.monitor.observeTool('run-1', {
      toolName: 'read',
      targetPaths: ['/repo/apps/desktop/src/file-tree-panel.tsx'],
      lineRange: 'L770-1049',
    });
    for (const lineRange of ['L393-442', 'L410-459', 'L720-759', 'L980-1019']) {
      h.monitor.observeTool('run-1', {
        toolName: 'read',
        targetPaths: ['/repo/apps/desktop/src/settings/pages/web-page.tsx'],
        lineRange,
      });
    }
    h.monitor.observeTool('run-1', {
      toolName: 'bash',
      command: `${src}panel = src / 'file-tree-panel.tsx'\nprint('preview state')\nPY`,
      inputPreview: clipped,
    });
    h.monitor.observeTool('run-1', {
      toolName: 'read',
      targetPaths: ['/repo/apps/desktop/src/file-tree-panel.tsx'],
      lineRange: 'L129-183',
    });
    expect(h.published).toEqual([]);
    expect(h.monitor.snapshot('run-1')).toBeUndefined();
  });

  it('exposes unpublished counts to the terminal snapshot and releases timers', () => {
    const h = harness();
    for (let index = 0; index < 13; index += 1) h.bash('pwd; ls');
    expect(h.published.at(-1)?.repeatedCalls).toBe(12);
    expect(h.monitor.snapshot('run-1')?.repeatedCalls).toBe(13);
    h.monitor.release('run-1');
    h.advance(10_000);
    expect(h.published).toHaveLength(1);
    expect(h.monitor.snapshot('run-1')).toBeUndefined();
  });

  it('publishes text repetition loop at once and recovers on subsequent message', () => {
    const h = harness();
    const sentence =
      '`BUILTIN_SCHEMES` 和 `LEGACY_ULTRA_CODE_SCOUT_ROLE` 原来是模块私有的，barrel 不该把它们变成公开导出。\n';
    h.monitor.observeText('run-1', { messageId: 'msg-1', text: sentence.repeat(8) });
    expect(h.published).toHaveLength(1);
    expect(h.published[0]).toMatchObject({
      state: 'looping',
      textRepeat: {
        messageId: 'msg-1',
        repeats: 8,
      },
    });

    h.monitor.noteMessageEnd('run-1', 'msg-1');
    expect(h.published).toHaveLength(1);

    h.monitor.noteMessageStart('run-1', 'msg-2');
    expect(h.published).toHaveLength(2);
    expect(h.published[1]).toMatchObject({
      state: 'recovered',
      textRepeat: {
        messageId: 'msg-1',
        repeats: 8,
      },
    });
  });
});
