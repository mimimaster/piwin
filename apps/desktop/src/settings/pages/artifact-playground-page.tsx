/**
 * Settings → Artifact Playground (beta).
 *
 * Paste raw HTML/CSS/JS and instantly preview it as a sandboxed artifact
 * using the same @piwin/artifact pipeline the chat uses — no model required.
 */
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { evaluateCodeFence, type ArtifactPreviewDecision } from '@piwin/artifact';
import { Button, TextArea } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { mapThemeToArtifactVariables } from '../../artifact-theme-map';
import { ArtifactFrame } from '../../ArtifactFrame';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

const SAMPLE_HTML = `<section style="font-family: system-ui; padding: 24px;">
  <h2>Hello, Artifact!</h2>
  <p>Edit this HTML and hit "Render" to preview.</p>
  <style>
    .card {
      padding: 16px;
      border-radius: 12px;
      background: var(--piwin-artifact-surface);
      border: 1px solid var(--piwin-artifact-border);
      margin-top: 12px;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      background: var(--piwin-artifact-accent);
      color: white;
      cursor: pointer;
      font-size: 14px;
    }
    .btn:active { transform: scale(0.97); }
  </style>
  <div class="card">
    <p>Clicks: <span id="count">0</span></p>
    <button class="btn" onclick="increment()">Click me</button>
  </div>
  <script>
    let count = 0;
    function increment() {
      count++;
      document.getElementById('count').textContent = count;
    }
  </script>
</section>`;

export function ArtifactPlaygroundPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const { activeTheme } = useSettings();

  const [source, setSource] = useState<string>(SAMPLE_HTML);
  const [decision, setDecision] = useState<ArtifactPreviewDecision | null>(null);
  const [renderKey, setRenderKey] = useState<number>(0);

  const themeVariables = useMemo(() => mapThemeToArtifactVariables(activeTheme), [activeTheme]);

  const handleRender = useCallback((): void => {
    const result = evaluateCodeFence({
      language: 'artifact-html',
      source,
      id: `playground-${renderKey}`,
      theme: themeVariables,
    });
    setDecision(result);
    setRenderKey((key) => key + 1);
  }, [source, themeVariables, renderKey]);

  const handleClear = useCallback((): void => {
    setSource('');
    setDecision(null);
  }, []);

  const handleLoadSample = useCallback((): void => {
    setSource(SAMPLE_HTML);
    setDecision(null);
  }, []);

  const renderableDecision = useMemo(() => {
    if (!decision) return null;
    if (decision.kind === 'render' || decision.kind === 'blocked') {
      return decision;
    }
    return null;
  }, [decision]);

  return (
    <div className="settings-card" data-testid="settings-artifact-playground">
      <PageTitle
        title={isZh ? 'Artifact 实验场' : 'Artifact Playground'}
        description={
          isZh
            ? '粘贴 HTML/CSS/JS 代码，一键转换为沙箱化 Artifact 预览。无需模型参与，使用与聊天相同的 @piwin/artifact 管线。'
            : 'Paste HTML/CSS/JS and instantly preview it as a sandboxed artifact. Uses the same @piwin/artifact pipeline as chat — no model required.'
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={handleRender} data-testid="playground-render-button">
            {isZh ? '渲染' : 'Render'}
          </Button>
          <Button variant="ghost" onClick={handleLoadSample} data-testid="playground-sample-button">
            {isZh ? '示例' : 'Sample'}
          </Button>
          <Button variant="ghost" onClick={handleClear} data-testid="playground-clear-button">
            {isZh ? '清空' : 'Clear'}
          </Button>
          <span style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: '0.8em' }}>
            {isZh
              ? '内联 JS/CSS only · 无外部资源 · 最大 100KB'
              : 'Inline JS/CSS only · No external resources · Max 100KB'}
          </span>
        </div>

        {/* Source editor */}
        <div className="ui-field" data-testid="playground-source-field">
          <label className="ui-field-label">{isZh ? 'HTML 源代码' : 'HTML Source'}</label>
          <TextArea
            value={source}
            onChange={(value) => setSource(value)}
            rows={12}
            placeholder={isZh ? '在此粘贴 HTML 代码…' : 'Paste HTML here…'}
            testId="playground-source-textarea"
            nativeProps={{
              style: { fontFamily: 'monospace', fontSize: '0.85em', resize: 'vertical' },
              spellCheck: false,
            }}
          />
        </div>

        {/* Preview area */}
        {renderableDecision ? (
          <div data-testid="playground-preview-area">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <strong style={{ fontSize: '0.9em' }}>{isZh ? '预览' : 'Preview'}</strong>
              {renderableDecision.kind === 'blocked' ? (
                <span className="pill" style={{ fontSize: '0.75em' }}>
                  {isZh ? '已拦截' : 'blocked'}
                </span>
              ) : null}
            </div>
            <ArtifactFrame
              key={`playground-${renderKey}`}
              decision={renderableDecision}
              presentation="inline"
              initPriority={0}
            />
          </div>
        ) : decision?.kind === 'code' ? (
          <p className="muted" style={{ fontSize: '0.85em' }}>
            {isZh
              ? '无法识别为 Artifact。请确保使用 HTML 代码。'
              : 'Not recognized as an artifact. Make sure you are using HTML.'}
          </p>
        ) : (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              borderRadius: '8px',
              border: '1px dashed var(--piwin-border, rgba(128,128,128,0.3))',
              color: 'var(--piwin-muted, rgba(128,128,128,0.6))',
              fontSize: '0.85em',
            }}
            data-testid="playground-empty-state"
          >
            {isZh ? '点击 "渲染" 预览你的 HTML 代码' : 'Click "Render" to preview your HTML'}
          </div>
        )}
      </div>
    </div>
  );
}
