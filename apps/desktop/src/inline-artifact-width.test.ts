// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { readInlineArtifactWidth } from './inline-artifact-width.js';

afterEach(() => document.body.replaceChildren());

function addColumn(sessionId: string, width: number): HTMLElement {
  const root = document.createElement('div');
  root.dataset.artifactLayoutSession = sessionId;
  const column = document.createElement('div');
  column.className = 'chat-thread';
  Object.defineProperty(column, 'clientWidth', { configurable: true, value: width });
  root.append(column);
  document.body.append(root);
  return column;
}

describe('send-time Inline width', () => {
  it('isolates sessions, subtracts padding and remeasures on the next send', () => {
    addColumn('other', 1200);
    const column = addColumn('active', 720);
    column.style.padding = '0 20px';
    expect(readInlineArtifactWidth('active')).toBe(680);
    Object.defineProperty(column, 'clientWidth', { value: 400 });
    expect(readInlineArtifactWidth('active')).toBe(360);
  });
  it('ignores hidden/unmounted columns and chooses the narrower duplicate', () => {
    addColumn('active', 0);
    addColumn('active', 720);
    addColumn('active', 480);
    expect(readInlineArtifactWidth('active')).toBe(480);
    expect(readInlineArtifactWidth('missing')).toBeUndefined();
    expect(readInlineArtifactWidth(null)).toBeUndefined();
  });
  it('measures the marked main transcript before the first session exists', () => {
    const root = document.createElement('div');
    root.dataset.artifactLayoutRoot = 'main';
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 640 });
    document.body.append(root);
    expect(readInlineArtifactWidth(null)).toBe(640);
  });
});
