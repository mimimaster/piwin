import type { SessionTranscriptMessage } from '@piwin/contracts';
import type { MockHostBackend } from '../host-client-mock.js';

/** The prototype scenario through the real session/host/rendering path.
 * Only installed by the explicit build-time E2E flag and query parameter. */
export function seedInkstoneHost(host: MockHostBackend): void {
  const projectPath = '/mock/piwin';
  const createdAt = '2026-09-05T06:02:00.000Z';
  host.mockProjects.set(projectPath, {
    path: projectPath,
    trust: 'trusted',
    createdAt,
    lastOpenedAt: createdAt,
  });
  host.mockGitCurrentBranches.set(projectPath, 'main');
  const transcript: SessionTranscriptMessage[] = [
    {
      id: 'inkstone-user',
      role: 'user',
      text: '把作曲器运行中的 `Enter` 改成排队，`⌘Enter` 保持介入；补回归测试，别动侧栏。',
      createdAt,
      status: 'done',
    },
    {
      id: 'inkstone-assistant',
      role: 'assistant',
      status: 'done',
      createdAt: '2026-09-05T06:03:00.000Z',
      model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
      thinking:
        'Enter 在运行中应进入队列。先定位 Composer 的发送分支，再检查输入法组合期间的保护条件。',
      tools: [
        {
          toolCallId: 'inkstone-read',
          toolName: 'read',
          status: 'done',
          output: 'Composer source',
          presentation: {
            kind: 'filesystem',
            title: 'read',
            actionVerb: 'Read',
            targetPaths: ['apps/desktop/src/composer-card.tsx'],
            durationMs: 40,
          },
        },
        {
          toolCallId: 'inkstone-search',
          toolName: 'grep',
          status: 'done',
          output: '7 matches',
          presentation: {
            kind: 'filesystem',
            title: 'grep',
            summary: 'queued-turn',
            countTag: '7 处 · 3 文件',
            durationMs: 32,
          },
        },
        {
          toolCallId: 'inkstone-test',
          toolName: 'bash',
          status: 'done',
          output: '45 passed',
          presentation: {
            kind: 'shell',
            title: 'bash',
            command: 'pnpm vitest composer-dock',
            countTag: '45 通过',
            durationMs: 6200,
          },
        },
        {
          toolCallId: 'inkstone-typecheck',
          toolName: 'bash',
          status: 'done',
          output: 'Typecheck passed',
          presentation: {
            kind: 'shell',
            title: 'bash',
            command: 'pnpm typecheck',
            durationMs: 4100,
          },
        },
      ],
      text: '### 已改为排队语义\n\n运行中的 `Enter` 现在提交到会话队列，`⌘Enter` 仍然触发介入。输入法组合期间两者都被抑制。\n\n```typescript\nif (event.key === "Enter" && !event.shiftKey && !isComposing) {\n  event.preventDefault();\n  return event.metaKey ? triggerSteer() : triggerSend();\n}\n```\n\n已验证队列提交、组合输入和忙会话回归测试。',
    },
  ];
  for (const [index, name] of [
    'Composer 忙会话队列',
    '分支选择器 mock 修复',
    'Artifact 源码 Preview 切回',
    '侧栏项目折叠',
  ].entries()) {
    host.sessions.set(`inkstone-session-${index}`, {
      projectPath,
      scope: { kind: 'project', projectPath },
      workingDirectory: projectPath,
      name,
      nameSource: 'user',
      updatedAt: new Date(Date.parse(createdAt) - index * 3600000).toISOString(),
      events: [],
      transcript: index === 0 ? transcript : [],
    });
  }
}
