/**
 * Full-screen 资料库 viewer: the biggest picture the Host will hand over,
 * the prompt that made it, and a star. Videos stay poster-only because the
 * public contract has no playable stream — the note says so instead of
 * failing silently.
 */
import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import type { MediaLibraryItem } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { Icon } from '../icons.js';
import { useInkstone } from '../inkstone-context.js';
import {
  describeLibraryKind,
  formatLibraryBytes,
  formatLibraryDate,
  libraryItemTitle,
} from './library-model.js';
import { useLibraryFullMedia, useLibraryThumb } from './use-media-reads.js';

export type LibraryViewerProps = {
  client: HostClient | undefined;
  item: MediaLibraryItem;
  index: number;
  count: number;
  favorited: boolean;
  onSelect: (index: number) => void;
  onToggleFavorite: () => void;
  onClose: () => void;
};

export function LibraryViewer(props: LibraryViewerProps): ReactElement {
  const { dispatch } = useInkstone();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const full = useLibraryFullMedia(props.client, props.item);
  const thumb = useLibraryThumb(props.client, props.item);
  const title = libraryItemTitle(props.item);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const step = useCallback(
    (delta: number) => {
      if (props.count === 0) return;
      const next = (props.index + delta + props.count) % props.count;
      props.onSelect(next);
    },
    [props],
  );

  const copyPrompt = useCallback(async () => {
    const prompt = props.item.prompt?.trim();
    if (prompt === undefined || prompt.length === 0) return;
    try {
      await navigator.clipboard.writeText(prompt);
      dispatch({ type: 'toast', message: '提示词已复制' });
    } catch {
      dispatch({ type: 'toast', message: '复制失败，可长按选中文字' });
    }
  }, [dispatch, props.item.prompt]);

  const src = full.src ?? thumb.src;
  const note = full.note;
  const prompt = props.item.prompt?.trim();

  return (
    <dialog
      className="lib-viewer"
      ref={dialogRef}
      aria-label={`${title} 预览`}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          step(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          step(1);
        }
      }}
    >
      <header className="lib-viewer-head">
        <button type="button" className="icon-button" aria-label="关闭预览" onClick={props.onClose}>
          <Icon name="close" />
        </button>
        <span className="lib-viewer-count">
          {props.count > 0 ? `${props.index + 1} / ${props.count}` : ''}
        </span>
        <button
          type="button"
          className="icon-button lib-viewer-star"
          aria-pressed={props.favorited}
          aria-label={props.favorited ? '取消收藏' : '收藏'}
          onClick={props.onToggleFavorite}
        >
          <Icon name="star" />
        </button>
      </header>

      <div className="lib-viewer-stage">
        {src !== undefined ? (
          <img src={src} alt={title} />
        ) : (
          <div className="lib-viewer-empty">
            <Icon name={props.item.kind === 'file' ? 'file' : 'image'} />
            <p>{full.loading ? '正在从 Host 读取…' : (note ?? 'Host 没有返回可显示的预览。')}</p>
          </div>
        )}
        {src !== undefined && note !== undefined ? (
          <p className="lib-viewer-note">{note}</p>
        ) : null}
      </div>

      <footer className="lib-viewer-foot">
        <h2>{title}</h2>
        <p className="lib-viewer-meta">
          {describeLibraryKind(props.item.kind)} · {formatLibraryDate(props.item.createdAt)} ·{' '}
          {formatLibraryBytes(props.item.byteSize)}
          {props.item.model !== undefined && props.item.model.length > 0
            ? ` · ${props.item.model}`
            : ''}
        </p>
        {prompt !== undefined && prompt.length > 0 ? (
          <p className="lib-viewer-prompt" data-selectable="true">
            {prompt}
          </p>
        ) : null}
        <div className="lib-viewer-actions">
          {prompt !== undefined && prompt.length > 0 ? (
            <button type="button" className="full-button secondary" onClick={() => void copyPrompt()}>
              <Icon name="copy" /> 复制提示词
            </button>
          ) : null}
          <div className="lib-viewer-nav">
            <button type="button" className="lib-nav-button" aria-label="上一张" onClick={() => step(-1)}>
              <Icon name="chevl" />
            </button>
            <button type="button" className="lib-nav-button" aria-label="下一张" onClick={() => step(1)}>
              <Icon name="chevr" />
            </button>
          </div>
        </div>
      </footer>
    </dialog>
  );
}
