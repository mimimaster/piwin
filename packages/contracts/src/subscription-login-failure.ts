/**
 * User-facing copy for a failed subscription sign-in.
 *
 * Pi renders the browser "authorization complete" page from its loopback
 * callback *before* it exchanges the code for tokens, so a success page is not
 * evidence the sign-in finished. Any later failure used to reach the user as
 * nothing at all; Desktop and CLI share this copy so the failure and its code
 * are always visible.
 */

export type SubscriptionLoginFailureLocale = 'zh-CN' | 'en';

export type SubscriptionLoginFailureCopy = {
  code: string;
  message: string;
};

/** Codes Piwin owns. Anything else is reported verbatim instead of guessed at. */
const FAILURE_MESSAGE: Record<string, Record<SubscriptionLoginFailureLocale, string>> = {
  'provider-authentication': {
    'zh-CN':
      '登录未完成：浏览器已授权，但凭据交换被平台拒绝。可重试一次，仍失败请把错误码发给开发者。',
    en: 'Sign-in did not finish: the browser authorized, but the credential exchange was rejected. Retry once; if it keeps failing, send the error code to your developer.',
  },
  'oauth-network': {
    'zh-CN':
      '登录未完成：浏览器已授权，但凭据交换时网络失败。可重试，或粘贴回调 URL 后再提交。',
    en: 'Sign-in did not finish: the browser authorized, but the credential exchange failed on the network. Retry, or paste the callback URL and submit again.',
  },
  'oauth-callback-port-busy': {
    'zh-CN':
      '登录未完成：本机回调端口 1455 已被占用（CPA / Codex CLI / 其他工具正在登录）。请先结束它再重试。',
    en: 'Sign-in did not finish: local callback port 1455 is already in use (CPA / Codex CLI / another tool is signing in). Close it and retry.',
  },
  'credential-sync-failed': {
    'zh-CN': '登录已写入，但凭据同步失败。可在账号页重试同步。',
    en: 'The credential was stored but the sync failed. Retry the sync from the accounts page.',
  },
  'auth-store-unreadable': {
    'zh-CN': '登录未完成：无法读取本机凭据文件 auth.json，请检查文件权限。',
    en: 'Sign-in did not finish: the local credential file auth.json could not be read. Check its permissions.',
  },
  'auth-busy': {
    'zh-CN': '登录未完成：已有一次登录在进行中，请先完成或取消它。',
    en: 'Sign-in did not finish: another sign-in is already in progress. Finish or cancel it first.',
  },
  'auth-not-owner': {
    'zh-CN': '登录未完成：这次登录由另一台设备发起，请在那台设备上完成。',
    en: 'Sign-in did not finish: another device owns this sign-in. Finish it there.',
  },
  'ticket-consumed': {
    'zh-CN': '登录未完成：这次授权请求已失效，请重新发起登录。',
    en: 'Sign-in did not finish: this authorization request is no longer valid. Start again.',
  },
  collision: {
    'zh-CN': '登录未完成：通道 id 与订阅账号冲突，请先重命名该通道。',
    en: 'Sign-in did not finish: a channel id collides with the subscription account. Rename that channel first.',
  },
  'unsupported-subscription-provider': {
    'zh-CN': '登录未完成：不支持该订阅提供方。',
    en: 'Sign-in did not finish: this subscription provider is not supported.',
  },
  'login-failed': {
    'zh-CN': '登录未完成，请重试。',
    en: 'Sign-in did not finish. Try again.',
  },
};

const PORT_BUSY = /EADDRINUSE|address already in use|listen EADDRINUSE/i;
const NETWORK_HINT =
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|EPIPE|EHOSTUNREACH|ECONNABORTED|fetch failed|network\s*error|socket hang up|timed? ?out|deadline exceeded|UND_ERR_|getaddrinfo|\b5\d{2}\b/i;
const NETWORK_NAME =
  /^(?:FetchError|APIConnectionError|APIConnectionTimeoutError|ConnectTimeoutError)$/;
const AUTH_REJECTION = /invalid_grant|invalid_client|invalid authentication|unauthorized|\b401\b|\b403\b/i;

function errorText(error: unknown): { name: string; text: string } {
  const parts: string[] = [];
  let name = '';
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current) && parts.length < 8) {
    seen.add(current);
    if (current instanceof Error) {
      if (!name) name = current.name;
      parts.push(current.name, current.message);
      current = 'cause' in current ? current.cause : undefined;
      continue;
    }
    parts.push(typeof current === 'string' ? current : String(current));
    break;
  }
  return { name, text: parts.join(' ') };
}

/**
 * Login failures without a code used to be reported as a platform rejection.
 * A later successful sign-in proved those were often just transport failures.
 */
export function classifySubscriptionLoginFailure(error: unknown): string {
  const { name, text } = errorText(error);
  if (PORT_BUSY.test(text)) return 'oauth-callback-port-busy';
  if (NETWORK_NAME.test(name) || NETWORK_HINT.test(text)) return 'oauth-network';
  if (AUTH_REJECTION.test(text)) return 'provider-authentication';
  return 'login-failed';
}

export function describeSubscriptionLoginFailure(
  errorCode: string | undefined,
  locale: SubscriptionLoginFailureLocale,
): SubscriptionLoginFailureCopy {
  const code = errorCode?.trim() ? errorCode.trim() : 'provider-authentication';
  const known = FAILURE_MESSAGE[code];
  if (known) {
    return { code, message: known[locale] };
  }
  // Unknown code: keep it visible so a report carries the raw Host reason.
  return {
    code,
    message:
      locale === 'zh-CN'
        ? `登录未完成（错误：${code}）。请把该错误码发给开发者。`
        : `Sign-in did not finish (error: ${code}). Send this code to your developer.`,
  };
}
