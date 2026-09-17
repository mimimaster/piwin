import type { RightPanelTab } from '../../right-panel.js';
import type { MovableToolKind } from './types.js';

/** Inspector tabs whose surface moves into the docking workspace. */
export const DOCKING_OWNED_INSPECTOR_TABS: readonly RightPanelTab[] = [
  'browser',
  'review',
  'canvas',
  'docPreview',
];

export function inspectorTabToToolKind(tab: RightPanelTab | null): MovableToolKind | null {
  if (tab === 'browser') return 'browser';
  if (tab === 'review') return 'changes';
  if (tab === 'canvas') return 'canvas';
  if (tab === 'docPreview') return 'doc';
  return null;
}

export function toolKindToInspectorTab(kind: MovableToolKind): RightPanelTab {
  if (kind === 'changes') return 'review';
  if (kind === 'doc') return 'docPreview';
  return kind;
}

export function tryOpenDockingTool(args: {
  enabled: boolean;
  tab: RightPanelTab | null;
  openToolView: (kind: MovableToolKind) => void;
}): boolean {
  if (!args.enabled) return false;
  const kind = inspectorTabToToolKind(args.tab);
  if (!kind) return false;
  args.openToolView(kind);
  return true;
}
