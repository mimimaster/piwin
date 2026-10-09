import type { WalkthroughErrorCode } from '@piwin/contracts';

const REASON: Record<WalkthroughErrorCode, string> = {
  disabled: '交付报告功能已关闭',
  'not-eligible': '这条回答不适合写报告',
  'session-not-found': '找不到这个会话',
  'message-not-found': '找不到这条回答',
  'model-unavailable': '没有可用的模型，先用 /model 选一个，或在 Host 里配置模型服务',
  'provider-not-found': '找不到所选模型的服务商，检查 Host 的模型配置',
  'model-not-configured': '没有配置报告用的模型',
  'missing-credentials': '模型服务缺少密钥，检查 Host 的模型配置',
  'unsupported-provider': '这个模型服务暂不支持写报告',
  'provider-request-failed': '模型服务请求失败，稍后再试',
  'provider-timeout': '模型服务响应超时，稍后再试',
  'empty-output': '模型没有返回内容，稍后再试',
  'invalid-config': '报告配置无效，检查 Host 设置',
  cancelled: '已取消',
};

/**
 * A walkthrough failure in the user's words. A refused request carries the
 * Host's `{ code, message }` as JSON text; a pushed failure carries them apart.
 * Unknown codes keep the Host's own message rather than hiding it.
 */
export function describeWalkthroughFailure(error: string | { code: string; message: string }): string {
  const parsed = typeof error === 'string' ? parseFailure(error) : error;
  if (parsed === undefined) return typeof error === 'string' ? error : error.message;
  return (REASON as Record<string, string | undefined>)[parsed.code] ?? parsed.message;
}

function parseFailure(text: string): { code: string; message: string } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return undefined;
    const { code, message } = value as { code?: unknown; message?: unknown };
    return typeof code === 'string' && typeof message === 'string' ? { code, message } : undefined;
  } catch {
    // Plain text from a Host that does not wrap its refusals.
    return undefined;
  }
}
