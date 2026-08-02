import type { RunActivityInput } from './run-activity-types.js';
import { resolveActionCategory } from './run-activity-icon.js';

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
  const isZh = input.locale === 'zh-CN';
  const toolName = input.activeToolName;
  const planStep = input.planStep;
  const category = resolveActionCategory(input);
  const workLine = buildPrimaryWorkPhrase(input);

  if (category === 'terminal') {
    if (workLine) {
      return isZh
        ? [workLine, '捕获标准输出…', '监控进程状态…']
        : [workLine, 'Capturing stdout…', 'Monitoring process…'];
    }
    return isZh
      ? [toolName ? `运行 ${toolName}` : '执行 Shell 指令…', '捕获标准输出…', '监控进程状态…']
      : [
          toolName ? `Running ${toolName}` : 'Running shell command…',
          'Capturing stdout…',
          'Monitoring process…',
        ];
  }
  if (category === 'edit') {
    if (workLine) {
      return isZh
        ? [workLine, '写入文件变更…', '校验代码语法…']
        : [workLine, 'Applying code diff…', 'Validating syntax…'];
    }
    return isZh
      ? [toolName ? `运行 ${toolName}` : '修改项目代码…', '写入文件变更…', '校验代码语法…']
      : [
          toolName ? `Running ${toolName}` : 'Editing source file…',
          'Applying code diff…',
          'Validating syntax…',
        ];
  }
  if (category === 'search') {
    if (workLine) {
      return isZh
        ? [workLine, '查阅文件结构…', '定位逻辑符号…']
        : [workLine, 'Inspecting file structure…', 'Locating symbols…'];
    }
    return isZh
      ? [toolName ? `运行 ${toolName}` : '检索项目代码…', '查阅文件结构…', '定位逻辑符号…']
      : [
          toolName ? `Running ${toolName}` : 'Searching codebase…',
          'Inspecting file structure…',
          'Locating symbols…',
        ];
  }
  if (category === 'web') {
    if (workLine) {
      return isZh
        ? [workLine, '获取网页内容…', '提取参考资料…']
        : [workLine, 'Fetching page content…', 'Extracting reference data…'];
    }
    return isZh
      ? [toolName ? `运行 ${toolName}` : '检索网络信息…', '获取网页内容…', '提取参考资料…']
      : [
          toolName ? `Running ${toolName}` : 'Searching web resources…',
          'Fetching page content…',
          'Extracting reference data…',
        ];
  }
  if (category === 'subagent') {
    if (workLine) {
      return isZh
        ? [workLine, '分发独立任务…', '汇总 Agent 结果…']
        : [workLine, 'Running subtask concurrently…', 'Merging agent response…'];
    }
    return isZh
      ? [toolName ? `运行 ${toolName}` : '调度 子Agent 协作…', '分发独立任务…', '汇总 Agent 结果…']
      : [
          toolName ? `Running ${toolName}` : 'Delegating to Subagent…',
          'Running subtask concurrently…',
          'Merging agent response…',
        ];
  }
  if (category === 'ask') {
    if (detailWithPermission(input, isZh)) {
      return [detailWithPermission(input, isZh)!, ...(isZh ? ['等待你决定'] : ['Waiting for you'])];
    }
    return isZh
      ? ['等待你的决策…', '整理交互选项…']
      : ['Waiting for your decision…', 'Preparing options…'];
  }

  switch (input.kind) {
    case 'preparing':
      return isZh
        ? ['准备中', '加载上下文', '选择合适工具']
        : ['Getting ready', 'Loading context', 'Picking tools'];
    case 'connecting-model':
      return isZh ? ['连接模型中…', '预热通道'] : ['Connecting to model…', 'Warming up the link'];
    case 'waiting-first-token':
      return isZh
        ? ['规划下一步', '读取请求', '思考中', '整理上下文']
        : ['Planning next moves', 'Reading your request', 'Thinking it over', 'Gathering context'];
    case 'planning':
      if (planStep) {
        return isZh
          ? [`规划：${planStep}`, '梳理步骤']
          : [`Planning: ${planStep}`, 'Outlining steps'];
      }
      return isZh
        ? ['规划下一步', '梳理步骤', '完善计划']
        : ['Planning next moves', 'Outlining steps', 'Refining the plan'];
    case 'working':
      if (workLine) {
        return isZh
          ? [workLine, '收集结果', '组织答案']
          : [workLine, 'Collecting results', 'Writing it up'];
      }
      if (toolName) {
        return isZh
          ? [`运行 ${toolName}`, '收集结果', '组织答案']
          : [`Running ${toolName}`, 'Collecting results', 'Writing it up'];
      }
      return isZh
        ? ['写代码中', '组装中', '就快好了']
        : ['Writing your code', 'Putting it together', 'Almost there'];
    case 'waiting-permission':
      if (detailWithPermission(input, isZh)) {
        return [
          detailWithPermission(input, isZh)!,
          ...(isZh ? ['等待你决定'] : ['Waiting for you']),
        ];
      }
      return isZh ? ['需要你确认', '等待你决定'] : ['Needs your approval', 'Waiting for you'];
    case 'compacting':
      return isZh ? ['压缩上下文', '总结记忆'] : ['Trimming context', 'Summarizing memory'];
    case 'stopping':
      return isZh ? ['停止中', '终止运行'] : ['Stopping', 'Halting run'];
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
  const toolName = input.activeToolName;

  if (input.kind === 'working' && workLine) {
    return isZh
      ? [`${workLine} — 比预期久一点…`, '仍在处理…']
      : [`${workLine} — taking longer…`, 'Still working…'];
  }

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

function detailWithPermission(input: RunActivityInput, isZh: boolean): string | null {
  const detail = clipDetail(input.detail);
  if (!detail) return null;
  return isZh ? `需要确认：${detail}` : `Approve: ${detail}`;
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
