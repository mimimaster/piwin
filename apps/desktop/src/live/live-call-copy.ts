import type {
  LiveCallView,
  LiveMediaDriverId,
  LiveReadyMissing,
  LiveStatusData,
} from '@piwin/contracts';

export function canStartLive(input: {
  sessionId: string | null;
  call: LiveCallView | null;
  starting: boolean;
  missing: readonly LiveReadyMissing[];
}): boolean {
  return (
    !input.starting &&
    !input.call &&
    !input.missing.includes('provider-auth')
  );
}

export function liveMissingLabel(missing: LiveReadyMissing[], isChinese: boolean): string {
  if (missing.includes('provider-auth')) {
    return isChinese ? '请先完成当前渠道的登录或密钥' : 'Sign in or save a key for this Live channel first';
  }
  if (missing.includes('invalid-settings')) {
    return isChinese ? '请在 Live 设置里修正当前渠道选项' : 'Fix the current Live channel settings';
  }
  if (missing.includes('provider-unavailable')) {
    return isChinese ? '当前渠道不可用，请换一家或更新应用' : 'This Live channel is unavailable. Choose another or update the app.';
  }
  if (missing.includes('media-unsupported')) {
    return isChinese ? '当前电脑不支持该渠道的媒体能力' : 'This computer does not support this Live channel';
  }
  if (missing.includes('call-busy')) {
    return isChinese ? '已有通话进行中' : 'A Live call is already active';
  }
  if (missing.includes('session')) {
    return isChinese ? '将为当前对话创建会话' : 'Will create a session for this chat';
  }
  return isChinese ? 'Live 未就绪' : 'Live is not ready';
}

export function mediaDriverIdForLiveProvider(providerId: string): LiveMediaDriverId | null {
  if (providerId === 'google-gemini') return 'gemini-live-v1beta';
  if (providerId === 'openai-codex') return 'codex-webrtc-v1';
  if (providerId === 'openai-realtime') return 'openai-realtime-ws-v1';
  return null;
}

export function resolveLiveStartChannel(
  status: LiveStatusData | null,
):
  | { ok: true; providerId: string; mediaDriverId: LiveMediaDriverId }
  | { ok: false; error: string } {
  const providerId = status?.selectedProviderId?.trim() ?? '';
  const mediaDriverId = status?.mediaDriverId ?? mediaDriverIdForLiveProvider(providerId);
  if (!providerId || !mediaDriverId) {
    return { ok: false, error: 'live-provider-unavailable' };
  }
  return { ok: true, providerId, mediaDriverId };
}

export function liveProviderAuthError(providerId: string): string {
  return `live-provider-auth:${providerId}`;
}

export function liveStartErrorLabel(error: string, isChinese: boolean): string {
  if (error === 'live-session-unavailable') {
    return isChinese ? '无法创建会话' : 'Could not create a session';
  }
  if (error === 'live-conflict') {
    return isChinese ? 'Live 设置刚更新过，请再点一次开始' : 'Live settings just changed. Start Live again.';
  }
  const authProvider = error.startsWith('live-provider-auth:')
    ? error.slice('live-provider-auth:'.length)
    : undefined;
  if (error === 'live-provider-auth' || authProvider || /openai-codex login required/i.test(error)) {
    if (authProvider === 'google-gemini') {
      return isChinese ? '请先保存 Gemini API key' : 'Save a Gemini API key first';
    }
    if (authProvider === 'openai-realtime') {
      return isChinese
        ? '请先在模型配置里保存该 OpenAI 兼容渠道的密钥'
        : 'Save the OpenAI-compatible provider key in Models settings first';
    }
    if (authProvider === 'openai-codex' || /openai-codex login required/i.test(error)) {
      return isChinese ? '请先登录 Codex' : 'Sign in to Codex first';
    }
    return isChinese
      ? '请先完成当前 Live 渠道的登录或密钥'
      : 'Sign in or save a key for this Live channel first';
  }
  if (error === 'live-provider-access-denied') {
    return isChinese
      ? '上游拒绝了 piwin Live 的建连参数。这不等同于账号没有官方 Voice；请更新并重启 piwin，若仍失败则可能是非公开协议已经变化。'
      : 'The upstream service rejected the piwin Live connection parameters. This does not mean the account lacks official Voice. Update and restart piwin; if it persists, the private protocol may have changed.';
  }
  if (error === 'mic-denied') {
    return isChinese
      ? '麦克风被拒绝，请在系统设置里允许'
      : 'Microphone denied. Allow it in System Settings.';
  }
  if (error === 'mic-unavailable') {
    return isChinese
      ? '麦克风不可用。完全退出并重新打开 Desktop 后再试。'
      : 'Microphone unavailable. Quit and reopen Desktop, then try again.';
  }
  if (error === 'live-disconnected') {
    return isChinese ? 'Live 已断开' : 'Live disconnected';
  }
  if (error === 'live-call-busy' || error === 'call-busy') {
    return isChinese
      ? '上次通话还停在 Host 上。再点一次即可重新连接'
      : 'The previous call is still on the Host. Start Live again.';
  }
  if (error === 'live-provider-unavailable') {
    return isChinese
      ? '当前 Live 渠道还没准备好。打开设置 → 模型配置 → 语音能力，确认渠道与密钥。'
      : 'This Live channel is not ready. Open Settings → Models → Speech and confirm the channel and key.';
  }
  if (error === 'live-start-throttled') {
    return isChinese ? '点得太快了，等几秒再开始' : 'Too many Live starts. Wait a few seconds.';
  }
  if (error === 'live-gemini-credits') {
    return isChinese
      ? 'Gemini Live 预付额度用完了。打开 AI Studio 给这个项目充值后再试。'
      : 'Gemini Live prepaid credits are depleted. Add credits for this project in AI Studio, then try again.';
  }
  if (error === 'live-provider-rejected' || error === 'live-protocol-failed') {
    return isChinese
      ? '上游拒绝了这次 Live 建连。Codex / Gemini / OpenAI Realtime 请分别看 Host 日志。'
      : 'The upstream service rejected this Live start. Check Host logs for the active channel.';
  }
  if (error === 'negotiate-failed' || error === 'peer-failed') {
    return isChinese ? '无法建立 Live 连接' : 'Could not start the Live connection';
  }
  if (error === 'live-start-cancelled') {
    return isChinese
      ? 'Live 连接已中止，请重试'
      : 'The Live connection was interrupted. Try again.';
  }
  return error;
}
