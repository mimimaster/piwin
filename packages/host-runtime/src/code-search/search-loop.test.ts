import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodeSearchLoop, type CodeSearchLoopBudget } from './search-loop.js';
import {
  CodeSearchCompletionError,
  type CodeSearchCompletionPort,
  type CodeSearchCompletionRequest,
  type CodeSearchCompletionResponse,
} from './completion-port.js';
import { CODE_SEARCH_ANSWER_TOOL, CODE_SEARCH_RESTRICTED_EXEC_TOOL } from './tool-schema.js';
import { CODE_SEARCH_FORCE_ANSWER } from './prompts.js';

const BUDGET: CodeSearchLoopBudget = {
  maxTurns: 3,
  maxCommands: 8,
  maxResults: 10,
  includeSnippets: true,
  lineMaxChars: 250,
  resultMaxLines: 50,
  excludePaths: ['node_modules'],
  timeoutMs: 30_000,
};

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'piwin-search-loop-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'src/app.ts'),
    ['export function createHandler() {', '  return 1;', '}'].join('\n'),
  );
});

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
});

function scriptedPort(
  script: Array<
    CodeSearchCompletionResponse | ((request: CodeSearchCompletionRequest, round: number) => CodeSearchCompletionResponse)
  >,
): { port: CodeSearchCompletionPort; requests: CodeSearchCompletionRequest[] } {
  const requests: CodeSearchCompletionRequest[] = [];
  const port: CodeSearchCompletionPort = async (request) => {
    const round = requests.length;
    // Snapshot: the loop keeps appending to its live message array.
    requests.push({ ...request, messages: [...request.messages] });
    const step = script[Math.min(round, script.length - 1)];
    if (!step) {
      throw new Error('script exhausted');
    }
    return typeof step === 'function' ? step(request, round) : step;
  };
  return { port, requests };
}

function answer(text: string): CodeSearchCompletionResponse {
  return {
    text: '',
    toolCalls: [{ id: 'a1', name: CODE_SEARCH_ANSWER_TOOL, arguments: { answer: text } }],
  };
}

function execCall(args: Record<string, unknown>, id = 'e1'): CodeSearchCompletionResponse {
  return {
    text: 'searching',
    toolCalls: [{ id, name: CODE_SEARCH_RESTRICTED_EXEC_TOOL, arguments: args }],
  };
}

function run(port: CodeSearchCompletionPort, budget: Partial<CodeSearchLoopBudget> = {}) {
  return runCodeSearchLoop({
    root,
    query: 'where is createHandler defined',
    repoMap: '/codebase\n├── src',
    repoMapDepth: 1,
    budget: { ...BUDGET, ...budget },
    complete: port,
  });
}

describe('runCodeSearchLoop', () => {
  it('searches, then answers with the verified framing', async () => {
    const { port, requests } = scriptedPort([
      execCall({ command1: { type: 'rg', pattern: 'createHandler', path: '/codebase/src' } }),
      answer('<ANSWER><file path="/codebase/src/app.ts"><range>1-3</range></file></ANSWER>'),
    ]);

    const outcome = await run(port);

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.fileCount).toBe(1);
    expect(outcome.rounds).toBe(2);
    expect(outcome.output).toBe(
      [
        'A search subagent explored the codebase, running these commands:',
        '- Grepped createHandler in src',
        '',
        'It believes the snippets below are relevant to your search. Be careful evaluating their relevance — the subagent can make mistakes — and follow up with your normal grep/glob/read tools to fill in anything it missed:',
        '',
        '<file path="src/app.ts" total_lines=3>',
        '1|export function createHandler() {',
        '2|  return 1;',
        '3|}',
        '</file>',
      ].join('\n'),
    );
    // The command output was fed back to the subagent before it answered.
    const second = requests[1]?.messages.at(-1);
    expect(second?.role).toBe('tool');
    expect(second && second.role === 'tool' ? second.content : '').toContain(
      'src/app.ts:1|export function createHandler() {',
    );
  });

  it('totals maxTurns + 1 rounds and forces the answer on the last one', async () => {
    const { port, requests } = scriptedPort([
      execCall({ command1: { type: 'ls', path: '/codebase' } }),
    ]);

    const outcome = await run(port, { maxTurns: 2 });

    // 2 turns of searching + 1 forced answer round.
    expect(requests).toHaveLength(3);
    const lastMessages = requests[2]?.messages ?? [];
    expect(lastMessages.at(-1)).toEqual({ role: 'user', content: CODE_SEARCH_FORCE_ANSWER });
    // The force prompt appears only on the final round.
    expect(requests[1]?.messages.some((message) => message.content === CODE_SEARCH_FORCE_ANSWER)).toBe(
      false,
    );
    expect(outcome.status).toBe('no-ranges');
  });

  it('caps the executed batch at maxCommands', async () => {
    const commands: Record<string, unknown> = {};
    for (let index = 1; index <= 4; index += 1) {
      commands[`command${index}`] = { type: 'ls', path: '/codebase' };
    }
    const { port, requests } = scriptedPort([
      execCall(commands),
      answer('<ANSWER><file path="/codebase/src/app.ts"><range>1-1</range></file></ANSWER>'),
    ]);

    const outcome = await run(port, { maxCommands: 2 });

    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.output.match(/^- Listed/gm)).toHaveLength(2);
    }
    const feedback = requests[1]?.messages.at(-1);
    expect(feedback && feedback.role === 'tool' ? feedback.content : '').toContain(
      '<command2_result>',
    );
    expect(feedback && feedback.role === 'tool' ? feedback.content : '').not.toContain(
      '<command3_result>',
    );
  });

  it('treats an empty ANSWER as a legitimate no-results answer', async () => {
    const { port } = scriptedPort([answer('<ANSWER></ANSWER>')]);
    const outcome = await run(port);
    expect(outcome.status).toBe('no-results');
    expect(outcome.output).toBe(
      'Fast-context search did not find relevant code. Verify with your normal grep/glob/read tools.',
    );
  });

  it('surfaces refused paths alongside the no-results sentence', async () => {
    const { port } = scriptedPort([
      answer('<ANSWER><file path="/etc/hosts"><range>1-2</range></file></ANSWER>'),
    ]);
    const outcome = await run(port);
    expect(outcome.status).toBe('no-results');
    expect(outcome.output).toContain('Refused paths outside the search root: /etc/hosts');
  });

  it('reports a prose answer as no-ranges with the raw text', async () => {
    const { port } = scriptedPort([{ text: 'I think it is in src/app.ts', toolCalls: [] }]);
    const outcome = await run(port);
    expect(outcome.status).toBe('no-ranges');
    if (outcome.status === 'no-ranges') {
      expect(outcome.rawResponse).toBe('I think it is in src/app.ts');
      expect(outcome.output).toContain('Fast-context search did not return any file ranges.');
    }
  });

  it('reports a malformed answer tool call as no-ranges', async () => {
    const { port } = scriptedPort([answer('not xml at all')]);
    const outcome = await run(port);
    expect(outcome.status).toBe('no-ranges');
  });

  it('accepts a final-round XML answer in text (custom model, no answer tool)', async () => {
    const { port } = scriptedPort([
      execCall({ command1: { type: 'rg', pattern: 'createHandler', path: '/codebase/src' } }),
      {
        text: `<ANSWER>
  <file path="/codebase/src/app.ts">
    <range>1-3</range>
  </file>
</ANSWER>`,
        toolCalls: [],
      },
    ]);
    const outcome = await run(port, { maxTurns: 1 });
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.fileCount).toBe(1);
      expect(outcome.output).toContain('src/app.ts');
      expect(outcome.output).not.toContain('did not return any file ranges');
    }
  });

  it('accepts an unclosed ANSWER from the answer tool', async () => {
    const { port } = scriptedPort([
      answer('<ANSWER><file path="/codebase/src/app.ts"><range>1-3</range></file>'),
    ]);
    const outcome = await run(port);
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.fileCount).toBe(1);
    }
  });

  it('answers every tool call so the provider can pair them', async () => {
    const { port, requests } = scriptedPort([
      {
        text: 'mixed',
        toolCalls: [
          { id: 'e1', name: CODE_SEARCH_RESTRICTED_EXEC_TOOL, arguments: { command1: { type: 'ls', path: '/codebase' } } },
          { id: 'x1', name: 'shell', arguments: { command: 'rm -rf /' } },
        ],
      },
      answer('<ANSWER></ANSWER>'),
    ]);

    await run(port);

    const toolMessages = (requests[1]?.messages ?? []).filter((message) => message.role === 'tool');
    expect(toolMessages.map((message) => (message.role === 'tool' ? message.toolCallId : ''))).toEqual([
      'e1',
      'x1',
    ]);
    const unknown = toolMessages[1];
    expect(unknown && unknown.role === 'tool' ? unknown.content : '').toContain(
      'Error: unknown tool "shell"',
    );
  });

  it('reports provider failures as an error status instead of throwing', async () => {
    const port: CodeSearchCompletionPort = async () => {
      throw new CodeSearchCompletionError('provider-timeout', 'Code search round timed out after 30 seconds');
    };
    const outcome = await run(port);
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') {
      expect(outcome.message).toContain('timed out');
      expect(outcome.output).toContain('Error: Code search round timed out');
    }
  });

  it('tells the subagent when a batch had no valid commands', async () => {
    const { port, requests } = scriptedPort([
      execCall({ command1: { type: 'rg' } }),
      answer('<ANSWER></ANSWER>'),
    ]);
    await run(port);
    const feedback = requests[1]?.messages.at(-1);
    expect(feedback && feedback.role === 'tool' ? feedback.content : '').toContain(
      'rg requires a non-empty pattern',
    );
  });

  it('passes the budget into the system prompt and the tools into every round', async () => {
    const { port, requests } = scriptedPort([answer('<ANSWER></ANSWER>')]);
    await run(port, { maxTurns: 2, maxCommands: 5, maxResults: 4 });
    expect(requests[0]?.systemPrompt).toContain('at most 2 turns');
    expect(requests[0]?.systemPrompt).toContain('at most 5 commands');
    expect(requests[0]?.systemPrompt).toContain('at most 4 files');
    const parameters = requests[0]?.tools[0]?.parameters as { properties: Record<string, unknown> };
    expect(Object.keys(parameters.properties)).toHaveLength(5);
  });

  it('renders a path and range list when snippets are disabled', async () => {
    const { port } = scriptedPort([
      answer('<ANSWER><file path="/codebase/src/app.ts"><range>1-3</range></file></ANSWER>'),
    ]);
    const outcome = await run(port, { includeSnippets: false });
    expect(outcome.status).toBe('ok');
    expect(outcome.output).toContain('  src/app.ts (L1-3)');
    expect(outcome.output).not.toContain('1|export function createHandler() {');
  });

  it('reports a duration from the injected clock', async () => {
    const { port } = scriptedPort([answer('<ANSWER></ANSWER>')]);
    const ticks = [1_000, 1_250];
    let index = 0;
    const outcome = await runCodeSearchLoop({
      root,
      query: 'q',
      repoMap: '/codebase',
      repoMapDepth: 1,
      budget: BUDGET,
      complete: port,
      now: () => ticks[Math.min(index++, ticks.length - 1)] ?? 0,
    });
    expect(outcome.durationMs).toBe(250);
  });

  it('does not run commands on the forced answer round', async () => {
    // Every round asks for a tool call, so the final round must not execute.
    const { port } = scriptedPort([
      execCall({ command1: { type: 'tree', path: '/codebase' } }),
    ]);
    const outcome = await run(port, { maxTurns: 1 });
    expect(outcome.status).toBe('no-ranges');
    expect(outcome.rounds).toBe(2);
  });
});
