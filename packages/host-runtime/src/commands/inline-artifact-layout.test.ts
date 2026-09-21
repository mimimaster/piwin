/**
 * Prompt-preparation wiring for the advisory Artifact rendering block.
 *
 * The block is gated by the session's *resolved* Artifact capability, not by the
 * master switch alone: the scope class comes from the durable session record
 * (the same record the blueprint compiler reads), so Agent chat — which ships
 * with both surfaces off — never receives a chat-column/theme hint.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PiwinConfig, PromptInput, SessionScope } from '@piwin/contracts';
import { createSessionRecord, upsertSessionRecord } from '@piwin/session';
import { createModelPromptAssembly } from '../model-context-assembly.js';
import { getPiwinSessionIndexPath } from '../paths.js';
import { createControlContext, createSilentSessionHandle } from './session-live-test-context.js';
import { preparePromptInput } from './prompt-preparation.js';

let piwinRoot: string;

beforeEach(async () => {
  piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-prompt-artifact-'));
});

afterEach(async () => {
  await rm(piwinRoot, { recursive: true, force: true });
});

async function seedSession(sessionId: string, scope: SessionScope): Promise<void> {
  await upsertSessionRecord(
    getPiwinSessionIndexPath(piwinRoot),
    createSessionRecord({
      id: sessionId,
      projectPath: piwinRoot,
      scope,
      name: 'artifact prompt',
    }),
  );
}

async function runPrompt(options: {
  scope?: SessionScope;
  seed?: boolean;
  mutate?: (config: PiwinConfig) => void;
}): Promise<{ text: string; input: PromptInput }> {
  const session = createSilentSessionHandle();
  const { context, activeRun } = createControlContext(session);
  context.piwinRoot = piwinRoot;
  if (options.seed !== false) {
    await seedSession(session.id, options.scope ?? { kind: 'general' });
  }
  const loadConfig = context.loadConfig;
  context.loadConfig = async () => {
    const config = await loadConfig();
    options.mutate?.(config);
    return config;
  };
  const recorded: string[] = [];
  context.recordUserPrompt = async (_sessionId, input) => {
    recorded.push(input.text);
  };

  const input: PromptInput = { text: 'Compare', inlineArtifactWidthPx: 680 };
  const result = await preparePromptInput(
    context,
    { type: 'session/prompt', sessionId: session.id, input },
    activeRun,
    createModelPromptAssembly(),
    true,
  );
  expect(recorded).toEqual(['Compare']);
  // The client fields never survive into the prompt input; the block is text.
  expect(input).toEqual({ text: 'Compare', inlineArtifactWidthPx: 680 });
  expect(result.promptInput.inlineArtifactWidthPx).toBeUndefined();
  return { text: result.promptInput.text, input };
}

describe('prompt preparation Inline layout wiring', () => {
  it('injects the layout block for a Conversation chat session', async () => {
    const { text } = await runPrompt({ scope: { kind: 'general' } });
    expect(text).toContain('approximately 680 CSS px');
  });

  it('injects nothing for Agent chat, which ships with both surfaces off', async () => {
    const { text } = await runPrompt({ scope: { kind: 'project', projectPath: piwinRoot } });
    expect(text).not.toContain('CSS px');
    expect(text).not.toContain('Sending client theme');
  });

  it('injects for Agent chat once a surface is opted back in', async () => {
    const { text } = await runPrompt({
      scope: { kind: 'project', projectPath: piwinRoot },
      mutate: (config) => {
        config.artifact.scopes = {
          general: { inline: true, canvas: true },
          project: { inline: true, canvas: false },
        };
      },
    });
    expect(text).toContain('approximately 680 CSS px');
  });

  it('injects nothing when the master switch is off', async () => {
    const { text } = await runPrompt({
      scope: { kind: 'general' },
      mutate: (config) => {
        config.artifact.enabled = false;
      },
    });
    expect(text).not.toContain('CSS px');
  });

  it('injects nothing when the session class cannot be resolved', async () => {
    const { text } = await runPrompt({ seed: false });
    expect(text).not.toContain('CSS px');
    expect(text).not.toContain('Sending client theme');
  });
});
