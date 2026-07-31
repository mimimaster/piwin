import type { RunStatusKind } from './run-status.js';

export type ActivityActionCategory =
  | 'terminal'
  | 'edit'
  | 'search'
  | 'web'
  | 'subagent'
  | 'ask'
  | 'thinking'
  | 'planning';

export type RunActivityInput = {
  kind: RunStatusKind;
  activeToolName?: string;
  actionCategory?: ActivityActionCategory;
  planStep?: string;
  elapsedMs?: number;
  locale: 'zh-CN' | 'en';
};

export type ActivityIconSource = {
  kind: RunStatusKind;
  actionCategory?: ActivityActionCategory;
  lucideName: string;
};

