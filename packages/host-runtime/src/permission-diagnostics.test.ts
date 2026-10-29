import { describe, expect, it } from 'vitest';
import { logPermissionDiagnostic } from './permission-diagnostics.js';

describe('logPermissionDiagnostic', () => {
  it('is silent unless PIWIN_PERM_DIAG=1', () => {
    const lines: string[] = [];
    logPermissionDiagnostic('mode', { a: 1 }, {}, (l) => lines.push(l));
    expect(lines).toEqual([]);
    logPermissionDiagnostic('mode', { a: 1 }, { PIWIN_PERM_DIAG: '1' }, (l) => lines.push(l));
    expect(lines).toEqual(['[perm-diag] mode {"a":1}']);
  });
});
