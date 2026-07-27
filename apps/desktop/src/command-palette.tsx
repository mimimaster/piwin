/**
 * Cmd/Ctrl+K command palette — Dialog + deterministic token matching.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Dialog, Field } from '@piwin/ui-kit';
import {
  commandAvailability,
  filterDesktopCommands,
  type DesktopCommandId,
} from './desktop-commands';

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

  useEffect(() => {
    if (!props.open) {
      setQuery('');
    }
  }, [props.open]);

  return (
    <Dialog
      label="Command palette"
      open={props.open}
      onOpenChange={props.onOpenChange}
      testId="command-palette"
      closeOnInteractOutside
    >
      <h3>Commands</h3>
      <Field label="Search commands">
        <input
          data-testid="command-palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a command…"
          autoFocus
        />
      </Field>
      <ul className="command-palette-list" data-testid="command-palette-list">
        {commands.map((command) => {
          const availability = commandAvailability(command.id, {
            hasProject: props.hasProject,
            projectTrusted: props.projectTrusted,
            hasActiveSession: props.hasActiveSession,
          });
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
                <span className="command-palette-title">{command.title}</span>
                {command.shortcut ? (
                  <kbd className="command-palette-shortcut">{command.shortcut}</kbd>
                ) : null}
                {!availability.available && availability.reason ? (
                  <span className="muted command-palette-reason">{availability.reason}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
