import { describe, expect, it } from 'vitest';
import { applyArtifactThemeContract } from './theme-contract.js';

describe('applyArtifactThemeContract', () => {
  it('rewrites hard-coded white backgrounds', () => {
    const result = applyArtifactThemeContract(
      '<div style="background: white; color: #111">Card</div>',
    );
    expect(result.changed).toBe(true);
    expect(result.source).toContain('var(--piwin-artifact-surface)');
    expect(result.source).not.toMatch(/background:\s*white/i);
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it('rewrites bg-white class', () => {
    const result = applyArtifactThemeContract('<div class="card bg-white p-4">x</div>');
    expect(result.changed).toBe(true);
    expect(result.source).toContain('piwin-artifact-surface');
    expect(result.source).not.toContain('bg-white');
  });

  it('leaves intentional dark colors alone', () => {
    const source = '<div style="background: #111827; color: #fff">Dark</div>';
    const result = applyArtifactThemeContract(source);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  });
});
