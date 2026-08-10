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
      expect(decision.renderSource).toContain('<h1>Hello</h1>');
      expect(decision.srcdoc).toContain('piwin-artifact:ready');
      expect(decision.csp).toContain("default-src 'none'");
      expect(decision.themeRepairs).toEqual([]);
    }
  });

  it('builds surface-specific overflow policy for an explicit Canvas fence', () => {
    const decision = evaluateCodeFence({
      language: 'artifact-html title="Workspace" surface="canvas"',
      source: '<main>Wide workspace</main>',
      id: 'canvas-workspace',
    });

    expect(decision.kind).toBe('render');
    if (decision.kind === 'render') {
      expect(decision.descriptor.surface).toBe('canvas');
      expect(decision.srcdoc).toContain('overflow-x: auto !important');
      expect(decision.srcdoc).toContain('overflow-y: auto !important');
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
      expect(decision.streamSource).toBe('<div><p>Hi</p></div>');
      expect(decision.renderSource).toBe('<div><p>Hi</p></div>');
      expect(decision.srcdoc).toContain('piwin-artifact:stream-update');
      expect(decision.srcdoc).toContain('name="piwin-artifact-channel" content="stream"');
      expect(decision.srcdoc).not.toContain('content="stream-stream"');
    } else {
      expect(['preparing', 'blocked', 'code']).toContain(decision.kind);
    }
  });

  it('renders an incomplete SVG as a safe stream snapshot', () => {
    const decision = evaluateCodeFence({
      language: 'svg',
      source: '<svg viewBox="0 0 80 20"><text x="2" y="14">Lo',
      id: 'svg-stream',
      mode: 'stream-preview',
      htmlUiModeEnabled: true,
    });
    expect(decision.kind).toBe('render');
    if (decision.kind === 'render') {
      expect(decision.mode).toBe('stream-preview');
      expect(decision.streamSource).toContain('Lo</text></svg>');
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

  it('renders a safe svg fence through the Artifact srcdoc pipeline', () => {
    const decision = evaluateCodeFence({
      language: 'svg',
      source: '<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20" /></svg>',
      id: 'svg-render',
      htmlUiModeEnabled: true,
    });
    expect(decision.kind).toBe('render');
    if (decision.kind === 'render') {
      expect(decision.descriptor.type).toBe('svg');
      expect(decision.descriptor.source).toContain('<svg');
      expect(decision.srcdoc).toContain('<svg viewBox="0 0 100 60">');
      expect(decision.srcdoc).toContain("default-src 'none'");
      expect(decision.srcdoc).toContain('piwin-artifact:ready');
    }
  });
});
