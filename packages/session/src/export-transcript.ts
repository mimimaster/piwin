/**
 * CE-SHARE-01: pure product-transcript → Markdown/HTML export.
 * Source of truth is SessionTranscriptMessage[] (same layer as UI hydrate).
 * No FS I/O here — host/CLI write the returned content.
 */

import type { SessionTranscriptMessage, SessionToolCardView } from '@piwin/contracts';

export type SessionExportFormat = 'md' | 'html';

export type ExportTranscriptOptions = {
  format: SessionExportFormat;
  /** When true, tool card outputs are replaced with a fixed placeholder. */
  redactTools?: boolean;
  sessionId?: string;
  projectPath?: string;
  /** Optional document title (defaults from sessionId). */
  title?: string;
  /** Override export timestamp (ISO); defaults to now. Useful for tests. */
  exportedAt?: string;
};

export type ExportTranscriptResult = {
  content: string;
  format: SessionExportFormat;
  redactTools: boolean;
};

/** Placeholder used when `redactTools` is enabled. */
export const TOOL_OUTPUT_REDACTED_PLACEHOLDER = '[tool output redacted]';

/**
 * Convert product transcript messages to Markdown or HTML.
 * User/assistant text is preserved as in the UI transcript (no model re-summary).
 */
export function exportTranscript(
  messages: readonly SessionTranscriptMessage[],
  options: ExportTranscriptOptions,
): ExportTranscriptResult {
  const redactTools = options.redactTools === true;
  const format = options.format === 'html' ? 'html' : 'md';
  const content =
    format === 'html'
      ? renderTranscriptHtml(messages, options, redactTools)
      : renderTranscriptMarkdown(messages, options, redactTools);
  return {
    content,
    format,
    redactTools,
  };
}

/**
 * Suggested export file basename (no directory).
 * Example: `piwin-export-a1b2c3d4.md`
 */
export function suggestSessionExportBasename(
  sessionId: string,
  format: SessionExportFormat,
): string {
  const shortId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8) || 'session';
  const extension = format === 'html' ? 'html' : 'md';
  return `piwin-export-${shortId}.${extension}`;
}

function renderTranscriptMarkdown(
  messages: readonly SessionTranscriptMessage[],
  options: ExportTranscriptOptions,
  redactTools: boolean,
): string {
  const lines: string[] = [];
  const title = options.title?.trim() || buildDefaultTitle(options.sessionId);
  const exportedAt = options.exportedAt ?? new Date().toISOString();

  lines.push(`# ${title}`);
  lines.push('');
  lines.push('## Metadata');
  lines.push('');
  if (options.sessionId) {
    lines.push(`- **Session:** \`${options.sessionId}\``);
  }
  if (options.projectPath) {
    lines.push(`- **Project:** \`${options.projectPath}\``);
  }
  lines.push(`- **Exported:** ${exportedAt}`);
  lines.push(`- **Format:** Markdown`);
  if (redactTools) {
    lines.push(`- **Tool output:** redacted`);
  }
  lines.push('');
  lines.push('## Transcript');
  lines.push('');

  if (messages.length === 0) {
    lines.push('_(empty transcript)_');
    lines.push('');
    return lines.join('\n');
  }

  for (const message of messages) {
    const roleHeading = roleHeadingMarkdown(message.role);
    lines.push(`### ${roleHeading}`);
    lines.push('');

    const body = (message.text ?? '').trimEnd();
    if (body.length > 0) {
      lines.push(body);
      lines.push('');
    } else {
      lines.push('_(empty)_');
      lines.push('');
    }

    if (message.status === 'error') {
      lines.push('> Status: error');
      lines.push('');
    } else if (message.status === 'streaming') {
      lines.push('> Status: streaming');
      lines.push('');
    }

    const thinking = message.thinking?.trim();
    if (thinking) {
      lines.push('#### Thinking');
      lines.push('');
      lines.push(thinking);
      lines.push('');
    }

    if (message.attachments && message.attachments.length > 0) {
      lines.push('#### Attachments');
      lines.push('');
      for (const attachment of message.attachments) {
        lines.push(
          `- \`${attachment.path}\` (${attachment.mimeType}, ${attachment.byteSize} bytes)`,
        );
      }
      lines.push('');
    }

    if (message.tools && message.tools.length > 0) {
      lines.push('#### Tools');
      lines.push('');
      for (const tool of message.tools) {
        lines.push(...renderToolMarkdown(tool, redactTools));
      }
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function renderToolMarkdown(tool: SessionToolCardView, redactTools: boolean): string[] {
  const lines: string[] = [];
  lines.push(`##### \`${tool.toolName}\` (${tool.status})`);
  lines.push('');
  lines.push(`- call id: \`${tool.toolCallId}\``);
  lines.push('');
  const output = redactTools ? TOOL_OUTPUT_REDACTED_PLACEHOLDER : tool.output ?? '';
  lines.push('```');
  lines.push(output);
  lines.push('```');
  lines.push('');
  return lines;
}

function renderTranscriptHtml(
  messages: readonly SessionTranscriptMessage[],
  options: ExportTranscriptOptions,
  redactTools: boolean,
): string {
  const title = escapeHtml(options.title?.trim() || buildDefaultTitle(options.sessionId));
  const exportedAt = escapeHtml(options.exportedAt ?? new Date().toISOString());
  const sessionId = options.sessionId ? escapeHtml(options.sessionId) : '';
  const projectPath = options.projectPath ? escapeHtml(options.projectPath) : '';

  const parts: string[] = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en">');
  parts.push('<head>');
  parts.push('<meta charset="utf-8" />');
  parts.push(`<title>${title}</title>`);
  parts.push(
    '<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#111}pre{white-space:pre-wrap;background:#f4f4f5;padding:.75rem;border-radius:6px;overflow:auto}article{border-top:1px solid #e4e4e7;padding:1rem 0}.meta{color:#52525b;font-size:.9rem}.role{font-weight:600;text-transform:capitalize}.tool{margin:.5rem 0;padding:.5rem;border:1px solid #e4e4e7;border-radius:6px}.thinking{color:#52525b;font-style:italic}</style>',
  );
  parts.push('</head>');
  parts.push('<body>');
  parts.push(`<h1>${title}</h1>`);
  parts.push('<section class="meta">');
  parts.push('<h2>Metadata</h2>');
  parts.push('<ul>');
  if (sessionId) parts.push(`<li><strong>Session:</strong> <code>${sessionId}</code></li>`);
  if (projectPath) parts.push(`<li><strong>Project:</strong> <code>${projectPath}</code></li>`);
  parts.push(`<li><strong>Exported:</strong> ${exportedAt}</li>`);
  parts.push('<li><strong>Format:</strong> HTML</li>');
  if (redactTools) parts.push('<li><strong>Tool output:</strong> redacted</li>');
  parts.push('</ul>');
  parts.push('</section>');
  parts.push('<section>');
  parts.push('<h2>Transcript</h2>');

  if (messages.length === 0) {
    parts.push('<p><em>(empty transcript)</em></p>');
  }

  for (const message of messages) {
    parts.push('<article>');
    parts.push(`<div class="role">${escapeHtml(message.role)}</div>`);
    const body = message.text ?? '';
    if (body.trim().length > 0) {
      parts.push(`<pre>${escapeHtml(body)}</pre>`);
    } else {
      parts.push('<p><em>(empty)</em></p>');
    }
    if (message.status === 'error' || message.status === 'streaming') {
      parts.push(`<p class="meta">Status: ${escapeHtml(message.status)}</p>`);
    }
    const thinking = message.thinking?.trim();
    if (thinking) {
      parts.push('<h3>Thinking</h3>');
      parts.push(`<pre class="thinking">${escapeHtml(thinking)}</pre>`);
    }
    if (message.attachments && message.attachments.length > 0) {
      parts.push('<h3>Attachments</h3>');
      parts.push('<ul>');
      for (const attachment of message.attachments) {
        parts.push(
          `<li><code>${escapeHtml(attachment.path)}</code> (${escapeHtml(attachment.mimeType)}, ${attachment.byteSize} bytes)</li>`,
        );
      }
      parts.push('</ul>');
    }
    if (message.tools && message.tools.length > 0) {
      parts.push('<h3>Tools</h3>');
      for (const tool of message.tools) {
        const output = redactTools ? TOOL_OUTPUT_REDACTED_PLACEHOLDER : tool.output ?? '';
        parts.push('<div class="tool">');
        parts.push(
          `<div><code>${escapeHtml(tool.toolName)}</code> (${escapeHtml(tool.status)})</div>`,
        );
        parts.push(`<div class="meta">call id: <code>${escapeHtml(tool.toolCallId)}</code></div>`);
        parts.push(`<pre>${escapeHtml(output)}</pre>`);
        parts.push('</div>');
      }
    }
    parts.push('</article>');
  }

  parts.push('</section>');
  parts.push('</body>');
  parts.push('</html>');
  parts.push('');
  return parts.join('\n');
}

function roleHeadingMarkdown(role: string): string {
  switch (role) {
    case 'user':
      return 'User';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
    case 'tool':
      return 'Tool';
    default:
      return role;
  }
}

function buildDefaultTitle(sessionId: string | undefined): string {
  if (sessionId && sessionId.trim()) {
    return `Session export (${sessionId.slice(0, 8)})`;
  }
  return 'Session export';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
