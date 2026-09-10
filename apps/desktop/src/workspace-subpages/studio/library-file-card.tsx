import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import { IconDocument, IconFile, IconTrash } from '../../shell-icons';
import { formatLibraryBytes, formatLibraryItemTitle, formatLibraryType } from './media-format';

type LibraryFileItem = {
  assetId: string;
  byteSize: number;
  createdAt: string;
  mimeType: string;
  name?: string | undefined;
  prompt?: string | undefined;
  kind: 'file';
  viewMode?: 'grid' | 'list' | undefined;
};

export function LibraryFileCard(props: {
  item: LibraryFileItem;
  locale: string;
  /** Receives the click so the caller can branch on ⌘/Ctrl/Shift. */
  onOpen: (event?: ReactMouseEvent<HTMLButtonElement>) => void;
  onFocus?: (() => void) | undefined;
  onDelete: () => void;
  deleteLabel: string;
  openLabel: string;
  isSelected?: boolean | undefined;
  /** See {@link import('./library-media-card.js').LibraryMediaCardModel.selectionActive}. */
  selectionActive?: boolean | undefined;
  onToggleSelect?: (() => void) | undefined;
  selectLabel?: string | undefined;
}): ReactElement {
  const { item } = props;
  const name = formatLibraryItemTitle(item, props.locale);
  const isPdf = item.mimeType === 'application/pdf';
  const isList = item.viewMode === 'list';
  const selectionClasses = `${props.isSelected ? ' is-selected' : ''}${props.selectionActive ? ' selection-active' : ''}`;

  const checkbox = props.onToggleSelect ? (
    <input
      type="checkbox"
      className={isList ? 'lib-batch-checkbox' : 'lib-card-batch-cb'}
      checked={Boolean(props.isSelected)}
      onChange={(e) => {
        e.stopPropagation();
        props.onToggleSelect?.();
      }}
      aria-label={props.selectLabel ?? 'Select item'}
    />
  ) : null;

  if (isList) {
    return (
      <article className={`lib-row-card lib-row-file${selectionClasses}`}>
        {checkbox}
        <button
          type="button"
          className="lib-row-open"
          onClick={props.onOpen}
          onFocus={props.onFocus}
          aria-label={`${props.openLabel}: ${name}`}
          data-testid={`file-card-${item.assetId}`}
        >
          <span className={`lib-row-thumb lib-row-thumb-file${isPdf ? ' is-pdf' : ''}`} aria-hidden="true">
            {isPdf ? <IconDocument width={20} height={20} /> : <IconFile width={20} height={20} />}
          </span>
          <div className="lib-row-main">
            <strong className="lib-row-title">{name}</strong>
            <div className="lib-row-meta">
              <span className={`lib-file-badge${isPdf ? ' is-pdf' : ''}`}>
                {isPdf ? 'PDF' : formatLibraryType(item.mimeType)}
              </span>
              <span className="lib-row-type">{formatLibraryBytes(item.byteSize)}</span>
              <span className="lib-row-time">{item.createdAt ? formatWhen(item.createdAt) : ''}</span>
            </div>
          </div>
        </button>
        <div className="lib-row-actions">
          <button
            type="button"
            className="lib-action-btn is-danger"
            data-testid={`media-delete-${item.assetId}`}
            onClick={props.onDelete}
            title={props.deleteLabel}
            aria-label={props.deleteLabel}
          >
            <IconTrash width={14} height={14} aria-hidden="true" />
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className={`lib-card lib-card-file${selectionClasses}`}>
      <button
        type="button"
        className="lib-card-open"
        onClick={props.onOpen}
        onFocus={props.onFocus}
        aria-label={`${props.openLabel}: ${name}`}
        data-testid={`file-card-${item.assetId}`}
      >
        <span className={`lib-card-thumb lib-card-thumb-file${isPdf ? ' is-pdf' : ''}`} aria-hidden="true">
          {isPdf ? <IconDocument width={28} height={28} /> : <IconFile width={28} height={28} />}
          <span className={`lib-card-file-type-pill${isPdf ? ' is-pdf' : ''}`}>
            {isPdf ? 'PDF' : formatLibraryType(item.mimeType)}
          </span>
        </span>
      </button>
      {checkbox ? <label className="lib-card-select">{checkbox}</label> : null}
      <div className="lib-card-foot">
        <button type="button" className="lib-card-info" onClick={props.onOpen}>
          <strong className="lib-card-title">{name}</strong>
          <div className="lib-card-meta-row">
            <span className="lib-card-meta-type">{formatLibraryType(item.mimeType)}</span>
            <span className="lib-card-meta-dot">·</span>
            <span className="lib-card-meta-size">{formatLibraryBytes(item.byteSize)}</span>
          </div>
        </button>
        <button
          type="button"
          className="lib-card-more"
          data-testid={`media-delete-${item.assetId}`}
          onClick={props.onDelete}
          title={props.deleteLabel}
          aria-label={props.deleteLabel}
        >
          <IconTrash width={14} height={14} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '';
  return date.toLocaleDateString();
}
