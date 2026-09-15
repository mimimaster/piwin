import { describe, expect, it, vi } from 'vitest';
import { inspectorTabToToolKind, tryOpenDockingTool } from './docking-tool-bridge.js';

describe('docking tool bridge', () => {
  it('maps inspector tabs to movable tool kinds', () => {
    expect(inspectorTabToToolKind('browser')).toBe('browser');
    expect(inspectorTabToToolKind('review')).toBe('changes');
    expect(inspectorTabToToolKind('canvas')).toBe('canvas');
    expect(inspectorTabToToolKind('docPreview')).toBe('doc');
    expect(inspectorTabToToolKind('files')).toBeNull();
    expect(inspectorTabToToolKind(null)).toBeNull();
  });

  it('opens the docking tool only when the flag is on and the tab is movable', () => {
    const openToolView = vi.fn();
    expect(tryOpenDockingTool({ enabled: false, tab: 'browser', openToolView })).toBe(false);
    expect(openToolView).not.toHaveBeenCalled();
    expect(tryOpenDockingTool({ enabled: true, tab: 'files', openToolView })).toBe(false);
    expect(tryOpenDockingTool({ enabled: true, tab: 'browser', openToolView })).toBe(true);
    expect(openToolView).toHaveBeenCalledWith('browser');
  });
});
