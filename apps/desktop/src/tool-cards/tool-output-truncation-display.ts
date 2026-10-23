import type { ToolOutputTruncation } from '@piwin/contracts';

export type ToolOutputTruncationCopy = {
  summary: string;
  notice: string;
  ariaLabel: string;
};

/** Keep the collapsed row compact while making the partial-result cause explicit. */
export function formatToolOutputTruncation(input: {
  truncation?: ToolOutputTruncation;
  locale: 'zh-CN' | 'en';
  isRead: boolean;
  isWeb: boolean;
}): ToolOutputTruncationCopy {
  const isChinese = input.locale === 'zh-CN';
  const partialLabel = isChinese ? '部分内容' : 'Partial';
  const truncation = input.truncation;
  const shownLines = truncation?.shownLines;

  if (input.isRead && shownLines !== undefined) {
    const total = truncation?.totalLines;
    const totalLabel =
      total === undefined ? '' : isChinese ? ` / 共 ${total} 行` : ` / ${total} lines`;
    const range = `L${shownLines.start}–L${shownLines.end}`;
    const nextOffset = truncation?.nextOffset ?? shownLines.end + 1;
    const limitLabel =
      truncation?.reason === 'byte-limit' && truncation.limitBytes !== undefined
        ? isChinese
          ? `（达到 ${formatByteLimit(truncation.limitBytes)} 限制）`
          : ` (${formatByteLimit(truncation.limitBytes)} limit)`
        : truncation?.reason === 'line-limit' && truncation.limitLines !== undefined
          ? isChinese
            ? `（达到 ${truncation.limitLines} 行限制）`
            : ` (${truncation.limitLines}-line limit)`
          : '';
    const notice = isChinese
      ? `文件内容较长，仅显示 ${range}${total === undefined ? '' : `（共 ${total} 行）`}${limitLabel}；文件未修改。可从第 ${nextOffset} 行继续读取。`
      : `File is long; showing ${range}${total === undefined ? '' : ` of ${total} lines`}${limitLabel}. The file was not modified. Continue from line ${nextOffset}.`;
    return {
      summary: `${partialLabel} · ${range}${totalLabel}`,
      notice,
      ariaLabel: notice,
    };
  }

  if (input.isRead && truncation?.firstLineExceedsLimit === true) {
    const limit =
      truncation.limitBytes === undefined ? '' : ` ${formatByteLimit(truncation.limitBytes)}`;
    const summary = isChinese
      ? `${partialLabel} · 单行超过${limit}`
      : `${partialLabel} · line >${limit}`;
    const notice = isChinese
      ? `单行内容超过${limit || '大小'}限制，未展示完整内容；文件未修改。`
      : `A line exceeds the${limit || ''} limit, so the full content was not shown. The file was not modified.`;
    return { summary, notice, ariaLabel: notice };
  }

  const limitLabel = truncation?.limitBytes
    ? formatByteLimit(truncation.limitBytes)
    : truncation?.limitLines
      ? `${truncation.limitLines} ${isChinese ? '行' : 'lines'}`
      : undefined;
  const summary = limitLabel ? `${partialLabel} · ${limitLabel}` : partialLabel;
  const notice = input.isWeb
    ? isChinese
      ? '网页响应较长，本次只显示部分结果。'
      : 'The web response was too large; only a partial result is shown.'
    : input.isRead
      ? isChinese
        ? '文件内容较长，本次只显示部分内容；文件未修改。'
        : 'The file is long; only part of its content is shown. The file was not modified.'
      : isChinese
        ? '工具输出较长，本次只显示部分结果。'
        : 'The tool output was too large; only a partial result is shown.';
  return { summary, notice, ariaLabel: notice };
}

function formatByteLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
}
