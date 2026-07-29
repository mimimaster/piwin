/**
 * Settings → General: list/revoke project-remembered tool permissions.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { HostResponse, RememberedPermission } from '@piwin/contracts';
import { Button, Collapse, Notice, EmptyState, Spinner } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

export type RememberedPermissionsSectionProps = {
  projectPath: string | null;
  expanded?: boolean;
  onToggle?: () => void;
  request: (command: {
    type: 'project/permissions-list' | 'project/permissions-revoke';
    path: string;
    key?: string;
  }) => Promise<HostResponse>;
};

export function RememberedPermissionsSection(
  props: RememberedPermissionsSectionProps,
): ReactElement {
  const { locale, translator } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const common = translator.common;
  const [permissions, setPermissions] = useState<RememberedPermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!props.projectPath) {
      setPermissions([]);
      return;
    }
    setLoading(true);
    setError(null);
    const response = await props.request({
      type: 'project/permissions-list',
      path: props.projectPath,
    });
    setLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { permissions?: RememberedPermission[] };
    setPermissions(data.permissions ?? []);
  }, [props]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRevoke(key: string): Promise<void> {
    if (!props.projectPath) return;
    setBusyKey(key);
    setError(null);
    setInfo(null);
    const response = await props.request({
      type: 'project/permissions-revoke',
      path: props.projectPath,
      key,
    });
    setBusyKey(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { permissions?: RememberedPermission[] };
    setPermissions(data.permissions ?? []);
    setInfo(
      isChinese
        ? '已撤销 — 下次匹配的工具调用将再次询问。'
        : 'Revoked — the next matching tool call will ask again.',
    );
  }

  return (
    <div className="settings-section" data-testid="remembered-permissions">
      <button
        type="button"
        className="settings-collapsible-trigger"
        onClick={() => props.onToggle?.()}
        aria-expanded={props.expanded !== false}
        data-testid="remembered-permissions-toggle"
      >
        <div className="settings-card-heading" style={{ marginBottom: 0 }}>
          <div>
            <h4>{isChinese ? '已记住的工具权限' : 'Remembered tool permissions'}</h4>
            <p>
              {isChinese
                ? '项目范围的允许决策（Web 主机、bash 命令、文件写入路径）。撤销后下次使用会再次询问。'
                : 'Project-scoped allow decisions (web hosts, bash commands, file-write paths). Revoking asks again on the next use.'}
            </p>
          </div>
        </div>
        <svg
          className={`settings-collapsible-chevron ${props.expanded !== false ? 'open' : ''}`}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <Collapse expanded={props.expanded !== false} testId="remembered-permissions-collapse">
        {!props.projectPath ? (
          <EmptyState
            title={isChinese ? '未打开工作区' : 'No workspace open'}
            description={
              isChinese
                ? '打开并信任项目后，可管理已记住的工具权限。'
                : 'Open and trust a project to manage remembered tool permissions.'
            }
            testId="remembered-permissions-no-project"
          />
        ) : loading ? (
          <div className="panel-loading" data-testid="remembered-permissions-loading">
            <Spinner label={isChinese ? '正在加载已记住权限' : 'Loading remembered permissions'} />
            <span className="muted">{common.loading}</span>
          </div>
        ) : permissions.length === 0 ? (
          <EmptyState
            title={isChinese ? '暂无已记住权限' : 'No remembered permissions'}
            description={
              isChinese
                ? '在权限对话框中选择「对本项目允许」后，会出现在这里。'
                : 'Choose “Allow for this project” in a permission dialog to see it here.'
            }
            testId="remembered-permissions-empty"
          />
        ) : (
          <ul className="ext-list" data-testid="remembered-permissions-list">
            {permissions.map((permission) => (
              <li
                key={permission.key}
                className="ext-list-item"
                data-testid="remembered-permission-row"
                data-permission-key={permission.key}
              >
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{permission.action}</strong>
                    <span className="pill muted">{permission.key}</span>
                  </div>
                  <div className="muted ext-desc">{permission.detail}</div>
                </div>
                <Button
                  data-testid="remembered-permission-revoke"
                  disabled={busyKey === permission.key}
                  onClick={() => void handleRevoke(permission.key)}
                >
                  {isChinese ? '撤销' : 'Revoke'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}
      </Collapse>
    </div>
  );
}
