import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { HostPush } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { FullButton, IconButton, ScreenHeading } from '../inkstone-ui.js';
import { isObject } from '../host/use-host-query.js';

const CAPTURE_QUALITY = 60;
const RECAPTURE_DEBOUNCE_MS = 700;

type Snapshot = { src: string; width: number; height: number; at: number };

/**
 * Workspace › 浏览器: the Host's browser session seen from the phone. The page
 * lives on the Host; the phone asks for a JPEG snapshot (`browser/capture` →
 * `media/read`), follows `browser/state`, and relays navigation. While the
 * agent holds the browser, the phone only watches.
 */
export function WorkspaceBrowser({
  client,
  sessionId,
  onToast,
}: {
  client: HostClient | undefined;
  sessionId: string | undefined;
  onToast: (message: string) => void;
}): ReactElement {
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState<string | undefined>();
  const [draftUrl, setDraftUrl] = useState('');
  const [agentOwns, setAgentOwns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const capture = useCallback(async (): Promise<void> => {
    if (client === undefined || sessionId === undefined) return;
    setBusy(true);
    try {
      const response = await client.request({ type: 'browser/capture', sessionId, quality: CAPTURE_QUALITY });
      const attachment = response.success && isObject(response.data) ? response.data.attachment : undefined;
      if (!isObject(attachment) || typeof attachment.id !== 'string') {
        setError(response.success ? 'Host 没有返回截图。' : response.error);
        return;
      }
      const read = await client.request({ type: 'media/read', input: { sessionId, assetId: attachment.id } });
      const data = read.success && isObject(read.data) ? read.data : undefined;
      if (data?.status !== 'ready' || typeof data.base64Data !== 'string' || typeof data.mimeType !== 'string') {
        setError(read.success ? '截图暂时读不到。' : read.error);
        return;
      }
      setSnapshot({
        src: `data:${data.mimeType};base64,${data.base64Data}`,
        width: typeof attachment.width === 'number' ? attachment.width : 16,
        height: typeof attachment.height === 'number' ? attachment.height : 10,
        at: Date.now(),
      });
      setError(undefined);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '截图失败。');
    } finally {
      setBusy(false);
    }
  }, [client, sessionId]);

  useEffect(() => {
    void capture();
  }, [capture]);

  useEffect(() => {
    if (client === undefined) return undefined;
    const unsubscribe = client.subscribePush((push: HostPush) => {
      if (push.type === 'browser/state') {
        if (push.url !== undefined) setUrl(push.url);
        if (push.title !== undefined) setTitle(push.title);
        if (timerRef.current !== undefined) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void capture(), RECAPTURE_DEBOUNCE_MS);
      } else if (push.type === 'browser/controller') {
        setAgentOwns(push.owner === 'agent');
      }
    });
    return () => {
      unsubscribe();
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
  }, [client, capture]);

  const relay = (command: Parameters<HostClient['request']>[0], done: string): void => {
    if (client === undefined) return;
    if (agentOwns) {
      onToast('Agent 正在操作浏览器，稍后再试');
      return;
    }
    client
      .request(command)
      .then((response) => {
        if (!response.success) {
          onToast(response.error);
          return;
        }
        onToast(done);
        timerRef.current = setTimeout(() => void capture(), RECAPTURE_DEBOUNCE_MS);
      })
      .catch((reason: unknown) => onToast(reason instanceof Error ? reason.message : '操作失败'));
  };

  const go = (): void => {
    const target = normalizeUrl(draftUrl);
    if (target === undefined) {
      onToast('请输入完整网址，例如 example.com');
      return;
    }
    relay({ type: 'browser/navigate', url: target }, '正在打开');
  };

  return (
    <>
      <ScreenHeading title="Host 浏览器" subtitle={title ?? (url.length > 0 ? url : '与 Agent 共用同一个浏览器')} />
      {agentOwns ? <p className="browser-lock">Agent 正在操作这个浏览器，你可以看，暂时不能控制。</p> : null}
      <form
        className="browser-bar"
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
      >
        <IconButton name="chevl" label="后退" onClick={() => relay({ type: 'browser/back' }, '已后退')} />
        <input
          aria-label="网址"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={url.length > 0 ? url : '输入网址'}
          value={draftUrl}
          disabled={agentOwns}
          onChange={(event) => setDraftUrl(event.target.value)}
        />
        <IconButton name="refresh" label="重新加载" onClick={() => relay({ type: 'browser/reload' }, '已重新加载')} />
      </form>
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      <div className="browser-shot" style={{ aspectRatio: `${snapshot?.width ?? 16} / ${snapshot?.height ?? 10}` }}>
        {snapshot !== undefined ? <img src={snapshot.src} alt={title ?? '浏览器截图'} /> : <span>{busy ? '正在截图…' : '还没有画面'}</span>}
      </div>
      <FullButton variant="secondary" onClick={() => void capture()} disabled={busy}>
        {busy ? '正在截图…' : '刷新画面'}
      </FullButton>
      <p className="quote-note">画面是 Host 浏览器的快照，点选网页元素在桌面端进行。</p>
    </>
  );
}

export function normalizeUrl(raw: string): string | undefined {
  const value = raw.trim();
  if (value.length === 0) return undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(value)) return `http://${value}`;
  return /^[^\s/]+\.[^\s/]+/.test(value) ? `https://${value}` : undefined;
}
