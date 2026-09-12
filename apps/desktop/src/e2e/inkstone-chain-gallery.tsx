import { useEffect, useState, type ReactElement } from 'react';
import type { ToolCardUi } from '../chat-reducer.js';
import type { ExploreFlowGroup } from '../explore-flow.js';
import { ExploreFlowCapsule } from '../explore-flow-capsule.js';
import { ToolCallCard } from '../tool-call-card.js';
import { CitationCards } from '../CitationCards.js';
import { ImageGenerationProgress } from '../image-generation-progress.js';
import { VideoGenerationProgress } from '../video-generation-progress.js';
import { WorkFoldHeader } from '../work-fold-header.js';
import { FlashcardStackView } from '../FlashcardView.js';
import type { FlashcardReviewCard } from '@piwin/contracts';

function tool(partial: ToolCardUi): ToolCardUi {
  return partial;
}

const readTool = tool({
  toolCallId: 'read-1',
  toolName: 'read',
  status: 'done',
  output: 'source',
  presentation: {
    kind: 'filesystem',
    title: 'read',
    actionVerb: 'read',
    targetPaths: ['apps/desktop/src/composer-card.tsx'],
    durationMs: 40,
  },
});

const failTool = tool({
  toolCallId: 'bash-fail',
  toolName: 'bash',
  status: 'error',
  output: 'FAIL composer-dock.test.tsx › queues Enter while streaming\n  expected "steer" to be "queue"',
  presentation: {
    kind: 'shell',
    title: 'bash',
    actionVerb: 'bash',
    command: 'pnpm vitest composer-dock',
    durationMs: 6200,
  },
});

const writeTool = tool({
  toolCallId: 'write-1',
  toolName: 'write_file',
  status: 'done',
  output: 'wrote',
  presentation: {
    kind: 'filesystem',
    title: 'write_file',
    actionVerb: 'write_file',
    changedPaths: ['apps/desktop/src/composer-run-actions.tsx'],
    durationMs: 80,
  },
});

const bashTool = tool({
  toolCallId: 'bash-ok',
  toolName: 'bash',
  status: 'done',
  output: 'ok',
  presentation: {
    kind: 'shell',
    title: 'bash',
    actionVerb: 'bash',
    command: 'pnpm typecheck',
    durationMs: 4100,
  },
});

const exploreGroup: ExploreFlowGroup = {
  anchorMessageId: 'anchor',
  memberMessageIds: ['anchor'],
  items: [
    {
      kind: 'tool',
      messageId: 'anchor',
      tool: tool({
        toolCallId: 'grep-1',
        toolName: 'grep',
        status: 'done',
        output: '7',
        presentation: {
          kind: 'filesystem',
          title: 'grep',
          actionVerb: 'grep',
          summary: '"queued-turn"',
          countTag: '7 处 · 3 文件',
        },
      }),
    },
    { kind: 'thought', messageId: 'anchor', text: 'check steer-queue next', seconds: 3 },
    {
      kind: 'tool',
      messageId: 'anchor',
      tool: tool({
        toolCallId: 'read-2',
        toolName: 'read',
        status: 'done',
        output: 'ok',
        presentation: {
          kind: 'filesystem',
          title: 'read',
          actionVerb: 'read',
          targetPaths: ['apps/desktop/src/steer-queue-model.ts'],
        },
      }),
    },
  ],
  toolCount: 6,
  fileCount: 3,
  searchCount: 2,
  thoughtCount: 1,
  hasRunning: false,
  isLive: false,
  errorCount: 0,
  totalDurationMs: 1800,
};

const galleryStyle = {
  maxWidth: 720,
  margin: '24px auto',
  padding: '0 24px 48px',
  background: 'var(--s2)',
  minHeight: '100vh',
  ['--row-pad' as string]: '8px',
  ['--row-in' as string]: '30px',
  ['--line-x' as string]: '8px',
  ['--surf-x' as string]: '12px',
  ['--surf-y' as string]: '10px',
} as const;

/** Static proto-01 call-chain states for visual QA. */
export function InkstoneChainGallery(): ReactElement {
  // Fixed at mount so the running header's live clock actually ticks here.
  const [runStartedAt] = useState(() => Date.now() - 74_000);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme-id', 'piwin-inkstone-paper');
    document.documentElement.setAttribute('data-theme-mode', 'light');
  }, []);

  return (
    <div
      className="inkstone-chain-gallery"
      data-testid="inkstone-chain-gallery"
      style={galleryStyle}
    >
      <div className="work">
        <WorkFoldHeader
          state="done"
          locale="zh-CN"
          open
          elapsedMs={41_000}
          toolCount={5}
          fileCount={2}
          failureCount={1}
          testId="gallery-work-done"
        />
        <WorkFoldHeader
          state="running"
          locale="zh-CN"
          runningToolIndex={5}
          runningCode="pnpm typecheck"
          runningSince={runStartedAt}
          testId="gallery-work-running"
        />
        <WorkFoldHeader
          state="waiting"
          locale="zh-CN"
          waitingAction="写入"
          waitingCode="composer-run-actions.tsx"
          testId="gallery-work-waiting"
        />
        <div className="think turn-thinking" data-testid="gallery-think">
          Enter 在运行中应进 SteerQueue 而不是 transcript；⌘Enter 仍走 triggerSteer。先读
          composer-card.tsx 第 5 段的键盘分发，再改 handleSend 的 streaming 分支。
        </div>
        <div className="thread turn-tool-sequence">
          <ToolCallCard tool={readTool} density="compact" />
          <ExploreFlowCapsule group={exploreGroup} locale="zh-CN" />
          <ToolCallCard tool={failTool} density="compact" defaultExpanded />
          <ToolCallCard tool={writeTool} density="compact" />
          <ToolCallCard tool={bashTool} density="compact" />
        </div>
        <div data-testid="gallery-cites">
          <CitationCards
            evidence={{
              provenance: 'external',
              citations: [
                {
                  title: 'Cursor Agent · queue follow-up messages',
                  url: 'https://github.com/cursor/docs',
                  snippet:
                    'Follow-up prompts typed while the agent runs are queued and sent after the current step finishes…',
                  provenance: 'external',
                },
                {
                  title: 'Claude Code · Interrupting and steering',
                  url: 'https://docs.claude.com/en/docs',
                  snippet:
                    'Press Escape to interrupt; typing while Claude works adds the message to the queue.',
                  provenance: 'external',
                },
                {
                  title: 'Agent Panel — follow-ups and cancellation',
                  url: 'https://zed.dev/docs',
                  snippet:
                    'Follow-up messages are held until the assistant finishes the current turn…',
                  provenance: 'external',
                },
              ],
            }}
          />
        </div>
        <ImageGenerationProgress
          locale="zh-CN"
          status="running"
          tool={{
            toolCallId: 'img-run',
            toolName: 'image_gen',
            status: 'running',
            output: '',
            presentation: {
              kind: 'image',
              title: 'gpt-image-1',
              summary: '砚台上的一盏铜灯，宣纸背景',
              inputPreview: '{"prompt":"砚台上的一盏铜灯，宣纸背景","size":"1024x1024"}',
            },
          }}
        />
        <ImageGenerationProgress
          locale="zh-CN"
          status="done"
          tool={{
            toolCallId: 'img-done',
            toolName: 'image_gen',
            status: 'done',
            output: 'ok',
            presentation: {
              kind: 'image',
              title: 'gpt-image-1',
              durationMs: 8400,
              targetPaths: ['~/.piwin/media/gen/0192a…png'],
            },
          }}
        />
        <VideoGenerationProgress
          locale="zh-CN"
          status="error"
          tool={{
            toolCallId: 'vid-err',
            toolName: 'video_gen',
            status: 'error',
            output: '429 rate_limited',
            presentation: {
              kind: 'video',
              title: 'veo-3',
              error: { category: 'execution', message: '生成接口返回错误，可以重试 · 429 rate_limited' },
            },
          }}
        />
        <div data-testid="gallery-flashcards">
          <FlashcardStackView cards={galleryFlashcards} locale="zh-CN" />
        </div>
      </div>
    </div>
  );
}

const galleryFlashcards: FlashcardReviewCard[] = [
  {
    cardId: 'fc-1',
    itemId: 'fc-1',
    model: 'basic',
    ordinal: 1,
    deck: 'piwin/composer',
    front: '作曲器运行中按 Enter 与 ⌘Enter 分别触发什么？',
    back: 'Enter → 排队为后续轮（SteerQueue，不进 transcript）；⌘Enter → 介入当前运行（triggerSteer）。IME 组合期间 Enter 被抑制。',
    tags: ['composer', 'keyboard', 'ADR 0045'],
    createdAt: '2026-09-06T00:00:00.000Z',
  },
  {
    cardId: 'fc-2',
    itemId: 'fc-2',
    model: 'basic',
    ordinal: 1,
    deck: 'piwin/composer',
    front: 'SteerQueue 与 transcript 的边界是什么？',
    back: '排队消息不写入 transcript，直到当前运行结束再投递。',
    tags: ['composer', 'queue'],
    createdAt: '2026-09-06T00:00:00.000Z',
  },
  {
    cardId: 'fc-3',
    itemId: 'fc-3',
    model: 'basic',
    ordinal: 1,
    deck: 'piwin/composer',
    front: '权限条与自动授权印「允」分别何时出现？',
    back: '需确认时出权限条；自动放行的写类工具在节点旁盖「允」。',
    tags: ['permissions'],
    createdAt: '2026-09-06T00:00:00.000Z',
  },
];
