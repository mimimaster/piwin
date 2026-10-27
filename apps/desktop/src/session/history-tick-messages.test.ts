import { describe, expect, it } from 'vitest';
import type { SessionUserMessageIndexData } from '@piwin/contracts';
import type { ChatMessageUi } from '../conversation/chat-reducer.js';
import { buildHistoryTickMessages } from './history-tick-messages.js';

function message(id: string, createdAt: string): ChatMessageUi {
  return {
    id,
    createdAt,
    role: 'user',
    text: id,
    status: 'done',
    tools: [],
    attachments: [],
    thinking: '',
  };
}
const index: SessionUserMessageIndexData = {
  sessionId: 'long',
  revision: 'r1',
  mode: 'sampled',
  totalUserMessages: 100,
  anchorBytes: 100,
  anchors: [0, 99].map((ordinal) => ({
    messageId: `m${ordinal}`,
    ordinal,
    preview: 'turn',
    createdAt: ordinal === 0 ? '2026-09-01' : '2026-09-20',
    spanStartOrdinal: ordinal,
    spanEndOrdinal: ordinal,
  })),
};
describe('history ticks while refreshing', () => {
  it('keeps Host anchors and adds only new local turns without duplicating sampled interiors', () => {
    expect(
      buildHistoryTickMessages(
        [message('m50', '2026-09-10'), message('m99', '2026-09-20'), message('new', '2026-09-21')],
        index,
      ).map((tick) => tick.id),
    ).toEqual(['m0', 'm99', 'new']);
  });
  it('uses resident rows only before the first Host index is available', () => {
    expect(
      buildHistoryTickMessages([message('new', '2026-09-21')], null).map((tick) => tick.id),
    ).toEqual(['new']);
  });
  it('numbers appended local turns after the indexed ones and carries marks', () => {
    const marked: SessionUserMessageIndexData = {
      ...index,
      anchors: index.anchors.map((anchor) =>
        anchor.ordinal === 99 ? { ...anchor, marks: ['error' as const] } : anchor,
      ),
    };
    const ticks = buildHistoryTickMessages([message('new', '2026-09-21')], marked);
    expect(ticks.map((tick) => [tick.id, tick.ordinal, tick.marks])).toEqual([
      ['m0', 0, []],
      ['m99', 99, ['error']],
      ['new', 100, []],
    ]);
  });
});
