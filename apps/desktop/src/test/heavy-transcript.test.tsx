// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import {
  appendBoundedLiveText,
  calculateUtf8ByteLength,
  chatUiReducer,
  createInitialChatUiState,
  MAX_LIVE_ASSISTANT_TEXT_BYTES,
  MAX_LIVE_THINKING_BYTES,
  STREAMING_TEXT_RETENTION_OPTIONS,
  STREAMING_TEXT_TRUNCATION_MARKER,
  STREAMING_THINKING_RETENTION_OPTIONS,
} from '../chat-reducer';
import { MarkdownView } from '../MarkdownView';
import {
  highlightCode,
  MAX_HIGHLIGHT_CODE_BYTES,
  MAX_HIGHLIGHT_LINES,
  shouldHighlightCode,
} from '../syntax-highlight';
import {
  create900LineCodeBlock,
  createHeavyTranscriptMessages,
} from './fixtures/heavy-transcript.fixture';

describe('Plan A: Desktop Hard Memory Bounds & Incident Defense', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  describe('1. Syntax highlight safety thresholds', () => {
    it('allows normal code blocks within safety bounds', () => {
      const normalCode = 'const a = 1;\nconst b = 2;\nconsole.log(a + b);';
      expect(shouldHighlightCode(normalCode)).toBe(true);
    });

    it('rejects code blocks exceeding MAX_HIGHLIGHT_CODE_BYTES', () => {
      const hugeCode = 'a'.repeat(MAX_HIGHLIGHT_CODE_BYTES + 1);
      expect(shouldHighlightCode(hugeCode)).toBe(false);
    });

    it('rejects code blocks exceeding MAX_HIGHLIGHT_LINES (e.g. 900-line files)', () => {
      const code900 = create900LineCodeBlock('typescript');
      expect(shouldHighlightCode(code900)).toBe(false);
      const code401Lines = 'line\n'.repeat(MAX_HIGHLIGHT_LINES + 1);
      expect(shouldHighlightCode(code401Lines)).toBe(false);
    });

    it('highlightCode soft-degrades to plain text tokens for huge code', async () => {
      const hugeCode = 'export const test = 1;\n'.repeat(500);
      const tokens = await highlightCode(hugeCode, 'typescript');
      expect(tokens).not.toBeNull();
      expect(tokens.length).toBe(501); // 500 lines + trailing empty
      expect(tokens[0]?.[0]?.content).toBe('export const test = 1;');
    });
  });

  describe('2. Chat reducer UTF-8 byte precision & uiTruncated flag', () => {
    it('accurately calculates UTF-8 byte length for multi-byte characters', () => {
      const ascii = 'abc'; // 3 chars, 3 bytes
      const chinese = '你好世界'; // 4 chars, 12 bytes
      expect(calculateUtf8ByteLength(ascii)).toBe(3);
      expect(calculateUtf8ByteLength(chinese)).toBe(12);
    });

    it('bounds streaming text with head retention, marker, and freezes after truncation', () => {
      const current = 'x'.repeat(MAX_LIVE_ASSISTANT_TEXT_BYTES - 10);
      const delta = 'y'.repeat(50);
      const result = appendBoundedLiveText(
        { text: current },
        delta,
        STREAMING_TEXT_RETENTION_OPTIONS,
      );
      expect(result.truncated).toBe(true);
      expect(calculateUtf8ByteLength(result.text)).toBeLessThanOrEqual(
        MAX_LIVE_ASSISTANT_TEXT_BYTES,
      );
      expect(result.text.endsWith(STREAMING_TEXT_TRUNCATION_MARKER)).toBe(true);
      expect(result.text.startsWith('xxx')).toBe(true);
      // Once truncated, every later append is a constant-time no-op.
      const frozen = appendBoundedLiveText(
        result,
        'z'.repeat(1_000),
        STREAMING_TEXT_RETENTION_OPTIONS,
      );
      expect(frozen.text).toBe(result.text);
    });

    it('accounts bytes incrementally on the below-cap path', () => {
      const first = appendBoundedLiveText({ text: '' }, 'abc', STREAMING_TEXT_RETENTION_OPTIONS);
      expect(first).toEqual({ text: 'abc', retainedBytes: 3, truncated: false });
      const second = appendBoundedLiveText(first, 'def', STREAMING_TEXT_RETENTION_OPTIONS);
      expect(second).toEqual({ text: 'abcdef', retainedBytes: 6, truncated: false });
    });

    it('bounds streaming thinking to MAX_LIVE_THINKING_BYTES with UTF-8 precision', () => {
      const current = 't'.repeat(MAX_LIVE_THINKING_BYTES - 20);
      const delta = '思考中... '.repeat(10);
      const result = appendBoundedLiveText(
        { text: current },
        delta,
        STREAMING_THINKING_RETENTION_OPTIONS,
      );
      expect(result.truncated).toBe(true);
      expect(calculateUtf8ByteLength(result.text)).toBeLessThanOrEqual(MAX_LIVE_THINKING_BYTES);
    });

    it('enforces bounded transcript retention and sets uiTruncated on message state', () => {
      const initialState = createInitialChatUiState();
      const heavyMessages = createHeavyTranscriptMessages();

      let state = chatUiReducer(initialState, {
        type: 'session/set',
        sessionId: 'test-session-1',
      });

      for (const msg of heavyMessages) {
        state = {
          ...state,
          messages: [...state.messages, msg],
        };
      }

      const streamingMsgId = 'msg-assistant-3';
      // Emit large delta that triggers UTF-8 byte truncation
      const hugeDelta = 'Large text generation '.repeat(25_000);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 'test-session-1',
        event: {
          type: 'message/text_delta',
          messageId: streamingMsgId,
          delta: hugeDelta,
        },
      });

      const updated = state.messages.find((m) => m.id === streamingMsgId);
      expect(updated).toBeDefined();
      expect(updated?.status).toBe('streaming');
      expect(updated?.uiTruncated).toBe(true);
      expect(calculateUtf8ByteLength(updated!.text)).toBeLessThanOrEqual(MAX_LIVE_ASSISTANT_TEXT_BYTES);
    });
  });

  describe('3. Real DOM Mount Test for zero-DOM Markdown code folding', () => {
    it('mounts only 8 code line DOM nodes for a 900-line Markdown code block when collapsed', async () => {
      const code900 = create900LineCodeBlock('tsx');
      const markdown = `## Summary\n\n${code900}\n\nConclusion.`;

      await act(async () => {
        root.render(
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <MarkdownView text={markdown} />
          </PiwinUiProvider>,
        );
      });

      // Assert that exactly 8 lines are mounted in the DOM
      const mountedCodeLines = container.querySelectorAll('.md-code-line');
      expect(mountedCodeLines.length).toBe(8);

      // Verify that the first preview line is rendered
      expect(mountedCodeLines[0]?.textContent).toContain('Auto-generated heavy code block');

      // Verify that the 900th line is completely absent from the DOM
      const fullText = container.textContent ?? '';
      expect(fullText).not.toContain('calculateNodeMetrics_900');
    });
  });
});
