/**
 * Row memo invalidation for the Run projection.
 *
 * `reduceChatRun` rebuilds the whole `RunRecordUi` on every `run/updated`, so
 * every assistant row sharing that runId hands the memo a new `runRecord`
 * object even when nothing it renders has changed. A settled step row reads
 * only terminal fields (error card, truncation, idle-loop, empty-row hiding);
 * live phase chrome belongs to the turn's last assistant row, which is the only
 * row `chat-message-row` passes a non-null `activeRunId` to `TurnWorkDetails`.
 */
import { describe, expect, it } from 'vitest';
import type { ComposerDockProps } from './composer-dock';
import type { ChatMessageRowProps } from './chat-message-row-types.js';
import type { ChatMessageUi, RunRecordUi } from './chat-ui-types.js';
import { areChatMessageRowPropsEqual } from './chat-message-row-memo.js';

const noop = (): void => {};
/** Only `isEditingThisRow` reads composerCard; the rest is never inspected. */
const composerCard = {} as ComposerDockProps;

function assistantMessage(overrides: Partial<ChatMessageUi> = {}): ChatMessageUi {
  return {
    id: 'step-a1',
    role: 'assistant',
    text: 'step',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    runId: 'run-1',
    ...overrides,
  };
}

function runRecord(overrides: Partial<RunRecordUi> = {}): RunRecordUi {
  return {
    runId: 'run-1',
    status: 'running',
    phase: 'tool-running',
    phaseHistory: [{ phase: 'tool-running', at: 1_000 }],
    startedAt: 1,
    endedAt: null,
    ...overrides,
  };
}

/** One stable identity, exactly as the reducer hands the same object to both renders. */
const STEP_MESSAGE = assistantMessage();

function rowProps(overrides: Partial<ChatMessageRowProps> = {}): ChatMessageRowProps {
  return {
    message: STEP_MESSAGE,
    messageIndex: 0,
    showStreamingCaret: false,
    isNew: false,
    streaming: true,
    activeSessionId: 'session-1',
    editingMessageId: null,
    lastUserMessageId: 'user-1',
    activeTheme: null,
    artifactThemeKey: 0,
    runRecordsById: {},
    activeRunId: 'run-1',
    permissionPrompt: null,
    workDetailsExpanded: 'auto',
    toolDensity: 'comfortable',
    showThinking: true,
    onEdit: noop,
    onCancelEdit: noop,
    onEditResend: noop,
    onRetry: noop,
    onInspectSubagent: undefined,
    artifactInlineEnabled: false,
    composerCard,
    ...overrides,
  };
}

describe('areChatMessageRowPropsEqual — run projection', () => {
  it('keeps a settled step row stable when the run advances its phase', () => {
    const previous = rowProps({ runRecord: runRecord() });
    const next = rowProps({
      runRecord: runRecord({
        phase: 'streaming',
        phaseHistory: [
          { phase: 'tool-running', at: 1_000 },
          { phase: 'streaming', at: 2_000 },
        ],
      }),
    });

    expect(areChatMessageRowPropsEqual(previous, next)).toBe(true);
  });

  it('stays equal when the run record is rebuilt with identical values', () => {
    const previous = rowProps({ runRecord: runRecord() });
    const next = rowProps({ runRecord: runRecord() });

    expect(previous.runRecord).not.toBe(next.runRecord);
    expect(areChatMessageRowPropsEqual(previous, next)).toBe(true);
  });

  it("re-renders the turn's last assistant row when the run advances its phase", () => {
    const previous = rowProps({ isLastAssistantInTurn: true, runRecord: runRecord() });
    const next = rowProps({
      isLastAssistantInTurn: true,
      runRecord: runRecord({
        phase: 'streaming',
        phaseHistory: [
          { phase: 'tool-running', at: 1_000 },
          { phase: 'streaming', at: 2_000 },
        ],
      }),
    });

    expect(areChatMessageRowPropsEqual(previous, next)).toBe(false);
  });

  it('re-renders a step row when the run reaches a terminal outcome', () => {
    const previous = rowProps({ runRecord: runRecord() });
    const next = rowProps({
      runRecord: runRecord({
        status: 'failed',
        outcome: 'failed',
        terminalMessage: 'provider exploded',
        endedAt: 3,
      }),
    });

    expect(areChatMessageRowPropsEqual(previous, next)).toBe(false);
  });

  it('re-renders a step row when the run gains a length stop reason', () => {
    const previous = rowProps({ runRecord: runRecord() });
    const next = rowProps({ runRecord: runRecord({ agentStopReason: 'length' }) });

    expect(areChatMessageRowPropsEqual(previous, next)).toBe(false);
  });
});
