/**
 * The `code_search` search subagent loop.
 *
 * Shape follows the recorded Devin behaviour: total rounds are `maxTurns + 1`
 * (the last round exists only to produce an answer), a round executes one
 * `restricted_exec` batch in parallel, and the force-answer prompt is appended
 * before the final round so a stuck subagent still returns something usable.
 *
 * Everything provider-specific lives behind {@link CodeSearchCompletionPort};
 * everything filesystem-specific lives in `restricted-executor`.
 */
import { readFile } from 'node:fs/promises';
import {
  formatCommandSlotErrors,
  parseRestrictedExecArguments,
} from './command-parse.js';
import { extractAnswerXml, parseCodeSearchAnswer } from './answer-parse.js';
import {
  CODE_SEARCH_FORCE_ANSWER,
  buildCodeSearchSystemPrompt,
  buildCodeSearchUserMessage,
} from './prompts.js';
import { splitContentLines } from './command-output.js';
import {
  formatCodeSearchNoRanges,
  formatCodeSearchNoResults,
  formatCodeSearchResult,
  type CodeSearchLineReader,
} from './result-format.js';
import {
  createRestrictedExecutor,
  type CodeSearchRestrictedCommand,
} from './restricted-executor.js';
import {
  CODE_SEARCH_ANSWER_TOOL,
  CODE_SEARCH_RESTRICTED_EXEC_TOOL,
  buildCodeSearchToolSchemas,
} from './tool-schema.js';
import type {
  CodeSearchCompletionMessage,
  CodeSearchCompletionPort,
  CodeSearchCompletionToolCall,
} from './completion-port.js';

/** Knobs the loop actually reads; a subset of `ResolvedCodeSearchConfig`. */
export type CodeSearchLoopBudget = {
  maxTurns: number;
  maxCommands: number;
  maxResults: number;
  includeSnippets: boolean;
  lineMaxChars: number;
  resultMaxLines: number;
  excludePaths: readonly string[];
  timeoutMs: number;
};

export type CodeSearchLoopInput = {
  /** Real search root; the subagent only ever sees `/codebase`. */
  root: string;
  query: string;
  repoMap: string;
  repoMapDepth: number;
  budget: CodeSearchLoopBudget;
  complete: CodeSearchCompletionPort;
  /** Injected so snippet rendering is testable without touching disk. */
  readLines?: CodeSearchLineReader;
  signal?: AbortSignal;
  /** Injected clock for deterministic durations in tests. */
  now?: () => number;
};

export type CodeSearchLoopOutcome =
  /** The subagent returned at least one file. */
  | { status: 'ok'; output: string; fileCount: number; rounds: number; durationMs: number }
  /** The subagent answered with nothing, which is a legitimate answer. */
  | { status: 'no-results'; output: string; rounds: number; durationMs: number }
  /** No usable `<ANSWER>` came back before the rounds ran out. */
  | { status: 'no-ranges'; output: string; rawResponse: string; rounds: number; durationMs: number }
  | { status: 'error'; output: string; message: string; rounds: number; durationMs: number };

async function defaultReadLines(absolutePath: string): Promise<string[] | undefined> {
  try {
    return splitContentLines(await readFile(absolutePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

/** Wrap each command's output the way the subagent expects to read it back. */
function buildToolResultContent(
  commands: readonly CodeSearchRestrictedCommand[],
  outputs: readonly string[],
  slotErrors: readonly { slot: string; message: string }[],
): string {
  const parts = outputs.map(
    (output, index) => `<command${index + 1}_result>\n${output}\n</command${index + 1}_result>`,
  );
  if (slotErrors.length) {
    parts.push(formatCommandSlotErrors(slotErrors));
  }
  if (!parts.length) {
    return 'Error: restricted_exec received no valid commands. Provide command1 with a valid rg, readfile, tree, ls or glob object.';
  }
  return parts.join('\n');
}

/** Report an unknown tool call back to the model rather than ignoring it. */
function buildUnknownToolResult(toolName: string): string {
  return `Error: unknown tool ${JSON.stringify(toolName)}. Use ${CODE_SEARCH_RESTRICTED_EXEC_TOOL} or ${CODE_SEARCH_ANSWER_TOOL}.`;
}

export async function runCodeSearchLoop(input: CodeSearchLoopInput): Promise<CodeSearchLoopOutcome> {
  const clock = input.now ?? Date.now;
  const startedAt = clock();
  const { budget } = input;
  const readLines = input.readLines ?? defaultReadLines;
  const signal = input.signal ?? new AbortController().signal;

  const executor = createRestrictedExecutor({
    root: input.root,
    resultMaxLines: budget.resultMaxLines,
    lineMaxChars: budget.lineMaxChars,
    excludePaths: budget.excludePaths,
  });
  const systemPrompt = buildCodeSearchSystemPrompt({
    maxTurns: budget.maxTurns,
    maxCommands: budget.maxCommands,
    maxResults: budget.maxResults,
  });
  const tools = buildCodeSearchToolSchemas(budget.maxCommands);
  const messages: CodeSearchCompletionMessage[] = [
    {
      role: 'user',
      content: buildCodeSearchUserMessage({
        query: input.query,
        repoMap: input.repoMap,
        depth: input.repoMapDepth,
      }),
    },
  ];

  const commandSummaries: string[] = [];
  // Devin totals `maxTurns + 1` calls: the extra round is the answer round.
  const totalRounds = Math.max(1, budget.maxTurns + 1);
  let rounds = 0;
  let lastText = '';

  const finish = <T extends Omit<CodeSearchLoopOutcome, 'rounds' | 'durationMs'>>(outcome: T) =>
    ({ ...outcome, rounds, durationMs: clock() - startedAt }) as CodeSearchLoopOutcome;

  for (let round = 0; round < totalRounds; round += 1) {
    const isAnswerRound = round === totalRounds - 1;
    if (isAnswerRound) {
      messages.push({ role: 'user', content: CODE_SEARCH_FORCE_ANSWER });
    }
    let response;
    try {
      response = await input.complete({ systemPrompt, messages, tools, timeoutMs: budget.timeoutMs, signal });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'search subagent failed';
      return finish({ status: 'error', output: `Error: ${message}`, message });
    }
    rounds += 1;
    lastText = response.text;

    const answerCall = response.toolCalls.find((call) => call.name === CODE_SEARCH_ANSWER_TOOL);
    // Custom models follow "output this as your final response" and put XML
    // in text instead of calling `answer`. Parse that on the last round, or
    // when the model stopped calling tools.
    const parseAnswerNow =
      answerCall !== undefined || isAnswerRound || response.toolCalls.length === 0;
    if (parseAnswerNow) {
      const answerXml = extractAnswerXml({
        ...(answerCall ? { toolArguments: answerCall.arguments } : {}),
        text: response.text,
      });
      const parsed = parseCodeSearchAnswer({
        root: input.root,
        answerXml,
        maxResults: budget.maxResults,
      });
      if (!parsed.malformed) {
        if (!parsed.files.length) {
          return finish({
            status: 'no-results',
            output: formatCodeSearchNoResults(parsed.rejectedPaths),
          });
        }
        const output = await formatCodeSearchResult({
          commandSummaries,
          files: parsed.files,
          includeSnippets: budget.includeSnippets,
          lineMaxChars: budget.lineMaxChars,
          readLines,
        });
        return finish({ status: 'ok', output, fileCount: parsed.files.length });
      }
      return finish({
        status: 'no-ranges',
        output: formatCodeSearchNoRanges(answerXml || response.text),
        rawResponse: answerXml || response.text,
      });
    }

    messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });

    const execCall = response.toolCalls.find(
      (call) => call.name === CODE_SEARCH_RESTRICTED_EXEC_TOOL,
    );
    if (execCall) {
      const parsedCommands = parseRestrictedExecArguments(execCall.arguments, budget.maxCommands);
      const outcomes = parsedCommands.commands.length
        ? await executor.executeAll(parsedCommands.commands)
        : [];
      for (const commandOutcome of outcomes) {
        commandSummaries.push(commandOutcome.summary);
      }
      messages.push({
        role: 'tool',
        toolCallId: execCall.id,
        toolName: execCall.name,
        content: buildToolResultContent(
          parsedCommands.commands,
          outcomes.map((outcome) => outcome.output),
          parsedCommands.errors,
        ),
      });
    }

    // Answer every remaining tool call so the provider can pair them up.
    for (const call of response.toolCalls as readonly CodeSearchCompletionToolCall[]) {
      if (call.name === CODE_SEARCH_ANSWER_TOOL || call.name === CODE_SEARCH_RESTRICTED_EXEC_TOOL) {
        continue;
      }
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        toolName: call.name,
        content: buildUnknownToolResult(call.name),
      });
    }

  }

  return finish({
    status: 'no-ranges',
    output: formatCodeSearchNoRanges(lastText),
    rawResponse: lastText,
  });
}
