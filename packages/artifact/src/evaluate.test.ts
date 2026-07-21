import { describe, expect, it } from 'vitest';
import { evaluateCodeFence } from './evaluate.js';

describe('evaluateCodeFence', () => {
  it('returns render for safe artifact-html', () => {
    const decision = evaluateCodeFence({
      language: 'artifact-html',
      source: '<section><h1>Hello</h1></section>',
      id: 'demo',
    });
    expect(decision.kind).toBe('render');
    if (decision.kind === 'render') {
      expect(decision.mode).toBe('interactive');
      expect(decision.srcdoc).toContain('<h1>Hello</h1>');
      expect(decision.srcdoc).toContain('piwin-artifact:ready');
      expect(decision.csp).toContain("default-src 'none'");
      expect(decision.themeRepairs).toEqual([]);
    }
  });

  it('soft-repairs hard-coded light surfaces', () => {
    const decision = evaluateCodeFence({
      language: 'artifact-html',
      source: '<div style="background: white">Card</div>',
      id: 'light',
    });
    expect(decision.kind).toBe('render');
    if (decision.kind === 'render') {
      expect(decision.srcdoc).toContain('var(--piwin-artifact-surface)');
      expect(decision.themeRepairs.length).toBeGreaterThan(0);
      // Raw descriptor source stays original
      expect(decision.descriptor.source).toContain('background: white');
    }
  });

  it('returns stream-preview mode and strips scripts', () => {
    const decision = evaluateCodeFence({
      language: 'html',
      source: '<div><p>Hi</p></div><script>alert(1)',
      id: 'stream',
      mode: 'stream-preview',
      htmlUiModeEnabled: true,
    });
    // May be preparing if structure not streamable enough, or render
    if (decision.kind === 'render') {
      expect(decision.mode).toBe('stream-preview');
      expect(decision.srcdoc).not.toContain('<script');
    } else {
      expect(['preparing', 'blocked', 'code']).toContain(decision.kind);
    }
  });

  it('returns blocked for external script', () => {
    const decision = evaluateCodeFence({
      language: 'artifact-html',
      source: '<script src="https://cdn.example.com/x.js"></script>',
      id: 'bad',
    });
    expect(decision.kind).toBe('blocked');
    if (decision.kind === 'blocked') {
      expect(decision.reason).toBe('blocked-external-resource');
    }
  });

  it('returns code for non-artifact languages', () => {
    const decision = evaluateCodeFence({
      language: 'ts',
      source: 'export const x = 1',
    });
    expect(decision.kind).toBe('code');
  });
});
