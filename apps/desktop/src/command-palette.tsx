/**
 * Cmd/Ctrl+K command palette — Dialog + deterministic token matching.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Dialog, Field } from '@piwin/ui-kit';
import {
  commandAvailability,
  COMMAND_GROUP_ORDER,
  commandGroupLabel,
  commandTitle,
  filterDesktopCommands,
  type DesktopCommandIcon,
  type DesktopCommandId,
} from './desktop-commands';
import { useDesktopLocale } from './desktop-locale-context';
import {
  IconBrowser,
  IconDocument,
  IconFile,
  IconFolder,
  IconGit,
  IconPanelRight,
  IconPlus,
  IconSearch,
  IconSettings,
  IconPanelLeft,
  IconStop,
  IconTerminal,
} from './shell-icons';

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasProject: boolean;
  projectTrusted: boolean;
  hasActiveSession: boolean;
  onRun: (commandId: DesktopCommandId) => void;
};

export function CommandPalette(props: CommandPaletteProps): ReactElement {
  const [query, setQuery] = useState('');
  const commands = useMemo(() => filterDesktopCommands(query), [query]);
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';

  useEffect(() => {
    if (!props.open) {
      setQuery('');
    }
  }, [props.open]);

  return (
    <Dialog
      label={isChinese ? '命令面板' : 'Command palette'}
      open={props.open}
      onOpenChange={props.onOpenChange}
      testId="command-palette"
      closeOnInteractOutside
    >
      <h3>{isChinese ? '命令' : 'Commands'}</h3>
      <Field label={isChinese ? '搜索命令' : 'Search commands'}>
        <input
          data-testid="command-palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={isChinese ? '输入命令…' : 'Type a command…'}
          autoFocus
        />
      </Field>
      <ul className="command-palette-list" data-testid="command-palette-list">
        {COMMAND_GROUP_ORDER.map((group) => {
          const groupCommands = commands.filter((command) => command.group === group);
          if (groupCommands.length === 0) {
            return null;
          }
          return (
            <li key={group} className="command-palette-section">
              <div className="command-palette-group">{commandGroupLabel(group, locale)}</div>
              <ul>
                {groupCommands.map((command) => {
                  const availability = commandAvailability(
                    command.id,
                    {
                      hasProject: props.hasProject,
                      projectTrusted: props.projectTrusted,
                      hasActiveSession: props.hasActiveSession,
                    },
                    locale,
                  );
                  return (
                    <li key={command.id}>
                      <button
                        type="button"
                        className="command-palette-item"
                        data-testid={`command-${command.id}`}
                        disabled={!availability.available}
                        title={availability.reason}
                        onClick={() => {
                          if (!availability.available) {
                            return;
                          }
                          props.onRun(command.id);
                          props.onOpenChange(false);
                        }}
                      >
                        <span className="command-palette-icon" aria-hidden>
                          {commandIcon(command.icon)}
                        </span>
                        <span className="command-palette-title">
                          {commandTitle(command, locale)}
                        </span>
                        {!availability.available && availability.reason ? (
                          <span className="muted command-palette-reason">{availability.reason}</span>
                        ) : null}
                        {command.shortcut ? (
                          <kbd className="command-palette-shortcut">{command.shortcut}</kbd>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

function commandIcon(icon: DesktopCommandIcon): ReactElement {
  const size = 14;
  switch (icon) {
    case 'plus':
      return <IconPlus width={size} height={size} />;
    case 'search':
      return <IconSearch width={size} height={size} />;
    case 'composer':
      return <IconDocument width={size} height={size} />;
    case 'inspector':
      return <IconPanelRight width={size} height={size} />;
    case 'terminal':
      return <IconTerminal width={size} height={size} />;
    case 'settings':
      return <IconSettings width={size} height={size} />;
    case 'folder':
      return <IconFolder width={size} height={size} />;
    case 'sidebar':
      return <IconPanelLeft width={size} height={size} />;
    case 'panel':
      return <IconPanelRight width={size} height={size} />;
    case 'stop':
      return <IconStop width={size} height={size} />;
    case 'file':
      return <IconFile width={size} height={size} />;
    case 'changes':
      return <IconGit width={size} height={size} />;
    case 'browser':
      return <IconBrowser width={size} height={size} />;
    case 'document':
      return <IconDocument width={size} height={size} />;
  }
}
