import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { SubagentPreviewLine, SubagentPreviewView } from '@piwin/host-client';
import { formatElapsed } from './status-line.js';
import { style } from './tui-style.js';

/**
 * Paints the shared dense preview (`@piwin/host-client`
 * subagent-preview-projection) for the terminal: one aligned line per step,
 * the report as plain wrapped text. No Markdown, no tool output. Pure.
 */

const TIME_WIDTH = 4;
const VERB_MAX = 10;
const TASK_LINES = 2;

export type PaintedSubagentPreview = {
  /** Fixed above the scrolling body: identity and task. */
  header: string[];
  /** Scrolls: steps, then the report. */
  body: string[];
};

function pad(text: string, width: number, alignRight = false): string {
  const clipped = truncateToWidth(text, width, '…');
  const fill = ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
  return alignRight ? `${fill}${clipped}` : `${clipped}${fill}`;
}

function paintResult(line: Extract<SubagentPreviewLine, { kind: 'tool' }>): string {
  switch (line.status) {
    case 'running':
      return style.yellow('…');
    case 'error':
      return style.red(`✗ ${line.result}`.trimEnd());
    case 'done':
      return style.gray(`✓ ${line.result}`.trimEnd());
  }
}

function paintStep(line: SubagentPreviewLine, verbWidth: number, width: number): string {
  const time = style.gray(pad(line.offset, TIME_WIDTH, true));
  if (line.kind !== 'tool') {
    const verb = style.gray(pad(line.kind === 'say' ? '说' : '想', verbWidth));
    const text = line.kind === 'say' ? line.text : style.gray(style.italic(line.text));
    return truncateToWidth(`${time} ${verb} ${text}`, width);
  }
  const verbPaint = line.status === 'error' ? style.red : style.gray;
  const verb = verbPaint(pad(line.verb, verbWidth));
  const result = paintResult(line);
  const targetWidth = Math.max(4, width - TIME_WIDTH - verbWidth - visibleWidth(result) - 3);
  return `${time} ${verb} ${pad(line.target, targetWidth)} ${result}`;
}

export function paintSubagentPreview(
  view: SubagentPreviewView,
  title: string,
  width: number,
  now = Date.now(),
): PaintedSubagentPreview {
  const started = view.startedAt === undefined ? Number.NaN : Date.parse(view.startedAt);
  const ended = view.endedAt === undefined ? now : Date.parse(view.endedAt);
  const elapsed = Number.isFinite(started) && Number.isFinite(ended) ? formatElapsed(ended - started) : undefined;
  const statusPaint = view.live
    ? style.yellow
    : view.outcome?.tone === 'failed'
      ? style.red
      : view.outcome?.tone === 'done'
        ? style.green
        : style.gray;
  const meta = [...view.meta, ...(elapsed === undefined ? [] : [elapsed])].join(' · ');
  const header = [
    truncateToWidth(`${style.bold(title)}${meta.length > 0 ? style.gray(` · ${meta}`) : ''} ${statusPaint(view.statusLabel)}`, width),
  ];
  if (view.task.length > 0) {
    const wrapped = wrapTextWithAnsi(`${style.gray('任务')} ${view.task.replace(/\s+/g, ' ')}`, width);
    header.push(...wrapped.slice(0, TASK_LINES));
    if (wrapped.length > TASK_LINES) header[header.length - 1] = truncateToWidth(`${header[header.length - 1]}…`, width);
  }

  const verbWidth = Math.min(
    VERB_MAX,
    Math.max(2, ...view.lines.map((line) => (line.kind === 'tool' ? visibleWidth(line.verb) : 2))),
  );
  const body: string[] = [];
  if (view.elidedCount > 0) body.push(style.gray(`${' '.repeat(TIME_WIDTH)} … 前 ${view.elidedCount} 步已省略`));
  for (const line of view.lines) body.push(paintStep(line, verbWidth, width));
  if (view.lines.length === 0 && view.live) body.push(style.gray(`${' '.repeat(TIME_WIDTH)} 还没有步骤`));
  if (view.outcome !== undefined) {
    const paint = view.outcome.tone === 'failed' ? style.red : style.green;
    body.push('', paint(view.outcome.label));
    for (const line of view.outcome.text.split('\n')) {
      const wrapped = wrapTextWithAnsi(line, width);
      body.push(...(wrapped.length === 0 ? [''] : wrapped));
    }
  }
  return { header, body };
}
