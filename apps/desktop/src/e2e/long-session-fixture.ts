/**
 * Long-session fixture: the shape of a real session that broke history
 * scrolling (session-mucdicnu-sir3qtwg, 2026-09-22) — 13 turns, one of them a
 * 200-message agent run, several with 25k+ characters of prose.
 *
 * A turn is the transcript's virtualization unit, so a single turn larger than
 * the 160-message resident window, split across 50-message pages, is the case
 * the older-page anchor has to survive.
 *
 * Installed only when `VITE_PIWIN_E2E_FIXTURES=true` and `?e2eLongSession=1`.
 */
import type { SessionToolCardView, SessionTranscriptMessage } from '@piwin/contracts';
import type { MockHostBackend } from '../host-client-mock.js';

const PROJECT = '/mock/piwin';
export const LONG_SESSION_ID = 'fixture-long-session';

/** Assistant messages per turn, in order; 0 marks a single long-prose reply. */
const TURN_SHAPES: ReadonlyArray<{ steps: number; proseChars: number }> = [
  { steps: 32, proseChars: 1_000 },
  { steps: 7, proseChars: 5_000 },
  { steps: 15, proseChars: 2_000 },
  { steps: 14, proseChars: 1_600 },
  { steps: 1, proseChars: 25_000 },
  { steps: 1, proseChars: 25_000 },
  { steps: 1, proseChars: 25_000 },
  { steps: 200, proseChars: 7 },
  { steps: 32, proseChars: 50 },
  { steps: 44, proseChars: 60 },
  { steps: 20, proseChars: 150 },
  { steps: 1, proseChars: 340 },
  { steps: 1, proseChars: 396 },
];

const PARAGRAPH =
  '长会话里，一轮就是虚拟列表的一个单元。一轮内容越长，估算高度和真实高度差得越多，翻页时锚点就越容易丢。';

function prose(chars: number, turn: number, step: number): string {
  if (chars <= 400) {
    return `第 ${turn + 1} 轮 · 第 ${step + 1} 步：${PARAGRAPH.slice(0, Math.max(6, chars))}`;
  }
  const lines: string[] = [`### 第 ${turn + 1} 轮结论`];
  let length = 0;
  let paragraph = 0;
  while (length < chars) {
    const line = `${paragraph + 1}. ${PARAGRAPH}${PARAGRAPH}`;
    lines.push(line, '');
    length += line.length;
    paragraph += 1;
  }
  return lines.join('\n');
}

function bashTool(id: string, step: number): SessionToolCardView {
  const command = step % 3 === 0 ? `rg -n "scrollTop" apps/desktop/src | head -${20 + step}` : `sed -n '${step},${step + 40}p' apps/desktop/src/transcript-turn-list.tsx`;
  return {
    toolCallId: id,
    toolName: 'bash',
    status: 'done',
    output: Array.from({ length: 12 }, (_, line) => `line ${line + 1} of step ${step}`).join('\n'),
    presentation: { kind: 'shell', title: 'bash', command, durationMs: 120 + step, exitCode: 0 },
  };
}

export function buildLongSessionTranscript(): SessionTranscriptMessage[] {
  const messages: SessionTranscriptMessage[] = [];
  const start = Date.parse('2026-09-22T09:00:00.000Z');
  let sequence = 0;
  const stamp = (): string => new Date(start + sequence * 7_000).toISOString();
  TURN_SHAPES.forEach((shape, turn) => {
    sequence += 1;
    messages.push({
      id: `long-u${String(turn + 1).padStart(2, '0')}`,
      role: 'user',
      text: `第 ${turn + 1} 个问题：继续排查长会话滚动（${shape.steps} 步）`,
      createdAt: stamp(),
      status: 'done',
    });
    for (let step = 0; step < shape.steps; step += 1) {
      sequence += 1;
      const id = `long-t${String(turn + 1).padStart(2, '0')}-a${String(step + 1).padStart(3, '0')}`;
      const last = step === shape.steps - 1;
      messages.push({
        id,
        role: 'assistant',
        status: 'done',
        outcome: 'completed',
        createdAt: stamp(),
        text: last ? prose(shape.proseChars, turn, step) : `第 ${turn + 1} 轮 · 第 ${step + 1} 步`,
        tools: shape.steps > 1 && !last ? [bashTool(`${id}-tool`, step)] : [],
      });
    }
  });
  return messages;
}

export function seedLongSessionHost(host: MockHostBackend): void {
  const createdAt = '2026-09-22T09:00:00.000Z';
  host.mockProjects.set(PROJECT, {
    path: PROJECT,
    trust: 'trusted',
    createdAt,
    lastOpenedAt: createdAt,
  });
  host.mockGitCurrentBranches.set(PROJECT, 'main');
  host.sessions.set(LONG_SESSION_ID, {
    projectPath: PROJECT,
    scope: { kind: 'project', projectPath: PROJECT },
    workingDirectory: PROJECT,
    name: '长会话 · 13 轮 / 1 轮 200 步',
    nameSource: 'user',
    updatedAt: '2026-09-22T12:00:00.000Z',
    events: [],
    transcript: buildLongSessionTranscript(),
  });
}
