/**
 * Settings field row template: label + hint on the left, control on the right.
 * UI-pure (no host access); candidate for later promotion to @piwin/ui-kit.
 * Delegates to the ui-kit Field wrapper so existing `ui-field` CSS applies
 * unchanged — no new CSS is introduced in this slice.
 */
import type { ReactElement } from 'react';
import { Field, type FieldProps } from '@piwin/ui-kit';

export type FieldRowProps = FieldProps;

export function FieldRow(props: FieldRowProps): ReactElement {
  return <Field {...props} />;
}
