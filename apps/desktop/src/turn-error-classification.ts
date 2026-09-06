import { normalizeAgentFailure, type AgentFailure } from '@piwin/contracts';

export type TurnErrorCategory =
  | 'auth'
  | 'quota'
  | 'context'
  | 'stream'
  | 'timeout'
  | 'http'
  | 'unknown';

export type TurnErrorPrimaryAction = 'settings' | 'retry' | 'switch-model' | 'copy';

export type TurnErrorClassification = {
  category: TurnErrorCategory;
  titleZh: string;
  titleEn: string;
  primaryAction: TurnErrorPrimaryAction;
};

/**
 * Map structured AgentFailure to titles and actions. Message prose is never
 * classification authority — legacy rows without failure are generic.
 */
export function classifyAgentFailure(failure: AgentFailure | undefined): TurnErrorClassification {
  const code = failure === undefined ? 'unknown-agent-failure' : normalizeAgentFailure(failure).code;
  switch (code) {
    case 'provider-authentication':
      return {
        category: 'auth',
        titleZh: '模型认证失败',
        titleEn: 'Model authentication failed',
        primaryAction: 'settings',
      };
    case 'provider-quota':
    case 'provider-rate-limit':
      return {
        category: 'quota',
        titleZh: '模型调用受限',
        titleEn: 'Model request limited',
        primaryAction: 'switch-model',
      };
    case 'context-limit-exceeded':
      return {
        category: 'context',
        titleZh: '上下文长度超限',
        titleEn: 'Context window exceeded',
        primaryAction: 'retry',
      };
    case 'model-stream-missing-finish':
      return {
        category: 'stream',
        titleZh: '模型流异常结束',
        titleEn: 'Model stream ended unexpectedly',
        primaryAction: 'retry',
      };
    case 'model-stream-stalled':
      return {
        category: 'stream',
        titleZh: '模型输出中断',
        titleEn: 'Model output interrupted',
        primaryAction: 'retry',
      };
    case 'model-request-timeout':
      return {
        category: 'timeout',
        titleZh: '模型请求超时',
        titleEn: 'Model request timed out',
        primaryAction: 'retry',
      };
    case 'provider-http-error':
      return {
        category: 'http',
        titleZh: '模型服务返回错误',
        titleEn: 'Model service returned an error',
        primaryAction: failure?.retriable === true ? 'retry' : 'copy',
      };
    case 'provider-unavailable':
      return {
        category: 'http',
        titleZh: '无法连接模型服务',
        titleEn: 'Could not reach model service',
        primaryAction: 'retry',
      };
    case 'backend-worker-crash':
      return {
        category: 'unknown',
        titleZh: '后端进程异常',
        titleEn: 'Backend process crashed',
        primaryAction: 'retry',
      };
    case 'backend-protocol-error':
      return {
        category: 'unknown',
        titleZh: '协议错误',
        titleEn: 'Protocol error',
        primaryAction: 'retry',
      };
    case 'unknown-agent-failure':
    default:
      return {
        category: 'unknown',
        titleZh: '生成失败',
        titleEn: 'Generation failed',
        primaryAction: 'retry',
      };
  }
}
