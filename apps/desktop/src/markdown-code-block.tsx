import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '@piwin/ui-kit';
import { CollapsibleContentBlock } from './collapsible-content-block.js';
import { computeDiffLineNumbers } from './diff-line-numbers.js';
import { parseUnifiedDiff } from './diff-view.js';
import { downloadTextFile } from './artifact-source-export.js';
import { normalizeLanguage, TokenSpans, useHighlight, type TokenLine } from './syntax-highlight.js';

const SHELL_LANGUAGES = new Set([
  'bash',
  'sh',
  'zsh',
  'shell',
  'console',
  'terminal',
  'cmd',
  'powershell',
]);
const CODE_FENCE_COLLAPSED_HEIGHT_PX = 200;
const CODE_FENCE_PREVIEW_LINES = 8;

export function isShellLanguage(language?: string): boolean {
  return language ? SHELL_LANGUAGES.has(language.trim().toLowerCase()) : false;
}

function CodeLinesRenderer({
  lines,
  source,
  language,
  isDiff,
  highlightEnabled,
}: {
  lines: string[];
  source: string;
  language: string;
  isDiff: boolean;
  highlightEnabled: boolean;
}): ReactElement {
  const normalizedLanguage = normalizeLanguage(language);
  const tokenLines = useHighlight(source, normalizedLanguage, highlightEnabled);
  const diffLineNumbers = useMemo(() => {
    if (!isDiff) return null;
    return computeDiffLineNumbers(parseUnifiedDiff(source));
  }, [isDiff, source]);

  return (
    <pre className={`md-code${isDiff ? ' md-code-diff' : ''}`}>
      <div
        className="md-code-content"
        data-language={language || undefined}
        data-syntax-highlight={highlightEnabled ? 'enabled' : 'deferred'}
      >
        {lines.map((line, index) => {
          const tokens: TokenLine | null = tokenLines?.[index] ?? null;
          let lineClass = 'md-code-line';
          if (isDiff) {
            const marker = line.charAt(0);
            if (marker === '+') lineClass += ' diff-line-add';
            else if (marker === '-') lineClass += ' diff-line-delete';
            else lineClass += ' diff-line-context';
          }

          let gutter: ReactNode;
          if (diffLineNumbers) {
            const numbers = diffLineNumbers[index];
            gutter = (
              <>
                <span className="md-code-line-num md-code-line-num-old" aria-hidden>
                  {numbers?.old ?? ''}
                </span>
                <span className="md-code-line-num md-code-line-num-new" aria-hidden>
                  {numbers?.new ?? ''}
                </span>
              </>
            );
          } else {
            gutter = (
              <span className="md-code-line-num" aria-hidden>
                {index + 1}
              </span>
            );
          }

          return (
            <div key={index} className={lineClass}>
              {gutter}
              <span className="md-code-line-text">
                {tokens ? <TokenSpans tokens={tokens} /> : line}
              </span>
            </div>
          );
        })}
      </div>
    </pre>
  );
}

function CodeBodyWithLineNumbers({
  source,
  language,
  defaultCollapsed = true,
  highlightEnabled = true,
}: {
  source: string;
  language: string;
  /** When false (e.g. streaming), keep expanded so new lines stay visible. */
  defaultCollapsed?: boolean;
  /** Streaming blocks stay plain until completion to avoid retaining token trees per delta. */
  highlightEnabled?: boolean;
}): ReactElement {
  const normalizedLanguage = normalizeLanguage(language);
  const isDiff = normalizedLanguage === 'diff';
  const lines = useMemo(() => source.split('\n'), [source]);
  const isTall = lines.length > 12;
  const previewLines = useMemo(
    () => (isTall ? lines.slice(0, CODE_FENCE_PREVIEW_LINES) : lines),
    [isTall, lines],
  );
  const previewSource = useMemo(
    () => (isTall ? previewLines.join('\n') : source),
    [isTall, previewLines, source],
  );

  return (
    <CollapsibleContentBlock
      maxCollapsedHeight={CODE_FENCE_COLLAPSED_HEIGHT_PX}
      defaultCollapsed={defaultCollapsed}
      expandable={isTall}
      className="md-code-collapsible"
      renderCollapsed={() => (
        <CodeLinesRenderer
          lines={previewLines}
          source={previewSource}
          language={language}
          isDiff={isDiff}
          highlightEnabled={highlightEnabled}
        />
      )}
      renderExpanded={() => (
        <CodeLinesRenderer
          lines={lines}
          source={source}
          language={language}
          isDiff={isDiff}
          highlightEnabled={highlightEnabled}
        />
      )}
    >
      <CodeLinesRenderer
        lines={lines}
        source={source}
        language={language}
        isDiff={isDiff}
        highlightEnabled={highlightEnabled}
      />
    </CollapsibleContentBlock>
  );
}

export function SourceCodeBlock(props: {
  language: string;
  source: string;
  isShell: boolean;
  streaming?: boolean;
  defaultCollapsed?: boolean;
  previewAction?: ReactElement;
  blockedReason?: string;
  incompatible?: boolean;
}): ReactElement {
  return (
    <div
      className="md-code-block"
      data-is-shell={props.isShell ? 'true' : undefined}
      data-testid={props.streaming ? 'code-fence-streaming' : 'code-fence-source'}
    >
      <div className="md-code-header">
        <div className="md-code-header-title">
          {props.isShell ? (
            <span className="md-code-shell-icon" aria-hidden="true">
              $
            </span>
          ) : null}
          <span className="md-code-lang muted">
            {props.language || (props.isShell ? 'bash' : 'code')}
          </span>
        </div>
        {props.previewAction || props.source.length > 0 ? (
          <div className="md-code-header-actions">
            {props.source.length > 0 ? (
              <DownloadCodeButton language={props.language} source={props.source} />
            ) : null}
            {!props.streaming ? <CopyCodeButton text={props.source} /> : null}
            {props.previewAction}
          </div>
        ) : null}
      </div>
      <CodeBodyWithLineNumbers
        source={props.source}
        language={props.language}
        highlightEnabled={!props.streaming}
        {...(props.streaming
          ? { defaultCollapsed: false }
          : props.defaultCollapsed !== undefined
            ? { defaultCollapsed: props.defaultCollapsed }
            : {})}
      />
      {props.blockedReason ? (
        <div className="artifact-blocked muted" data-testid="artifact-blocked" role="status">
          Artifact blocked{`: ${props.blockedReason}`}
        </div>
      ) : null}
      {props.incompatible ? (
        <p className="artifact-inline-incompatible" data-testid="artifact-inline-incompatible">
          Full-page or viewport-sized HTML cannot use Inline sizing. Preview it in Canvas.
        </p>
      ) : null}
    </div>
  );
}

function codeExportExtension(language: string): string {
  const token = language.trim().toLowerCase();
  if (token === 'artifact-html' || token === 'html' || token === 'htm') return 'html';
  if (token === 'svg') return 'svg';
  if (/^[a-z0-9]+$/.test(token)) return token;
  return 'txt';
}

function codeExportMimeType(extension: string): string {
  if (extension === 'html') return 'text/html;charset=utf-8';
  if (extension === 'svg') return 'image/svg+xml;charset=utf-8';
  if (extension === 'json') return 'application/json;charset=utf-8';
  if (extension === 'css') return 'text/css;charset=utf-8';
  return 'text/plain;charset=utf-8';
}

/** Save original model source. Never srcdoc or theme-repaired renderSource. */
function DownloadCodeButton(props: { language: string; source: string }): ReactElement {
  return (
    <Button
      variant="ghost"
      size="compact"
      data-testid="code-download-button"
      onClick={() => {
        const extension = codeExportExtension(props.language);
        downloadTextFile({
          text: props.source,
          fileName: `code.${extension}`,
          mimeType: codeExportMimeType(extension),
        });
      }}
    >
      Download
    </Button>
  );
}

/** Copy original model source. Never srcdoc or theme-repaired renderSource. */
function CopyCodeButton(props: { text: string }): ReactElement {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Button
      variant="ghost"
      size="compact"
      data-testid="code-copy-button"
      onClick={() => {
        void (async () => {
          try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(props.text);
            setStatus('copied');
            window.setTimeout(() => setStatus('idle'), 1_500);
          } catch {
            setStatus('failed');
            window.setTimeout(() => setStatus('idle'), 2_000);
          }
        })();
      }}
    >
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}
    </Button>
  );
}
