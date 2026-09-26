import type { InkstoneProjectGroup, InkstoneSessionRow } from '../host/host-bridge.js';

export type SessionListFilter = '全部' | '进行中' | '置顶';

/** A row plus the project it came from, shown when the list is not grouped by project. */
export interface SessionSectionRow extends InkstoneSessionRow {
  scope: string | undefined;
}

export interface SessionSection {
  key: string;
  /** Pinned and filtered sections are flat; project sections draw the folder heading. */
  kind: 'pinned' | 'project' | 'flat';
  title: string;
  rows: SessionSectionRow[];
}

export interface SessionSectionsView {
  sections: SessionSection[];
  /** Set when nothing matches, so the page draws one empty state instead of N empty groups. */
  emptyMessage: string | undefined;
}

const EMPTY_BY_FILTER: Record<SessionListFilter, string> = {
  全部: '还没有会话。',
  进行中: '现在没有正在工作的会话。',
  置顶: '还没有置顶的会话。点会话右侧的「⋯」可以置顶。',
};

export function isSessionListFilter(value: string): value is SessionListFilter {
  return value === '全部' || value === '进行中' || value === '置顶';
}

/**
 * Turns Host project groups into what the list draws. Pinned rows float to one
 * section above the projects (and leave their project group so they are not
 * listed twice); the 进行中 / 置顶 filters are a single flat list with a scope
 * tag, because a filter that repeats every project heading with "0" under it
 * reads as broken.
 */
export function buildSessionSections(
  groups: readonly InkstoneProjectGroup[],
  filter: SessionListFilter,
): SessionSectionsView {
  const scoped = groups.flatMap((group) =>
    group.rows.map((row): SessionSectionRow => ({ ...row, scope: group.project })),
  );
  if (filter !== '全部') {
    const rows = scoped.filter((row) => (filter === '置顶' ? row.pinned : row.status === 'running'));
    return rows.length === 0
      ? { sections: [], emptyMessage: EMPTY_BY_FILTER[filter] }
      : { sections: [{ key: `flat:${filter}`, kind: 'flat', title: filter, rows }], emptyMessage: undefined };
  }

  const sections: SessionSection[] = [];
  const pinned = scoped.filter((row) => row.pinned);
  if (pinned.length > 0) {
    sections.push({ key: 'pinned', kind: 'pinned', title: '置顶', rows: pinned });
  }
  for (const group of groups) {
    const rows = group.rows
      .filter((row) => !row.pinned)
      .map((row): SessionSectionRow => ({ ...row, scope: undefined }));
    if (rows.length === 0) continue;
    sections.push({
      key: `project:${group.projectId ?? '__general__'}`,
      kind: 'project',
      title: group.project,
      rows,
    });
  }
  return sections.length === 0
    ? { sections, emptyMessage: EMPTY_BY_FILTER[filter] }
    : { sections, emptyMessage: undefined };
}
