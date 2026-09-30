import { describe, expect, it, vi } from 'vitest';

import { createModelPromptAssembly } from '../model-context-assembly.js';
import type { SessionLiveContext } from './session-live-context.js';
import { injectTurnChangeNotice } from './session-turn-executor.js';

function contextWith(read: SessionLiveContext['readTurnChangeNotice']): SessionLiveContext {
  return { readTurnChangeNotice: read, push: vi.fn() } as unknown as SessionLiveContext;
}

describe('injectTurnChangeNotice', () => {
  it('prepends the note, records it in the assembly, then marks it delivered', () => {
    const commit = vi.fn();
    const prompt = { text: 'next question' };
    const assembly = createModelPromptAssembly();
    injectTurnChangeNotice(contextWith(() => ({ text: '[piwin-turn-changes]\nnote', commit })), 's1', prompt, assembly);
    expect(prompt.text).toBe('[piwin-turn-changes]\nnote\n\nnext question');
    expect(commit).toHaveBeenCalledOnce();
    const summary = assembly.toSummary({ sessionId: 's1', runId: 'r1', requestClass: 'prompt', requestOrdinal: 1 });
    expect(JSON.stringify(summary)).toContain('Undo / redo since last prompt');
  });

  it('leaves the prompt alone when there is nothing to tell or reading fails', () => {
    const prompt = { text: 'hello' };
    injectTurnChangeNotice(contextWith(() => undefined), 's1', prompt, createModelPromptAssembly());
    expect(prompt.text).toBe('hello');
    const failing = contextWith(() => {
      throw new Error('db locked');
    });
    injectTurnChangeNotice(failing, 's1', prompt, createModelPromptAssembly());
    expect(prompt.text).toBe('hello');
    expect(failing.push).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });
});
