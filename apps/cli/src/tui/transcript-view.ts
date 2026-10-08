import {
  Markdown,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui';
import type {
  TranscriptEntry,
  TranscriptMessageEntry,
  TranscriptState,
  TranscriptTool,
} from './transcript-model.js';
import { markdownTheme, style } from './tui-theme.js';

const TOOL_OUTPUT_PREVIEW_LINES = 8;
const EMPTY_HINT = '输入消息开始对话，/ 查看命令，Ctrl+S 切换会话';
/** Embedded: the host application switches sessions, so the shortcut is not offered. */
const EMBEDDED_EMPTY_HINT = '输入消息开始对话，/ 查看命令';

type CachedEntry = { entry: TranscriptEntry; width: number; expanded: boolean; lines: string[] };

/**
 * Renders the transcript document. Lines are cached per entry identity, so a
 * streaming token re-renders one message, not the whole conversation.
 */
export class TranscriptView implements Component {
  private state: TranscriptState = { entries: [], noticeCount: 0 };
  private toolOutputExpanded = false;
  private readonly cache = new Map<string, CachedEntry>();
  /** One Markdown renderer per message keeps its own parse cache across deltas. */
  private readonly markdownById = new Map<string, Markdown>();

  public constructor(private readonly embedded = false) {}

  public setState(state: TranscriptState): void {
    this.state = state;
  }

  public toggleToolOutput(): boolean {
    this.toolOutputExpanded = !this.toolOutputExpanded;
    return this.toolOutputExpanded;
  }

  public invalidate(): void {
    this.cache.clear();
    for (const markdown of this.markdownById.values()) markdown.invalidate();
  }

  public render(width: number): string[] {
    if (this.state.entries.length === 0) {
      return ['', truncateToWidth(` ${style.gray(this.embedded ? EMBEDDED_EMPTY_HINT : EMPTY_HINT)}`, width), ''];
    }
    const lines: string[] = [];
    const liveIds = new Set<string>();
    for (const entry of this.state.entries) {
      liveIds.add(entry.id);
      lines.push(...this.renderCached(entry, width));
    }
    for (const id of this.cache.keys()) {
      if (!liveIds.has(id)) {
        this.cache.delete(id);
        this.markdownById.delete(id);
      }
    }
    return lines;
  }

  private renderCached(entry: TranscriptEntry, width: number): string[] {
    const cached = this.cache.get(entry.id);
    if (
      cached !== undefined &&
      cached.entry === entry &&
      cached.width === width &&
      cached.expanded === this.toolOutputExpanded
    ) {
      return cached.lines;
    }
    const lines =
      entry.kind === 'notice' ? renderNotice(entry.tone, entry.text, width) : this.renderMessage(entry, width);
    this.cache.set(entry.id, { entry, width, expanded: this.toolOutputExpanded, lines });
    return lines;
  }

  private renderMessage(entry: TranscriptMessageEntry, width: number): string[] {
    if (entry.role === 'user') return renderUser(entry.text, entry.annotations ?? [], width);
    const lines: string[] = [];
    if (entry.thinking.trim().length > 0) {
      lines.push(...renderPrefixed(style.gray('┊ '), style.gray(style.italic(entry.thinking.trim())), width));
    }
    if (entry.text.trim().length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(...this.renderMarkdown(entry, width));
    }
    for (const tool of entry.tools) {
      lines.push(...renderTool(tool, width, this.toolOutputExpanded));
    }
    if (entry.composing !== undefined) {
      const name = entry.composing.toolName ?? '工具';
      lines.push(
        truncateToWidth(
          ` ${style.gray(`… 正在生成 ${name} 参数（${entry.composing.argumentCharCount} 字符）`)}`,
          width,
        ),
      );
    }
    if (entry.terminalMessage !== undefined && entry.terminalMessage.length > 0) {
      lines.push(...renderNotice(entry.status === 'error' ? 'error' : 'info', entry.terminalMessage, width));
    }
    if (lines.length === 0) return [];
    return ['', ...lines];
  }

  private renderMarkdown(entry: TranscriptMessageEntry, width: number): string[] {
    let markdown = this.markdownById.get(entry.id);
    if (markdown === undefined) {
      markdown = new Markdown(entry.text, 1, 0, markdownTheme);
      this.markdownById.set(entry.id, markdown);
    } else {
      markdown.setText(entry.text);
    }
    return markdown.render(width);
  }
}

function renderUser(text: string, annotations: readonly string[], width: number): string[] {
  return [
    '',
    ...renderPrefixed(style.cyan(style.bold('› ')), style.bold(text), width),
    ...annotations.flatMap((annotation) => renderPrefixed(style.gray('⎿ '), style.gray(annotation), width)),
  ];
}

function renderNotice(tone: 'info' | 'error', text: string, width: number): string[] {
  const paint = tone === 'error' ? style.red : style.gray;
  return renderPrefixed(paint(tone === 'error' ? '✗ ' : '· '), paint(text), width);
}

function renderTool(tool: TranscriptTool, width: number, expanded: boolean): string[] {
  const presentation = tool.presentation;
  const glyph =
    tool.status === 'running' ? style.yellow('◌') : tool.status === 'error' ? style.red('✗') : style.green('●');
  const title = presentation?.actionVerb ?? presentation?.title ?? tool.toolName;
  const detail = presentation?.command ?? presentation?.summary ?? presentation?.targetPaths?.join(', ') ?? '';
  const head = ` ${glyph} ${style.bold(title)}${detail.length > 0 ? ` ${style.gray(singleLine(detail))}` : ''}`;
  const lines = [truncateToWidth(head, width)];
  if (presentation?.error !== undefined) {
    lines.push(...renderPrefixed('   ', style.red(presentation.error.message), width));
  }
  const output = presentation?.output?.text ?? tool.output;
  if (output.trim().length > 0 && (expanded || tool.status === 'running')) {
    const outputLines = output.trimEnd().split('\n');
    const shown = expanded ? outputLines : outputLines.slice(-TOOL_OUTPUT_PREVIEW_LINES);
    if (shown.length < outputLines.length) {
      lines.push(truncateToWidth(`   ${style.gray(`… 前 ${outputLines.length - shown.length} 行已省略`)}`, width));
    }
    for (const line of shown) {
      lines.push(truncateToWidth(`   ${style.gray(line.replace(/\t/g, '  '))}`, width));
    }
  }
  return lines;
}

/** Wrap `body` to the width left after `prefix`; continuation lines are indented to match. */
function renderPrefixed(prefix: string, body: string, width: number): string[] {
  const indent = ' ';
  const prefixWidth = 2;
  const bodyWidth = Math.max(1, width - indent.length - prefixWidth);
  const wrapped = body.split('\n').flatMap((line) => {
    const pieces = wrapTextWithAnsi(line, bodyWidth);
    return pieces.length === 0 ? [''] : pieces;
  });
  return wrapped.map((line, index) =>
    truncateToWidth(`${indent}${index === 0 ? prefix : ' '.repeat(prefixWidth)}${line}`, width),
  );
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
