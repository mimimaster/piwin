import { describe, expect, it } from 'vitest';
import { applyArtifactLayoutContract } from './layout-contract.js';

describe('applyArtifactLayoutContract', () => {
  it('neutralizes height: 100vh in style blocks', () => {
    const source = '<style>.wrapper { height: 100vh; }</style><div class="wrapper">x</div>';
    const result = applyArtifactLayoutContract(source);
    expect(result.changed).toBe(true);
    expect(result.source).toContain('height: auto');
    expect(result.source).not.toContain('100vh');
    expect(result.repairs[0]?.kind).toBe('full-page-height');
  });

  it('neutralizes min-height with all viewport units', () => {
    const source = '.a { min-height: 100dvh; } .b { height: 100svh; } .c { min-height: 100lvh; }';
    const result = applyArtifactLayoutContract(source);
    expect(result.source).not.toContain('100dvh');
    expect(result.source).not.toContain('100svh');
    expect(result.source).not.toContain('100lvh');
    expect(result.source).toContain('min-height: 0');
    expect(result.source).toContain('height: auto');
  });

  it('repairs inline style attributes', () => {
    const source = '<div style="min-height: 100vh">x</div>';
    const result = applyArtifactLayoutContract(source);
    expect(result.changed).toBe(true);
    expect(result.source).toContain('min-height: 0');
    expect(result.source).not.toContain('100vh');
  });

  it('repairs calc() viewport-unit heights', () => {
    const source = '.panel { height: calc(100vh - 60px); }';
    const result = applyArtifactLayoutContract(source);
    expect(result.changed).toBe(true);
    expect(result.source).toContain('height: auto');
  });

  it('does not touch media-query feature values', () => {
    const source = '@media (min-height: 100vh) { .a { color: red; } }';
    const result = applyArtifactLayoutContract(source);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  });

  it('does not touch max-height or non-viewport units', () => {
    const source = '.a { max-height: 100vh; } .b { height: 100%; } .c { height: 480px; }';
    const result = applyArtifactLayoutContract(source);
    expect(result.changed).toBe(false);
    expect(result.source).toBe(source);
  });

  it('is a no-op for clean sources', () => {
    const source = '.card { background: var(--piwin-artifact-surface); }';
    const result = applyArtifactLayoutContract(source);
    expect(result.changed).toBe(false);
    expect(result.repairs).toEqual([]);
  });
});
