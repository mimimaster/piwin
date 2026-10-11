/**
 * Screenshot fixture for the transcript subagent cards (Inkstone proto-13):
 * one conversation whose four turns are the prototype's four blocks —
 * ① 并行运行 (scripted lifecycle), ② 全部结束后, ③ 单个子代理, ④ 需要处理的结果.
 *
 * Only data is fabricated: Host-shaped `SubagentInvocation` records and child
 * summaries answered from `session/list-children`, then
 * `subagent/invocation-updated` pushes that walk block ① from running to
 * settled. Every card on screen is the shipping renderer.
 *
 * Installed only when `VITE_PIWIN_E2E_FIXTURES=true` and
 * `?e2eChainShowcase=subagents`.
 */
import type {
  ModelRef,
  SessionSummary,
  SessionToolCardView,
  SessionTranscriptMessage,
  SubagentInvocation,
} from '@piwin/contracts';
import type { MockHostBackend } from '../host-client-mock.js';

export const SUBAGENT_CARDS_SESSION_ID = 'showcase-subagent-cards';
const PROJECT = '/mock/piwin';

const SONNET: ModelRef = { protocol: 'anthropic-compatible', providerId: 'anthropic', modelId: 'claude-sonnet-4-6' };
const OPUS: ModelRef = { protocol: 'anthropic-compatible', providerId: 'anthropic', modelId: 'claude-opus-4-1' };
const HAIKU: ModelRef = { protocol: 'anthropic-compatible', providerId: 'anthropic', modelId: 'claude-haiku-4-5' };

type Spec = {
  key: string;
  title: string;
  role: string;
  model: ModelRef;
  /** Seconds before "now" (seed time) the delegation started. */
  startedAgo: number;
  /** Seconds the run took; undefined while still running. */
  took?: number;
  status: SubagentInvocation['status'];
  activity: SubagentInvocation['activity'];
  integration?: SessionSummary['subagentIntegrationStatus'];
  summary?: SessionSummary['subagentSummaryStatus'];
  /** Host-counted work; omitted on one row to show an older Host. */
  usage?: SubagentInvocation['usage'];
};

/** ① live — the pushes below walk these through the prototype's ~36s script. */
const LIVE: Spec[] = [
  { key: 'live-export', title: '实现导出接口', role: 'implementer', model: SONNET, startedAgo: 2, status: 'running', activity: { kind: 'tool', toolName: 'edit', title: 'edit (session-export.ts)' }, usage: { toolCalls: 3, totalTokens: 4200, requests: 2 } },
  { key: 'live-review', title: '审查权限改动', role: 'reviewer', model: OPUS, startedAgo: 2, status: 'running', activity: { kind: 'tool', toolName: 'read', title: 'read (permission-policy.ts)' }, usage: { toolCalls: 2, totalTokens: 3100, requests: 1 } },
  { key: 'live-cache', title: '调研缓存策略', role: 'scout', model: HAIKU, startedAgo: 0, status: 'queued', activity: { kind: 'queued' }, usage: { toolCalls: 0, totalTokens: 0, requests: 0 } },
];

/** ② every row settled long ago — the group folds to its header. */
const SETTLED: Spec[] = [
  { key: 'done-export', title: '实现导出接口', role: 'implementer', model: SONNET, startedAgo: 900, took: 14, status: 'completed', activity: { kind: 'completed', summary: '导出路径改走 media 目录，补上越界校验' }, summary: 'merged', usage: { toolCalls: 6, totalTokens: 8400, requests: 4 } },
  { key: 'done-review', title: '审查权限改动', role: 'reviewer', model: OPUS, startedAgo: 900, took: 24, status: 'completed', activity: { kind: 'completed', summary: '文件写入闸门在 bypass 模式下仍然生效' }, summary: 'merged', usage: { toolCalls: 4, totalTokens: 11200, requests: 3 } },
  { key: 'done-cache', title: '调研缓存策略', role: 'scout', model: HAIKU, startedAgo: 897, took: 27, status: 'failed', activity: { kind: 'failed', message: 'web_fetch 超时（30s），未取得文档' }, usage: { toolCalls: 2, totalTokens: 2900, requests: 2 } },
];

/** ③ a lone delegation — no group header. */
const SINGLE: Spec[] = [
  { key: 'solo-review', title: '审查权限改动', role: 'reviewer', model: OPUS, startedAgo: 7, status: 'running', activity: { kind: 'tool', toolName: 'read', title: 'read (permission-policy.ts)' }, usage: { toolCalls: 3, totalTokens: 5600, requests: 2 } },
];

/** ④ finished, but the result still needs the user. */
const ATTENTION: Spec[] = [
  { key: 'att-export', title: '实现导出接口', role: 'implementer', model: SONNET, startedAgo: 600, took: 14, status: 'needs-integration', activity: { kind: 'needs-integration' }, integration: 'pending', summary: 'merged', usage: { toolCalls: 7, totalTokens: 9100, requests: 4 } },
  { key: 'att-review', title: '审查权限改动', role: 'reviewer', model: OPUS, startedAgo: 600, took: 24, status: 'completed', activity: { kind: 'completed' }, integration: 'conflict', summary: 'merged' },
];

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function invocationFor(spec: Spec, now: number, revision = 1): SubagentInvocation {
  const startMs = now - spec.startedAgo * 1000;
  return {
    id: `inv-${spec.key}`,
    parentSessionId: SUBAGENT_CARDS_SESSION_ID,
    runId: `run-${spec.key}`,
    parentToolCallId: `tool-${spec.key}`,
    taskId: spec.key,
    task: spec.title,
    title: spec.title,
    role: spec.role,
    model: spec.model,
    isolation: 'worktree',
    childSessionId: `child-${spec.key}`,
    status: spec.status,
    activity: spec.activity,
    ...(spec.usage !== undefined ? { usage: spec.usage } : {}),
    revision,
    createdAt: iso(startMs),
    updatedAt: iso(spec.took !== undefined ? startMs + spec.took * 1000 : now),
  };
}

function childFor(spec: Spec, now: number): SessionSummary {
  const terminal = spec.status === 'completed' || spec.status === 'needs-integration';
  return {
    id: `child-${spec.key}`,
    scope: { kind: 'project', projectPath: PROJECT },
    workingDirectory: PROJECT,
    projectPath: PROJECT,
    name: spec.title,
    updatedAt: iso(now),
    messageCount: 4,
    parentSessionId: SUBAGENT_CARDS_SESSION_ID,
    depth: 1,
    kind: 'subagent',
    task: spec.title,
    subagentRole: spec.role,
    subagentModel: spec.model,
    subagentInvocationId: `inv-${spec.key}`,
    subagentParentToolCallId: `tool-${spec.key}`,
    subagentStatus: terminal ? 'done' : spec.status === 'failed' ? 'failed' : 'running',
    ...(spec.integration !== undefined ? { subagentIntegrationStatus: spec.integration } : {}),
    ...(spec.summary !== undefined ? { subagentSummaryStatus: spec.summary } : {}),
  };
}

function startTool(spec: Spec): SessionToolCardView {
  return {
    toolCallId: `tool-${spec.key}`,
    toolName: 'piwin_subagent_start',
    status: 'done',
    output: 'accepted',
    presentation: {
      kind: 'subagent',
      title: 'piwin_subagent_start',
      summary: spec.title,
      subagentControl: {
        phase: 'accepted',
        runId: `run-${spec.key}`,
        invocationId: `inv-${spec.key}`,
        task: spec.title,
      },
    },
  };
}

function turn(id: string, user: string, specs: Spec[], text: string, at: string): SessionTranscriptMessage[] {
  return [
    { id: `${id}-user`, role: 'user', text: user, createdAt: at, status: 'done' },
    {
      id: `${id}-assistant`,
      role: 'assistant',
      status: 'done',
      outcome: 'completed',
      createdAt: at,
      startedAt: at,
      endedAt: at,
      model: SONNET,
      tools: specs.map(startTool),
      text,
    },
  ];
}

export function buildSubagentCardsTranscript(): SessionTranscriptMessage[] {
  return [
    ...turn('sa-settled', '导出接口、权限审查、缓存调研三件事并行做。', SETTLED, '三件事都收口了；缓存调研超时，没取到文档。', '2026-10-11T08:00:00.000Z'),
    ...turn('sa-attention', '同样三件再来一轮，代码先别合。', ATTENTION, '导出接口的代码待你处理；审查那份和主干冲突。', '2026-10-11T08:10:00.000Z'),
    ...turn('sa-single', '只让一个子代理复核权限改动。', SINGLE, '复核在跑。', '2026-10-11T08:20:00.000Z'),
    ...turn('sa-live', '现在三个一起跑，实时看着。', LIVE, '三个子代理已派出。', '2026-10-11T08:30:00.000Z'),
  ];
}

/**
 * Block ① lifecycle, relative to the session being opened: the prototype's
 * script compressed — 导出 finishes, 调研 starts, waits on a permission and
 * times out, 审查 finishes last.
 */
const LIVE_SCRIPT: Array<{ at: number; key: string; patch: Partial<Spec> }> = [
  { at: 2, key: 'live-export', patch: { usage: { toolCalls: 5, totalTokens: 7300, requests: 3 } } },
  { at: 4, key: 'live-cache', patch: { status: 'running', activity: { kind: 'tool', toolName: 'web_fetch', title: 'web_fetch (prompt caching)' }, usage: { toolCalls: 1, totalTokens: 1800, requests: 1 } } },
  { at: 6, key: 'live-review', patch: { activity: { kind: 'tool', toolName: 'read', title: 'read (permissions.md)' }, usage: { toolCalls: 4, totalTokens: 6900, requests: 2 } } },
  { at: 8, key: 'live-export', patch: { status: 'completed', activity: { kind: 'completed', summary: '导出路径改走 media 目录' }, usage: { toolCalls: 6, totalTokens: 9400, requests: 4 } } },
  { at: 10, key: 'live-cache', patch: { activity: { kind: 'permission', action: 'web_fetch' }, usage: { toolCalls: 2, totalTokens: 2600, requests: 2 } } },
  { at: 14, key: 'live-cache', patch: { status: 'failed', activity: { kind: 'failed', message: 'web_fetch 超时（30s），未取得文档' } } },
  { at: 18, key: 'live-review', patch: { status: 'completed', activity: { kind: 'completed', summary: '符合 ADR 0019' }, usage: { toolCalls: 7, totalTokens: 13800, requests: 4 } } },
];

export function seedSubagentCardsShowcase(host: MockHostBackend): void {
  const seededAt = Date.now();
  const all = [...SETTLED, ...ATTENTION, ...SINGLE, ...LIVE];
  let scheduled = false;
  host.extraCommandHandlers.push((command, id) => {
    if (command.type !== 'session/list-children' || command.parentSessionId !== SUBAGENT_CARDS_SESSION_ID) {
      return null;
    }
    const now = Date.now();
    if (!scheduled) {
      scheduled = true;
      scheduleLiveScript(host, now);
    }
    return {
      id,
      type: 'response',
      command: 'session/list-children',
      success: true,
      data: {
        parentSessionId: SUBAGENT_CARDS_SESSION_ID,
        sessions: all.map((spec) => childFor(spec, seededAt)),
        invocations: all.map((spec) => invocationFor(spec, LIVE.includes(spec) ? now : seededAt)),
      },
    };
  });
}

function scheduleLiveScript(host: MockHostBackend, openedAt: number): void {
  const state = new Map(LIVE.map((spec) => [spec.key, { ...spec }]));
  const revisions = new Map(LIVE.map((spec) => [spec.key, 1]));
  for (const step of LIVE_SCRIPT) {
    window.setTimeout(() => {
      const current = state.get(step.key);
      if (!current) return;
      const next: Spec = { ...current, ...step.patch };
      const settled = next.status === 'completed' || next.status === 'failed';
      if (settled) next.took = current.startedAgo + step.at;
      state.set(step.key, next);
      const revision = (revisions.get(step.key) ?? 1) + 1;
      revisions.set(step.key, revision);
      host.emitPush({
        type: 'subagent/invocation-updated',
        parentSessionId: SUBAGENT_CARDS_SESSION_ID,
        invocation: invocationFor(next, openedAt, revision),
      });
      // The child summary moves with it, so the inline session agrees.
      host.emitPush({
        type: 'subagent/updated',
        parentSessionId: SUBAGENT_CARDS_SESSION_ID,
        child: childFor(next, Date.now()),
      });
    }, step.at * 1000);
  }
}
