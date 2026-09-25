import type { ReactElement } from 'react';

const SCOPE_ITEMS = [
  ['once', '仅这一次'],
  ['session', '本次会话'],
  ['project', '此项目'],
] as const;

export function ScopeOptionsSelector({
  scope,
  onSelect,
}: {
  scope: string;
  onSelect: (scope: 'once' | 'session' | 'project') => void;
}): ReactElement {
  return (
    <div className="scope-options" role="group" aria-label="批准范围">
      {SCOPE_ITEMS.map(([value, label]) => (
        <button
          key={value}
          className={scope === value ? 'active' : ''}
          onClick={() => onSelect(value)}
          aria-pressed={scope === value}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
