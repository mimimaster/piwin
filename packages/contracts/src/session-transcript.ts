/** Product-side chat transcript (not Pi JSONL internals). */

import type { AgentMessageRole, MediaAttachmentRef } from './host.js';

export type SessionToolCardView = {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  output: string;
};

export type SessionTranscriptMessage = {
  id: string;
  role: AgentMessageRole;
  text: string;
  createdAt: string;
  status: 'streaming' | 'done' | 'error';
  thinking?: string;
  tools?: SessionToolCardView[];
  attachments?: MediaAttachmentRef[];
};

export type SessionTranscriptDocument = {
  version: 1;
  sessionId: string;
  projectPath: string;
  messages: SessionTranscriptMessage[];
  updatedAt: string;
};

export type SessionResumeData = {
  sessionId: string;
  /** True when a live host handle is bound and can accept prompts. */
  live: boolean;
  messages: SessionTranscriptMessage[];
  projectPath?: string;
  name?: string;
  /** Linear message outline for jump-scroll UI (not a multi-branch Pi tree). */
  outline?: SessionOutlineNode[];
};

/** Lightweight linear outline derived from product transcript. */
export type SessionOutlineNode = {
  id: string;
  role: AgentMessageRole;
  preview: string;
  createdAt: string;
};
