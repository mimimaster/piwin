import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { ProjectRecord, SessionScope } from '@piwin/contracts';
import { Dialog } from '@piwin/ui-kit';
import type { SessionListItemUi } from './chat-reducer';
import type { DesktopLocale } from './desktop-locale';
import { projectLabel } from './project-display-name';
import { IconChat, IconSearch } from './shell-icons';
import {
  buildSessionSearchDialogItems,
  type SessionSearchDialogItem,
} from './session-search-dialog-model';
import { formatSessionRelativeTime } from './session-relative-time';

export type SessionSearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  primaryScope: SessionScope;
  primarySessions: readonly SessionListItemUi[];
  generalSessions: readonly SessionListItemUi[];
  recentProjects: readonly ProjectRecord[];
  locale: DesktopLocale;
  onOpenSession: (sessionId: string, scope: SessionScope) => void;
};

type SessionSearchCopy = {
  dialogLabel: string;
  inputLabel: string;
  placeholder: string;
  recent: string;
  results: string;
  general: string;
  emptyTitle: string;
  emptyBody: string;
  resultCount: (count: number) => string;
};

function getSessionSearchCopy(locale: DesktopLocale): SessionSearchCopy {
  if (locale === 'zh-CN') {
    return {
      dialogLabel: '搜索会话',
      inputLabel: '按关键词搜索会话',
      placeholder: '搜索会话名称或对话内容…',
      recent: '最近会话',
      results: '搜索结果',
      general: '通用会话',
      emptyTitle: '没有找到相关会话',
      emptyBody: '试试更短或不同的关键词。',
      resultCount: (count) => `${count} 个结果`,
    };
  }
  return {
    dialogLabel: 'Search sessions',
    inputLabel: 'Search sessions by keyword',
    placeholder: 'Search session names or conversation content…',
    recent: 'Recent sessions',
    results: 'Search results',
    general: 'General',
    emptyTitle: 'No matching sessions',
    emptyBody: 'Try a shorter or different keyword.',
    resultCount: (count) => `${count} result${count === 1 ? '' : 's'}`,
  };
}

function sessionScopeLabel(
  scope: SessionScope,
  recentProjects: readonly ProjectRecord[],
  generalLabel: string,
): string {
  return scope.kind === 'general' ? generalLabel : projectLabel(scope.projectPath, recentProjects);
}

export function SessionSearchDialog(props: SessionSearchDialogProps): ReactElement {
  const copy = getSessionSearchCopy(props.locale);
  const listId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const resultButtonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const items = useMemo(
    () =>
      buildSessionSearchDialogItems({
        primaryScope: props.primaryScope,
        primarySessions: props.primarySessions,
        generalSessions: props.generalSessions,
        query: props.query,
      }),
    [props.generalSessions, props.primaryScope, props.primarySessions, props.query],
  );
  const hasQuery = props.query.trim().length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [props.open, props.query]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    const activeButton = resultButtonsRef.current[activeIndex];
    activeButton?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const openItem = (item: SessionSearchDialogItem | undefined): void => {
    if (!item) return;
    props.onOpenChange(false);
    props.onOpenSession(item.id, item.scope);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (items.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % items.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + items.length) % items.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openItem(items[activeIndex]);
    }
  };

  return (
    <Dialog
      label={copy.dialogLabel}
      open={props.open}
      onOpenChange={props.onOpenChange}
      testId="session-search-dialog"
      contentClassName="session-search-dialog"
      closeOnInteractOutside
    >
      <h2 className="sr-only">{copy.dialogLabel}</h2>
      <div className="session-search-input-row">
        <IconSearch width={18} height={18} aria-hidden />
        <input
          type="search"
          role="combobox"
          aria-label={copy.inputLabel}
          aria-controls={listId}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={items[activeIndex] ? `${listId}-option-${activeIndex}` : undefined}
          data-testid="session-search-input"
          value={props.query}
          placeholder={copy.placeholder}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          onChange={(event) => props.onQueryChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <kbd className="session-search-escape-hint">Esc</kbd>
      </div>

      <div className="session-search-section-heading" aria-hidden>
        <span>{hasQuery ? copy.results : copy.recent}</span>
        <span>{items.length}</span>
      </div>
      <span className="sr-only" aria-live="polite">
        {copy.resultCount(items.length)}
      </span>

      {items.length > 0 ? (
        <ul id={listId} className="session-search-results" role="listbox">
          {items.map((item, index) => {
            const relativeTime = formatSessionRelativeTime(item.updatedAt);
            const preview = item.lastPreview?.trim();
            const showPreview =
              hasQuery &&
              preview !== undefined &&
              preview.toLocaleLowerCase() !== item.name.trim().toLocaleLowerCase();
            return (
              <li key={`${item.scope.kind}:${item.id}`} role="presentation">
                <button
                  ref={(node) => {
                    resultButtonsRef.current[index] = node;
                  }}
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`session-search-result${index === activeIndex ? ' active' : ''}`}
                  data-testid="session-search-result"
                  data-session-id={item.id}
                  onPointerMove={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  onClick={() => openItem(item)}
                >
                  <span className="session-search-result-icon" aria-hidden>
                    <IconChat width={16} height={16} />
                  </span>
                  <span className="session-search-result-body">
                    <span className="session-search-result-title">{item.name}</span>
                    {showPreview ? (
                      <span className="session-search-result-snippet">{preview}</span>
                    ) : null}
                  </span>
                  <span className="session-search-result-meta">
                    <span className="session-search-result-scope">
                      {sessionScopeLabel(item.scope, props.recentProjects, copy.general)}
                    </span>
                    {relativeTime ? (
                      <time dateTime={item.updatedAt} aria-label={item.updatedAt}>
                        {relativeTime}
                      </time>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="session-search-empty" data-testid="session-search-empty">
          <IconSearch width={22} height={22} aria-hidden />
          <strong>{copy.emptyTitle}</strong>
          <span>{copy.emptyBody}</span>
        </div>
      )}

      <footer className="session-search-footer" aria-hidden>
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> {props.locale === 'zh-CN' ? '选择' : 'Select'}
        </span>
        <span>
          <kbd>↵</kbd> {props.locale === 'zh-CN' ? '打开' : 'Open'}
        </span>
        <span>
          <kbd>Esc</kbd> {props.locale === 'zh-CN' ? '关闭' : 'Close'}
        </span>
      </footer>
    </Dialog>
  );
}
