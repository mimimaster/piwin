import type { PlanExecutionMode } from '@piwin/contracts';

const INLINE_PATTERN = /inline|in\s*line|行内|当前会话/;
const SUBAGENT_PATTERN = /sub\s*-?\s*agents?|子代理|委派/;
const EXECUTION_VERB_PATTERN =
  /execute|execution|run|use|choose|select|start|直接|执行|运行|使用|选择|开始|采用/;
const QUESTION_PATTERN =
  /[?？]|(?:什么|为何|为什么|怎么|如何|解释|区别|优缺点|讨论|是否|能否|可否|意思|含义|吗|么)/;
const NEGATED_SELECTION_PATTERN =
  /(?:不要|不需要|不想|别用|无需|取消|don't|do\s+not|not)\s*(?:使用|用|选择|执行|run|use|choose|select)?\s*(?:inline|in\s*line|行内|当前会话|sub\s*-?\s*agents?|子代理|委派)/;

/**
 * Resolve a deliberate one-mode reply for a draft plan.
 *
 * The Host only auto-approves when the message names exactly one execution
 * mode. A comparison such as “inline 还是 subagent” remains ordinary text so
 * the model can answer it without mutating the durable plan.
 */
export function resolveExplicitPlanExecutionMode(text: string): PlanExecutionMode | undefined {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    !normalized ||
    NEGATED_SELECTION_PATTERN.test(normalized) ||
    QUESTION_PATTERN.test(normalized)
  ) {
    return undefined;
  }

  const inline = INLINE_PATTERN.test(normalized);
  const subagent = SUBAGENT_PATTERN.test(normalized);
  if (inline === subagent) {
    return undefined;
  }

  const stripped = normalized
    .replace(/[，。！？、；：,.!?;:()[\]{}"']/g, ' ')
    .replace(/\b(?:please|use|choose|select|run|execute|execution|start|mode|the|plan)\b/g, ' ')
    .replace(/(?:请|用|使用|选择|执行|运行|开始|采用|计划|方式|模式|一下)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const isStandaloneSelection =
    stripped === 'inline' ||
    stripped === 'in line' ||
    stripped === '行内' ||
    stripped === '当前会话' ||
    stripped === 'subagent' ||
    stripped === 'sub agent' ||
    stripped === '子代理' ||
    stripped === '委派';
  if (isStandaloneSelection || EXECUTION_VERB_PATTERN.test(normalized)) {
    return inline ? 'inline' : 'subagent-driven';
  }
  return undefined;
}
