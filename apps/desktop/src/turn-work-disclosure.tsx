import type { ReactElement } from 'react';
import type { TurnWorkDisclosureProjection } from './turn-work-disclosure-model.js';
import { WorkFoldHeader } from './work-fold-header.js';

export type TurnWorkDisclosureProps = {
  projection: TurnWorkDisclosureProjection;
  open: boolean;
  locale: 'zh-CN' | 'en';
  onToggle: () => void;
};

/** Turn-level disclosure around unchanged causal rows after the query settles. */
export function TurnWorkDisclosure(props: TurnWorkDisclosureProps): ReactElement {
  const { projection, locale } = props;

  return (
    <div
      className={`turn-work-disclosure work fw${props.open ? ' open is-open' : ' is-collapsed'}`}
      data-testid="turn-work-disclosure"
      data-open={props.open ? 'true' : 'false'}
    >
      <WorkFoldHeader
        state="done"
        locale={locale}
        open={props.open}
        onToggle={props.onToggle}
        className="turn-work-disclosure-trigger"
        testId="turn-work-disclosure-trigger"
        {...(projection.elapsedMs !== undefined ? { elapsedMs: projection.elapsedMs } : {})}
        {...(projection.toolCount !== undefined ? { toolCount: projection.toolCount } : {})}
        {...(projection.fileCount !== undefined ? { fileCount: projection.fileCount } : {})}
        failureCount={projection.failureCount}
      />
    </div>
  );
}
