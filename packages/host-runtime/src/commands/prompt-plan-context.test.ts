import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PromptInput } from '@piwin/contracts';
import { getPiwinSessionPlanPath } from '../paths.js';
import { createDelayedSessionHandle } from '../delayed-session-fixture.js';
import { handleSessionLiveCommand } from './session-live-commands.js';
import { createPromptContext } from './session-live-test-context.js';

describe('prompt plan context degradation', () => {
  it('still calls liveSession.prompt when plan.json is corrupt', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-prompt-corrupt-plan-'));
    const session = createDelayedSessionHandle();
    const { context, events } = createPromptContext(session);
    context.piwinRoot = rootDir;
    context.resolveIsConversationChat = async () => false;
    let promptCalls = 0;
    let modelFacingText = '';
    const originalPrompt = session.prompt.bind(session);
    session.prompt = async (input: PromptInput) => {
      promptCalls += 1;
      modelFacingText = input.text;
      return originalPrompt(input);
    };
    const planPath = getPiwinSessionPlanPath(rootDir, session.id);
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(planPath, '{not-json', 'utf8');

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: 'continue the work' },
      },
      undefined,
      context,
    );
    expect(response?.success).toBe(true);
    await session.promptSettled;
    await vi.waitFor(() => {
      expect(promptCalls).toBe(1);
    });
    expect(modelFacingText).toContain('continue the work');
    expect(modelFacingText).not.toContain('not-json');
    expect(
      events.some(
        (event) =>
          event.type === 'host/log' &&
          event.level === 'warn' &&
          event.message.includes('session plan load failed'),
      ),
    ).toBe(false);
  });
});
