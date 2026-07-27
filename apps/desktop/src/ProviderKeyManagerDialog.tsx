import { useEffect, useState, type ReactElement } from 'react';
import { Button, Dialog, IconButton } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { IconClose } from './shell-icons';

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
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoadError(null);
    setRevealedIds(new Set());
    setStatusById({});
    setLoading(true);
    void loadSecret(providerId)
      .then((raw) => {
        if (cancelled) {
          return;
        }
        const lines = (raw ?? '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        if (lines.length === 0) {
          setEntries([createEmptyEntry()]);
          return;
        }
        const next = lines.map((value, index) => ({
          id: `stored-${index}-${Date.now().toString(36)}`,
          value,
        }));
        setEntries(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setEntries([createEmptyEntry()]);
          const message = error instanceof Error ? error.message : String(error);
          setLoadError(
            message === 'Unhandled command'
              ? isChinese
                ? '密钥服务暂未就绪。请重启桌面 Host 后重试。'
                : 'The key service is not ready. Restart Desktop Host and try again.'
              : message,
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, providerId, loadSecret, isChinese]);

  function updateEntry(entryId: string, value: string): void {
    setEntries((current) =>
      current.map((entry) => (entry.id === entryId ? { ...entry, value } : entry)),
    );
  }

  function removeEntry(entryId: string): void {
    setEntries((current) => {
      const next = current.filter((entry) => entry.id !== entryId);
      return next.length > 0 ? next : [createEmptyEntry()];
    });
  }

  async function handleTest(entry: ManagedKeyEntry): Promise<void> {
    const key = entry.value.trim();
    if (!key) {
      setStatusById((current) => ({
        ...current,
        [entry.id]: isChinese ? '请先填写密钥' : 'Enter a key first',
      }));
      return;
    }
    setStatusById((current) => ({
      ...current,
      [entry.id]: isChinese ? '检测中…' : 'Testing…',
    }));
    const result = await testKey(key);
    setStatusById((current) => ({
      ...current,
      [entry.id]: result.message,
    }));
  }

  async function handleSave(): Promise<void> {
    const keys = entries.map((entry) => entry.value.trim()).filter((value) => value.length > 0);
    setBusy(true);
    try {
      const payload = keys.join('\n');
      if (!payload) {
        // Clear keychain by writing empty is rejected — store a single empty via delete semantics:
        // write a space-only is bad; use empty string rejection — leave keys empty means clear ref outside.
        onSaved('');
        onOpenChange(false);
        return;
      }
      const apiKeyRef = await saveSecret(providerId, payload);
      onSaved(apiKeyRef);
      onOpenChange(false);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      label={copy.keyManagerTitle(providerName)}
      open={open}
      onOpenChange={onOpenChange}
      testId="provider-key-manager"
      closeOnInteractOutside
    >
      <div className="cherry-dialog cherry-dialog--keys">
        <header className="cherry-dialog-header">
          <h3>{copy.keyManagerTitle(providerName)}</h3>
          <IconButton label={common.close} onClick={() => onOpenChange(false)}>
            <IconClose width={16} height={16} />
          </IconButton>
        </header>
        <div className="cherry-dialog-body">
          <p className="cherry-key-description">{copy.keyManagerHint}</p>
          {loadError ? <p className="cherry-inline-error">{loadError}</p> : null}
          <ul className="cherry-key-list" aria-busy={loading}>
            {entries.map((entry) => {
              const revealed = revealedIds.has(entry.id);
              return (
                <li key={entry.id} className="cherry-key-row">
                  <input
                    className="cherry-secret-input"
                    type={revealed ? 'text' : 'password'}
                    value={entry.value}
                    onChange={(event) => updateEntry(entry.id, event.target.value)}
                    placeholder={copy.apiKeyPlaceholder}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={loading || busy}
                    data-testid="key-manager-input"
                  />
                  <div className="cherry-key-actions">
                    <Button
                      size="compact"
                      onClick={() => void handleTest(entry)}
                      disabled={loading || busy || !entry.value.trim()}
                      data-testid="key-manager-test"
                    >
                      {copy.detect}
                    </Button>
                    <Button
                      size="compact"
                      aria-label={isChinese ? '显示或隐藏密钥' : 'Show or hide API key'}
                      onClick={() => {
                        setRevealedIds((current) => {
                          const next = new Set(current);
                          if (next.has(entry.id)) {
                            next.delete(entry.id);
                          } else {
                            next.add(entry.id);
                          }
                          return next;
                        });
                      }}
                      disabled={loading || busy || !entry.value.trim()}
                    >
                      {revealed ? (isChinese ? '隐藏' : 'Hide') : isChinese ? '显示' : 'Show'}
                    </Button>
                    <IconButton
                      label={common.remove}
                      onClick={() => removeEntry(entry.id)}
                      disabled={loading || busy}
                    >
                      <IconClose width={14} height={14} />
                    </IconButton>
                  </div>
                  {statusById[entry.id] ? (
                    <p className="cherry-key-status">{statusById[entry.id]}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Button
            size="compact"
            className="cherry-key-add"
            onClick={() => {
              const entry = createEmptyEntry();
              setEntries((current) => [...current, entry]);
            }}
            disabled={loading || busy}
            data-testid="key-manager-add"
          >
            + {copy.keyManagerAdd}
          </Button>
        </div>
        <footer className="cherry-dialog-footer">
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            {common.cancel}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={busy}
            data-testid="key-manager-save"
          >
            {busy ? common.saving : common.save}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
