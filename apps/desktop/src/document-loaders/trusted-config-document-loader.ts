/**
 * `trusted-config` target loader (ADR 0052 §6 split).
 *
 * Config-store text (`~/.piwin/**`) is addressed by a config-root-relative path
 * only, so a remote shell can preview it without ever learning the Host layout.
 * The body comes back read-only, badged as outside the project.
 */
import type { DocumentLoaderContext } from './document-loader-context.js';
import { settleUnavailable } from './document-loader-context.js';

export async function loadTrustedConfigDocument(
  context: DocumentLoaderContext,
  input: { relativePath: string },
): Promise<void> {
  const response = await context.hostClient.request({
    type: 'preview/read-trusted-text',
    input: { relativePath: input.relativePath },
  });

  if (response.success && response.data) {
    const readData = response.data as {
      status?: string;
      content?: string;
      displayRef?: string;
      truncated?: boolean;
      reason?: string;
      suggestion?: string;
    };
    if (readData.status === 'ready' && typeof readData.content === 'string') {
      context.apply({
        status: 'ready',
        requestId: context.requestId,
        title: context.title,
        content: readData.content,
        displayRef: readData.displayRef || context.displayRef,
        provenance: 'trusted-config',
        readOnly: true,
        ...(readData.truncated === true ? { warning: '内容已截断，只展示部分文本。' } : {}),
      });
      return;
    }
    if (readData.status === 'unavailable') {
      settleUnavailable(
        { ...context, displayRef: readData.displayRef || context.displayRef },
        {
          reason: readData.reason || 'unavailable',
          ...(readData.suggestion ? { suggestion: readData.suggestion } : {}),
          warning: '展示来自对话记录的恢复内容，非当前配置文件。',
        },
      );
      return;
    }
  }

  settleUnavailable(context, {
    reason: 'not-found',
    suggestion: '该受信配置文件无法读取，或已不存在。',
    warning: '展示来自对话记录的恢复内容，非当前配置文件。',
  });
}
