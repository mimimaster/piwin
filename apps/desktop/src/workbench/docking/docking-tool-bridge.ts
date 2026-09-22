import type { RightPanelTab } from '../../right-panel.js';
import { rightPanelTabKind } from '../../right-panel-instances.js';
import type { MovableToolKind } from './types.js';

/** Inspector tabs whose surface moves into the docking workspace. */
export const DOCKING_OWNED_INSPECTOR_TABS: readonly RightPanelTab[] = [
  'browser',
  'review',
  'canvas',
  'docPreview',
];

export function inspectorTabToToolKind(tab: RightPanelTab | null): MovableToolKind | null {
  const kind = tab ? rightPanelTabKind(tab) : null;
  if (kind === 'browser') return 'browser';
  if (kind === 'review') return 'changes';
  if (kind === 'canvas') return 'canvas';
  if (kind === 'docPreview') return 'doc';
  return null;
}

export function toolKindToInspectorTab(kind: MovableToolKind): RightPanelTab {
  if (kind === 'changes') return 'review';
  if (kind === 'doc') return 'docPreview';
  return kind;
}

/** Tab id of one docked tool view. Browsers are instances; other tools are one per kind. */
export function dockedToolTabId(kind: MovableToolKind, browsersBefore: number): RightPanelTab {
  if (kind !== 'browser') return toolKindToInspectorTab(kind);
  return (browsersBefore === 0 ? 'browser' : `browser-${browsersBefore + 1}`) as RightPanelTab;
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
