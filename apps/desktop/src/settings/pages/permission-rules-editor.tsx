import { useEffect, useState, type ReactElement } from 'react';
import type { HostCommand, HostResponse, PermissionRulesFile } from '@piwin/contracts';
import { Button, Notice, TextArea } from '@piwin/ui-kit';
import { IconClose } from '../../shell-icons.js';
import { useDesktopLocale } from '../../desktop-locale-context';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';
import {
  RULE_KINDS,
  RULE_TIERS,
  createEmptyRow,
  emptyRulesFile,
  fileToRows,
  rowsToFile,
  ruleNeedsPattern,
  type PermissionRuleTier,
  type VisualRuleRow,
} from './permission-rules-visual';

function kindLabel(kind: VisualRuleRow['kind'], isChinese: boolean): string {
  const labels: Record<VisualRuleRow['kind'], { zh: string; en: string }> = {
    bash: { zh: '命令', en: 'bash' },
    'file-write': { zh: '写文件', en: 'file-write' },
    'web-fetch': { zh: '抓取', en: 'web-fetch' },
    'web-search': { zh: '搜索', en: 'web-search' },
    git: { zh: 'Git', en: 'git' },
    process: { zh: '进程', en: 'process' },
    'notes-mutate': { zh: '笔记', en: 'notes' },
  };
  return isChinese ? labels[kind].zh : labels[kind].en;
}

function tierLabel(tier: PermissionRuleTier, isChinese: boolean): string {
  if (!isChinese) return tier;
  if (tier === 'deny') return '拒绝';
  if (tier === 'ask') return '询问';
  return '允许';
}

function patternPlaceholder(kind: VisualRuleRow['kind'], isChinese: boolean): string {
  switch (kind) {
    case 'bash':
    case 'git':
      return isChinese ? '命令模式' : 'command pattern';
    case 'file-write':
      return isChinese ? '路径 glob' : 'path glob';
    case 'web-fetch':
      return isChinese ? '主机 glob' : 'host glob';
    default:
      return '';
  }
}

export function PermissionRulesEditor(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { hostClient } = useSettings();
  const canEdit = hostClient?.supportsCommand?.('permissions/get-rules') !== false;
  const [rules, setRules] = useState<PermissionRulesFile>(emptyRulesFile);
  const [jsonDraft, setJsonDraft] = useState('{\n  "version": 1\n}\n');
  const [revision, setRevision] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [rowSeed, setRowSeed] = useState(0);

  const rows = fileToRows(rules);

  function applyRules(next: PermissionRulesFile): void {
    setRules(next);
    setJsonDraft(`${JSON.stringify(next, null, 2)}\n`);
  }

  useEffect(() => {
    if (!canEdit || hostClient?.request === undefined) {
      return;
    }
    void hostClient.request({ type: 'permissions/get-rules', layer: 'user' }).then((response) => {
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as { rules?: PermissionRulesFile; revision?: string };
      applyRules(data.rules ?? emptyRulesFile());
      setRevision(data.revision);
      setError(null);
    });
  }, [canEdit, hostClient]);

  if (!canEdit) {
    return null;
  }

  function updateRow(id: string, patch: Partial<VisualRuleRow>): void {
    applyRules(
      rowsToFile(rows.map((row) => (row.id === id ? { ...row, ...patch } : row))),
    );
  }

  async function handleSave(): Promise<void> {
    if (hostClient?.request === undefined) {
      return;
    }
    let next = rules;
    if (showJson) {
      try {
        next = JSON.parse(jsonDraft) as PermissionRulesFile;
      } catch {
        setError(isChinese ? '规则不是合法 JSON。' : 'Rules must be valid JSON.');
        return;
      }
      if (next.version !== 1) {
        setError(isChinese ? 'version 必须是 1。' : 'version must be 1.');
        return;
      }
      applyRules(next);
    }
    setSaving(true);
    setError(null);
    const command: HostCommand = {
      type: 'permissions/set-rules',
      layer: 'user',
      rules: next,
      ...(revision === undefined ? {} : { expectedRevision: revision }),
    };
    const response: HostResponse = await hostClient.request(command);
    setSaving(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { rules?: PermissionRulesFile; revision?: string };
    applyRules(data.rules ?? next);
    setRevision(data.revision);
  }

  return (
    <div className="settings-section settings-section-card" data-testid="settings-permission-rules">
      <PageTitle
        title={isChinese ? '全局规则' : 'Global rules'}
        description={
          isChinese
            ? '按层编辑拒绝 / 询问 / 允许。文件在 Host 上；保存后由 Host 写入。'
            : 'Edit deny / ask / allow rows. The file lives on the Host; saving asks the Host to write it.'
        }
      />
      <div data-testid="settings-permission-rules-visual">
        {RULE_TIERS.map((tier) => {
          const tierRows = rows.filter((row) => row.tier === tier);
          return (
            <div key={tier} className="rules-visual-tier-block">
              <div className="rules-visual-tier">{tierLabel(tier, isChinese)}</div>
              {tierRows.map((row) => (
                <div key={row.id} className="rules-visual-row" data-testid="settings-permission-rule-row">
                  <select
                    aria-label={isChinese ? '目标' : 'Target'}
                    value={row.kind}
                    onChange={(event) =>
                      updateRow(row.id, {
                        kind: event.currentTarget.value as VisualRuleRow['kind'],
                        pattern: '',
                      })
                    }
                    disabled={saving}
                  >
                    {RULE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kindLabel(kind, isChinese)}
                      </option>
                    ))}
                  </select>
                  {ruleNeedsPattern(row.kind) ? (
                    <input
                      aria-label={isChinese ? '模式' : 'Pattern'}
                      value={row.pattern}
                      placeholder={patternPlaceholder(row.kind, isChinese)}
                      onChange={(event) => updateRow(row.id, { pattern: event.currentTarget.value })}
                      disabled={saving}
                    />
                  ) : (
                    <span className="muted">{isChinese ? '整类' : 'all'}</span>
                  )}
                  <input
                    aria-label={isChinese ? '原因' : 'Reason'}
                    value={row.reason}
                    placeholder={isChinese ? '原因' : 'reason'}
                    onChange={(event) => updateRow(row.id, { reason: event.currentTarget.value })}
                    disabled={saving}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="compact"
                    aria-label={isChinese ? '删除规则' : 'Remove rule'}
                    onClick={() => applyRules(rowsToFile(rows.filter((item) => item.id !== row.id)))}
                    disabled={saving}
                  >
                    <IconClose />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="compact"
                data-testid={`settings-permission-rules-add-${tier}`}
                onClick={() => {
                  const nextSeed = rowSeed + 1;
                  setRowSeed(nextSeed);
                  applyRules(rowsToFile([...rows, createEmptyRow(tier, nextSeed)]));
                }}
                disabled={saving}
              >
                {isChinese ? `添加${tierLabel(tier, isChinese)}` : `Add ${tier}`}
              </Button>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || hostClient?.request === undefined}
        >
          {isChinese ? '保存到 Host' : 'Save to Host'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          data-testid="settings-permission-rules-json-toggle"
          onClick={() => setShowJson((current) => !current)}
        >
          {showJson
            ? isChinese
              ? '收起 JSON'
              : 'Hide JSON'
            : isChinese
              ? '高级：JSON'
              : 'Advanced: JSON'}
        </Button>
      </div>
      {showJson ? (
        <TextArea
          testId="settings-permission-rules-draft"
          value={jsonDraft}
          onChange={setJsonDraft}
          rows={12}
          disabled={saving}
          nativeProps={{ spellCheck: false }}
        />
      ) : null}
      {error ? (
        <Notice tone="error" testId="settings-permission-rules-error">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
