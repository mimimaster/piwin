import type { ArtifactThemeVariables } from '@piwin/artifact';
import type { ReactElement } from 'react';
import { ArtifactStatic } from './ArtifactStatic.js';
import type { DesktopLocale } from './desktop-locale.js';

export function markupPreviewKind(path: string): 'html' | 'svg' | null {
  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(path);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? '';
  if (extension === 'html' || extension === 'htm') {
    return 'html';
  }
  if (extension === 'svg') {
    return 'svg';
  }
  return null;
}

export type MarkupPreviewViewProps = {
  source: string;
  kind: 'html' | 'svg';
  locale?: DesktopLocale | undefined;
  theme?: ArtifactThemeVariables | undefined;
};

/** Visual HTML/SVG preview for inspector Doc Preview and the file-tree rail. */
export function MarkupPreviewView(props: MarkupPreviewViewProps): ReactElement {
  return (
    <div className="markup-preview" data-testid="markup-preview">
      <ArtifactStatic
        source={props.source}
        type={props.kind}
        {...(props.locale === 'zh-CN' || props.locale === 'en' ? { locale: props.locale } : {})}
        {...(props.theme ? { theme: props.theme } : {})}
      />
    </div>
  );
}
