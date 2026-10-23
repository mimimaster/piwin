import type { RunStatusKind } from './run-status.js';

export type ActivityActionCategory =
  'terminal' | 'edit' | 'search' | 'web' | 'subagent' | 'ask' | 'thinking' | 'planning';

export type RunActivityInput = {
  kind: RunStatusKind;
  activeToolName?: string;
  actionCategory?: ActivityActionCategory;
  planStep?: string;
  elapsedMs?: number;
  locale: 'zh-CN' | 'en';
  /**
   * Host-normalized work detail (path / command / query) from ToolPresentation.
   * Prefer this over the raw tool name for the primary bubble line.
   */
  detail?: string;
  /** Host action verb (e.g. "Read", "Ran command"); desktop may localize. */
  actionVerb?: string;
};

export type ActivityIconSource = {
  kind: RunStatusKind;
  actionCategory?: ActivityActionCategory;
  lucideName: string;
};
