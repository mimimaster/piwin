import { useEffect, useState, type ReactElement } from 'react';
import type { AuthPromptPayload } from '@piwin/contracts';
import { Button, TextInput } from '@piwin/ui-kit';
import { Check, Clock, Copy, ExternalLink, Loader2, X } from 'lucide-react';
import { openExternalUrl } from './open-external-url.js';

export function readAuthPromptOpenUrl(
  prompt: AuthPromptPayload | undefined,
  authUrl?: AuthPromptPayload,
): string | undefined {
  if (!prompt || prompt.kind === 'prompt-cancelled') {
    return undefined;
  }
  const raw = prompt.kind === 'device_code' ? prompt.verificationUri : (prompt.url ?? authUrl?.url);
  const trimmed = raw?.trim() ?? '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

export type ProviderCardMeta = {
  title: string;
  titleEn: string;
  tagline: string;
  taglineEn: string;
  login: string;
  loginEn: string;
};

export type InlineAuthPromptFormProps = {
  prompt: AuthPromptPayload;
  authUrl?: AuthPromptPayload | undefined;
  value: string;
  onChange: (value: string) => void;
  isChinese: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
};

export function InlineAuthPromptForm(props: InlineAuthPromptFormProps): ReactElement | null {
  const { prompt, authUrl, value, onChange, isChinese, onSubmit, onCancel } = props;
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(prompt.expiresInSeconds);
  const openUrl = readAuthPromptOpenUrl(prompt, authUrl);

  // Auto-select the first non-device_code option when a select prompt arrives,
  // skipping the manual selection UI entirely (e.g. "Browser login (default)").
  useEffect(() => {
    if (prompt.kind !== 'select' || !prompt.options) return;
    const defaultOption = prompt.options.find((o) => o.id !== 'device_code');
    if (defaultOption) {
      onSubmit(defaultOption.id);
    }
  }, [prompt.promptId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const expires = prompt.expiresInSeconds;
    if (expires === undefined) {
      setRemainingSeconds(undefined);
      return;
    }
    setRemainingSeconds(expires);
    const started = Date.now();
    const timer = setInterval(() => {
      const next = expires - Math.floor((Date.now() - started) / 1000);
      setRemainingSeconds(Math.max(0, next));
    }, 1000);
    return () => clearInterval(timer);
  }, [prompt.expiresInSeconds, prompt.promptId]);

  async function copyText(text: string, type: 'url' | 'code'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'url') {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      } else {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      }
    } catch {
      if (type === 'url') setCopiedUrl(false);
      else setCopiedCode(false);
    }
  }

  if (prompt.kind === 'prompt-cancelled') {
    return null;
  }

  return (
    <div className="oauth-inline-form" data-testid="subscription-login-prompt">
      {/* 1. Device Code Mode */}
      {prompt.kind === 'device_code' ? (
        <div className="oauth-inline-device-section">
          <div className="oauth-inline-section-header">
            <span className="oauth-inline-label">{isChinese ? '设备授权码' : 'Device Code'}</span>
            {remainingSeconds !== undefined ? (
              <div className="oauth-timer-badge">
                <Clock size={12} />
                <span>
                  {isChinese
                    ? `剩余 ${Math.floor(remainingSeconds / 60)}分${(remainingSeconds % 60).toString().padStart(2, '0')}秒`
                    : `${remainingSeconds}s remaining`}
                </span>
              </div>
            ) : null}
          </div>

          <div className="oauth-device-code-box">
            <strong className="oauth-device-code-value" data-testid="subscription-device-code">
              {prompt.userCode}
            </strong>
            {prompt.userCode ? (
              <Button
                type="button"
                variant="secondary"
                size="compact"
                className="oauth-copy-btn"
                onClick={() => void copyText(prompt.userCode ?? '', 'code')}
              >
                {copiedCode ? (
                  <>
                    <Check size={13} className="oauth-icon-mint" />
                    <span>{isChinese ? '已复制' : 'Copied'}</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    <span>{isChinese ? '复制设备码' : 'Copy code'}</span>
                  </>
                )}
              </Button>
            ) : null}
          </div>

          <div className="oauth-inline-instructions">
            <p className="oauth-inline-hint">
              {prompt.instructions ?? (isChinese
                ? '复制上方授权码，点击下方按钮前往授权页面并粘贴确认即可完成登录。'
                : 'Copy the code above, open the verification page, and confirm authorization.')}
            </p>
          </div>

          <div className="oauth-inline-actions-row">
            {prompt.verificationUri ? (
              <Button
                type="button"
                variant="primary"
                size="compact"
                onClick={() => {
                  void openExternalUrl(prompt.verificationUri ?? '');
                }}
              >
                <ExternalLink size={13} />
                <span>{isChinese ? '打开验证页面' : 'Open verification page'}</span>
              </Button>
            ) : null}

            <Button type="button" variant="secondary" size="compact" onClick={onCancel}>
              <X size={13} />
              <span>{isChinese ? '取消连接' : 'Cancel'}</span>
            </Button>
          </div>
        </div>
      ) : null}

      {/* 2. Web OAuth URL Section */}
      {openUrl && prompt.kind !== 'device_code' ? (
        <div className="oauth-inline-url-section">
          <span className="oauth-inline-label">{isChinese ? '授权链接：' : 'Authorization Link:'}</span>
          <div className="oauth-inline-url-box">
            <code className="oauth-auth-url" data-testid="subscription-auth-url">
              {openUrl}
            </code>
          </div>
          <div className="oauth-inline-url-actions">
            <Button
              type="button"
              variant="secondary"
              size="compact"
              onClick={() => void copyText(openUrl, 'url')}
            >
              {copiedUrl ? (
                <>
                  <Check size={13} className="oauth-icon-mint" />
                  <span>{isChinese ? '已复制' : 'Copied'}</span>
                </>
              ) : (
                <>
                  <Copy size={13} />
                  <span>{isChinese ? '复制链接' : 'Copy link'}</span>
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              onClick={() => void openExternalUrl(openUrl)}
            >
              <ExternalLink size={13} />
              <span>{isChinese ? '打开链接' : 'Open link'}</span>
            </Button>
          </div>
        </div>
      ) : null}

      {/* 3. Message / Progress Info */}
      {(prompt.kind === 'info' || prompt.kind === 'progress') && (
        <div className="oauth-inline-message-box">
          <Loader2 size={14} className="oauth-inline-spinner" />
          <p className="oauth-prompt-message">{prompt.message ?? prompt.instructions}</p>
        </div>
      )}

      {/* 4. Select Options — auto-submitted, show brief loading */}
      {prompt.kind === 'select' ? (
        <div className="oauth-inline-loading">
          <span className="oauth-status-dot is-spinning" />
          <span>{isChinese ? '正在选择登录方式...' : 'Selecting login method...'}</span>
        </div>
      ) : null}

      {/* 5. Response Form (e.g. Callback URL or Token Input) */}
      {prompt.expectsResponse && prompt.kind !== 'select' ? (
        <form
          className="oauth-inline-input-group"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(value);
          }}
        >
          <div className="oauth-inline-field">
            <label className="oauth-inline-label">
              {prompt.placeholder?.includes('http') || prompt.message?.includes('URL') || prompt.message?.includes('url')
                ? (isChinese ? '回调 URL' : 'Callback URL')
                : (prompt.message || (isChinese ? '认证凭证' : 'Credentials'))}
            </label>
            <TextInput
              autoFocus
              type={prompt.kind === 'secret' ? 'password' : 'text'}
              value={value}
              placeholder={prompt.placeholder || (isChinese ? 'http://localhost:1455/auth/callback?code=...&state=...' : 'Enter response...')}
              onChange={(event) => onChange(event.currentTarget.value)}
              className="oauth-inline-input"
            />
            <p className="oauth-inline-hint">
              {prompt.instructions ?? (isChinese
                ? '在浏览器完成授权并跳转到 localhost 页面后，将浏览器地址栏中的完整 URL 粘贴至此处提交。'
                : 'After completing authorization, copy the final redirected URL from your browser address bar and paste here.')}
            </p>
          </div>

          <div className="oauth-inline-actions-row">
            <Button type="submit" variant="primary" size="compact">
              {isChinese ? '提交回调 URL' : 'Submit Callback URL'}
            </Button>

            <Button type="button" variant="secondary" size="compact" onClick={onCancel}>
              <X size={13} />
              <span>{isChinese ? '取消连接' : 'Cancel'}</span>
            </Button>

            <div className="oauth-inline-waiting-status">
              <span className="oauth-status-dot is-pulse" />
              <span>{isChinese ? '等待认证中...' : 'Waiting for authentication...'}</span>
            </div>
          </div>
        </form>
      ) : null}

      {/* If prompt doesn't expect text response and isn't device_code, show waiting & cancel footer */}
      {!prompt.expectsResponse && prompt.kind !== 'device_code' ? (
        <div className="oauth-inline-footer">
          <div className="oauth-inline-waiting-status">
            <span className="oauth-status-dot is-pulse" />
            <span>{isChinese ? '等待认证中...' : 'Waiting for authentication...'}</span>
          </div>
          <Button type="button" variant="secondary" size="compact" onClick={onCancel}>
            <X size={13} />
            <span>{isChinese ? '取消连接' : 'Cancel'}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
