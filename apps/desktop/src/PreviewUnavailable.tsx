import type { ReactElement } from 'react';
import type { DocumentPathAttempt } from '@piwin/contracts';
import { EmptyState } from '@piwin/ui-kit';
import type { DesktopLocale } from './desktop-locale.js';
import { previewUnavailableCopy } from './preview-unavailable.js';
import { IconFile } from './shell-icons.js';

export type PreviewUnavailableProps = {
  reason: string;
  locale?: DesktopLocale | undefined;
  fileName?: string | undefined;
  byteSize?: number | undefined;
  maxBytes?: number | undefined;
  /**
   * Routes the Host tried while resolving the path (ADR 0052 §6). A miss that
   * names its routes is diagnosable; a bare "not found" is not.
   */
  attempts?: readonly DocumentPathAttempt[] | undefined;
  testId?: string | undefined;
};

/** Centered inspector empty state: icon + title + one-line reason. */
export function PreviewUnavailable({
  reason,
  locale = 'zh-CN',
  fileName,
  byteSize,
  maxBytes,
  attempts,
  testId = 'preview-unavailable',
}: PreviewUnavailableProps): ReactElement {
  const copy = previewUnavailableCopy({
    reason,
    locale,
    ...(fileName ? { fileName } : {}),
    ...(byteSize !== undefined ? { byteSize } : {}),
    ...(maxBytes !== undefined ? { maxBytes } : {}),
  });
  const list = attempts ?? [];
  const zh = locale !== 'en';

  return (
    <div
      className="preview-unavailable"
      data-testid={testId}
      data-reason={reason}
      {...(list.length > 0 ? { 'data-attempts': String(list.length) } : {})}
    >
      <EmptyState
        visual={<IconFile width={48} height={48} />}
        title={copy.title}
        description={copy.detail}
        testId={`${testId}-copy`}
      />
      {list.length > 0 ? (
        <details className="preview-unavailable-diagnostics" data-testid={`${testId}-attempts`}>
          <summary>
            {zh ? `尝试过的路径（${list.length}）` : `Paths tried (${list.length})`}
          </summary>
          <ul>
            {list.map((attempt, index) => (
              <li key={`${attempt.route}-${attempt.reason}-${index}`}>
                <code>{attempt.route}</code>
                <span>{attempt.reason}</span>
                {attempt.detail ? <em>{attempt.detail}</em> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
