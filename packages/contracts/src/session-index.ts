/** Lightweight session index (product-side, not Pi JSONL internals). */

export type SubagentStatus = 'running' | 'done' | 'failed' | 'cancelled';

export type SessionIndexRecord = {
  id: string;
  projectPath: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastPreview?: string;
  /** Optional path to Pi session file when known */
  piSessionFile?: string;
  /** Parent session when this is a product-layer sub-agent. */
  parentSessionId?: string;
  /** 0 = main, 1 = sub-agent (max depth). */
  depth?: number;
  kind?: 'main' | 'subagent';
  subagentStatus?: SubagentStatus;
  /** Brief task description for sub-agents. */
  task?: string;
  /** When set, child summary was merged into parent product transcript. */
  mergedAt?: string;
  /** Parent transcript message id for the merge card (idempotency). */
  mergeMessageId?: string;
  /** Short extractive summary for list cards. */
  summaryPreview?: string;
  /** CE-CHAT pin fields (product index; not Pi JSONL). */
  isPinned?: boolean;
  pinnedAt?: string;
};

export type SessionIndexDocument = {
  version: 1;
  sessions: SessionIndexRecord[];
};
