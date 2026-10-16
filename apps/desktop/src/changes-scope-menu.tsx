/**
 * Changes scope picker (toolbar trigger + menu) and the empty-scope view that
 * points at the scopes which do have changes. Both read the same option list,
 * so a count shown in one is the count shown in the other.
 */
import type { ReactElement, ReactNode } from 'react';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '@piwin/ui-kit';
import {
  IconAgent,
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconEdit,
  IconFileDiff,
  IconGit,
  IconSpark,
} from './shell-icons';
import type { ChangesScope, ScopeTally } from './changes-scope';

export type ScopeOption = {
  scope: ChangesScope;
  /** null when the scope has no count to show (history, result). */
  tally: ScopeTally | null;
};

const SCOPE_LABELS: Record<ChangesScope, { zh: string; en: string }> = {
  turn: { zh: '本轮变更', en: 'Last turn' },
  uncommitted: { zh: '未提交', en: 'Uncommitted' },
  staged: { zh: '已暂存', en: 'Staged' },
  unstaged: { zh: '未暂存', en: 'Unstaged' },
  history: { zh: '提交历史', en: 'History' },
  result: { zh: '子任务结果', en: 'Subagent results' },
};

/** Menu groups, separated by a rule: turn record | working tree | history | results. */
const SCOPE_GROUPS: readonly (readonly ChangesScope[])[] = [
  ['turn'],
  ['uncommitted', 'staged', 'unstaged'],
  ['history'],
  ['result'],
];

export function scopeLabel(scope: ChangesScope, locale: 'zh-CN' | 'en'): string {
  return locale === 'zh-CN' ? SCOPE_LABELS[scope].zh : SCOPE_LABELS[scope].en;
}

function ScopeIcon(props: { scope: ChangesScope }): ReactElement {
  const size = { width: 14, height: 14 };
  switch (props.scope) {
    case 'turn':
      return <IconSpark {...size} />;
    case 'uncommitted':
      return <IconFileDiff {...size} />;
    case 'staged':
      return <IconCheckCircle {...size} />;
    case 'unstaged':
      return <IconEdit {...size} />;
    case 'history':
      return <IconGit {...size} />;
    case 'result':
      return <IconAgent {...size} />;
  }
}

function TallyText(props: { tally: ScopeTally | null }): ReactElement | null {
  const { tally } = props;
  if (!tally || tally.files === 0) return null;
  return (
    <span className="changes-tally">
      <span className="changes-tally-files">{tally.files}</span>
      {tally.additions ? <span className="add">+{tally.additions}</span> : null}
      {tally.deletions ? <span className="del">−{tally.deletions}</span> : null}
    </span>
  );
}

export type ChangesScopeMenuProps = {
  scope: ChangesScope;
  options: readonly ScopeOption[];
  locale: 'zh-CN' | 'en';
  onSelect: (scope: ChangesScope) => void;
};

export function ChangesScopeMenu(props: ChangesScopeMenuProps): ReactElement {
  const current = props.options.find((option) => option.scope === props.scope);
  const groups = SCOPE_GROUPS.map((group) =>
    props.options.filter((option) => group.includes(option.scope)),
  ).filter((group) => group.length > 0);
  const items: ReactNode[] = [];
  groups.forEach((group, index) => {
    if (index > 0) items.push(<DropdownMenuSeparator key={`sep-${index}`} />);
    for (const option of group) {
      items.push(
        <DropdownMenuItem
          key={option.scope}
          icon={<ScopeIcon scope={option.scope} />}
          testId={`changes-scope-${option.scope}`}
          onSelect={() => props.onSelect(option.scope)}
        >
          <span className="changes-scope-item">
            <span className="changes-scope-item-label">{scopeLabel(option.scope, props.locale)}</span>
            <TallyText tally={option.tally} />
            {option.scope === props.scope ? (
              <IconCheck className="changes-scope-item-check" width={13} height={13} />
            ) : null}
          </span>
        </DropdownMenuItem>,
      );
    }
  });

  return (
    <DropdownMenu
      align="start"
      label={props.locale === 'zh-CN' ? '变更范围' : 'Change scope'}
      contentClassName="changes-scope-menu"
      testId="changes-scope-menu"
      trigger={
        <button type="button" className="changes-scope-trigger" data-testid="changes-scope-trigger">
          <ScopeIcon scope={props.scope} />
          <span className="changes-scope-label">{scopeLabel(props.scope, props.locale)}</span>
          <TallyText tally={current?.tally ?? null} />
          <IconChevronDown className="changes-scope-chevron" width={12} height={12} />
        </button>
      }
    >
      {items}
    </DropdownMenu>
  );
}

export type ChangesScopeEmptyProps = {
  scope: ChangesScope;
  options: readonly ScopeOption[];
  locale: 'zh-CN' | 'en';
  onSelect: (scope: ChangesScope) => void;
};

export function ChangesScopeEmpty(props: ChangesScopeEmptyProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const others = props.options.filter(
    (option) => option.scope !== props.scope && option.tally !== null && option.tally.files > 0,
  );
  const message =
    props.scope === 'uncommitted'
      ? isZh
        ? '工作区干净'
        : 'Working tree clean'
      : isZh
        ? `「${scopeLabel(props.scope, props.locale)}」中没有变更`
        : `No ${scopeLabel(props.scope, props.locale).toLowerCase()} changes`;
  return (
    <div className="changes-empty" data-testid="changes-empty">
      <p className="changes-empty-message">{message}</p>
      {others.length > 0 ? (
        <ul className="changes-empty-scopes">
          {others.map((option) => (
            <li key={option.scope}>
              <button
                type="button"
                className="changes-empty-scope"
                data-testid={`changes-empty-scope-${option.scope}`}
                onClick={() => props.onSelect(option.scope)}
              >
                <ScopeIcon scope={option.scope} />
                <span className="changes-empty-scope-label">{scopeLabel(option.scope, props.locale)}</span>
                <TallyText tally={option.tally} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
