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
      className="kb-mounts"
      role="group"
      aria-label={zh ? '本对话使用的知识库' : 'Knowledge bases in this conversation'}
      data-testid="knowledge-mount-chips"
    >
      {mounts.mountedIds.map((baseId) => {
        const name = namesById.get(baseId) ?? baseId;
        return (
          <span key={baseId} className="kb-mount-chip" data-testid={`knowledge-mount-chip-${baseId}`}>
            <IconBook width={12} height={12} aria-hidden="true" />
            <span className="kb-mount-name">{name}</span>
            <button
              type="button"
              className="kb-mount-remove"
              aria-label={zh ? `不再使用「${name}」` : `Stop using ${name}`}
              onClick={() => mounts.toggle(baseId)}
            >
              <IconClose width={10} height={10} aria-hidden="true" />
            </button>
          </span>
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
