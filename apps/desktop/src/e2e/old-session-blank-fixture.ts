/**
 * Heavy-thinking settled session fixture matching the shape of a session whose
 * first Host transcript page returns only the final assistant messages while
 * the initiating user prompt stays behind an older cursor.
 *
 * Installed only when `VITE_PIWIN_E2E_FIXTURES=true` and `?e2eOldSessionBlank=1`.
 */
import type { SessionTranscriptMessage } from '@piwin/contracts';
import type { MockHostBackend } from '../host/host-client-mock.js';

export const OLD_BLANK_SESSION_ID = 'fixture-pelican-heavy';
export const OLD_BLANK_TITLE = '画一个2D的鹈鹕骑自行车的html动画（合成复现）';
export const OLD_BLANK_USER_MESSAGE_ID = 'pelican-u1';
export const OLD_BLANK_FINAL_MESSAGE_ID = 'pelican-final';
export const OLD_BLANK_PEER_SESSION_ID = 'fixture-peer-session';
export const OLD_BLANK_PEER_TITLE = '普通对照会话';

export function buildOldSessionBlankTranscript(): SessionTranscriptMessage[] {
  const thinkingSizes = [118_814, 119_868, 128_882, 87_034, 81_875, 97_486];
  const toolSizes = [400, 3_000, 13_000, 350, 15_500, 600];
  const start = Date.parse('2026-11-21T03:30:49.000Z');
  const stamp = (offsetSec: number): string => new Date(start + offsetSec * 1_000).toISOString();

  const messages: SessionTranscriptMessage[] = [
    {
      id: OLD_BLANK_USER_MESSAGE_ID,
      role: 'user',
      text: '画一个2D的鹈鹕骑自行车的html动画',
      createdAt: stamp(0),
      status: 'done',
    },
  ];

  for (let index = 0; index < thinkingSizes.length; index += 1) {
    messages.push({
      id: `pelican-a${index + 1}`,
      role: 'assistant',
      text: '',
      thinking: 't'.repeat(thinkingSizes[index]!),
      tools: [
        {
          toolCallId: `pelican-tc-${index + 1}`,
          toolName: 'piwin_toolbox',
          status: 'done',
          output: 'o'.repeat(toolSizes[index]!),
          runId: 'run-pelican',
          presentation: {
            kind: 'other',
            title: 'piwin_toolbox',
          },
        },
      ],
      createdAt: stamp((index + 1) * 60),
      runId: 'run-pelican',
      status: 'done',
      outcome: 'completed',
    });
  }

  const cards = Array.from({ length: 450 }, (_, idx) => `<div class="pel-card">step ${idx}</div>`).join('\n');
  const htmlBody = [
    '<div class="pel-wrap">',
    '<style>.pel-wrap{width:100%;max-width:100%;box-sizing:border-box;padding:16px;font-family:sans-serif;}</style>',
    '<h2>Pelican Riding a Bicycle</h2>',
    '<svg viewBox="0 0 320 180" width="320" height="180"><circle cx="90" cy="130" r="32" fill="none" stroke="#333" stroke-width="4"/><circle cx="220" cy="130" r="32" fill="none" stroke="#333" stroke-width="4"/></svg>',
    '<script>window.__pelicanInit = true;</script>',
    cards,
    '</div>',
  ].join('\n');

  messages.push({
    id: OLD_BLANK_FINAL_MESSAGE_ID,
    role: 'assistant',
    text: [
      '这是一个 2D 鹈鹕骑车动画的合成复现回复。',
      '',
      '```artifact-html title="pelican-bike" style="host"',
      htmlBody,
      '```',
    ].join('\n'),
    thinking: 't'.repeat(126_250),
    tools: [],
    createdAt: stamp(600),
    runId: 'run-pelican',
    status: 'done',
    outcome: 'completed',
  });

  return messages;
}

export function seedOldSessionBlankHost(host: MockHostBackend): void {
  host.sessions.set(OLD_BLANK_SESSION_ID, {
    projectPath: '',
    scope: { kind: 'general' },
    workingDirectory: 'general',
    name: OLD_BLANK_TITLE,
    nameSource: 'user',
    updatedAt: '2026-11-21T03:41:15.000Z',
    events: [],
    transcript: buildOldSessionBlankTranscript(),
  });

  host.sessions.set(OLD_BLANK_PEER_SESSION_ID, {
    projectPath: '',
    scope: { kind: 'general' },
    workingDirectory: 'general',
    name: OLD_BLANK_PEER_TITLE,
    nameSource: 'user',
    updatedAt: '2026-11-21T03:40:00.000Z',
    events: [],
    transcript: [
      {
        id: 'peer-u1',
        role: 'user',
        text: '测试会话切换的对照组问题',
        createdAt: '2026-11-21T03:39:00.000Z',
        status: 'done',
      },
      {
        id: 'peer-a1',
        role: 'assistant',
        text: '测试会话切换的对照组回复内容。',
        createdAt: '2026-11-21T03:39:05.000Z',
        status: 'done',
        outcome: 'completed',
      },
    ],
  });
}
