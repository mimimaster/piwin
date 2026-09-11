import type { ReactElement } from 'react';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@piwin/ui-kit';
import { IconBook } from '../shell-icons';
import { isSearchableKnowledgeBase } from './knowledge-base-client.js';
import { knowledgeStateCopy } from './knowledge-base-copy.js';
import { useKnowledgeMounts } from './knowledge-mounts-context.js';

export type KnowledgeMountSubmenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: 'zh-CN' | 'en';
};

/** Composer "+" → Knowledge: pick which bases this conversation answers from. */
export function KnowledgeMountSubmenu(props: KnowledgeMountSubmenuProps): ReactElement | null {
  const mounts = useKnowledgeMounts();
  if (!mounts?.supported) return null;
  const zh = props.locale === 'zh-CN';
  const mountedCount = mounts.mountedIds.length;

  return (
    <DropdownMenuSub open={props.open} onOpenChange={props.onOpenChange}>
      <DropdownMenuSubTrigger testId="plus-menu-knowledge">
        <span className="plus-menu-icon">
          <IconBook width={16} height={16} />
        </span>
        <span className="plus-menu-label">{zh ? '知识库' : 'Knowledge'}</span>
        {mountedCount > 0 ? <span className="plus-menu-count">{mountedCount}</span> : null}
        <span className="plus-menu-chevron">›</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="plus-submenu" label="Knowledge">
        <DropdownMenuLabel className="plus-menu-caption muted">
          {zh ? '在这个对话中使用' : 'Use in this conversation'}
        </DropdownMenuLabel>
        {mounts.bases.length === 0 ? (
          <DropdownMenuLabel className="plus-menu-empty muted">
            {zh ? '还没有知识库' : 'No knowledge bases yet'}
          </DropdownMenuLabel>
        ) : (
          mounts.bases.map((base) => {
            const mounted = mounts.mountedIds.includes(base.id);
            return (
              <DropdownMenuItem
                key={base.id}
                onSelect={() => mounts.toggle(base.id)}
                testId={`plus-menu-knowledge-${base.id}`}
              >
                <span className={`plus-menu-check${mounted ? ' is-on' : ''}`} aria-hidden="true">
                  {mounted ? '✓' : ''}
                </span>
                <span className="plus-menu-label">{base.name}</span>
                {isSearchableKnowledgeBase(base) ? null : (
                  <span className="plus-menu-hint muted">{knowledgeStateCopy(base, props.locale).label}</span>
                )}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuItem onSelect={mounts.openManager} testId="plus-menu-manage-knowledge">
          {zh ? '管理知识库…' : 'Manage knowledge…'}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
