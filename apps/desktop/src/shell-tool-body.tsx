/**
 * Expanded body for shell tool calls (bash / zsh / process-with-command) —
 * Inkstone 墨线 (docs/design/inkstone/proto-12-shell.html, direction A).
 *
 * No container: the command and its output hang off the tool row like a
 * thinking note.
 *  - command: lamp `$` (the agent's hand) + highlighted source; a heredoc body
 *    hangs off a dotted hairline in its interpreter's language
 *  - output: a 1.5px hairline gutter; error lines get a crimson tick on that
 *    hairline (朱批) instead of dyeing the whole block; tail-anchored
 *  - foot: only what the node can't say — failure / running, a confirmed
 *    empty output, truncation. Success needs no stamp (the node is pine).
 * Historical rows arrive with output slimmed to ''; the body asks the Host
 * for it on expand (tool-output-reader) and never guesses "no output".
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import type { ToolErrorView, ToolOutputTruncation } from '@piwin/contracts';
import { TokenSpans, languageFromPath, useHighlight } from './syntax-highlight';
import { useLazyToolOutput } from './tool-output-reader.js';
import type { ToolCallDensity } from './ui-preferences';

export type ShellToolBodyProps = {
  toolCallId: string;
  command: string;
  output: string | undefined;
  status: 'running' | 'done' | 'error';
  exitCode: number | null | undefined;
  error: ToolErrorView | undefined;
  truncation: ToolOutputTruncation | undefined;
  /** Fallback copy when the host did not report a line range. */
  truncationNotice: string | undefined;
  density: ToolCallDensity;
  locale: 'zh-CN' | 'en';
};

/** Commands longer than this fold to the first COMMAND_PREVIEW_LINES lines. */
const COMMAND_FOLD_LINES = 24;
const COMMAND_PREVIEW_LINES = 16;

export type ShellCommandSegment =
  | { kind: 'shell'; text: string }
  | { kind: 'heredoc'; text: string; lang: string; delimiter: string };

const HEREDOC_OPEN = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/;

const INTERPRETER_LANG: ReadonlyArray<[RegExp, string]> = [
  [/\bpython[0-9.]*\b/, 'python'],
  [/\b(node|deno|bun)\b/, 'javascript'],
  [/\bruby\b/, 'ruby'],
  [/\bperl\b/, 'perl'],
  [/\b(psql|sqlite3|mysql)\b/, 'sql'],
  [/\b(bash|sh|zsh)\b/, 'bash'],
];

function heredocLanguage(openerLine: string): string {
  const redirect = openerLine.match(/(?:>{1,2}|\btee\s+(?:-a\s+)?)\s*(['"]?)([^\s'"|;&<>]+)\1/);
  if (redirect?.[2]) {
    const fromPath = languageFromPath(redirect[2]);
    if (fromPath && fromPath !== 'text') {
      return fromPath;
    }
  }
  for (const [pattern, lang] of INTERPRETER_LANG) {
    if (pattern.test(openerLine)) {
      return lang;
    }
  }
  return 'text';
}

/**
 * Split a command into shell text and heredoc bodies so each can be
 * highlighted in its own language. Unterminated heredocs run to the end.
 */
export function splitShellCommand(command: string): ShellCommandSegment[] {
  const lines = command.split('\n');
  const segments: ShellCommandSegment[] = [];
  let shell: string[] = [];
  let index = 0;
  const flushShell = (): void => {
    if (shell.length > 0) {
      segments.push({ kind: 'shell', text: shell.join('\n') });
      shell = [];
    }
  };
  while (index < lines.length) {
    const line = lines[index] ?? '';
    shell.push(line);
    index += 1;
    const open = line.match(HEREDOC_OPEN);
    if (!open?.[3]) {
      continue;
    }
    const delimiter = open[3];
    const allowTabs = open[1] === '-';
    const body: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] ?? '';
      const bare = allowTabs ? candidate.replace(/^\t+/, '') : candidate;
      if (bare.trimEnd() === delimiter) {
        break;
      }
      body.push(candidate);
      index += 1;
    }
    flushShell();
    segments.push({ kind: 'heredoc', text: body.join('\n'), lang: heredocLanguage(line), delimiter });
  }
  flushShell();
  return segments;
}

export type ShellOutputTone = 'ok' | 'err' | 'warn';

const ERR_LINE =
  /^\s*(?:FAIL\b|ERROR\b|ERR!|npm ERR!|fatal:|error(?:\[[^\]]*\])?:|[A-Za-z]*Error\b:?|Traceback\b|panic:|[×✗✖❌])/;
const OK_LINE = /^\s*(?:[✓✔✅]|PASS\b|ok\b\s)/;
const WARN_LINE = /^\s*(?:warn(?:ing)?\b:?|WARN\b|⚠)/i;

/** Tint only lines that carry a marker; everything else stays neutral ink. */
export function classifyShellOutputLine(line: string): ShellOutputTone | null {
  if (ERR_LINE.test(line)) return 'err';
  if (OK_LINE.test(line)) return 'ok';
  if (WARN_LINE.test(line)) return 'warn';
  return null;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export type ShellCommandShape = {
  /** Total command lines, heredoc bodies included. */
  lines: number;
  /** Language of the first heredoc body, when it has a known one. */
  heredocLang?: string;
};

/** Collapsed-row hint: `python · 17 行` for a heredoc, `+N 行` otherwise. */
export function describeShellCommand(command: string): ShellCommandShape {
  const heredoc = splitShellCommand(command).find(
    (segment): segment is Extract<ShellCommandSegment, { kind: 'heredoc' }> =>
      segment.kind === 'heredoc' && segment.lang !== 'text',
  );
  return {
    lines: command.split('\n').length,
    ...(heredoc ? { heredocLang: heredoc.lang } : {}),
  };
}

export type ShellStampTone = 'ok' | 'fail' | 'run' | 'idle';

export function resolveShellStamp(input: {
  status: 'running' | 'done' | 'error';
  exitCode: number | null | undefined;
  errorCategory: ToolErrorView['category'] | undefined;
  locale: 'zh-CN' | 'en';
}): { tone: ShellStampTone; label: string } {
  const zh = input.locale === 'zh-CN';
  if (input.status === 'running') {
    return { tone: 'run', label: zh ? '运行中' : 'Running' };
  }
  if (typeof input.exitCode === 'number') {
    return { tone: input.exitCode === 0 ? 'ok' : 'fail', label: `exit ${input.exitCode}` };
  }
  if (input.status === 'error') {
    const category = input.errorCategory;
    const label =
      category === 'timeout'
        ? zh ? '超时' : 'Timed out'
        : category === 'cancelled'
          ? zh ? '已取消' : 'Cancelled'
          : category === 'permission'
            ? zh ? '未获准' : 'Denied'
            : zh ? '失败' : 'Failed';
    return { tone: 'fail', label };
  }
  return { tone: 'idle', label: zh ? '完成' : 'Done' };
}

function formatTruncation(props: ShellToolBodyProps): string | undefined {
  const truncation = props.truncation;
  const zh = props.locale === 'zh-CN';
  const shown = truncation?.shownLines;
  if (shown && truncation?.totalLines !== undefined) {
    return zh
      ? `仅显示 L${shown.start}–L${shown.end} / 共 ${truncation.totalLines} 行`
      : `Showing L${shown.start}–L${shown.end} of ${truncation.totalLines}`;
  }
  return props.truncationNotice;
}

function CopyLink(props: { text: string; label: string; copiedLabel: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={`shell-trail-link${copied ? ' is-copied' : ''}`}
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard
          ?.writeText(props.text)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      {copied ? props.copiedLabel : props.label}
    </button>
  );
}

function HighlightedLines(props: {
  source: string;
  lang: string;
  /** Shell lines keep the prompt column; only a command's first line shows `$`. */
  prompt: 'first' | 'blank' | 'none';
}): ReactElement {
  const tokenLines = useHighlight(props.source, props.lang, props.lang !== 'text');
  const plain = props.source.split('\n');
  return (
    <>
      {plain.map((text, index) => {
        const tokens = tokenLines?.[index];
        return (
          <span key={index} className="shell-line">
            {props.prompt !== 'none' ? (
              <span className="shell-prompt" aria-hidden="true">
                {props.prompt === 'first' && index === 0 ? '$' : ''}
              </span>
            ) : null}
            <span className="shell-line-text">
              {tokens ? <TokenSpans tokens={tokens} /> : text || ' '}
            </span>
            {'\n'}
          </span>
        );
      })}
    </>
  );
}

function ShellCommand(props: { command: string; locale: 'zh-CN' | 'en' }): ReactElement {
  const zh = props.locale === 'zh-CN';
  const lineCount = props.command.split('\n').length;
  const foldable = lineCount > COMMAND_FOLD_LINES;
  const [folded, setFolded] = useState(foldable);
  const visible = folded
    ? props.command.split('\n').slice(0, COMMAND_PREVIEW_LINES).join('\n')
    : props.command;
  const segments = splitShellCommand(visible);
  let firstShell = true;
  return (
    <div
      className={`shell-trail-cmd${folded ? ' is-folded' : ''}`}
      data-testid="tool-call-command"
    >
      <code className="shell-trail-code">
        {segments.map((segment, index) => {
          if (segment.kind === 'heredoc') {
            return (
              <span
                key={index}
                className="shell-heredoc"
                data-lang={segment.lang === 'text' ? undefined : segment.lang}
              >
                <HighlightedLines source={segment.text} lang={segment.lang} prompt="none" />
              </span>
            );
          }
          const withPrompt = firstShell;
          firstShell = false;
          return (
            <span key={index} className="shell-segment">
              <HighlightedLines
                source={segment.text}
                lang="bash"
                prompt={withPrompt ? 'first' : 'blank'}
              />
            </span>
          );
        })}
      </code>
      {foldable ? (
        <button
          type="button"
          className="shell-trail-link shell-trail-more"
          aria-expanded={!folded}
          onClick={(event) => {
            event.stopPropagation();
            setFolded((value) => !value);
          }}
        >
          {folded
            ? zh
              ? `展开全部 · 共 ${lineCount} 行`
              : `Show all ${lineCount} lines`
            : zh
              ? '收起'
              : 'Show less'}
        </button>
      ) : null}
    </div>
  );
}

function ShellOutput(props: {
  text: string;
  running: boolean;
  maxChars: number;
  locale: 'zh-CN' | 'en';
}): ReactElement {
  const ref = useRef<HTMLPreElement>(null);
  // Terminals read from the bottom: keep the tail, drop the head.
  const clipped = props.text.length > props.maxChars;
  const shown = clipped ? props.text.slice(props.text.length - props.maxChars) : props.text;
  const lines = shown.replace(/\n$/, '').split('\n');
  if (clipped) {
    lines.shift();
  }
  const zh = props.locale === 'zh-CN';

  useLayoutEffect(() => {
    const node = ref.current;
    if (node && props.running) {
      node.scrollTop = node.scrollHeight;
    }
  }, [props.text, props.running]);

  // Lines are blocks (the crimson tick hangs off each one), so no '\n' joins.
  return (
    <pre ref={ref} className="tool-call-output shell-trail-out">
      {clipped ? (
        <span className="shell-out-line is-elided">
          {zh ? '… 前面的输出已省略' : '… earlier output omitted'}
        </span>
      ) : null}
      {props.text.length > 0
        ? lines.map((line, index) => (
            <span
              key={index}
              className="shell-out-line"
              data-tone={classifyShellOutputLine(line) ?? undefined}
            >
              {line || ' '}
            </span>
          ))
        : null}
      {props.running ? (
        <span className="shell-out-line">
          <span className="shell-caret" aria-hidden="true" />
        </span>
      ) : null}
    </pre>
  );
}

export function ShellToolBody(props: ShellToolBodyProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const running = props.status === 'running';
  const inlineOutput = (props.output ?? '').replace(ANSI_PATTERN, '');
  const hasInlineOutput = inlineOutput.trim().length > 0;
  // Empty inline output is ambiguous (slimmed history vs. a silent command):
  // ask the Host once the row is open.
  const lazy = useLazyToolOutput(props.toolCallId, !running && !hasInlineOutput);
  const output =
    hasInlineOutput || lazy.status !== 'ready' ? inlineOutput : lazy.output.replace(ANSI_PATTERN, '');
  const hasOutput = output.trim().length > 0;
  const stamp = resolveShellStamp({
    status: props.status,
    exitCode: props.exitCode,
    errorCategory: props.error?.category,
    locale: props.locale,
  });
  const showStamp = stamp.tone === 'fail' || stamp.tone === 'run';
  const knownEmpty = !running && !hasOutput && lazy.status === 'empty';
  const truncation = formatTruncation(props);
  const hasFoot = showStamp || knownEmpty || Boolean(truncation);

  return (
    <div
      className={`shell-trail${running ? ' is-running' : ''}`}
      data-testid="tool-call-shell"
      data-stamp={stamp.tone}
    >
      <ShellCommand command={props.command} locale={props.locale} />
      <span className="shell-trail-acts">
        <CopyLink
          text={props.command}
          label={zh ? '复制命令' : 'Copy command'}
          copiedLabel={zh ? '已复制' : 'Copied'}
        />
        {hasOutput ? (
          <CopyLink
            text={output}
            label={zh ? '复制输出' : 'Copy output'}
            copiedLabel={zh ? '已复制' : 'Copied'}
          />
        ) : null}
      </span>
      {hasOutput || running ? (
        <ShellOutput
          text={output}
          running={running}
          maxChars={props.density === 'compact' ? 4000 : 12000}
          locale={props.locale}
        />
      ) : lazy.status === 'loading' ? (
        <pre className="tool-call-output shell-trail-out is-loading" data-testid="tool-call-shell-loading">
          <span className="shell-out-line is-elided">{zh ? '读取输出…' : 'Loading output…'}</span>
        </pre>
      ) : null}
      {props.error ? (
        <div className="tool-call-error shell-trail-error" data-testid="tool-call-error" role="status">
          {props.error.message}
        </div>
      ) : null}
      {hasFoot ? (
        <div className="shell-trail-foot">
          {showStamp ? (
            <span className="shell-stamp" data-tone={stamp.tone} data-testid="tool-call-shell-stamp">
              {stamp.label}
            </span>
          ) : null}
          {knownEmpty ? (
            <>
              {showStamp ? <span className="shell-foot-sep" aria-hidden="true">·</span> : null}
              <span data-testid="tool-call-shell-empty">{zh ? '无输出' : 'No output'}</span>
            </>
          ) : null}
          {truncation ? (
            <>
              {showStamp || knownEmpty ? (
                <span className="shell-foot-sep" aria-hidden="true">·</span>
              ) : null}
              <span className="shell-foot-trunc" data-testid="tool-call-output-notice" title={truncation}>
                {truncation}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
