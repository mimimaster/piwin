import { describe, expect, it } from 'vitest';
import type { PromptInput } from '@piwin/contracts';
import { createModelPromptAssembly } from '../model-context-assembly.js';
import { createControlContext, createSilentSessionHandle } from './session-live-test-context.js';
import { preparePromptInput } from './prompt-preparation.js';

describe('prompt preparation Inline layout wiring', () => {
  it.each([true, false])('prepares layout with artifact enabled=%s', async (enabled) => {
    const session = createSilentSessionHandle();
    const { context, activeRun } = createControlContext(session);
    const loadConfig = context.loadConfig;
    context.loadConfig = async () => {
      const config = await loadConfig();
      if (config.artifact) config.artifact.enabled = enabled;
      return config;
    };
    const recorded: string[] = [];
    context.recordUserPrompt = async (_sessionId, input) => { recorded.push(input.text); };
    const input: PromptInput = { text: 'Compare', inlineArtifactWidthPx: 680 };
    const result = await preparePromptInput(context,
      { type: 'session/prompt', sessionId: session.id, input },
      activeRun, createModelPromptAssembly(), true);
    expect(recorded).toEqual(['Compare']);
    expect(input).toEqual({ text: 'Compare', inlineArtifactWidthPx: 680 });
    expect(result.promptInput.text.includes('approximately 680 CSS px')).toBe(enabled);
    expect(result.promptInput.inlineArtifactWidthPx).toBeUndefined();
  });
});
