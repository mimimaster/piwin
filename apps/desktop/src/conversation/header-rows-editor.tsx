/**
 * Editable name/value rows for configured HTTP request headers. Shared by the
 * provider connection form and the per-model editor so both stay one widget.
 */
import type { ReactElement } from 'react';
import { IconButton, TextInput } from '@piwin/ui-kit';
import { createHeaderRow, type HeaderDraftRow } from '../models/provider-draft.js';
import { IconClose, IconPlus } from '../tool-cards/shell-icons.js';

export type HeaderRowsEditorCopy = {
  headerName: string;
  headerValue: string;
  addHeader: string;
  deleteLabel: string;
};

export type HeaderRowsEditorProps = {
  rows: readonly HeaderDraftRow[];
  disabled: boolean;
  copy: HeaderRowsEditorCopy;
  /** Prefix for row test ids, e.g. `provider` → `provider-header-name`. */
  testIdPrefix: string;
  onChange: (rows: HeaderDraftRow[]) => void;
};

export function HeaderRowsEditor({
  rows,
  disabled,
  copy,
  testIdPrefix,
  onChange,
}: HeaderRowsEditorProps): ReactElement {
  function updateRow(id: string, patch: { name?: string; value?: string }): void {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <>
      {rows.map((row) => (
        <div key={row.id} className="pconn-header-row">
          <TextInput
            value={row.name}
            onChange={(event) => updateRow(row.id, { name: event.currentTarget.value })}
            placeholder={copy.headerName}
            aria-label={copy.headerName}
            spellCheck={false}
            testId={`${testIdPrefix}-header-name`}
            disabled={disabled}
            className="pconn-mono"
          />
          <TextInput
            value={row.value}
            onChange={(event) => updateRow(row.id, { value: event.currentTarget.value })}
            placeholder={copy.headerValue}
            aria-label={copy.headerValue}
            spellCheck={false}
            testId={`${testIdPrefix}-header-value`}
            disabled={disabled}
            className="pconn-mono"
          />
          <IconButton
            label={copy.deleteLabel}
            size={26}
            onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
            disabled={disabled}
          >
            <IconClose width={12} height={12} />
          </IconButton>
        </div>
      ))}
      <button
        type="button"
        className="pconn-add-header"
        onClick={() => onChange([...rows, createHeaderRow()])}
        disabled={disabled}
        data-testid={`${testIdPrefix}-header-add`}
      >
        <IconPlus width={12} height={12} />
        {copy.addHeader}
      </button>
    </>
  );
}
