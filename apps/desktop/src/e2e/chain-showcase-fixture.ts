/**
 * Screenshot fixture: two fabricated conversations rendered through the real
 * path (session → mock Host → transcript → tool-card components).
 *
 * Nothing here is a mock of the UI: it only fabricates *data* (`ToolPresentation`
 * payloads the Host would normally derive), so every card, node state, capsule
 * and diff on screen is produced by the shipping renderer.
 *
 * Installed only when `VITE_PIWIN_E2E_FIXTURES=true` and `?e2eChainShowcase=1`.
 */
import type {
  SessionPlan,
  SessionToolCardView,
  SessionTranscriptMessage,
  ToolPresentation,
} from '@piwin/contracts';
import { KNOWLEDGE_CITATIONS_DETAILS_KIND, WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND } from '@piwin/contracts';
import type { MockHostBackend } from '../host-client-mock.js';

const PROJECT = '/mock/piwin';
const SESSION_ENDPOINT = 'showcase-endpoint-loop';
const SESSION_RESEARCH = 'showcase-research-persist';
const SESSION_FANOUT = 'showcase-subagent-fanout';
const SESSION_TOOLED = 'showcase-tool-families';
const SESSION_APPROVAL = 'showcase-approval-gates';
const APPROVAL_RUN_ID = 'run-showcase-approval';

function tool(view: SessionToolCardView): SessionToolCardView {
  return view;
}

/** Shell/filesystem row with an already-finished status. */
function doneTool(
  toolCallId: string,
  toolName: string,
  presentation: ToolPresentation,
  output: string,
): SessionToolCardView {
  return tool({ toolCallId, toolName, status: 'done', output, presentation });
}

const iosEndpointTools: SessionToolCardView[] = [
  doneTool(
    'ios-doctor',
    'pi_ios_doctor',
    {
      kind: 'process',
      title: 'pi_ios_doctor',
      summary: 'macos 26.0 · xcode 26.0 · simctl · node v22.22.1',
      durationMs: 900,
    },
    'xcode 26.0 · iPhoneSimulator 26.0 SDK present',
  ),
  doneTool(
    'ios-rn-doctor',
    'pi_ios_react_native',
    {
      kind: 'process',
      title: 'pi_ios_react_native',
      summary: 'doctor',
      countTag: '8 项检查通过',
      durationMs: 1200,
    },
    'react-native 0.82 · pods installed',
  ),
  doneTool(
    'ios-metro',
    'pi_ios_react_native',
    {
      kind: 'process',
      title: 'pi_ios_react_native',
      summary: 'start-metro · :8081',
      countTag: 'Metro 就绪',
      durationMs: 3400,
    },
    'Metro waiting on http://localhost:8081',
  ),
  doneTool(
    'ios-boot',
    'pi_ios_simulator',
    {
      kind: 'process',
      title: 'pi_ios_simulator',
      summary: 'boot · iPhone 16 Pro',
      countTag: '已启动',
      durationMs: 6100,
    },
    'Booted: iPhone 16 Pro (iOS 26.0)',
  ),
  doneTool(
    'ios-build',
    'pi_ios_build_run',
    {
      kind: 'shell',
      title: 'pi_ios_build_run',
      command:
        'xcodebuild -scheme PiwinMobile -destination "platform=iOS Simulator,name=iPhone 16 Pro"',
      countTag: 'Build Succeeded',
      durationMs: 11300,
      exitCode: 0,
    },
    '** BUILD SUCCEEDED ** · installed com.piwin.mobile',
  ),
  doneTool(
    'ios-snapshot',
    'pi_ios_ui',
    {
      kind: 'other',
      title: 'pi_ios_ui',
      summary: 'snapshot',
      countTag: '12 个可交互元素',
      durationMs: 800,
    },
    'title: 首页 · 4 tabs · 6 list rows · 1 primary action',
  ),
  doneTool(
    'ios-assert',
    'pi_ios_ui',
    {
      kind: 'other',
      title: 'pi_ios_ui',
      summary: 'assert-visible · 首页标题 / 底部 Tab ×4',
      countTag: '4/4 通过',
      durationMs: 600,
    },
    'all assertions passed',
  ),
  doneTool(
    'ios-shot',
    'pi_ios_simulator',
    {
      kind: 'other',
      title: 'pi_ios_simulator',
      summary: 'screenshot',
      countTag: '1284×2778 · 已归档',
      durationMs: 1100,
    },
    '~/.piwin/media/2026-09-20/sim-piwin-mobile.png',
  ),
];

const researchPlan: SessionPlan = {
  id: 'plan-artifact-csp-adr',
  sessionId: SESSION_RESEARCH,
  projectPath: PROJECT,
  status: 'executing',
  title: '后续：把 CSP 结论并入 ADR 0005',
  goal: '把本轮核对过的沙箱事实并入 ADR 0005，并给 wiki 页补一条到 srcdoc.ts 的源码引用',
  steps: [
    {
      id: '1',
      title: '更新 ADR 0005 的沙箱小节',
      detail: 'docs/adr/0005-artifact-and-media.md · 补 allow-scripts 与不透明源说明',
      status: 'done',
    },
    {
      id: '2',
      title: '给 wiki 页补源码引用',
      detail: '~/.piwin/wiki/concepts/artifact-sandbox-csp.md · 指向 srcdoc.ts:24-35',
      status: 'active',
    },
    {
      id: '3',
      title: '跑一遍 artifact 包测试',
      detail: 'pnpm vitest run packages/artifact · 期望 22 passed',
      status: 'pending',
    },
  ],
  revision: 2,
  createdAt: '2026-09-20T15:21:40.000Z',
  updatedAt: '2026-09-20T15:22:20.000Z',
  source: 'assistant',
  complexity: 'short',
  independentSteps: ['2'],
  execution: {
    sessionId: SESSION_RESEARCH,
    planId: 'plan-artifact-csp-adr',
    mode: 'inline',
    status: 'running',
    runId: 'run-plan-adr',
    currentStepId: '2',
    childSessionIds: [],
    startedAt: '2026-09-20T15:22:05.000Z',
  },
};

const researchTools: SessionToolCardView[] = [
  doneTool(
    'csp-search',
    'code_search',
    {
      kind: 'other',
      title: 'code_search',
      summary: 'artifact csp frame sandbox',
      countTag: '12 处 · 4 文件',
      durationMs: 1100,
    },
    'packages/artifact/src/srcdoc.ts · packages/artifact/src/iframe-policy.ts',
  ),
  doneTool(
    'csp-grep',
    'grep',
    {
      kind: 'filesystem',
      title: 'grep',
      summary: '"Content-Security-Policy"',
      countTag: '9 处 · 4 文件',
      durationMs: 210,
    },
    'srcdoc.ts:155 · security.test.ts:41 …',
  ),
  doneTool(
    'csp-read-srcdoc',
    'read',
    {
      kind: 'filesystem',
      title: 'read',
      targetPaths: ['packages/artifact/src/srcdoc.ts'],
      lineRange: '1-214',
      countTag: '214 行',
      durationMs: 40,
    },
    'buildStrictArtifactCsp(policy)',
  ),
  doneTool(
    'csp-read-policy',
    'read',
    {
      kind: 'filesystem',
      title: 'read',
      targetPaths: ['packages/artifact/src/iframe-policy.ts'],
      lineRange: '1-96',
      countTag: '96 行',
      durationMs: 30,
    },
    'createDefaultArtifactIframePolicy()',
  ),
  doneTool(
    'csp-grep-sandbox',
    'grep',
    {
      kind: 'filesystem',
      title: 'grep',
      summary: '"allow-scripts"',
      countTag: '6 处',
      durationMs: 180,
    },
    'ArtifactFrame.tsx · srcdoc.test.ts …',
  ),
  {
    toolCallId: 'csp-fetch',
    toolName: 'web_fetch',
    status: 'error',
    output: 'fetch timeout after 12000ms · no bytes received',
    presentation: {
      kind: 'web',
      title: 'web_fetch',
      summary: 'developer.mozilla.org/…/Content-Security-Policy',
      durationMs: 12000,
      error: { category: 'timeout', message: 'fetch timeout after 12000ms' },
    },
  },
  doneTool(
    'csp-web-search',
    'web_search',
    {
      kind: 'web',
      title: 'web_search',
      summary: 'iframe sandbox 与 CSP 组合 最佳实践',
      countTag: '5 条结果',
      durationMs: 1800,
      webSearch: {
        kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
        providerId: 'aggregate:brave+tavily',
        hitCount: 5,
        durationMs: 1800,
        attempts: [
          { sourceId: 'brave', ok: true, hitCount: 4, durationMs: 900 },
          { sourceId: 'tavily', ok: true, hitCount: 3, durationMs: 700 },
          { sourceId: 'exa', ok: false, hitCount: 0, durationMs: 200 },
        ],
      },
    },
    'iframe sandbox 与 CSP 组合的最佳实践',
  ),
  doneTool(
    'csp-knowledge',
    'knowledge_search',
    {
      kind: 'other',
      title: 'knowledge_search',
      summary: 'sandbox 不透明源',
      countTag: '2 条命中',
      durationMs: 340,
      knowledge: {
        kind: KNOWLEDGE_CITATIONS_DETAILS_KIND,
        degradedBaseIds: [],
        citations: [
          {
            ref: 1,
            baseId: 'wiki',
            baseName: '项目 Wiki',
            kind: 'folder',
            title: 'Reconnect Strategy',
            relativePath: 'concepts/reconnect-strategy.md',
            startLine: 12,
            endLine: 40,
            text: '重连采用指数退避 + 抖动，attempt 上限 6 次后转入离线队列。',
          },
          {
            ref: 2,
            baseId: 'notes',
            baseName: '随手笔记',
            kind: 'notes',
            title: 'iframe 沙箱笔记',
            noteId: 'note-iframe',
            text: 'sandbox="allow-scripts" 不给 allow-same-origin 时，文档源不透明，读不到父级 DOM。',
          },
        ],
      },
    },
    '2 citations',
  ),
  doneTool(
    'csp-plan-create',
    'piwin_plan_create',
    {
      kind: 'other',
      title: 'piwin_plan_create',
      summary: '把 CSP 结论并入 ADR 0005',
      countTag: '3 步 · 1 可并行',
      durationMs: 180,
    },
    'plans/showcase-research-persist.md',
  ),
  doneTool(
    'csp-plan-step-1',
    'piwin_plan_set_step',
    {
      kind: 'other',
      title: 'piwin_plan_set_step',
      summary: '步骤 1 · 定位 CSP 组装点',
      countTag: 'done',
      durationMs: 20,
    },
    'done',
  ),
  doneTool(
    'csp-plan-step-2',
    'piwin_plan_set_step',
    {
      kind: 'other',
      title: 'piwin_plan_set_step',
      summary: '步骤 2 · 核对 sandbox 与 policy 白名单',
      countTag: 'done',
      durationMs: 20,
    },
    'done',
  ),
  doneTool(
    'csp-wiki-write',
    'write_file',
    {
      kind: 'filesystem',
      title: 'write_file',
      targetPaths: ['docs/knowledge/artifact-csp.md'],
      changedPaths: ['docs/knowledge/artifact-csp.md'],
      countTag: '34 行',
      durationMs: 60,
    },
    'wrote 34 lines',
  ),
  doneTool(
    'csp-test',
    'bash',
    {
      kind: 'shell',
      title: 'bash',
      command: 'pnpm vitest run packages/artifact',
      countTag: '22 passed',
      durationMs: 6400,
      exitCode: 0,
    },
    'Test Files 6 passed · Tests 22 passed',
  ),
  doneTool(
    'csp-subagent',
    'piwin_subagent_run',
    {
      kind: 'subagent',
      title: 'piwin_subagent_run',
      summary: 'verifier · 复核 CSP 结论',
      countTag: '1 个子代理',
      durationMs: 11200,
      subagentControl: {
        phase: 'waited',
        total: 1,
        completed: 1,
        failed: 0,
        cancelled: 0,
        needsIntegration: 0,
        runs: [
          {
            runId: 'run-verify-csp',
            invocationId: 'invocation-verify-csp',
            title: 'verifier · 复核 CSP 结论',
            activity: 'readonly 隔离 · 3 步 · 11.2s',
            summaryPreview: '修正 1 处：canvas 面与内联面共用同一套策略',
            executionStatus: 'completed',
            summaryStatus: 'merged',
            integrationStatus: 'not-requested',
          },
        ],
      },
    },
    'subagent verified 5 findings',
  ),
  doneTool(
    'csp-wiki-tool',
    'wiki_write',
    {
      kind: 'filesystem',
      title: 'wiki_write',
      summary: 'concepts/artifact-sandbox-csp.md',
      countTag: '新建 · 34 行',
      durationMs: 90,
    },
    'concepts/artifact-sandbox-csp.md',
  ),
  doneTool(
    'csp-memory',
    'mcp__agent-memory__agent_memory_remember',
    {
      kind: 'mcp',
      title: 'mcp__agent-memory__agent_memory_remember',
      summary: 'category=architecture',
      countTag: '已记录 · 1 条',
      durationMs: 260,
    },
    'remembered: artifact CSP 在 srcdoc 组装期注入',
  ),
  doneTool(
    'csp-goal',
    'goal_complete',
    {
      kind: 'other',
      title: 'goal_complete',
      summary: 'CSP 结论已沉淀',
      durationMs: 40,
      goal: {
        phase: 'completed',
        summary:
          'artifact 沙箱的 CSP 由 buildStrictArtifactCsp() 在 srcdoc 组装期一次拼出，沙箱靠不透明源兜底；结论已写入 wiki 与项目记忆，未改动源码。',
        verification: 'pnpm vitest run packages/artifact · 22 passed',
        artifacts: ['docs/knowledge/artifact-csp.md', '~/.piwin/wiki/concepts/artifact-sandbox-csp.md'],
      },
    },
    'goal complete',
  ),
  doneTool(
    'csp-plan-present',
    'piwin_plan_present',
    {
      kind: 'other',
      title: 'piwin_plan_present',
      summary: 'artifact CSP 结论沉淀',
      countTag: '4/4 完成',
      durationMs: 30,
      plan: {
        version: 1,
        path: 'plans/showcase-research-persist.md',
        displayPath: 'plans/showcase-research-persist.md',
        plan: researchPlan,
      },
    },
    'plan presented',
  ),
];

const endpointTranscript: SessionTranscriptMessage[] = [
  {
    id: 'showcase-endpoint-user',
    role: 'user',
    text: '把 piwin-mobile 跑起来，在 iPhone 16 Pro 上看一眼首页，顺手截图给我。别动我前台窗口。',
    createdAt: '2026-09-20T15:04:00.000Z',
    status: 'done',
  },
  {
    id: 'showcase-endpoint-assistant',
    role: 'assistant',
    status: 'done',
    outcome: 'completed',
    thinkingStartedAt: '2026-09-20T15:04:12.000Z',
    thinkingEndedAt: '2026-09-20T15:04:36.000Z',
    createdAt: '2026-09-20T15:05:00.000Z',
    startedAt: '2026-09-20T15:04:12.000Z',
    endedAt: '2026-09-20T15:04:37.000Z',
    model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    thinking:
      '宿主机是 macOS 26 + Xcode 26。顺序必须是 Metro 先起、再编原生包 —— 反了会让 Xcode 侧探测 8081 超时。截图走 simctl，App 不必开到前台。',
    tools: iosEndpointTools,
    text: [
      '### 首页已在模拟器上跑通',
      '',
      'Metro 先起、原生包后编，`pi_ios_build_run` 一次完成编译、安装与启动；`pi_ios_ui` 用无障碍树确认首页可交互（标题 + 4 个 Tab），最后走 `simctl` 截图 —— 全程没有抢占你的前台窗口。',
      '',
      '- 设备：iPhone 16 Pro · iOS 26.0',
      '- 产物：`~/.piwin/media/2026-09-20/sim-piwin-mobile.png`（1284×2778）',
    ].join('\n'),
  },
];

const researchTranscript: SessionTranscriptMessage[] = [
  {
    id: 'showcase-research-user',
    role: 'user',
    text: 'artifact 沙箱的 CSP 是怎么拼的？查清楚后写进 wiki，并把结论记到项目记忆里。先别改代码。',
    createdAt: '2026-09-20T15:20:00.000Z',
    status: 'done',
  },
  {
    id: 'showcase-research-assistant',
    role: 'assistant',
    status: 'done',
    outcome: 'completed',
    thinkingStartedAt: '2026-09-20T15:20:08.000Z',
    thinkingEndedAt: '2026-09-20T15:21:50.000Z',
    createdAt: '2026-09-20T15:22:00.000Z',
    startedAt: '2026-09-20T15:20:08.000Z',
    endedAt: '2026-09-20T15:21:50.000Z',
    model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    thinking:
      'CSP 只可能在 srcdoc 组装期注入 —— 先看 packages/artifact 的 srcdoc / iframe-policy，再回头看 desktop 侧怎么选 policy。顺序反过来会把渲染层误判成安全边界。这一轮只读不写，产出是一篇 wiki 加一条记忆。',
    tools: researchTools,
    workspaceWrites: { files: ['docs/knowledge/artifact-csp.md'], hasUnknownWrites: false },
    text: [
      '### CSP 在 srcdoc 组装期注入，沙箱靠不透明源兜底',
      '',
      '**清单**：`buildStrictArtifactCsp()` 一次拼出 `default-src \'none\'`、`base-uri \'none\'`、`object-src \'none\'`、`form-action \'none\'`，只放开内联脚本与样式（`\'unsafe-inline\'`）以及 `img-src data: blob:`、`font-src data:`；`connect-src` 恒为 `\'none\'`，只有 `frame-src` 来自 iframe policy 白名单 [1]。',
      '',
      '**注入点与沙箱**：清单以 `<meta http-equiv="Content-Security-Policy">` 写进 srcdoc 文档头 —— 渲染层不参与安全决策；iframe 仅授予 `allow-scripts`（不给 `allow-same-origin`），文档处在不透明源上，读不到父级 DOM、cookie 与 storage。外链先经 `detectExternalArtifactResources()` 归类，确需外链时只放宽 `frame-src`。',
    ].join('\n'),
  },
];

/* ------------------------------------------------------------------ *
 * Session 05 — approval surfaces: plan execution gate + permission gate.
 * These two cards are driven by live Host pushes (a completed Run record and
 * a pending permission request), not by transcript data, so the fixture emits
 * them after boot — repeating with a stable eventId so the app cannot miss one.
 * ------------------------------------------------------------------ */

const approvalPlan: SessionPlan = {
  id: 'plan-adr-csp',
  sessionId: SESSION_APPROVAL,
  projectPath: PROJECT,
  status: 'draft',
  title: '把 CSP 结论并入 ADR 0005',
  goal: '把本轮核对过的沙箱事实写进 ADR 0005，并给 wiki 页补源码引用',
  steps: [
    {
      id: '1',
      title: '更新 ADR 0005 的沙箱小节',
      detail: 'docs/adr/0005-artifact-and-media.md',
      status: 'pending',
    },
    {
      id: '2',
      title: '给 wiki 页补源码引用',
      detail: '~/.piwin/wiki/concepts/artifact-sandbox-csp.md',
      status: 'pending',
    },
    {
      id: '3',
      title: '跑 artifact 包测试',
      detail: 'pnpm vitest run packages/artifact',
      status: 'pending',
      dependsOn: ['1', '2'],
    },
  ],
  revision: 1,
  createdAt: '2026-09-20T17:05:00.000Z',
  updatedAt: '2026-09-20T17:05:00.000Z',
  source: 'assistant',
  complexity: 'short',
  independentSteps: ['1', '2'],
};

const approvalTools: SessionToolCardView[] = [
  doneTool(
    'app-1',
    'read_file',
    {
      kind: 'filesystem',
      title: 'read_file',
      targetPaths: ['docs/adr/0005-artifact-and-media.md'],
      lineRange: '1-132',
      countTag: '132 行',
      durationMs: 40,
    },
    'ADR 0005 read',
  ),
  doneTool(
    'app-2',
    'grep',
    {
      kind: 'filesystem',
      title: 'grep',
      summary: '"allow-scripts"',
      countTag: '6 处',
      durationMs: 140,
    },
    '6 matches',
  ),
  doneTool(
    'app-plan',
    'piwin_plan_present',
    {
      kind: 'other',
      title: 'piwin_plan_present',
      summary: '把 CSP 结论并入 ADR 0005',
      countTag: '3 步 · 待批准',
      durationMs: 30,
      plan: {
        version: 1,
        path: 'plans/showcase-approval-gates.md',
        displayPath: 'plans/showcase-approval-gates.md',
        plan: approvalPlan,
      },
    },
    'plan presented for approval',
  ),
  doneTool(
    'app-goal-blocked',
    'goal_blocked',
    {
      kind: 'other',
      title: 'goal_blocked',
      summary: '等你批准后再写 ADR',
      durationMs: 40,
      goal: {
        phase: 'blocked',
        reason: 'ADR 0005 属于项目文档，写入需要你授权一次。',
        unblockAction: '批准写入，或改为只产出 diff 供你手动应用。',
      },
    },
    'goal blocked on approval',
  ),
];

const approvalTranscript: SessionTranscriptMessage[] = [
  {
    id: 'showcase-approval-user',
    role: 'user',
    text: '把 artifact 沙箱那段结论并进 ADR 0005，顺便给 wiki 页补一条源码引用。写完跑一遍包内测试。',
    createdAt: '2026-09-20T17:05:00.000Z',
    status: 'done',
  },
  {
    id: 'showcase-approval-assistant',
    role: 'assistant',
    status: 'done',
    outcome: 'completed',
    runId: APPROVAL_RUN_ID,
    createdAt: '2026-09-20T17:05:40.000Z',
    startedAt: '2026-09-20T17:05:06.000Z',
    endedAt: '2026-09-20T17:05:34.000Z',
    thinkingStartedAt: '2026-09-20T17:05:06.000Z',
    thinkingEndedAt: '2026-09-20T17:05:26.000Z',
    model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    thinking:
      'ADR 是项目文档，写它要过一次权限；wiki 页在 ~/.piwin 下同样算写入。先读 ADR 现状、确认要改的小节，再出计划等批准 —— 不先斩后奏。',
    tools: approvalTools,
    text: [
      '### 材料已经备好，等你点头',
      '',
      'ADR 0005 现在只讲媒体与 artifact 生命周期，没有沙箱小节；我准备补一节 `Sandbox & CSP`（`allow-scripts` 不给 `allow-same-origin`、清单 `default-src \'none\'`、`frame-src` 走白名单），再给 wiki 页补一条指向 `srcdoc.ts:24-35` 的引用。',
      '',
      '写入需要你授权一次 —— 批准后我按计划执行三步，最后跑 `pnpm vitest run packages/artifact` 复验。',
    ].join('\n'),
  },
];

/**
 * Live surfaces for the approval session: a completed Run record (the plan gate
 * refuses to offer itself without one) and a pending permission request.
 */
function scheduleApprovalPushes(host: MockHostBackend): void {
  const runUpdated = {
    type: 'run/updated' as const,
    eventId: 'showcase-approval-run',
    run: {
      runId: APPROVAL_RUN_ID,
      revision: 3,
      kind: 'session-turn' as const,
      status: 'completed' as const,
      rootRunId: APPROVAL_RUN_ID,
      sessionId: SESSION_APPROVAL,
      outcome: 'completed' as const,
      startedAt: '2026-09-20T17:05:06.000Z',
      endedAt: '2026-09-20T17:05:34.000Z',
    },
  };
  const permissionRequest = {
    type: 'permission/request' as const,
    eventId: 'showcase-approval-permission',
    sessionId: SESSION_APPROVAL,
    requestId: 'perm-showcase-adr',
    action: 'write_file',
    detail: 'docs/adr/0005-artifact-and-media.md · +18 −2',
    defaultDecision: 'ask' as const,
    runId: APPROVAL_RUN_ID,
  };
  const emit = (): void => {
    host.emitPush(runUpdated);
    host.emitPush(permissionRequest);
  };
  // The app subscribes a beat after boot; identical eventIds keep repeats inert.
  for (const delay of [2000, 4000, 7000, 11000]) {
    window.setTimeout(emit, delay);
  }
}

/** Installs the showcase session(s). Only called behind the E2E fixture flag. */
export function seedChainShowcaseHost(host: MockHostBackend, selector = 'all'): void {
  const createdAt = '2026-09-20T15:04:00.000Z';
  host.mockProjects.set(PROJECT, {
    path: PROJECT,
    trust: 'trusted',
    createdAt,
    lastOpenedAt: createdAt,
  });
  host.mockGitCurrentBranches.set(PROJECT, 'main');

  host.sessions.set(SESSION_ENDPOINT, {
    projectPath: PROJECT,
    scope: { kind: 'project', projectPath: PROJECT },
    workingDirectory: PROJECT,
    name: '端上闭环 · iPhone 16 Pro',
    nameSource: 'user',
    updatedAt: createdAt,
    events: [],
    transcript: endpointTranscript,
  });
  const seedSession = (
    id: string,
    name: string,
    updatedAt: string,
    transcript: SessionTranscriptMessage[],
  ): void => {
    host.sessions.set(id, {
      projectPath: PROJECT,
      scope: { kind: 'project', projectPath: PROJECT },
      workingDirectory: PROJECT,
      name,
      nameSource: 'user',
      updatedAt,
      events: [],
      transcript,
    });
  };
  // One key per shots run: the landing list only surfaces the 4 most recent
  // sessions, so each capture seeds just the conversation it is photographing.
  const wanted = (key: string): boolean => selector === 'all' || selector === key;

  if (wanted('endpoint')) {
    seedSession(SESSION_ENDPOINT, '端上闭环 · iPhone 16 Pro', createdAt, endpointTranscript);
  }
  if (wanted('research')) {
    // Message-bound snapshot + live document: the plan card reads the transcript
    // payload, the tray above the composer reads `plan/get`.
    host.plans.set(SESSION_RESEARCH, researchPlan);
    seedSession(SESSION_RESEARCH, 'artifact 沙箱 CSP · 结论沉淀', '2026-09-20T15:20:00.000Z', researchTranscript);
  }
  if (wanted('fanout')) {
    host.plans.set(SESSION_FANOUT, fanoutPlan);
    seedSession(SESSION_FANOUT, '三块并行 · 3 个子代理', '2026-09-20T16:04:10.000Z', fanoutTranscript);
  }
  if (wanted('tooled')) {
    seedSession(SESSION_TOOLED, '工具家族一览 · 浏览器 / 配图 / 卡片 / 日志', '2026-09-20T16:32:20.000Z', toolFamilyTranscript);
  }
  if (wanted('approval')) {
    host.plans.set(SESSION_APPROVAL, approvalPlan);
    seedSession(SESSION_APPROVAL, '待批准 · ADR 写入 + 计划', '2026-09-20T17:05:40.000Z', approvalTranscript);
    scheduleApprovalPushes(host);
  }
}

/** Installs the showcase session(s). Only called behind the E2E fixture flag. */

/* ------------------------------------------------------------------ *
 * Session 03 — parallel subagent fan-out (multiple children + review)
 * ------------------------------------------------------------------ */

const fanoutPlan: SessionPlan = {
  id: 'plan-fanout-three-way',
  sessionId: SESSION_FANOUT,
  projectPath: PROJECT,
  status: 'executing',
  title: '三块并行 + 人工合并',
  goal: 'artifact 断言 / mobile 设置 Tab / wiki 双语化 三块并行推进，合并由用户确认',
  steps: [
    {
      id: '1',
      title: '补 artifact CSP 断言',
      detail: 'packages/artifact/src/security.test.ts',
      status: 'done',
      profileId: 'verifier',
      parallelGroup: 'fanout-a',
    },
    {
      id: '2',
      title: 'mobile 端加设置 Tab',
      detail: 'apps/mobile/src/settings/tab.tsx',
      status: 'done',
      parallelGroup: 'fanout-a',
    },
    {
      id: '3',
      title: 'wiki 页双语化',
      detail: '~/.piwin/wiki/concepts/artifact-sandbox-csp.md',
      status: 'active',
      parallelGroup: 'fanout-a',
    },
    {
      id: '4',
      title: '人工合并三个 worktree',
      detail: 'explicit apply · 用户确认后合入',
      status: 'pending',
      dependsOn: ['1', '2', '3'],
    },
  ],
  revision: 5,
  createdAt: '2026-09-20T16:02:00.000Z',
  updatedAt: '2026-09-20T16:08:40.000Z',
  source: 'assistant',
  complexity: 'long',
  independentSteps: ['1', '2', '3'],
  execution: {
    sessionId: SESSION_FANOUT,
    planId: 'plan-fanout-three-way',
    mode: 'subagent-driven',
    status: 'running',
    runId: 'run-plan-fanout',
    currentStepId: '3',
    childSessionIds: ['child-artifact-assert', 'child-mobile-tab', 'child-wiki-i18n'],
    startedAt: '2026-09-20T16:02:30.000Z',
  },
};

const fanoutTools: SessionToolCardView[] = [
  doneTool(
    'fanout-plan-create',
    'piwin_plan_create',
    {
      kind: 'other',
      title: 'piwin_plan_create',
      summary: '三块并行 + 人工合并',
      countTag: '4 步 · 3 可并行',
      durationMs: 210,
    },
    'plans/showcase-subagent-fanout.md',
  ),
  doneTool(
    'fanout-run-assert',
    'piwin_subagent_run',
    {
      kind: 'subagent',
      title: 'piwin_subagent_run',
      summary: '补 artifact CSP 断言',
      countTag: 'worktree · profile=verifier',
      durationMs: 900,
      subagentControl: {
        phase: 'accepted',
        runId: 'run-artifact-assert',
        invocationId: 'inv-artifact-assert',
        task: '在 packages/artifact/src/security.test.ts 补 CSP 指令覆盖断言',
      },
    },
    'accepted',
  ),
  doneTool(
    'fanout-run-mobile',
    'piwin_subagent_run',
    {
      kind: 'subagent',
      title: 'piwin_subagent_run',
      summary: 'mobile 端加设置 Tab',
      countTag: 'worktree · profile=coder',
      durationMs: 800,
      subagentControl: {
        phase: 'accepted',
        runId: 'run-mobile-tab',
        invocationId: 'inv-mobile-tab',
        task: '给 apps/mobile 加一个设置 Tab 与路由',
      },
    },
    'accepted',
  ),
  doneTool(
    'fanout-run-wiki',
    'piwin_subagent_run',
    {
      kind: 'subagent',
      title: 'piwin_subagent_run',
      summary: 'wiki 页双语化',
      countTag: 'worktree · profile=docs',
      durationMs: 860,
      subagentControl: {
        phase: 'accepted',
        runId: 'run-wiki-i18n',
        invocationId: 'inv-wiki-i18n',
        task: '把 concepts/artifact-sandbox-csp.md 改成中英对照',
      },
    },
    'accepted',
  ),
  doneTool(
    'fanout-wait',
    'piwin_subagent_wait',
    {
      kind: 'subagent',
      title: 'piwin_subagent_wait',
      summary: '3 个子代理',
      countTag: '3 完成 · 1 待处理 · 1 冲突',
      durationMs: 64200,
      subagentControl: {
        phase: 'waited',
        total: 3,
        completed: 3,
        failed: 0,
        cancelled: 0,
        needsIntegration: 2,
        runs: [
          {
            runId: 'run-artifact-assert',
            invocationId: 'inv-artifact-assert',
            childSessionId: 'child-artifact-assert',
            title: '补 artifact CSP 断言',
            activity: '改动 security.test.ts · 3 步',
            summaryPreview: '+18 条断言，包内 22 passed',
            executionStatus: 'completed',
            summaryStatus: 'merged',
            integrationStatus: 'not-requested',
          },
          {
            runId: 'run-mobile-tab',
            invocationId: 'inv-mobile-tab',
            childSessionId: 'child-mobile-tab',
            title: 'mobile 端加设置 Tab',
            activity: '新增 tab.tsx + 路由 · 5 步',
            summaryPreview: 'Tab 与路由已通，i18n 文案待补',
            executionStatus: 'completed',
            summaryStatus: 'pending',
            integrationStatus: 'pending',
          },
          {
            runId: 'run-wiki-i18n',
            invocationId: 'inv-wiki-i18n',
            childSessionId: 'child-wiki-i18n',
            title: 'wiki 页双语化',
            activity: '重写概念页 · 2 步',
            summaryPreview: '中英对照落盘，与既有中文页命名冲突',
            executionStatus: 'completed',
            summaryStatus: 'merged',
            integrationStatus: 'conflict',
          },
        ],
      },
    },
    '3 subagents collected',
  ),
  doneTool(
    'fanout-continue',
    'piwin_subagent_continue',
    {
      kind: 'subagent',
      title: 'piwin_subagent_continue',
      summary: 'repair · wiki 命名冲突',
      countTag: '第 2 轮 · 复用 worktree',
      durationMs: 18400,
    },
    'continuation accepted',
  ),
  doneTool(
    'fanout-apply',
    'piwin_subagent_result_apply',
    {
      kind: 'subagent',
      title: 'piwin_subagent_result_apply',
      summary: 'applied · run-artifact-assert',
      countTag: '1 个候选已应用',
      durationMs: 640,
    },
    'applied 1 file',
  ),
  doneTool(
    'fanout-verify',
    'piwin_subagent_verification_submit',
    {
      kind: 'subagent',
      title: 'piwin_subagent_verification_submit',
      summary: 'passed · 3 项检查',
      countTag: '已记录',
      durationMs: 120,
    },
    'verification recorded',
  ),
  doneTool(
    'fanout-worktree',
    'bash',
    {
      kind: 'git',
      title: 'bash',
      command: 'git worktree list',
      countTag: '3 个 worktree',
      durationMs: 90,
      exitCode: 0,
    },
    '3 worktrees under .worktrees/',
  ),
];

const fanoutTranscript: SessionTranscriptMessage[] = [
  {
    id: 'showcase-fanout-user',
    role: 'user',
    text: '三块并行推进：①给 artifact 补 CSP 断言 ②mobile 端加一个设置 Tab ③把 wiki 那页双语化。三个子代理各做各的，结果我自己合，别自动 apply。',
    createdAt: '2026-09-20T16:02:00.000Z',
    status: 'done',
  },
  {
    id: 'showcase-fanout-assistant',
    role: 'assistant',
    status: 'done',
    outcome: 'completed',
    thinkingStartedAt: '2026-09-20T16:02:08.000Z',
    thinkingEndedAt: '2026-09-20T16:03:31.000Z',
    createdAt: '2026-09-20T16:03:40.000Z',
    startedAt: '2026-09-20T16:02:08.000Z',
    endedAt: '2026-09-20T16:03:31.000Z',
    model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    thinking:
      '三块互相独立，各自开 worktree。合并必须由我确认 —— applyPolicy 走 explicit，不让子代理碰主工作树；先建计划再并行 spawn，最后 wait 收结果，冲突的单独 continue 修一轮。',
    tools: fanoutTools,
    workspaceWrites: { files: ['packages/artifact/src/security.test.ts'], hasUnknownWrites: false },
    text: [
      '### 三块并行已收口，等你的合并确认',
      '',
      '- **断言**：`run-artifact-assert` 已应用（`+18` 条断言，包内 `22 passed`）。',
      '- **mobile Tab**：子代理把 Tab 与路由做通了，`i18n` 文案还差一条，报告待收。',
      '- **wiki 双语化**：落盘成功但与既有中文页命名冲突，已 `continue` 一轮把命名对齐。',
      '',
      '三个 worktree 都还在 `.worktrees/` 下，我没有自动 apply 第三个 —— 你确认命名后我再合。',
    ].join('\n'),
  },
  {
    id: 'showcase-fanout-activity',
    role: 'assistant',
    status: 'done',
    outcome: 'completed',
    createdAt: '2026-09-20T16:04:10.000Z',
    model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    tools: [],
    subagentActivity: {
      childSessionId: 'child-wiki-i18n',
      displayName: 'wiki 双语化',
      taskSummary: '中英对照改写 concepts/artifact-sandbox-csp.md，命名冲突已修复',
      state: 'merged',
      worktreePath: '.worktrees/wiki-i18n',
      updatedAt: '2026-09-20T16:04:05.000Z',
    },
    text: 'wiki 页保留在 worktree 里，等你说合再合。',
  },
];

/* ------------------------------------------------------------------ *
 * Session 04 — the remaining tool families (browser / media / cards /
 * terminal / toolbox / truncated read / goal wait)
 * ------------------------------------------------------------------ */

const toolFamilyTools: SessionToolCardView[] = [
  doneTool(
    'fam-browser-nav',
    'browser_navigate',
    {
      kind: 'other',
      title: 'browser_navigate',
      summary: 'https://v2.tauri.app/security/csp/',
      countTag: '已加载',
      durationMs: 1400,
    },
    'loaded v2.tauri.app/security/csp/',
  ),
  doneTool(
    'fam-browser-snapshot',
    'browser_snapshot',
    {
      kind: 'other',
      title: 'browser_snapshot',
      summary: 'snapshot',
      countTag: '142 个元素',
      durationMs: 420,
    },
    'heading CSP · code block · nav ×9',
  ),
  doneTool(
    'fam-browser-shot',
    'browser_screenshot',
    {
      kind: 'other',
      title: 'browser_screenshot',
      summary: 'screenshot',
      countTag: 'PNG · 1.1 MB',
      durationMs: 700,
    },
    '~/.piwin/media/2026-09-20/tauri-csp.png',
  ),
  doneTool(
    'fam-fetch',
    'web_fetch',
    {
      kind: 'web',
      title: 'web_fetch',
      summary: 'v2.tauri.app/security/csp',
      countTag: '4.2k 字',
      durationMs: 900,
    },
    'csp: null → 由 tauri.conf.json 的 security.csp 覆盖',
  ),
  doneTool(
    'fam-image-gen',
    'image_gen',
    {
      kind: 'image',
      title: 'image_gen',
      summary: '架构图：host ↔ client 边界',
      countTag: '1 张 · 2048×1152',
      durationMs: 18400,
    },
    '~/.piwin/media/2026-09-20/host-client-boundary.png',
  ),
  doneTool(
    'fam-read-truncated',
    'read',
    {
      kind: 'filesystem',
      title: 'read',
      targetPaths: ['packages/host-runtime/src/host-command-router.ts'],
      lineRange: '1-400',
      countTag: '2841 行',
      durationMs: 120,
      output: {
        text: '… (前 400 行)',
        truncated: true,
        truncation: { reason: 'line-limit', shownLines: { start: 1, end: 400 }, totalLines: 2841 },
      },
    },
    'large file read truncated',
  ),
  doneTool(
    'fam-flashcards',
    'flashcard_batch_create',
    {
      kind: 'other',
      title: 'flashcard_batch_create',
      summary: 'CSP 要点',
      countTag: '3 张 · deck=tauri',
      durationMs: 640,
      flashcard: {
        cards: [
          {
            cardId: 'card-1',
            itemId: 'item-1',
            model: 'basic',
            ordinal: 1,
            deck: 'tauri',
            front: 'Tauri 2 里谁最终决定 iframe 的 CSP？',
            back: '宿主页面自身的 CSP，加上 iframe 的 sandbox 属性；子文档只能再收紧。',
            createdAt: '2026-09-20T16:31:00.000Z',
            tags: ['tauri', 'csp'],
          },
          {
            cardId: 'card-2',
            itemId: 'item-2',
            model: 'basic',
            ordinal: 2,
            deck: 'tauri',
            front: 'sandbox 只给 allow-scripts 会怎样？',
            back: '文档落在不透明源上：拿不到父级 DOM / cookie / storage。',
            createdAt: '2026-09-20T16:31:00.000Z',
            tags: ['sandbox'],
          },
          {
            cardId: 'card-3',
            itemId: 'item-3',
            model: 'cloze',
            ordinal: 3,
            deck: 'tauri',
            front: 'connect-src 应当设为 {{none}}，外链只放宽 frame-src。',
            back: 'connect-src \'none\'',
            createdAt: '2026-09-20T16:31:00.000Z',
            tags: ['csp'],
          },
        ],
      },
    },
    'created 3 cards',
  ),
  doneTool(
    'fam-note-write',
    'note_write',
    {
      kind: 'filesystem',
      title: 'note_write',
      summary: 'tauri-csp 笔记',
      countTag: '已写入 · 24 行',
      durationMs: 110,
    },
    'notes/tauri-csp.md',
  ),
  doneTool(
    'fam-knowledge-read',
    'knowledge_read',
    {
      kind: 'other',
      title: 'knowledge_read',
      summary: '项目 Wiki · artifact 沙箱 CSP',
      countTag: '1 条引用',
      durationMs: 180,
      knowledge: {
        kind: KNOWLEDGE_CITATIONS_DETAILS_KIND,
        degradedBaseIds: [],
        citations: [
          {
            ref: 3,
            baseId: 'wiki',
            baseName: '项目 Wiki',
            kind: 'folder',
            title: 'Artifact 沙箱 CSP',
            relativePath: 'concepts/artifact-sandbox-csp.md',
            startLine: 1,
            endLine: 34,
            text: '严格清单在 srcdoc 组装期一次拼出，iframe 仅授予 allow-scripts。',
          },
        ],
      },
    },
    'wiki page read',
  ),
  doneTool(
    'fam-process-start',
    'process_start',
    {
      kind: 'process',
      title: 'process_start',
      summary: 'pnpm dev:host',
      countTag: 'PID 4212 · :7420',
      durationMs: 2100,
    },
    'host dev server started on 7420',
  ),
  doneTool(
    'fam-process-logs',
    'process_logs',
    {
      kind: 'process',
      title: 'process_logs',
      summary: 'dev:host · 最后 200 行',
      countTag: '200 行 · 0 error',
      durationMs: 90,
      output: {
        text: 'host ready on 127.0.0.1:7420\nsession store ok · 12 sessions',
        truncated: false,
      },
    },
    'log tail',
  ),
  doneTool(
    'fam-toolbox',
    'piwin_toolbox',
    {
      kind: 'other',
      title: 'piwin_toolbox',
      summary: 'image gen',
      countTag: '3 个工具',
      durationMs: 260,
      inputPreview: '{"action":"search","query":"image gen"}',
    },
    '{"tools":[{"id":"image_gen"},{"id":"video_gen"},{"id":"media_store"}]}',
  ),
  doneTool(
    'fam-video-gen',
    'video_gen',
    {
      kind: 'video',
      title: 'video_gen',
      summary: '把 CSP 三处覆盖讲成 20 秒动画',
      countTag: '1 段 · 1280×720 · 20s',
      durationMs: 46200,
    },
    '~/.piwin/media/2026-09-20/csp-three-layers.mp4',
  ),
  doneTool(
    'fam-goal-wait',
    'goal_wait',
    {
      kind: 'other',
      title: 'goal_wait',
      summary: '等待 Xcode 构建任务结束',
      durationMs: 45000,
      goal: { phase: 'waited', reason: '等待 xcodebuild 结束（-scheme PiwinMobile）', durationSeconds: 45 },
    },
    'waited 45s',
  ),
];

const toolFamilyTranscript: SessionTranscriptMessage[] = [
  {
    id: 'showcase-families-user',
    role: 'user',
    text: '用浏览器查一下 Tauri 2 的 CSP 配置项，顺手出一张 host ↔ client 边界图，把结论做成记忆卡，再把 dev server 的日志贴给我。',
    createdAt: '2026-09-20T16:30:00.000Z',
    status: 'done',
  },
  {
    id: 'showcase-families-assistant',
    role: 'assistant',
    status: 'done',
    outcome: 'completed',
    thinkingStartedAt: '2026-09-20T16:30:06.000Z',
    thinkingEndedAt: '2026-09-20T16:32:14.000Z',
    createdAt: '2026-09-20T16:32:20.000Z',
    startedAt: '2026-09-20T16:30:06.000Z',
    endedAt: '2026-09-20T16:32:14.000Z',
    model: { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
    thinking:
      '官方文档要以浏览器为准（web_fetch 有时拿不到动态渲染）。读到的大文件只用了前 400 行，标注截断；配图走 image_gen，要点做成卡片，日志用 process_logs 取尾部。',
    tools: toolFamilyTools,
    text: [
      '### Tauri 2 的 CSP 有三处，别只改一处',
      '',
      '1. **宿主页面**：`tauri.conf.json` 的 `app.security.csp` —— 这是唯一由你决定的一段。',
      '2. **嵌入文档**：子文档自己的 CSP 只能收紧，不能放宽；`sandbox` 属性决定源是否不透明。',
      '3. **运行时覆盖**：`on_page_load` 里注入的 meta 优先于配置里的默认值（[1]）。',
      '',
      '配图放在 `~/.piwin/media/2026-09-20/host-client-boundary.png`，要点已做成 3 张卡（deck: tauri），dev server 日志尾部 200 行无 error。',
    ].join('\n'),
  },
];
