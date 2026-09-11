import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { projectTranscriptMessagesForUi } from './transcript-ui-projection.js';

describe('projectTranscriptMessagesForUi', () => {
  it('strips heavy tool output and presentation.output while keeping head fields', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        text: 'done',
        createdAt: '2026-07-24T00:00:00.000Z',
        status: 'done',
        thinking: 'plan',
        tools: [
          {
            toolCallId: 't1',
            toolName: 'bash',
            status: 'done',
            output: 'x'.repeat(50_000),
            presentation: {
              kind: 'shell',
              title: 'bash',
              routedToolName: 'image_gen',
              actionVerb: 'Ran command',
              command: 'ls',
              summary: 'ls',
              changedPaths: ['a.ts'],
              output: { text: 'y'.repeat(80_000), truncated: true },
            },
          },
        ],
      },
    ];

    const slim = projectTranscriptMessagesForUi(messages);
    const tool = slim[0]?.tools?.[0];
    expect(tool?.output).toBe('');
    expect(tool?.presentation?.command).toBe('ls');
    expect(tool?.presentation?.routedToolName).toBe('image_gen');
    expect(tool?.presentation?.changedPaths).toEqual(['a.ts']);
    expect(tool?.presentation?.output).toBeUndefined();
    expect(slim[0]?.thinking).toBe('plan');
    expect(slim[0]?.text).toBe('done');

    const fullSize = JSON.stringify(messages).length;
    const slimSize = JSON.stringify(slim).length;
    expect(slimSize).toBeLessThan(fullSize / 10);
  });

  it('preserves MCP tool args and results across UI hydrate', () => {
    const memoryResult = JSON.stringify([
      { content: 'Canvas stream-preview needs a fragment root', category: 'bugfix' },
    ]);
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a-mcp',
        role: 'assistant',
        text: 'done',
        createdAt: '2026-09-07T00:00:00.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 'mcp-1',
            toolName: 'mcp__agent-memory__agent_memory_search',
            status: 'done',
            output: memoryResult,
            presentation: {
              kind: 'mcp',
              title: 'agent-memory / agent_memory_search',
              actionVerb: 'MCP (agent-memory)',
              summary: 'agent_memory_search',
              inputPreview: '{"project":"piwin","query":"canvas white"}',
              output: { text: memoryResult },
            },
          },
        ],
      },
    ];

    const tool = projectTranscriptMessagesForUi(messages)[0]?.tools?.[0];
    expect(tool?.output).toBe(memoryResult);
    expect(tool?.presentation?.inputPreview).toContain('canvas white');
    expect(tool?.presentation?.output?.text).toContain('fragment root');
    expect(tool?.presentation?.title).toBe('agent-memory / agent_memory_search');
  });

  it('keeps Health card fields when slimming UI hydrate', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        text: 'done',
        createdAt: '2026-08-23T00:00:00.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 't1',
            toolName: 'health_read_context',
            status: 'done',
            output: 'secret health series',
            presentation: {
              kind: 'health',
              title: 'health_read_context',
              sensitivity: 'health',
              health: {
                metrics: ['steps'],
                periodLabel: '今天',
                status: 'completed',
              },
              output: { text: 'secret health series' },
            },
          },
        ],
      },
    ];
    const tool = projectTranscriptMessagesForUi(messages)[0]?.tools?.[0];
    expect(tool?.output).toBe('');
    expect(tool?.presentation?.output).toBeUndefined();
    expect(tool?.presentation?.sensitivity).toBe('health');
    expect(tool?.presentation?.health).toEqual({
      metrics: ['steps'],
      periodLabel: '今天',
      status: 'completed',
    });
  });

  it('keeps compact truncation metadata when bulk output is omitted', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a-truncated',
        role: 'assistant',
        text: 'done',
        createdAt: '2026-08-25T00:00:00.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 'read-truncated',
            toolName: 'read',
            status: 'done',
            output: 'large output',
            presentation: {
              kind: 'filesystem',
              title: 'Read',
              output: {
                text: 'large output',
                truncated: true,
                truncation: {
                  reason: 'line-limit',
                  shownLines: { start: 1, end: 2000 },
                  totalLines: 6280,
                  nextOffset: 2001,
                },
              },
            },
          },
        ],
      },
    ];

    const tool = projectTranscriptMessagesForUi(messages)[0]?.tools?.[0];
    expect(tool?.output).toBe('');
    expect(tool?.presentation?.output).toEqual({
      text: '',
      truncated: true,
      truncation: {
        reason: 'line-limit',
        shownLines: { start: 1, end: 2000 },
        totalLines: 6280,
        nextOffset: 2001,
      },
    });
  });

  it('leaves messages without tools unchanged by reference shape', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'u1',
        role: 'user',
        text: 'hi',
        createdAt: '2026-07-24T00:00:00.000Z',
        status: 'done',
      },
    ];
    const slim = projectTranscriptMessagesForUi(messages);
    expect(slim[0]).toBe(messages[0]);
  });

  it('preserves tool output, presentation.output, and flashcard display for flashcard_create tools', () => {
    const flashcardPayload = JSON.stringify({
      card: { id: 'card-1', front: 'Q', back: 'A' },
      display: {
        cards: [
          {
            cardId: 'card-1',
            itemId: 'card-1',
            model: 'basic',
            ordinal: 1,
            deck: 'default',
            front: 'Q',
            back: 'A',
            createdAt: '2026-08-24T00:00:00.000Z',
          },
        ],
      },
    });
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a2',
        role: 'assistant',
        text: 'card created',
        createdAt: '2026-07-24T00:00:00.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 't2',
            toolName: 'piwin_toolbox',
            status: 'done',
            output: flashcardPayload,
            presentation: {
              kind: 'other',
              title: 'flashcard_create',
              routedToolName: 'flashcard_create',
              output: { text: flashcardPayload, truncated: false },
              flashcard: {
                cards: [
                  {
                    cardId: 'card-1',
                    itemId: 'card-1',
                    model: 'basic',
                    ordinal: 1,
                    deck: 'default',
                    front: 'Q',
                    back: 'A',
                    createdAt: '2026-08-24T00:00:00.000Z',
                  },
                ],
              },
            },
          },
        ],
      },
    ];
    const slim = projectTranscriptMessagesForUi(messages);
    const tool = slim[0]?.tools?.[0];
    expect(tool?.output).toBe(flashcardPayload);
    expect(tool?.presentation?.output?.text).toBe(flashcardPayload);
    expect(tool?.presentation?.flashcard?.cards[0]?.front).toBe('Q');
    expect(flashcardPayload).not.toContain('artifactHtml');
  });

  it('keeps logical documentTargets so historical skill reads can reopen Doc Preview', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a-skill',
        role: 'assistant',
        text: 'done',
        createdAt: '2026-09-06T00:00:00.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 'read-skill',
            toolName: 'read',
            status: 'done',
            output: '# Image Generation\n',
            presentation: {
              kind: 'filesystem',
              title: 'read',
              actionVerb: 'Read',
              targetPaths: ['/Users/me/.piwin-test/skills/imagegen/SKILL.md'],
              documentTargets: [
                { kind: 'skill', skillId: 'imagegen', displayRef: 'skill:imagegen' },
              ],
              output: { text: '# Image Generation\n' },
            },
          },
        ],
      },
    ];
    const tool = projectTranscriptMessagesForUi(messages)[0]?.tools?.[0];
    expect(tool?.output).toBe('');
    expect(tool?.presentation?.output).toBeUndefined();
    expect(tool?.presentation?.targetPaths).toEqual([
      '/Users/me/.piwin-test/skills/imagegen/SKILL.md',
    ]);
    expect(tool?.presentation?.documentTargets).toEqual([
      { kind: 'skill', skillId: 'imagegen', displayRef: 'skill:imagegen' },
    ]);
  });

  it('preserves the message-bound plan display payload across hydrate slimming', () => {
    const plan = {
      id: 'plan-1',
      sessionId: 'session-1',
      projectPath: '/repo',
      status: 'draft' as const,
      title: 'Ship the fix',
      goal: 'Make the flow reliable',
      steps: [{ id: '1', title: 'Implement', status: 'pending' as const }],
      revision: 0,
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
      source: 'assistant' as const,
    };
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a-plan',
        role: 'assistant',
        text: 'saved',
        createdAt: '2026-09-11T00:00:00.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 'plan-call',
            toolName: 'piwin_plan_create',
            status: 'done',
            output: 'saved',
            presentation: {
              kind: 'other',
              title: 'piwin_plan_create',
              plan: {
                version: 1,
                path: '/home/user/.piwin/sessions/session-1/plan.json',
                displayPath: 'plans/session-1.md',
                plan,
              },
            },
          },
        ],
      },
    ];
    const tool = projectTranscriptMessagesForUi(messages)[0]?.tools?.[0];
    expect(tool?.output).toBe('saved');
    expect(tool?.presentation?.plan).toEqual({
      version: 1,
      path: '/home/user/.piwin/sessions/session-1/plan.json',
      displayPath: 'plans/session-1.md',
      plan,
    });
  });

  it('keeps the plan tool text fallback when the structured display payload is absent', () => {
    const path = '/home/user/.piwin/sessions/session-1/plan.json';
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a-plan-fallback',
        role: 'assistant',
        text: 'saved',
        createdAt: '2026-09-11T00:00:00.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 'plan-call',
            toolName: 'piwin_plan_create',
            status: 'done',
            output: `draft plan saved at ${path}`,
            presentation: { kind: 'other', title: 'piwin_plan_create' },
          },
        ],
      },
    ];

    const tool = projectTranscriptMessagesForUi(messages)[0]?.tools?.[0];
    expect(tool?.output).toContain(path);
  });
});
