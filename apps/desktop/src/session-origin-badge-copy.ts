/**
 * Copy for the session origin badge shared by the context bar and stage header.
 */
import type { ProductSessionOrigin } from '@piwin/contracts';

export type SessionOriginBadgeCopy = { title: string; label: string };

export function describeSessionOriginBadge(
  origin: ProductSessionOrigin,
  isChinese: boolean,
): SessionOriginBadgeCopy {
  const zhSource = origin.sourceSessionNameSnapshot ?? '源会话';
  const enSource = origin.sourceSessionNameSnapshot ?? 'source session';
  switch (origin.kind) {
    case 'fork':
      return isChinese
        ? { title: `从「${zhSource}」分叉`, label: '分支' }
        : { title: `Forked from "${enSource}"`, label: 'Branch' };
    case 'handoff':
      return isChinese
        ? { title: `交接自「${zhSource}」`, label: '交接' }
        : { title: `Handed off from "${enSource}"`, label: 'Handoff' };
    case 'duplicate':
      return isChinese
        ? { title: `复制自「${zhSource}」`, label: '副本' }
        : { title: `Duplicated from "${enSource}"`, label: 'Duplicate' };
  }
}
