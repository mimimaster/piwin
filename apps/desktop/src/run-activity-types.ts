import type { RunStatusKind } from './run-status.js';

export type RunActivityInput = {
  kind: RunStatusKind;
  activeToolName?: string;
  planStep?: string;
  elapsedMs?: number;
  locale: 'zh-CN' | 'en';
};

export type ActivityIconSource = {
  kind: RunStatusKind;
  lucideName: string;
  imgSrc?: string;
};
