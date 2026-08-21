import { useEffect, useState, type ReactElement } from 'react';
import type { HostCommand, HostResponse, PermissionRulesFile } from '@piwin/contracts';
import { Button, Notice } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

function emptyRules(): PermissionRulesFile {
  return { version: 1 };
}

export function PermissionRulesEditor(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { hostClient } = useSettings();
  const canEdit = hostClient?.supportsCommand?.('permissions/get-rules') !== false;
  const [draft, setDraft] = useState('{\n  "version": 1\n}\n');
  const [revision, setRevision] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canEdit || hostClient?.request === undefined) {
      return;
    }
    const request = hostClient.request;
    void request({ type: 'permissions/get-rules', layer: 'user' }).then((response) => {
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as { rules?: PermissionRulesFile; revision?: string };
      setDraft(`${JSON.stringify(data.rules ?? emptyRules(), null, 2)}\n`);
      setRevision(data.revision);
      setError(null);
    });
  }, [canEdit, hostClient]);

  if (!canEdit) {
    return null;
  }

  async function handleSave(): Promise<void> {
    const request = hostClient?.request;
    if (request === undefined) {
      return;
    }
    let rules: PermissionRulesFile;
    try {
      rules = JSON.parse(draft) as PermissionRulesFile;
    } catch {
      setError(isChinese ? '规则不是合法 JSON。' : 'Rules must be valid JSON.');
      return;
    }
    if (rules.version !== 1) {
      setError(isChinese ? 'version 必须是 1。' : 'version must be 1.');
      return;
    }
    setSaving(true);
    setError(null);
    const command: HostCommand = {
      type: 'permissions/set-rules',
      layer: 'user',
      rules,
      ...(revision === undefined ? {} : { expectedRevision: revision }),
    };
    const response: HostResponse = await request(command);
    setSaving(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { rules?: PermissionRulesFile; revision?: string };
    setDraft(`${JSON.stringify(data.rules ?? rules, null, 2)}\n`);
    setRevision(data.revision);
  }

  return (
    <div className="settings-section settings-section-card" data-testid="settings-permission-rules">
      <PageTitle
        title={isChinese ? '全局规则' : 'Global rules'}
        description={
          isChinese
            ? '文件在 Host 上。这里改完会发命令让 Host 自己写入。'
            : 'The file lives on the Host. Saving sends a command so the Host writes it.'
        }
      />
      <textarea
        className="mcp-raw-editor"
        data-testid="settings-permission-rules-draft"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        rows={12}
        spellCheck={false}
        disabled={saving}
      />
      <div style={{ marginTop: 12 }}>
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || hostClient?.request === undefined}
        >
          {isChinese ? '保存到 Host' : 'Save to Host'}
        </Button>
      </div>
      {error ? (
        <Notice tone="error" testId="settings-permission-rules-error">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
