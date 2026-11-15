import { describe, expect, it } from 'vitest';
import {
  buildContextPromptSurfaceUpdates,
  CONTEXT_APPEND_PATH_META_KEY,
  CONTEXT_PROMPT_META_KEY,
  CONTEXT_SYSTEM_PATH_META_KEY,
} from './context-prompt-status.js';

describe('buildContextPromptSurfaceUpdates', () => {
  it('emits summary and full system/append paths from ContextManifest', () => {
    const updates = buildContextPromptSurfaceUpdates({
      agentsFiles: [{ kind: 'agents', source: 'project', absolutePath: '/repo/AGENTS.md' }],
      systemPrompt: { kind: 'system', source: 'project', absolutePath: '/repo/.pi/SYSTEM.md' },
      appendSystemPrompt: {
        kind: 'append-system',
        source: 'pi-native',
        absolutePath: '/home/.pi/agent/APPEND_SYSTEM.md',
      },
    });
    expect(updates).toEqual([
      {
        kind: 'status',
        key: CONTEXT_PROMPT_META_KEY,
        text: JSON.stringify({ sysSrc: 'project', appSrc: 'pi-native', agents: 1 }),
      },
      { kind: 'status', key: CONTEXT_SYSTEM_PATH_META_KEY, text: '/repo/.pi/SYSTEM.md' },
      {
        kind: 'status',
        key: CONTEXT_APPEND_PATH_META_KEY,
        text: '/home/.pi/agent/APPEND_SYSTEM.md',
      },
    ]);
  });

  it('clears path status updates when SYSTEM.md and APPEND_SYSTEM.md are absent', () => {
    const updates = buildContextPromptSurfaceUpdates({ agentsFiles: [] });
    expect(updates).toEqual([
      { kind: 'status', key: CONTEXT_PROMPT_META_KEY, text: JSON.stringify({ agents: 0 }) },
      { kind: 'status', key: CONTEXT_SYSTEM_PATH_META_KEY },
      { kind: 'status', key: CONTEXT_APPEND_PATH_META_KEY },
    ]);
  });
});
