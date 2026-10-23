/**
 * Map a Host `ProviderConnectionTestResult` to the provider pill / rail tone
 * and one user-facing sentence. Pure so the tone policy is unit-tested:
 * a catalog-less endpoint (`catalog-unavailable`) is a *warning* with a next
 * step, never the red "Connection failed" it used to be.
 */
import type { ProviderConnectionTestResult } from '@piwin/contracts';
import type { ProviderTestStatus } from './provider-status.js';

export type ProviderConnectionVerdict = {
  status: ProviderTestStatus;
  /** Which notification channel the shell should use. */
  notify: 'success' | 'info' | 'error';
};

export function describeProviderConnectionResult(
  result: ProviderConnectionTestResult,
  isChinese: boolean,
): ProviderConnectionVerdict {
  const duration = result.durationMs;
  const http = result.httpStatus !== undefined ? ` (HTTP ${result.httpStatus})` : '';
  const detail = result.detail ? `: ${result.detail}` : '';
  switch (result.outcome) {
    case 'chat-ok': {
      const transport = result.chatApi === 'openai-responses' ? ' · Responses' : '';
      const model = result.modelId ?? '';
      return ok(
        isChinese
          ? `已连通 · ${model}${transport} · ${duration}ms`
          : `Connected · ${model}${transport} · ${duration}ms`,
        duration,
      );
    }
    case 'catalog-ok': {
      const count = result.modelCount ?? 0;
      return ok(
        isChinese
          ? `已连接 · ${count} 个模型 · ${duration}ms`
          : `Connected · ${count} models · ${duration}ms`,
        duration,
      );
    }
    case 'catalog-unavailable':
      return {
        notify: 'info',
        status: {
          tone: 'warn',
          message: isChinese
            ? `该地址不提供模型列表${http}，不影响对话。请手动添加模型 ID，再点测试连接做一次真实对话测试。`
            : `This endpoint has no model list${http}; chat is unaffected. Add model IDs manually, then test again to run a real chat request.`,
        },
      };
    case 'auth-failed':
      return err(isChinese ? `密钥被拒绝${http}${detail}` : `API key rejected${http}${detail}`);
    case 'model-rejected':
      return err(modelRejectedMessage(result, isChinese, http, detail));
    case 'unreachable':
      return err(isChinese ? `无法连接${detail}` : `Cannot reach the endpoint${detail}`);
    case 'invalid-config':
      return err(isChinese ? `配置无效${detail}` : `Invalid configuration${detail}`);
  }
}

function modelRejectedMessage(
  result: ProviderConnectionTestResult,
  isChinese: boolean,
  http: string,
  detail: string,
): string {
  const where = result.endpoint ? ` · ${result.endpoint}` : '';
  const head = isChinese
    ? `模型 ${result.modelId ?? ''} 请求失败${http}${detail}${where}`
    : `Request to ${result.modelId ?? 'the model'} failed${http}${detail}${where}`;
  if (result.httpStatus !== 404) return head;
  // A 404 on the chat path is usually a wrong address, a wrong model ID, or a
  // provider that only serves the other OpenAI transport.
  const otherTransport = result.chatApi === 'openai-responses' ? 'Chat Completions' : 'Responses';
  return isChinese
    ? `${head}。请检查 API 地址和模型 ID；如果该服务商只支持 ${otherTransport}，可在「高级 → 对话协议」切换。`
    : `${head}. Check the API address and model ID; if this provider only serves ${otherTransport}, switch it under Advanced → Chat API.`;
}

function ok(message: string, durationMs: number): ProviderConnectionVerdict {
  return { notify: 'success', status: { tone: 'ok', message, durationMs } };
}

function err(message: string): ProviderConnectionVerdict {
  return { notify: 'error', status: { tone: 'err', message } };
}
