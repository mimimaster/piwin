import type { ReactElement } from 'react';
import { IconBook, IconClose } from '../shell-icons';
import { useKnowledgeMounts } from './knowledge-mounts-context.js';

/** Composer chips for the knowledge bases this conversation answers from. */
export function KnowledgeMountChips(props: { locale: 'zh-CN' | 'en' }): ReactElement | null {
  const mounts = useKnowledgeMounts();
  if (!mounts?.supported || (mounts.mountedIds.length === 0 && !mounts.error)) return null;
  const zh = props.locale === 'zh-CN';
  const namesById = new Map(mounts.bases.map((base) => [base.id, base.name]));

  return (
    <div
      className="kb-mounts refs"
      role="group"
      aria-label={zh ? '本对话使用的知识库' : 'Knowledge bases in this conversation'}
      data-testid="knowledge-mount-chips"
    >
      {mounts.mountedIds.map((baseId) => {
        const name = namesById.get(baseId) ?? baseId;
        return (
          <div
            key={baseId}
            className="ref composer-v2-attachment-chip composer-v2-doc-comment-chip composer-v2-context-chip kb-mount-chip"
            data-testid={`knowledge-mount-chip-${baseId}`}
            data-shelf-chip=""
            data-shelf-kind="knowledge-mount"
            tabIndex={0}
            title={name}
          >
            <span className="doc-comment-chip-icon" aria-hidden="true">
              <IconBook width={13} height={13} />
            </span>
            <span className="chip-text kb-mount-name">{name}</span>
            <span className="doc-comment-chip-dot" aria-hidden="true">
              ·
            </span>
            <span className="doc-comment-chip-count">{zh ? '知识库' : 'Knowledge'}</span>
            <button
              type="button"
              className="composer-v2-chip-remove doc-comment-chip-remove kb-mount-remove"
              data-testid={`knowledge-mount-remove-${baseId}`}
              tabIndex={-1}
              onClick={() => mounts.toggle(baseId)}
              aria-label={zh ? `不再使用「${name}」` : `Stop using ${name}`}
            >
              <IconClose width={12} height={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {mounts.error ? (
        <span className="kb-mount-error" role="alert">
          {mounts.error}
        </span>
      ) : null}
    </div>
  );
}
