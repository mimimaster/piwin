import type { ReactElement } from 'react';
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
  testId?: string | undefined;
};

/** Centered inspector empty state: icon + title + one-line reason. */
export function PreviewUnavailable({
  reason,
  locale = 'zh-CN',
  fileName,
  byteSize,
  maxBytes,
  testId = 'preview-unavailable',
}: PreviewUnavailableProps): ReactElement {
  const copy = previewUnavailableCopy({
    reason,
    locale,
    ...(fileName ? { fileName } : {}),
    ...(byteSize !== undefined ? { byteSize } : {}),
    ...(maxBytes !== undefined ? { maxBytes } : {}),
  });

  return (
    <div className="preview-unavailable" data-testid={testId} data-reason={reason}>
      <EmptyState
        visual={<IconFile width={48} height={48} />}
        title={copy.title}
        description={copy.detail}
        testId={`${testId}-copy`}
      />
    </div>
  );
}
