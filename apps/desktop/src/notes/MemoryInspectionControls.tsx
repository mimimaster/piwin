import { useEffect, useState, type ReactElement } from 'react';
import { Button, Card } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import { requestWebviewInspection, type WebviewInspectionStatus } from '../platform/webview-inspection.js';
import { MemoryDiagNote } from './memory-diagnostics-parts.js';

export function MemoryInspectionControls({ locale }: { locale: DesktopLocale }): ReactElement | null {
  const [status, setStatus] = useState<WebviewInspectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const chinese = locale === 'zh-CN';
  useEffect(() => {
    let live = true;
    void requestWebviewInspection().then((value) => {
      if (live) setStatus(value);
    }).catch((error: unknown) => {
      console.warn('[memory-inspection] status query failed:', error);
      if (live) setFailed(true);
    });
    return () => { live = false; };
  }, []);

  const toggle = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setStatus(await requestWebviewInspection(status === null ? undefined : !status.enabled));
    } catch (error) {
      console.warn('[memory-inspection] toggle failed:', error);
      setStatus(null);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (status?.supported === false || (status === null && !failed)) return null;
  return (
    <Card className="memory-diag-section" testId="memory-diag-inspection" padding="sm" radius="lg">
      <div className="memory-diag-card-head">
        <h3>{chinese ? '进一步排查' : 'Investigate further'}</h3>
      </div>
      <Button variant="secondary" size="compact" disabled={busy} onClick={() => { void toggle(); }}>
        {busy ? (chinese ? '处理中…' : 'Working…')
          : failed && status === null ? (chinese ? '重新连接检查工具' : 'Retry connection')
          : status?.enabled ? (chinese ? '关闭页面检查' : 'Disable page inspection')
          : (chinese ? '启用页面检查' : 'Enable page inspection')}
      </Button>
      <MemoryDiagNote>
        {status?.enabled
          ? chinese ? '已启用。在 Safari 的「开发」菜单中选择 piwin 主窗口，即可查看页面内存、对象和图层。用完可在这里关闭。'
            : 'Enabled. Choose the piwin main window in Safari’s Develop menu to inspect memory, objects and layers. Disable it here when finished.'
          : chinese ? '用系统自带的 Safari 检查当前页面，无需重载，不会结束正在运行的任务。'
            : 'Inspect the current page with Safari. No reload or interruption of running tasks is required.'}
      </MemoryDiagNote>
      {failed ? (
        <MemoryDiagNote muted={false} testId="memory-diag-inspection-error">
          {chinese ? '连接检查工具失败，请重试。' : 'Could not connect to inspection tools. Please retry.'}
        </MemoryDiagNote>
      ) : null}
    </Card>
  );
}
