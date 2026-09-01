import type { ReactElement } from 'react';
import { Button, IconClose, IconMic, IconSpark, IconStop } from '@piwin/ui-kit';
import type { MobileLiveCallController } from '../../hooks/use-mobile-live.js';
import { MobileLayer } from '../../mobile-portal.js';

export type MobileLiveSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  live: MobileLiveCallController;
};

export function MobileLiveSheet({
  isOpen,
  onClose,
  live,
}: MobileLiveSheetProps): ReactElement | null {
  const call = live.call;
  const active = call !== null && live.owned;
  const remoteCall = call !== null && !live.owned;
  const provider = providerLabel(call?.providerId ?? live.status?.selectedProviderId);
  const activity = activityLabel(call?.activity, live.starting);

  return (
    <MobileLayer isOpen={isOpen} onClose={onClose} overlayClassName="mobile-modal-overlay">
      <div className="mobile-live-sheet">
        <div className="mobile-modal-header">
          <div className="mobile-modal-header-left">
            <IconSpark size={18} />
            <h2 className="mobile-modal-title">Live 语音</h2>
          </div>
          <button
            type="button"
            className="mobile-modal-close-btn"
            onClick={onClose}
            aria-label="关闭 Live 面板"
          >
            <IconClose size={18} />
          </button>
        </div>

        <div className="mobile-live-body">
          <div className={`mobile-live-orb ${active ? 'is-active' : ''}`} aria-hidden="true">
            <IconMic size={32} />
          </div>
          <div className="mobile-live-status" role="status" aria-live="polite">
            <strong>
              {active
                ? activity
                : remoteCall
                  ? '另一台设备正在通话'
                  : live.starting
                    ? '正在连接…'
                    : '随时开始语音对话'}
            </strong>
            <span>{provider}</span>
          </div>

          {remoteCall ? (
            <p className="mobile-live-helper">
              Live 由另一台已配对设备持有。结束那台设备上的通话后，你可以在这里重新开始。
            </p>
          ) : (
            <p className="mobile-live-helper">
              聊天任务仍由当前 Host 执行；手机只负责麦克风和扬声器。
            </p>
          )}

          {live.error !== null ? (
            <div className="mobile-live-error" role="alert">
              {liveErrorLabel(live.error, active)}
            </div>
          ) : null}

          {!active ? (
            <Button
              variant="primary"
              className="mobile-live-primary-action"
              disabled={!live.canStart || live.starting || remoteCall}
              onClick={() => void live.start()}
            >
              <IconMic size={17} />
              {live.starting ? '正在连接…' : '开始 Live'}
            </Button>
          ) : (
            <div className="mobile-live-actions">
              <Button
                variant="secondary"
                className="mobile-live-mute-action"
                aria-pressed={live.peer.muted}
                onClick={() => void live.setMuted(!live.peer.muted)}
              >
                <IconMic size={17} />
                {live.peer.muted ? '取消静音' : '静音'}
              </Button>
              <Button
                variant="danger"
                className="mobile-live-end-action"
                onClick={() => void live.end()}
              >
                <IconStop size={16} />
                结束通话
              </Button>
            </div>
          )}

          {!live.canStart && !active && !remoteCall && live.error === null ? (
            <p className="mobile-live-missing">{missingLabel(live.status?.missing ?? [])}</p>
          ) : null}
        </div>
      </div>
    </MobileLayer>
  );
}

function providerLabel(providerId: string | undefined): string {
  if (providerId === 'openai-codex') return 'Codex Live';
  if (providerId === 'google-gemini') return 'Gemini Live';
  if (providerId === 'openai-realtime') return 'OpenAI 兼容实时模型';
  if (providerId && providerId.trim()) return providerId;
  return '尚未选择 Live 渠道';
}

function activityLabel(activity: string | undefined, starting: boolean): string {
  if (starting) return '正在连接…';
  if (activity === 'user-speaking') return '正在听你说';
  if (activity === 'assistant-speaking') return '正在回答';
  if (activity === 'agent-working') return '正在处理任务';
  if (activity === 'muted') return '已静音';
  return '正在聆听';
}

function missingLabel(missing: readonly string[]): string {
  if (missing.includes('provider-auth')) return '请先在 Host 的 Live 设置中完成登录或配置密钥。';
  if (missing.includes('microphone')) return '请在系统设置中允许 Piwin 使用麦克风。';
  if (missing.includes('media-unsupported')) return '当前移动设备暂不支持这个 Live 渠道。';
  if (missing.includes('provider-unavailable')) return '当前 Live 渠道不可用，请检查 Host 设置。';
  if (missing.includes('invalid-settings')) return 'Live 设置不完整，请先在 Host 中修正。';
  return 'Live 当前未就绪。';
}

function liveErrorLabel(error: string, activeCall = false): string {
  const normalized = error.trim();
  if (normalized === 'mic-denied') return '麦克风被拒绝，请在系统设置中允许 Piwin 使用麦克风。';
  if (normalized === 'mic-unavailable') return '麦克风当前不可用，请检查系统权限或重新连接设备。';
  if (normalized === 'live-session-unavailable') {
    return activeCall
      ? '无法改绑到该会话，语音通话仍保持连接。'
      : '无法找到当前对话，请返回聊天后重试。';
  }
  if (normalized === 'live-conflict') {
    return activeCall
      ? '工作目标改绑冲突，请稍后再试。'
      : 'Live 设置刚更新过，请再点一次开始。';
  }
  if (normalized === 'live-provider-auth' || normalized.startsWith('live-provider-auth:')) {
    if (normalized.endsWith('google-gemini'))
      return '请先在 Host 的 Live 设置中保存 Gemini API key。';
    if (normalized.endsWith('openai-realtime')) {
      return '请先在 Host 的模型配置中保存 OpenAI 兼容渠道的密钥。';
    }
    if (normalized.endsWith('openai-codex')) return '请先在 Host 中完成 Codex 登录。';
    return '请先在 Host 的 Live 设置中完成登录或配置密钥。';
  }
  if (normalized === 'live-provider-access-denied')
    return '上游拒绝了 Live 建连参数，请检查 Host 设置后重试。';
  if (normalized === 'live-provider-unavailable') return '当前 Live 渠道不可用，请检查 Host 设置。';
  if (normalized === 'live-gemini-credits') return 'Gemini Live 额度已用完，请补充额度后重试。';
  if (normalized === 'live-call-busy' || normalized === 'call-busy') {
    return '已有一通 Live 通话，请先结束另一台设备上的通话。';
  }
  if (normalized === 'live-not-owner') return '这台设备没有当前通话的控制权。';
  if (normalized === 'live-disconnected' || normalized === 'live-owner-disconnected') {
    return 'Live 已断开，请重新开始。';
  }
  if (
    normalized === 'live-provider-rejected' ||
    normalized === 'live-protocol-failed' ||
    normalized === 'negotiate-failed' ||
    normalized === 'peer-failed'
  ) {
    return 'Live 建连失败，请检查 Host 设置后重试。';
  }
  return 'Live 暂时不可用，请稍后重试。';
}
