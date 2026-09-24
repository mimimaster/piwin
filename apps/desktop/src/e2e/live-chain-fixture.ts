/**
 * Live call-chain fixture: one user prompt plus 55 assistant steps in a single
 * run, the last step still streaming. Shaped after session-mufct552-b137cg3x,
 * which re-rendered every mounted row on each token and each run/updated.
 *
 * Tool output and thinking stay small on purpose. The resident transcript page
 * is 50 messages / 256KB, and a page that spans turns would leave the live turn
 * only partly mounted — the benchmark needs the whole turn on screen.
 *
 * Installed only when `VITE_PIWIN_E2E_FIXTURES=true` and `?e2eLiveChain=1`.
 */
import type { SessionRunPhase, SessionToolCardView, SessionTranscriptMessage } from '@piwin/contracts';
import type { MockHostBackend } from '../host-client-mock.js';
import { installRenderProbe, type RenderProbeStore } from './render-probe-store.js';

const PROJECT = '/mock/piwin';
export const LIVE_CHAIN_SESSION_ID = 'fixture-live-chain';
export const LIVE_CHAIN_STEP_COUNT = 55;
const RUN_ID = 'run-live-chain';
const TAIL_ID = `live-a${String(LIVE_CHAIN_STEP_COUNT).padStart(3, '0')}`;

const THINKING_SAMPLE = '先看调用方，再核对比较函数是不是按引用判断，最后确认热路径上没有新建数组。';

/**
 * Reasoning volume per step, cycled across the turn. The real session carried
 * ~320K characters; the resident transcript page caps at 256KB and does not
 * strip reasoning, so the ladder is sized to keep the whole turn resident —
 * which is the shape the benchmark needs. Total is ~100KB.
 */
const THINKING_CHARS_BY_STEP = [0, 60, 120, 240, 400, 700, 1_000, 1_400, 1_800, 400];

function toolOutput(step: number, tool: number, bytes: number): string {
  const line = `step ${step} tool ${tool}: ${'x'.repeat(48)}\n`;
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
}

function bashTool(id: string, step: number, tool: number): SessionToolCardView {
  // 2–12KB per tool call. The mock transcript page strips tool output before
  // the byte budget is applied, so this never reaches the renderer; it only
  // keeps the host-side payload honestly shaped. 90KB × ~250 calls would cost
  // the harness ~20MB of transport without changing what renders.
  const bytes = 2_048 + ((step * 4_093 + tool * 977) % 10_000);
  return {
    toolCallId: id,
    toolName: 'bash',
    status: 'done',
    output: toolOutput(step, tool, bytes),
    runId: RUN_ID,
    presentation: {
      kind: 'shell',
      title: 'bash',
      command: `sed -n '${step},${step + 20}p' apps/desktop/src/chat-thread.tsx`,
      durationMs: 40 + step,
      exitCode: 0,
    },
  };
}

function thinkingFor(step: number): string {
  const target = THINKING_CHARS_BY_STEP[step % THINKING_CHARS_BY_STEP.length] ?? 0;
  if (target === 0) return '';
  return THINKING_SAMPLE.repeat(Math.ceil(target / THINKING_SAMPLE.length)).slice(0, target);
}

export function buildLiveChainTranscript(): SessionTranscriptMessage[] {
  const start = Date.parse('2026-09-24T10:00:00.000Z');
  const messages: SessionTranscriptMessage[] = [
    {
      id: 'live-u01',
      role: 'user',
      text: '继续排查：运行中的长调用链为什么整轮重渲',
      createdAt: new Date(start).toISOString(),
      status: 'done',
    },
  ];
  for (let step = 0; step < LIVE_CHAIN_STEP_COUNT; step += 1) {
    const last = step === LIVE_CHAIN_STEP_COUNT - 1;
    const id = `live-a${String(step + 1).padStart(3, '0')}`;
    const toolCount = last ? 0 : 1 + (step % 8);
    messages.push({
      id,
      role: 'assistant',
      status: last ? 'streaming' : 'done',
      createdAt: new Date(start + (step + 1) * 4_000).toISOString(),
      runId: RUN_ID,
      text: last ? '正在核对比较函数' : `第 ${step + 1} 步已核对`,
      thinking: thinkingFor(step),
      tools: Array.from({ length: toolCount }, (_, tool) =>
        bashTool(`${id}-tool-${tool + 1}`, step + 1, tool + 1),
      ),
    });
  }
  return messages;
}

export type LiveChainDriver = {
  ticks: number;
  phaseSwitches: number;
  /** One token onto the streaming tail. */
  pushToken: () => void;
  /** One run/updated with a phase the previous push did not carry. */
  pushPhase: () => void;
  stop: () => void;
};

const PHASES: readonly SessionRunPhase[] = ['streaming', 'tool-running'];

export function createLiveChainDriver(host: MockHostBackend): LiveChainDriver {
  const session = host.sessions.get(LIVE_CHAIN_SESSION_ID);
  let timer = 0;
  const driver: LiveChainDriver = {
    ticks: 0,
    phaseSwitches: 0,
    pushToken: () => {
      driver.ticks += 1;
      const tail = session?.transcript.find((message) => message.id === TAIL_ID);
      if (tail) tail.text += ' ·';
      host.pushEvent(LIVE_CHAIN_SESSION_ID, {
        type: 'message/text_delta',
        messageId: TAIL_ID,
        delta: ' ·',
        runId: RUN_ID,
      });
    },
    pushPhase: () => {
      driver.phaseSwitches += 1;
      host.pushMockRunUpdated(
        LIVE_CHAIN_SESSION_ID,
        RUN_ID,
        'running',
        PHASES[driver.phaseSwitches % PHASES.length] ?? 'streaming',
      );
    },
    stop: () => window.clearInterval(timer),
  };

  // Background stream so the session is genuinely live; the benchmark stops it
  // and drives single pushes so each sample is one event.
  timer = window.setInterval(() => {
    driver.pushToken();
    if (driver.ticks % 20 === 0) driver.pushPhase();
  }, 33);
  return driver;
}

export function seedLiveChainHost(host: MockHostBackend): void {
  const createdAt = '2026-09-24T10:00:00.000Z';
  host.mockProjects.set(PROJECT, {
    path: PROJECT,
    trust: 'trusted',
    createdAt,
    lastOpenedAt: createdAt,
  });
  host.mockGitCurrentBranches.set(PROJECT, 'main');
  host.sessions.set(LIVE_CHAIN_SESSION_ID, {
    projectPath: PROJECT,
    scope: { kind: 'project', projectPath: PROJECT },
    workingDirectory: PROJECT,
    name: '运行中 · 55 步调用链',
    nameSource: 'user',
    updatedAt: createdAt,
    events: [],
    transcript: buildLiveChainTranscript(),
  });
  host.pushMockRunUpdated(LIVE_CHAIN_SESSION_ID, RUN_ID, 'running', 'streaming', createdAt);
  const probe: RenderProbeStore = installRenderProbe();
  const driver = createLiveChainDriver(host);
  (
    window as Window & { __piwinLiveChain?: { driver: LiveChainDriver; probe: RenderProbeStore } }
  ).__piwinLiveChain = { driver, probe };
}
