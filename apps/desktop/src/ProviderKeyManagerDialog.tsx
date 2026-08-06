import { useEffect, useState, type ReactElement } from 'react';
import { Button, IconButton, Modal, Notice } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { IconClose } from './shell-icons';
import { formatError } from '@piwin/contracts';

export type ManagedKeyEntry = {
  id: string;
  value: string;
};

export type ProviderKeyManagerDialogProps = {
  open: boolean;
  providerName: string;
  providerId: string;
  /** Load current multi-line secret from host. */
  loadSecret: (providerId: string) => Promise<string | null>;
  /** Persist multi-line secret to keychain. */
  saveSecret: (providerId: string, secret: string) => Promise<string>;
  /** Test connectivity with one key. */
  testKey: (apiKey: string) => Promise<{ ok: boolean; message: string }>;
  onOpenChange: (open: boolean) => void;
  onSaved: (apiKeyRef: string) => void;
};

function createEmptyEntry(): ManagedKeyEntry {
  return { id: `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, value: '' };
}

export function ProviderKeyManagerDialog({
  open,
  providerName,
  providerId,
  loadSecret,
  saveSecret,
  testKey,
  onOpenChange,
  onSaved,
}: ProviderKeyManagerDialogProps): ReactElement {
  const { locale, translator } = useDesktopLocale();
  const copy = translator.settings.provider;
  const common = translator.common;
  const isChinese = locale === 'zh-CN';
  const [entries, setEntries] = useState<ManagedKeyEntry[]>([createEmptyEntry()]);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadError(null);
    setRevealedIds(new Set());
    setStatusById({});
    setLoading(true);
    void loadSecret(providerId)
      .then((raw) => {
        if (cancelled) return;
        const lines = (raw ?? '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        if (lines.length === 0) {
          setEntries([createEmptyEntry()]);
          return;
        }
        setEntries(lines.map((value, index) => ({ id: `stored-${index}-${Date.now().toString(36)}`, value })));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setEntries([createEmptyEntry()]);
          setLoadError(formatError(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, providerId, loadSecret]);

  function updateEntry(entryId: string, value: string): void {
    setEntries((current) => current.map((entry) => (entry.id === entryId ? { ...entry, value } : entry)));
  }

  function removeEntry(entryId: string): void {
    setEntries((current) => {
      const next = current.filter((entry) => entry.id !== entryId);
      return next.length > 0 ? next : [createEmptyEntry()];
    });
  }

  async function handleTest(entry: ManagedKeyEntry): Promise<void> {
    const key = entry.value.trim();
    if (!key) return;
    setStatusById((current) => ({ ...current, [entry.id]: isChinese ? '检测中…' : 'Testing…' }));
    const result = await testKey(key);
    setStatusById((current) => ({ ...current, [entry.id]: result.message }));
  }

  async function handleSave(): Promise<void> {
    const keys = entries.map((entry) => entry.value.trim()).filter((v) => v.length > 0);
    setBusy(true);
    try {
      const payload = keys.join('\n');
      if (!payload) {
        onSaved('');
        onOpenChange(false);
        return;
      }
      const apiKeyRef = await saveSecret(providerId, payload);
      onSaved(apiKeyRef);
      onOpenChange(false);
    } catch (error) {
      setLoadError(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={copy.keyManagerTitle(providerName)}
      open={open}
      onOpenChange={onOpenChange}
      testId="provider-key-manager"
      size="lg"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <p className="muted" style={{ fontSize: '13px', margin: 0 }}>{copy.keyManagerHint}</p>
        {loadError ? <Notice tone="error">{loadError}</Notice> : null}

        <ul className="ext-list" style={{ maxHeight: '300px', overflow: 'auto' }}>
            {entries.map((entry) => {
              const revealed = revealedIds.has(entry.id);
              return (
                <li key={entry.id} className="ext-list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px', padding: '12px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      className="mcp-raw-editor"
                      style={{ flex: 1, height: 'auto', padding: '8px 12px' }}
                      type={revealed ? 'text' : 'password'}
                      value={entry.value}
                      onChange={(e) => updateEntry(entry.id, e.target.value)}
                      placeholder={copy.apiKeyPlaceholder}
                      spellCheck={false}
                      autoComplete="off"
                      disabled={loading || busy}
                    />
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <Button
                        size="compact"
                        variant="ghost"
                        onClick={() => void handleTest(entry)}
                        disabled={loading || busy || !entry.value.trim()}
                      >
                        {copy.detect}
                      </Button>
                      <IconButton
                        label={revealed ? '隐藏' : '显示'}
                        onClick={() => {
                          setRevealedIds((cur) => {
                            const n = new Set(cur);
                            if (n.has(entry.id)) n.delete(entry.id); else n.add(entry.id);
                            return n;
                          });
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {revealed ? <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" /> : <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>}
                        </svg>
                      </IconButton>
                      <IconButton
                        label={common.remove}
                        onClick={() => removeEntry(entry.id)}
                        disabled={loading || busy}
                      >
                        <IconClose width={14} height={14} />
                      </IconButton>
                    </div>
                  </div>
                  {statusById[entry.id] && (
                    <div style={{ fontSize: '11.5px', color: 'var(--accent)', opacity: 0.8, paddingLeft: '4px' }}>
                      {statusById[entry.id]}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button
            variant="ghost"
            size="compact"
            onClick={() => setEntries((cur) => [...cur, createEmptyEntry()])}
            disabled={loading || busy}
          >
            + {isChinese ? '添加密钥' : 'Add Key'}
          </Button>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{common.cancel}</Button>
            <Button variant="primary" onClick={() => void handleSave()} disabled={loading || busy}>{common.save}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
