/**
 * Cursor-style composer "+" menu: modes, image, models, skills, MCP.
 * Visual interaction reverse-engineered from Cursor Agent screenshots
 * (not from cdesktop). Submenus open nested flyouts.
 */

import { useEffect, useRef, type ReactElement } from 'react';
import {
  AGENT_MODES,
  type AgentModeId,
} from './agent-mode';
import {
  IconFolder,
  IconListTree,
  IconPaperclip,
  IconPlug,
  IconSearch,
  IconSpark,
  IconUsers,
} from './shell-icons';

export type ComposerPlusSubmenu = 'none' | 'models' | 'skills' | 'mcp';

export type ComposerModelOption = {
  key: string;
  label: string;
};

export type ComposerSkillOption = {
  id: string;
  name: string;
  enabled: boolean;
};

export type ComposerMcpOption = {
  id: string;
  name: string;
  running: boolean;
};

export type ComposerPlusMenuProps = {
  open: boolean;
  onClose: () => void;
  agentMode: AgentModeId;
  onSelectMode: (mode: AgentModeId) => void;
  submenu: ComposerPlusSubmenu;
  onSubmenu: (submenu: ComposerPlusSubmenu) => void;
  models: ComposerModelOption[];
  selectedModelKey: string;
  onSelectModel: (key: string) => void;
  skills: ComposerSkillOption[];
  onOpenSkillsPanel: () => void;
  mcpServers: ComposerMcpOption[];
  onOpenMcpPanel: () => void;
  onAttachImage: () => void;
};

function modeIcon(modeId: AgentModeId): ReactElement {
  switch (modeId) {
    case 'plan':
      return <IconListTree />;
    case 'debug':
      return <IconSearch />;
    case 'ask':
      return <IconUsers />;
    default:
      return <IconSpark />;
  }
}

export function ComposerPlusMenu(props: ComposerPlusMenuProps): ReactElement | null {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      const target = event.target as Node | null;
      if (rootRef.current && target && !rootRef.current.contains(target)) {
        props.onClose();
      }
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        props.onClose();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [props]);

  if (!props.open) {
    return null;
  }

  return (
    <div className="plus-menu-root" ref={rootRef} data-testid="composer-plus-menu">
      <div className="plus-menu" role="menu" aria-label="Add agents, context, tools">
        <div className="plus-menu-caption muted">Add agents, context, tools…</div>
        <div className="plus-menu-section">
          {AGENT_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="menuitem"
              className={
                props.agentMode === mode.id
                  ? 'plus-menu-item active'
                  : 'plus-menu-item'
              }
              onClick={() => {
                props.onSelectMode(mode.id);
                props.onClose();
              }}
              title={mode.description}
            >
              <span className="plus-menu-icon">{modeIcon(mode.id)}</span>
              <span className="plus-menu-label">{mode.label}</span>
              {props.agentMode === mode.id ? (
                <span className="plus-menu-check">✓</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="plus-menu-divider" />
        <button
          type="button"
          role="menuitem"
          className="plus-menu-item"
          onClick={() => {
            props.onAttachImage();
            props.onClose();
          }}
        >
          <span className="plus-menu-icon">
            <IconFolder />
          </span>
          <span className="plus-menu-label">Image</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className={
            props.submenu === 'models' ? 'plus-menu-item active' : 'plus-menu-item'
          }
          onClick={() =>
            props.onSubmenu(props.submenu === 'models' ? 'none' : 'models')
          }
        >
          <span className="plus-menu-icon">
            <IconSpark />
          </span>
          <span className="plus-menu-label">Models</span>
          <span className="plus-menu-chevron">›</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className={
            props.submenu === 'skills' ? 'plus-menu-item active' : 'plus-menu-item'
          }
          onClick={() =>
            props.onSubmenu(props.submenu === 'skills' ? 'none' : 'skills')
          }
        >
          <span className="plus-menu-icon">
            <IconSpark />
          </span>
          <span className="plus-menu-label">Skills</span>
          <span className="plus-menu-chevron">›</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className={props.submenu === 'mcp' ? 'plus-menu-item active' : 'plus-menu-item'}
          onClick={() => props.onSubmenu(props.submenu === 'mcp' ? 'none' : 'mcp')}
        >
          <span className="plus-menu-icon">
            <IconPlug />
          </span>
          <span className="plus-menu-label">MCP Servers</span>
          <span className="plus-menu-chevron">›</span>
        </button>
      </div>

      {props.submenu === 'models' ? (
        <div className="plus-submenu" role="menu" aria-label="Models">
          <div className="plus-menu-caption muted">Search models…</div>
          {props.models.length === 0 ? (
            <div className="plus-menu-empty muted">No models — open Settings</div>
          ) : (
            props.models.map((model) => (
              <button
                key={model.key}
                type="button"
                role="menuitem"
                className={
                  props.selectedModelKey === model.key
                    ? 'plus-menu-item active'
                    : 'plus-menu-item'
                }
                onClick={() => {
                  props.onSelectModel(model.key);
                  props.onClose();
                }}
              >
                <span className="plus-menu-label">{model.label}</span>
                {props.selectedModelKey === model.key ? (
                  <span className="plus-menu-check">✓</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}

      {props.submenu === 'skills' ? (
        <div className="plus-submenu" role="menu" aria-label="Skills">
          <div className="plus-menu-caption muted">Skills</div>
          {props.skills.length === 0 ? (
            <div className="plus-menu-empty muted">No skills loaded</div>
          ) : (
            props.skills.slice(0, 12).map((skill) => (
              <div key={skill.id} className="plus-menu-static">
                <span className="plus-menu-label">{skill.name}</span>
                <span className="muted" style={{ fontSize: 11 }}>
                  {skill.enabled ? 'on' : 'off'}
                </span>
              </div>
            ))
          )}
          <button
            type="button"
            className="plus-menu-item"
            onClick={() => {
              props.onOpenSkillsPanel();
              props.onClose();
            }}
          >
            Manage skills…
          </button>
        </div>
      ) : null}

      {props.submenu === 'mcp' ? (
        <div className="plus-submenu" role="menu" aria-label="MCP Servers">
          <div className="plus-menu-caption muted">MCP servers</div>
          {props.mcpServers.length === 0 ? (
            <div className="plus-menu-empty muted">No servers configured</div>
          ) : (
            props.mcpServers.map((server) => (
              <div key={server.id} className="plus-menu-static">
                <span className="plus-menu-label">{server.name}</span>
                <span
                  className={server.running ? 'status-dot ok' : 'status-dot'}
                  style={{ fontSize: 10 }}
                >
                  {server.running ? 'on' : 'off'}
                </span>
              </div>
            ))
          )}
          <button
            type="button"
            className="plus-menu-item"
            onClick={() => {
              props.onOpenMcpPanel();
              props.onClose();
            }}
          >
            Open MCP Settings
          </button>
        </div>
      ) : null}
    </div>
  );
}

// keep paperclip import used if we reference Image differently
void IconPaperclip;
