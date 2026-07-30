import { describe, expect, it } from 'vitest';
import { diffLineStats } from './diff-card';

describe('diffLineStats', () => {
  it('counts add/del lines excluding file headers', () => {
    const diff = [
      '--- a/settings-shell.tsx',
      '+++ b/settings-shell.tsx',
      '@@ -41,2 +42,5 @@',
      ' export function SettingsShell() {',
      '-  const [page, setPage] = useState(\'general\')',
      '+  return (',
      '+    <Routes base="/settings">',
    ].join('\n');
    expect(diffLineStats(diff)).toEqual({ adds: 2, dels: 1 });
  });
  it('handles empty diff', () => {
    expect(diffLineStats('')).toEqual({ adds: 0, dels: 0 });
  });
});
