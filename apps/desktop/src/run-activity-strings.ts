import type { RunActivityInput } from './run-activity-types.js';
import { resolveActionCategory } from './run-activity-icon.js';

const TAKING_TOO_LONG_MS = 15_000;

export function buildActivityPhrases(input: RunActivityInput): string[] {
  if (typeof input.elapsedMs === 'number' && input.elapsedMs >= TAKING_TOO_LONG_MS) {
    return buildTakingTooLongPhrases(input);
  }
  return buildBasePhrases(input);
}

export function buildBasePhrases(input: RunActivityInput): string[] {
  const isZh = input.locale === 'zh-CN';
  const toolName = input.activeToolName;
  const planStep = input.planStep;
  const category = resolveActionCategory(input);

  if (category === 'terminal') {
    return isZh
      ? [toolName ? `运行 ${toolName}` : '执行 Shell 指令…', '捕获标准输出…', '监控进程状态…']
      : [toolName ? `Running ${toolName}` : 'Running shell command…', 'Capturing stdout…', 'Monitoring process…'];
  }
  if (category === 'edit') {
    return isZh
      ? [toolName ? `运行 ${toolName}` : '修改项目代码…', '写入文件变更…', '校验代码语法…']
      : [toolName ? `Running ${toolName}` : 'Editing source file…', 'Applying code diff…', 'Validating syntax…'];
  }
  if (category === 'search') {
    return isZh
      ? [toolName ? `运行 ${toolName}` : '检索项目代码…', '查阅文件结构…', '定位逻辑符号…']
      : [toolName ? `Running ${toolName}` : 'Searching codebase…', 'Inspecting file structure…', 'Locating symbols…'];
  }
  if (category === 'web') {
    return isZh
      ? [toolName ? `运行 ${toolName}` : '检索网络信息…', '获取网页内容…', '提取参考资料…']
      : [toolName ? `Running ${toolName}` : 'Searching web resources…', 'Fetching page content…', 'Extracting reference data…'];
  }
  if (category === 'subagent') {
    return isZh
      ? [toolName ? `运行 ${toolName}` : '调度 子Agent 协作…', '分发独立任务…', '汇总 Agent 结果…']
      : [toolName ? `Running ${toolName}` : 'Delegating to Subagent…', 'Running subtask concurrently…', 'Merging agent response…'];
  }
  if (category === 'ask') {
    return isZh
      ? ['等待你的决策…', '整理交互选项…']
      : ['Waiting for your decision…', 'Preparing options…'];
  }

  switch (input.kind) {
    case 'preparing':
      return isZh ? ['准备中', '加载上下文', '选择合适工具'] : ['Getting ready', 'Loading context', 'Picking tools'];
    case 'connecting-model':
      return isZh ? ['连接模型中…', '预热通道'] : ['Connecting to model…', 'Warming up the link'];
    case 'waiting-first-token':
      return isZh
        ? ['规划下一步', '读取请求', '思考中', '整理上下文']
        : ['Planning next moves', 'Reading your request', 'Thinking it over', 'Gathering context'];
    case 'planning':
      if (planStep) {
        return isZh ? [`规划：${planStep}`, '梳理步骤'] : [`Planning: ${planStep}`, 'Outlining steps'];
      }
      return isZh ? ['规划下一步', '梳理步骤', '完善计划'] : ['Planning next moves', 'Outlining steps', 'Refining the plan'];
    case 'working':
      if (toolName) {
        return isZh
          ? [`运行 ${toolName}`, '收集结果', '组织答案']
          : [`Running ${toolName}`, 'Collecting results', 'Writing it up'];
      }
      return isZh ? ['写代码中', '组装中', '就快好了'] : ['Writing your code', 'Putting it together', 'Almost there'];
    case 'waiting-permission':
      return isZh ? ['需要你确认', '等待你决定'] : ['Needs your approval', 'Waiting for you'];
    case 'compacting':
      return isZh ? ['压缩上下文', '总结记忆'] : ['Trimming context', 'Summarizing memory'];
    case 'stopping':
      return isZh ? ['停止中', '终止运行'] : ['Stopping', 'Halting run'];
    case 'failed':
      return isZh ? ['出错了', '再试一次？'] : ['Hit a snag', 'Try again?'];
    case 'complete':
      return isZh ? ['完成了', '准备就绪', '等待下一轮'] : ['Done', 'All set', 'Ready for what’s next'];
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
  const toolName = input.activeToolName;

  if (input.kind === 'working' && toolName) {
    return isZh
      ? [`${toolName} 比预期久一点…`, '仍在处理…']
      : [`${toolName} is taking longer than expected…`, 'Still working…'];
  }

  return isZh ? ['比预期久一点…', '仍在处理…', '继续等待'] : ['Taking longer than expected…', 'Still working…', 'Hang on'];
}
