/**
 * Composer `@` mention item shapes (files · folders · context · mcp).
 */

export type AtItemKind = 'file' | 'folder' | 'git' | 'mcp' | 'context';

export type AtGroupLabel = 'Workspace File' | 'Git Context' | 'System Context' | 'MCP Server';

export type AtItem = {
  id: string;
  kind: AtItemKind;
  /** Primary identifier or path (e.g. "src/App.tsx", "git:status"). */
  name: string;
  label: string;
  description: string;
  /** Text inserted into composer when selected (e.g. "@src/App.tsx "). */
  insertValue: string;
  groupLabel: AtGroupLabel;
  badge?: string;
};

export type ActiveAtToken = {
  /** Full token including leading `@`, e.g. "@src/Ap". */
  raw: string;
  /** Query string after `@` (may be empty). */
  query: string;
  /** Start index of `@` in full composer text. */
  startIndex: number;
  /** End index exclusive (caret position). */
  endIndex: number;
};
