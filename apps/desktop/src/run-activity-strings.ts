import type { RunActivityInput } from './run-activity-types.js';

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
