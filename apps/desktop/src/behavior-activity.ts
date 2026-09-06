import type { SubagentActivityState, SubagentExecutionStatus, ToolKind } from '@piwin/contracts';
import type { RunStatusKind } from './run-status.js';

export type BehaviorActivityId =
  | 'run.prepare'
  | 'run.connect'
  | 'run.wait-token'
  | 'run.running'
  | 'run.stop'
  | 'run.complete'
  | 'run.fail'
  | 'run.compacting'
  | 'tool.other'
  | 'tool.compose'
  | 'thinking'
  | 'plan'
  | 'explore'
  | 'search'
  | 'read'
  | 'edit'
  | 'shell'
  | 'test'
  | 'build'
  | 'process'
  | 'git'
  | 'mcp.server.connect'
  | 'mcp.server.stop'
  | 'mcp.server.status'
  | 'mcp.discovery'
  | 'mcp.call'
  | 'mcp.call.done'
  | 'mcp.call.error'
  | 'web.search'
  | 'web.fetch'
  | 'browser'
  | 'skill.load'
  | 'skill.use'
  | 'skill.fail'
  | 'extension.load'
  | 'subagent.batch.prepare'
  | 'subagent.batch.running'
  | 'subagent.batch.complete'
  | 'subagent.batch.fail'
  | 'subagent.batch.cancelled'
  | 'subagent.task.queued'
  | 'subagent.task.running'
  | 'subagent.task.complete'
  | 'subagent.task.fail'
  | 'subagent.task.cancelled'
  | 'subagent.inspector.live'
  | 'subagent'
  | 'artifact'
  | 'image'
  | 'video'
  | 'permission'
  | 'ask';

export type BehaviorActivitySurface =
  'locator' | 'timeline-row' | 'group' | 'inspector' | 'context-chip' | 'gate' | 'result';

export type BehaviorActivityAnimation =
  | 'radial-bellow'
  | 'asterisk-breath'
  | 'breath-dot'
  | 'pulse-block'
  | 'solid-bars'
  | 'breath-matrix'
  | 'cascade-ripple'
  | 'text-shimmer'
  | 'diff-in'
  | 'artifact-sheen'
  | 'gate-pulse'
  | 'none';

export type BehaviorActivitySpec = {
  id: BehaviorActivityId;
  surface: BehaviorActivitySurface;
  animation: BehaviorActivityAnimation;
  labelZh: string;
  labelEn: string;
  keepInHistory: boolean;
  expandable: boolean;
};

const spec = (
  id: BehaviorActivityId,
  values: Omit<BehaviorActivitySpec, 'id'>,
): BehaviorActivitySpec => ({ id, ...values });

/**
 * One-to-one presentation registry. Keep behavior semantics here and keep
 * component layout/CSS in the rendering layer.
 */
export const BEHAVIOR_ACTIVITY_REGISTRY: Readonly<
  Record<BehaviorActivityId, BehaviorActivitySpec>
> = {
  'run.prepare': spec('run.prepare', {
    surface: 'locator',
    animation: 'radial-bellow',
    labelZh: '准备上下文…',
    labelEn: 'Preparing context…',
    keepInHistory: false,
    expandable: false,
  }),
  'run.connect': spec('run.connect', {
    surface: 'locator',
    animation: 'radial-bellow',
    labelZh: '连接模型…',
    labelEn: 'Connecting to model…',
    keepInHistory: false,
    expandable: false,
  }),
  'run.wait-token': spec('run.wait-token', {
    surface: 'locator',
    animation: 'radial-bellow',
    labelZh: '正在思考…',
    labelEn: 'Thinking…',
    keepInHistory: false,
    expandable: false,
  }),
  'run.running': spec('run.running', {
    surface: 'locator',
    animation: 'radial-bellow',
    labelZh: '正在处理…',
    labelEn: 'Working…',
    keepInHistory: false,
    expandable: false,
  }),
  'run.stop': spec('run.stop', {
    surface: 'result',
    animation: 'none',
    labelZh: '正在停止…',
    labelEn: 'Stopping…',
    keepInHistory: true,
    expandable: false,
  }),
  'run.complete': spec('run.complete', {
    surface: 'result',
    animation: 'none',
    labelZh: '已完成',
    labelEn: 'Complete',
    keepInHistory: true,
    expandable: false,
  }),
  'run.fail': spec('run.fail', {
    surface: 'result',
    animation: 'none',
    labelZh: '执行失败',
    labelEn: 'Failed',
    keepInHistory: true,
    expandable: false,
  }),
  'run.compacting': spec('run.compacting', {
    surface: 'timeline-row',
    animation: 'breath-matrix',
    labelZh: '正在整理上下文…',
    labelEn: 'Compacting context…',
    keepInHistory: true,
    expandable: false,
  }),
  'tool.other': spec('tool.other', {
    surface: 'timeline-row',
    animation: 'breath-dot',
    labelZh: '正在执行工具…',
    labelEn: 'Running tool…',
    keepInHistory: true,
    expandable: true,
  }),
  'tool.compose': spec('tool.compose', {
    surface: 'timeline-row',
    animation: 'text-shimmer',
    labelZh: '正在生成内容…',
    labelEn: 'Composing content…',
    keepInHistory: false,
    expandable: false,
  }),
  thinking: spec('thinking', {
    surface: 'group',
    animation: 'asterisk-breath',
    labelZh: '思考中',
    labelEn: 'Thinking',
    keepInHistory: true,
    expandable: true,
  }),
  plan: spec('plan', {
    surface: 'group',
    animation: 'asterisk-breath',
    labelZh: '制定计划中',
    labelEn: 'Planning',
    keepInHistory: true,
    expandable: true,
  }),
  explore: spec('explore', {
    surface: 'group',
    animation: 'text-shimmer',
    labelZh: '正在探索…',
    labelEn: 'Exploring…',
    keepInHistory: true,
    expandable: true,
  }),
  search: spec('search', {
    surface: 'timeline-row',
    animation: 'text-shimmer',
    labelZh: '正在搜索…',
    labelEn: 'Searching…',
    keepInHistory: true,
    expandable: true,
  }),
  read: spec('read', {
    surface: 'timeline-row',
    animation: 'breath-dot',
    labelZh: '正在读取…',
    labelEn: 'Reading…',
    keepInHistory: true,
    expandable: true,
  }),
  edit: spec('edit', {
    surface: 'timeline-row',
    animation: 'diff-in',
    labelZh: '正在修改…',
    labelEn: 'Editing…',
    keepInHistory: true,
    expandable: true,
  }),
  shell: spec('shell', {
    surface: 'timeline-row',
    animation: 'cascade-ripple',
    labelZh: '正在运行命令…',
    labelEn: 'Running command…',
    keepInHistory: true,
    expandable: true,
  }),
  test: spec('test', {
    surface: 'timeline-row',
    animation: 'solid-bars',
    labelZh: '正在运行测试…',
    labelEn: 'Running tests…',
    keepInHistory: true,
    expandable: true,
  }),
  build: spec('build', {
    surface: 'timeline-row',
    animation: 'cascade-ripple',
    labelZh: '正在构建…',
    labelEn: 'Building…',
    keepInHistory: true,
    expandable: true,
  }),
  process: spec('process', {
    surface: 'timeline-row',
    animation: 'solid-bars',
    labelZh: '进程运行中…',
    labelEn: 'Process running…',
    keepInHistory: true,
    expandable: true,
  }),
  git: spec('git', {
    surface: 'timeline-row',
    animation: 'breath-dot',
    labelZh: '正在执行 Git…',
    labelEn: 'Running Git…',
    keepInHistory: true,
    expandable: true,
  }),
  'mcp.server.connect': spec('mcp.server.connect', {
    surface: 'context-chip',
    animation: 'breath-dot',
    labelZh: '正在连接 MCP 服务器…',
    labelEn: 'Connecting to MCP server…',
    keepInHistory: false,
    expandable: false,
  }),
  'mcp.server.stop': spec('mcp.server.stop', {
    surface: 'result',
    animation: 'none',
    labelZh: 'MCP 服务器已停止',
    labelEn: 'MCP server stopped',
    keepInHistory: false,
    expandable: false,
  }),
  'mcp.server.status': spec('mcp.server.status', {
    surface: 'context-chip',
    animation: 'none',
    labelZh: 'MCP 服务器状态',
    labelEn: 'MCP server status',
    keepInHistory: false,
    expandable: false,
  }),
  'mcp.discovery': spec('mcp.discovery', {
    surface: 'timeline-row',
    animation: 'breath-matrix',
    labelZh: '正在发现 MCP 工具…',
    labelEn: 'Discovering MCP tools…',
    keepInHistory: true,
    expandable: true,
  }),
  'mcp.call': spec('mcp.call', {
    surface: 'timeline-row',
    animation: 'breath-dot',
    labelZh: '调用 MCP…',
    labelEn: 'Calling MCP…',
    keepInHistory: true,
    expandable: true,
  }),
  'mcp.call.done': spec('mcp.call.done', {
    surface: 'result',
    animation: 'none',
    labelZh: 'MCP 调用完成',
    labelEn: 'MCP call complete',
    keepInHistory: true,
    expandable: true,
  }),
  'mcp.call.error': spec('mcp.call.error', {
    surface: 'result',
    animation: 'none',
    labelZh: 'MCP 调用失败',
    labelEn: 'MCP call failed',
    keepInHistory: true,
    expandable: true,
  }),
  'web.search': spec('web.search', {
    surface: 'timeline-row',
    animation: 'text-shimmer',
    labelZh: '正在搜索网页…',
    labelEn: 'Searching the web…',
    keepInHistory: true,
    expandable: true,
  }),
  'web.fetch': spec('web.fetch', {
    surface: 'timeline-row',
    animation: 'breath-dot',
    labelZh: '正在读取网页…',
    labelEn: 'Fetching page…',
    keepInHistory: true,
    expandable: true,
  }),
  browser: spec('browser', {
    surface: 'timeline-row',
    animation: 'breath-dot',
    labelZh: '正在打开页面…',
    labelEn: 'Opening page…',
    keepInHistory: true,
    expandable: true,
  }),
  'skill.load': spec('skill.load', {
    surface: 'context-chip',
    animation: 'breath-matrix',
    labelZh: '加载技能…',
    labelEn: 'Loading skill…',
    keepInHistory: false,
    expandable: false,
  }),
  'skill.use': spec('skill.use', {
    surface: 'context-chip',
    animation: 'none',
    labelZh: '使用技能',
    labelEn: 'Using skill',
    keepInHistory: true,
    expandable: false,
  }),
  'skill.fail': spec('skill.fail', {
    surface: 'result',
    animation: 'none',
    labelZh: '技能加载失败',
    labelEn: 'Skill failed to load',
    keepInHistory: true,
    expandable: false,
  }),
  'extension.load': spec('extension.load', {
    surface: 'context-chip',
    animation: 'breath-matrix',
    labelZh: '加载扩展…',
    labelEn: 'Loading extension…',
    keepInHistory: false,
    expandable: false,
  }),
  'subagent.batch.prepare': spec('subagent.batch.prepare', {
    surface: 'group',
    animation: 'pulse-block',
    labelZh: '准备子代理批次…',
    labelEn: 'Preparing subagent batch…',
    keepInHistory: true,
    expandable: true,
  }),
  'subagent.batch.running': spec('subagent.batch.running', {
    surface: 'group',
    animation: 'pulse-block',
    labelZh: '子代理批次运行中…',
    labelEn: 'Subagent batch running…',
    keepInHistory: true,
    expandable: true,
  }),
  'subagent.batch.complete': spec('subagent.batch.complete', {
    surface: 'result',
    animation: 'none',
    labelZh: '子代理批次已完成',
    labelEn: 'Subagent batch complete',
    keepInHistory: true,
    expandable: true,
  }),
  'subagent.batch.fail': spec('subagent.batch.fail', {
    surface: 'result',
    animation: 'none',
    labelZh: '子代理批次失败',
    labelEn: 'Subagent batch failed',
    keepInHistory: true,
    expandable: true,
  }),
  'subagent.batch.cancelled': spec('subagent.batch.cancelled', {
    surface: 'result',
    animation: 'none',
    labelZh: '子代理批次已取消',
    labelEn: 'Subagent batch cancelled',
    keepInHistory: true,
    expandable: true,
  }),
  'subagent.task.queued': spec('subagent.task.queued', {
    surface: 'timeline-row',
    animation: 'none',
    labelZh: '子代理排队中',
    labelEn: 'Subagent queued',
    keepInHistory: true,
    expandable: true,
  }),
  'subagent.task.running': spec('subagent.task.running', {
    surface: 'timeline-row',
    animation: 'breath-dot',
    labelZh: '子代理工作中…',
    labelEn: 'Subagent working…',
    keepInHistory: true,
    expandable: true,
  }),
  'subagent.task.complete': spec('subagent.task.complete', {
    surface: 'result',
    animation: 'none',
    labelZh: '子代理已完成',
    labelEn: 'Subagent complete',
    keepInHistory: true,
    expandable: true,
  }),
  'subagent.task.fail': spec('subagent.task.fail', {
    surface: 'result',
    animation: 'none',
    labelZh: '子代理失败',
    labelEn: 'Subagent failed',
    keepInHistory: true,
    expandable: true,
  }),
  'subagent.task.cancelled': spec('subagent.task.cancelled', {
    surface: 'result',
    animation: 'none',
    labelZh: '子代理已取消',
    labelEn: 'Subagent cancelled',
    keepInHistory: true,
    expandable: true,
  }),
  'subagent.inspector.live': spec('subagent.inspector.live', {
    surface: 'inspector',
    animation: 'text-shimmer',
    labelZh: '子代理输出中…',
    labelEn: 'Subagent output streaming…',
    keepInHistory: true,
    expandable: true,
  }),
  subagent: spec('subagent', {
    surface: 'group',
    animation: 'pulse-block',
    labelZh: '委派给子代理…',
    labelEn: 'Delegating to subagent…',
    keepInHistory: true,
    expandable: true,
  }),
  artifact: spec('artifact', {
    surface: 'timeline-row',
    animation: 'artifact-sheen',
    labelZh: '正在生成界面…',
    labelEn: 'Rendering artifact…',
    keepInHistory: true,
    expandable: true,
  }),
  image: spec('image', {
    surface: 'timeline-row',
    animation: 'artifact-sheen',
    labelZh: '正在生成图片…',
    labelEn: 'Generating image…',
    keepInHistory: true,
    expandable: true,
  }),
  video: spec('video', {
    surface: 'timeline-row',
    animation: 'artifact-sheen',
    labelZh: '正在生成视频…',
    labelEn: 'Generating video…',
    keepInHistory: true,
    expandable: true,
  }),
  permission: spec('permission', {
    surface: 'gate',
    animation: 'gate-pulse',
    labelZh: '等待你的确认',
    labelEn: 'Waiting for your approval',
    keepInHistory: true,
    expandable: false,
  }),
  ask: spec('ask', {
    surface: 'gate',
    animation: 'gate-pulse',
    labelZh: '等待你的回答',
    labelEn: 'Waiting for your answer',
    keepInHistory: true,
    expandable: false,
  }),
} as const;

export type ToolActivityInput = {
  kind: ToolKind | 'unknown';
  toolName: string;
  actionVerb?: string;
};

export type ToolActivityStatus = 'running' | 'done' | 'error';

/** Normalize Host tool presentation into the stable Desktop behavior id. */
export function resolveToolBehaviorId(input: ToolActivityInput): BehaviorActivityId {
  const verb = input.actionVerb?.trim().toLowerCase() ?? '';
  const name = input.toolName.trim().toLowerCase();

  if (
    input.kind === 'mcp' ||
    name === 'mcp_gateway' ||
    name.startsWith('mcp__') ||
    name.startsWith('mcp:') ||
    (name === 'piwin_toolbox' &&
      (verb.includes('discovery') || verb.includes('status') || verb.includes('catalog')))
  ) {
    if (verb.includes('status')) {
      return 'mcp.server.status';
    }
    if (
      verb.includes('discovery') ||
      verb.includes('discover') ||
      (name === 'mcp_gateway' && !verb.includes('call'))
    ) {
      return 'mcp.discovery';
    }
    return 'mcp.call';
  }
  if (name.startsWith('skill:') || name.startsWith('skill_') || name === 'skill') {
    return 'skill.use';
  }
  if (name.startsWith('extension:') || name.startsWith('extension_')) {
    return 'extension.load';
  }
  if (isTestToolName(name, verb)) {
    return 'test';
  }
  if (isBuildToolName(name, verb)) {
    return 'build';
  }
  if (input.kind === 'process') {
    return 'process';
  }
  if (input.kind === 'web') {
    return verb.startsWith('searched') || name.includes('search') ? 'web.search' : 'web.fetch';
  }
  if (input.kind === 'video') {
    return 'video';
  }
  if (input.kind === 'image') {
    return 'image';
  }
  if (verb.startsWith('generated video') || name.includes('video')) {
    return 'video';
  }
  if (verb.startsWith('generated image') || name.includes('image')) {
    return 'image';
  }
  if (verb.startsWith('explored')) {
    return 'explore';
  }
  if (verb.startsWith('searched') || name.includes('search') || name.includes('grep')) {
    return 'search';
  }
  if (verb.startsWith('read') || name.includes('read') || name.includes('view')) {
    return 'read';
  }
  if (
    verb.startsWith('edited') ||
    name.includes('write') ||
    name.includes('edit') ||
    name.includes('patch') ||
    name.includes('replace')
  ) {
    return 'edit';
  }
  if (
    verb.startsWith('ran command') ||
    input.kind === 'shell' ||
    name.includes('bash') ||
    name.includes('shell') ||
    name.includes('command') ||
    name.includes('exec')
  ) {
    return 'shell';
  }
  if (verb.startsWith('git') || input.kind === 'git' || name.includes('git')) {
    return 'git';
  }
  if (verb.startsWith('fetched') || name.includes('fetch') || name.includes('browser')) {
    return name.includes('browser') ? 'browser' : 'web.fetch';
  }
  if (name.includes('subagent') || name.includes('delegate') || name.includes('spawn_agent')) {
    return 'subagent.batch.running';
  }
  return 'tool.other';
}

function isTestToolName(name: string, verb: string): boolean {
  return (
    /(^|[\s_:/-])(test|tests|vitest|jest|pytest|mocha)(?=$|[\s_:/-])/.test(name) ||
    /(^|\s)test(?:ed|ing)?\b/.test(verb)
  );
}

function isBuildToolName(name: string, verb: string): boolean {
  return (
    /(^|[\s_:/-])(build|compile|tsc|vite|webpack|rollup)(?=$|[\s_:/-])/.test(name) ||
    /(^|\s)(built|building)\b/.test(verb)
  );
}

export function getBehaviorActivitySpec(id: BehaviorActivityId): BehaviorActivitySpec {
  return BEHAVIOR_ACTIVITY_REGISTRY[id];
}

/** Map a tool behavior to its terminal-specific MCP presentation id. */
export function resolveToolBehaviorStateId(
  id: BehaviorActivityId,
  status: ToolActivityStatus,
): BehaviorActivityId {
  if (id === 'subagent.batch.prepare' || id === 'subagent.batch.running') {
    if (status === 'done') return 'subagent.batch.complete';
    if (status === 'error') return 'subagent.batch.fail';
    return id;
  }
  if (id !== 'mcp.call') return id;
  switch (status) {
    case 'done':
      return 'mcp.call.done';
    case 'error':
      return 'mcp.call.error';
    case 'running':
      return 'mcp.call';
  }
}

export function resolveSubagentBatchBehaviorId(state: SubagentActivityState): BehaviorActivityId {
  switch (state) {
    case 'started':
      return 'subagent.batch.prepare';
    case 'running':
      return 'subagent.batch.running';
    case 'completed':
    case 'merged':
      return 'subagent.batch.complete';
    case 'failed':
      return 'subagent.batch.fail';
    case 'cancelled':
      return 'subagent.batch.cancelled';
  }
}

export function resolveSubagentTaskBehaviorId(status: SubagentExecutionStatus): BehaviorActivityId {
  switch (status) {
    case 'queued':
      return 'subagent.task.queued';
    case 'running':
      return 'subagent.task.running';
    case 'completed':
      return 'subagent.task.complete';
    case 'failed':
      return 'subagent.task.fail';
    case 'cancelled':
      return 'subagent.task.cancelled';
  }
}

/** Map the presentation-only run status to the same stable behavior IDs used
 * by timeline tools. Terminal statuses are included for result surfaces even
 * though the live locator normally renders only active statuses. */
export function resolveRunBehaviorId(kind: RunStatusKind): BehaviorActivityId {
  switch (kind) {
    case 'preparing':
      return 'run.prepare';
    case 'connecting-model':
      return 'run.connect';
    case 'waiting-first-token':
      return 'run.wait-token';
    case 'planning':
      return 'plan';
    case 'working':
      return 'run.running';
    case 'waiting-permission':
      return 'permission';
    case 'compacting':
      return 'run.compacting';
    case 'stopping':
    case 'stopped':
      return 'run.stop';
    case 'failed':
      return 'run.fail';
    case 'complete':
      return 'run.complete';
    case 'idle':
    default:
      return 'run.prepare';
  }
}

/**
 * Tool-call row chips are tool names, not sentences. Keep them short English
 * in every locale — "命令"/"读取"/"修改" ate the preview and looked forced.
 */
const TOOL_CALL_KIND_CHIP: Partial<Record<BehaviorActivityId, string>> = {
  explore: 'Explore',
  search: 'Search',
  read: 'Read',
  edit: 'Edit',
  shell: 'Bash',
  test: 'Test',
  build: 'Build',
  process: 'Process',
  git: 'Git',
  'mcp.discovery': 'MCP',
  'mcp.call': 'MCP',
  'mcp.call.done': 'MCP',
  'mcp.call.error': 'MCP',
  'web.search': 'Search',
  'web.fetch': 'Fetch',
  browser: 'Browser',
  image: 'Image',
  video: 'Video',
  subagent: 'Subagent',
};

export function localizeBehaviorAction(
  id: BehaviorActivityId,
  locale: 'zh-CN' | 'en',
  fallback?: string,
): string {
  const kindChip = TOOL_CALL_KIND_CHIP[id];
  if (kindChip) {
    return kindChip;
  }
  if (locale === 'en') {
    switch (id) {
      case 'mcp.server.connect':
        return 'Connecting to MCP';
      case 'mcp.server.stop':
        return 'Stopped MCP server';
      case 'mcp.server.status':
        return 'MCP status';
      case 'subagent.batch.prepare':
        return 'Preparing delegation';
      case 'subagent.batch.running':
        return 'Delegating';
      case 'subagent.batch.complete':
        return 'Delegated';
      case 'subagent.batch.fail':
        return 'Delegation failed';
      case 'subagent.batch.cancelled':
        return 'Delegation cancelled';
      case 'subagent.task.queued':
        return 'Queued';
      case 'subagent.task.running':
        return 'Working';
      case 'subagent.task.complete':
        return 'Completed';
      case 'subagent.task.fail':
        return 'Failed';
      case 'subagent.task.cancelled':
        return 'Cancelled';
      case 'subagent.inspector.live':
        return 'Streaming';
      default:
        return fallback ?? getBehaviorActivitySpec(id).labelEn.replace(/…$/, '');
    }
  }

  switch (id) {
    case 'mcp.server.connect':
      return '连接 MCP';
    case 'mcp.server.stop':
      return '停止 MCP';
    case 'mcp.server.status':
      return 'MCP 状态';
    case 'subagent.batch.prepare':
      return '准备委派';
    case 'subagent.batch.running':
      return '委派中';
    case 'subagent.batch.complete':
      return '已委派';
    case 'subagent.batch.fail':
      return '委派失败';
    case 'subagent.batch.cancelled':
      return '委派已取消';
    case 'subagent.task.queued':
      return '排队中';
    case 'subagent.task.running':
      return '工作中';
    case 'subagent.task.complete':
      return '已完成';
    case 'subagent.task.fail':
      return '失败';
    case 'subagent.task.cancelled':
      return '已取消';
    case 'subagent.inspector.live':
      return '输出中';
    default:
      return fallback ?? getBehaviorActivitySpec(id).labelZh.replace(/…$/, '');
  }
}

export function behaviorTextClass(id: BehaviorActivityId, active: boolean): string {
  if (!active) {
    return 'behavior-done';
  }
  switch (id) {
    case 'explore':
      return 'behavior-explore-active';
    case 'search':
      return 'behavior-search-active';
    case 'read':
      return 'behavior-read-active';
    case 'edit':
      return 'behavior-edit-active';
    case 'shell':
      return 'behavior-command-active';
    case 'test':
      return 'behavior-test-active';
    case 'build':
      return 'behavior-build-active';
    case 'process':
      return 'behavior-test-active';
    case 'web.search':
    case 'web.fetch':
    case 'browser':
      return 'behavior-web-active';
    case 'subagent':
    case 'subagent.batch.prepare':
    case 'subagent.batch.running':
    case 'subagent.task.running':
      return 'behavior-subagent-active';
    case 'subagent.inspector.live':
      return 'behavior-subagent-inspector-active';
    case 'mcp.discovery':
      return 'behavior-mcp-discovery-active';
    case 'mcp.server.connect':
      return 'behavior-mcp-active';
    case 'mcp.server.status':
      return 'behavior-context-active';
    case 'mcp.call':
      return 'behavior-mcp-active';
    case 'git':
      return 'behavior-git-active';
    case 'thinking':
    case 'plan':
      return 'behavior-thinking-active';
    case 'skill.load':
    case 'skill.use':
    case 'extension.load':
      return 'behavior-context-active';
    case 'permission':
    case 'ask':
      return 'behavior-gate-active';
    case 'artifact':
    case 'image':
    case 'video':
      return 'behavior-artifact-active';
    case 'tool.other':
      return 'behavior-generic-active';
    default:
      return 'behavior-text-bloom';
  }
}
