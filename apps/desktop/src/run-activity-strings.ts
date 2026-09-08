import type { RunActivityInput } from './run-activity-types.js';
import type { RunStatusKind } from './run-status.js';

/** Runtime status keys and copy defined by the Model Status reference. */
export type RuntimeStatusCopyKey =
  | 'preparing'
  | 'connecting-model'
  | 'waiting-first-token'
  | 'working'
  | 'stopping'
  | 'thinking'
  | 'planning'
  | 'asking';

export type RuntimeStatusCopy = {
  zh: string;
  en: string;
};

/**
 * Primary status line (also the first carousel line when multiple phrases exist).
 * Keep bilingual pairs exact for tooltips / splash that want a single label.
 */
export const RUNTIME_STATUS_COPY: Readonly<Record<RuntimeStatusCopyKey, RuntimeStatusCopy>> = {
  preparing: { zh: '准备上下文…', en: 'Preparing context…' },
  'connecting-model': { zh: '连接模型…', en: 'Connecting to model…' },
  'waiting-first-token': { zh: '正在思考…', en: 'Thinking…' },
  working: { zh: '正在处理…', en: 'Working…' },
  stopping: { zh: '正在停止…', en: 'Stopping…' },
  thinking: { zh: '思考中', en: 'Thinking' },
  planning: { zh: '制定计划中', en: 'Planning' },
  asking: { zh: '等待你的回答', en: 'Waiting for your answer' },
};

/**
 * Optional rotating lines for live locator chrome. First entry matches
 * RUNTIME_STATUS_COPY. Early "sent, waiting for model" phases rotate so the
 * wait feels active without inventing fake tool work.
 */
export const RUNTIME_STATUS_PHRASES: Readonly<
  Record<RuntimeStatusCopyKey, { zh: readonly string[]; en: readonly string[] }>
> = {
  preparing: {
    zh: ['准备上下文…', '整理对话记忆…', '装载工作区…'],
    en: ['Preparing context…', 'Gathering conversation memory…', 'Loading workspace…'],
  },
  'connecting-model': {
    zh: ['连接模型…', '建立会话通道…', '校验运行上下文…', '等待模型响应…'],
    en: [
      'Connecting to model…',
      'Opening session channel…',
      'Verifying runtime context…',
      'Waiting for model response…',
    ],
  },
  'waiting-first-token': {
    zh: ['正在思考…', '解析上下文与指令…', '规划执行路径…', '构思回复方案…'],
    en: [
      'Thinking…',
      'Parsing context and instructions…',
      'Planning execution path…',
      'Formulating response…',
    ],
  },
  working: {
    zh: ['正在处理…', '执行任务中…', '整理分析结果…'],
    en: ['Working…', 'Executing tasks…', 'Organizing results…'],
  },
  stopping: {
    zh: [RUNTIME_STATUS_COPY.stopping.zh],
    en: [RUNTIME_STATUS_COPY.stopping.en],
  },
  thinking: {
    zh: ['思考中', '深度推演中…', '梳理逻辑脉络…', '权衡解决方案…'],
    en: [
      'Thinking',
      'Reasoning in depth…',
      'Analyzing logic structure…',
      'Evaluating possible solutions…',
    ],
  },
  planning: {
    zh: ['制定计划中', '拆解任务步骤…', '评估依赖与风险…'],
    en: ['Planning', 'Breaking down task steps…', 'Evaluating dependencies…'],
  },
  asking: {
    zh: [RUNTIME_STATUS_COPY.asking.zh],
    en: [RUNTIME_STATUS_COPY.asking.en],
  },
};

const RUN_KIND_TO_RUNTIME_STATUS: Partial<Record<RunStatusKind, RuntimeStatusCopyKey>> = {
  preparing: 'preparing',
  'connecting-model': 'connecting-model',
  'waiting-first-token': 'waiting-first-token',
  working: 'working',
  stopping: 'stopping',
  planning: 'planning',
  'waiting-permission': 'asking',
};

/** Resolve the stable copy key for a live run state. */
export function resolveRuntimeStatusCopyKey(kind: RunStatusKind): RuntimeStatusCopyKey | null {
  return RUN_KIND_TO_RUNTIME_STATUS[kind] ?? null;
}

/** Return the exact localized copy from the reference status table. */
export function runtimeStatusText(
  key: RuntimeStatusCopyKey,
  locale: 'zh-CN' | 'en',
): string {
  return RUNTIME_STATUS_COPY[key][locale === 'zh-CN' ? 'zh' : 'en'];
}

/** Localized carousel lines for a runtime status (length ≥ 1). */
export function runtimeStatusPhrases(
  key: RuntimeStatusCopyKey,
  locale: 'zh-CN' | 'en',
): string[] {
  const bank = RUNTIME_STATUS_PHRASES[key];
  return [...(locale === 'zh-CN' ? bank.zh : bank.en)];
}

const TAKING_TOO_LONG_MS = 15_000;

/** Clip long paths/commands so the pet bubble stays glanceable (Codex-ish). */
const DETAIL_MAX_CHARS = 72;

export function buildActivityPhrases(input: RunActivityInput): string[] {
  if (typeof input.elapsedMs === 'number' && input.elapsedMs >= TAKING_TOO_LONG_MS) {
    return buildTakingTooLongPhrases(input);
  }
  return buildBasePhrases(input);
}

/**
 * Primary work line for the pet bubble: prefer host presentation detail
 * ("Read src/foo.ts") over bare tool names ("Running read_file").
 */
export function buildPrimaryWorkPhrase(input: RunActivityInput): string | null {
  const isZh = input.locale === 'zh-CN';
  const detail = clipDetail(input.detail);
  const verb = localizeActionVerb(input.actionVerb, input.locale);
  const toolName = input.activeToolName;

  if (detail && verb) {
    return `${verb} ${detail}`;
  }
  if (detail && toolName) {
    return isZh
      ? `${shortToolLabel(toolName, isZh)} ${detail}`
      : `${shortToolLabel(toolName, isZh)} ${detail}`;
  }
  if (detail) {
    return detail;
  }
  if (toolName) {
    return isZh ? `运行 ${toolName}` : `Running ${toolName}`;
  }
  return null;
}

export function buildBasePhrases(input: RunActivityInput): string[] {
  if (input.kind === 'working') {
    const workLine = buildPrimaryWorkPhrase(input);
    if (workLine) {
      return [workLine];
    }
  }
  const runtimeStatusKey = resolveRuntimeStatusCopyKey(input.kind);
  if (runtimeStatusKey) {
    return runtimeStatusPhrases(runtimeStatusKey, input.locale);
  }

  const isZh = input.locale === 'zh-CN';
  switch (input.kind) {
    case 'compacting':
      return isZh
        ? ['整理上下文', '保留关键决策', '整理工具记录', '生成续接摘要']
        : ['Trimming context', 'Preserving key decisions', 'Organizing tool history', 'Preparing a handoff summary'];
    case 'failed':
      return isZh ? ['出错了', '再试一次？'] : ['Hit a snag', 'Try again?'];
    case 'complete':
      return isZh
        ? ['完成了', '准备就绪', '等待下一轮']
        : ['Done', 'All set', 'Ready for what’s next'];
    case 'idle':
      return isZh ? ['就绪'] : ['Ready'];
    case 'stopped':
      return isZh ? ['已停止'] : ['Stopped'];
    default:
      return isZh ? ['工作中'] : ['Working'];
  }
}

export function buildTakingTooLongPhrases(input: RunActivityInput): string[] {
  const isZh = input.locale === 'zh-CN';
  const workLine = buildPrimaryWorkPhrase(input);
  if (input.kind === 'working' && workLine) {
    return isZh
      ? [`${workLine} — 比预期久一点…`, '仍在处理…']
      : [`${workLine} — taking longer…`, 'Still working…'];
  }

  const runtimeStatusKey = resolveRuntimeStatusCopyKey(input.kind);
  if (runtimeStatusKey) {
    // Keep rotating the same phase bank while waiting longer — do not invent
    // "taking longer" copy that contradicts the reference status table.
    return runtimeStatusPhrases(runtimeStatusKey, input.locale);
  }

  const toolName = input.activeToolName;

  if (input.kind === 'working' && toolName) {
    return isZh
      ? [`${toolName} 比预期久一点…`, '仍在处理…']
      : [`${toolName} is taking longer than expected…`, 'Still working…'];
  }

  return isZh
    ? ['比预期久一点…', '仍在处理…', '继续等待']
    : ['Taking longer than expected…', 'Still working…', 'Hang on'];
}

function clipDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const compact = detail.replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  if (compact.length <= DETAIL_MAX_CHARS) return compact;
  // Prefer keeping the tail of paths (filename) when it looks like a path.
  if (compact.includes('/') || compact.includes('\\')) {
    const tail = compact.slice(-(DETAIL_MAX_CHARS - 1));
    return `…${tail}`;
  }
  return `${compact.slice(0, DETAIL_MAX_CHARS - 1)}…`;
}

function shortToolLabel(toolName: string, isZh: boolean): string {
  const n = toolName.trim();
  if (!n) return isZh ? '运行' : 'Running';
  // Strip common MCP prefixes for glanceability.
  const cleaned = n.replace(/^mcp__?/, '').replace(/__/g, ' / ');
  return isZh ? `运行 ${cleaned}` : `Running ${cleaned}`;
}

/**
 * Map host English action verbs to short zh labels when locale is zh-CN.
 * Unknown verbs pass through (host already humanized them).
 */
function localizeActionVerb(
  actionVerb: string | undefined,
  locale: 'zh-CN' | 'en',
): string | undefined {
  if (!actionVerb) return undefined;
  if (locale !== 'zh-CN') return actionVerb;
  const key = actionVerb.trim().toLowerCase();
  const map: Record<string, string> = {
    read: '读取',
    edited: '编辑',
    edit: '编辑',
    'ran command': '执行',
    searched: '搜索',
    explored: '浏览',
    fetched: '获取',
    'generated image': '生成图片',
    'git status': 'Git 状态',
    'git diff': 'Git diff',
    'git log': 'Git log',
    'git commit': 'Git 提交',
    'git push': 'Git 推送',
    'git pull': 'Git 拉取',
    'git branch': 'Git 分支',
  };
  return map[key] ?? actionVerb;
}
