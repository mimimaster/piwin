/**
 * Cursor-style composer "+" menu: modes, image, skills, MCP.
 * Visual interaction reverse-engineered from Cursor Agent screenshots
 * (not from cdesktop). Built on ui-kit menu primitives, so Radix owns the
 * portal, positioning, outside dismissal, Escape, and arrow navigation.
 */

import { type ReactElement, type ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@piwin/ui-kit';
import { AGENT_MODES, type AgentModeId } from './agent-mode';
import { IconFolder, IconListTree, IconMcp, IconSkill, IconSpark, IconUsers } from './shell-icons';
import type { OrchestrationSchemeOption } from './OrchestrationSchemeControl';

export type ComposerPlusSubmenu = 'none' | 'skills' | 'mcp' | 'orchestration';

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
  /** The composer's "+" control; Radix renders it as the real menu trigger. */
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentMode: AgentModeId;
  onSelectMode: (mode: AgentModeId) => void;
  submenu: ComposerPlusSubmenu;
  onSubmenu: (submenu: ComposerPlusSubmenu) => void;
  skills: ComposerSkillOption[];
  onOpenSkillsPanel: () => void;
  mcpServers: ComposerMcpOption[];
  onOpenMcpPanel: () => void;
  onAttachImage: () => void;
  orchestrationSchemeOptions?: readonly OrchestrationSchemeOption[] | undefined;
  orchestrationSchemeId?: string | undefined;
  onOrchestrationSchemeChange?: ((schemeId: string) => void) | undefined;
  onOpenOrchestrationSchemeSettings?: (() => void) | undefined;
};

function modeIcon(modeId: AgentModeId): ReactElement {
  switch (modeId) {
    case 'plan':
      return <IconListTree />;
    case 'ask':
      return <IconUsers />;
    default:
      return <IconSpark />;
  }
}

export function ComposerPlusMenu(props: ComposerPlusMenuProps): ReactElement {
  return (
    <DropdownMenu
      open={props.open}
      onOpenChange={props.onOpenChange}
      // Non-modal: the composer textarea behind the menu must stay usable.
      modal={false}
      side="top"
      align="start"
      label="Add agents, context, tools"
      testId="composer-plus-menu"
      contentClassName="plus-menu"
      trigger={props.trigger}
    >
      <DropdownMenuLabel className="plus-menu-caption muted">
        Add agents, context, tools…
      </DropdownMenuLabel>
      {AGENT_MODES.map((mode) => (
        <DropdownMenuItem
          key={mode.id}
          onSelect={() => props.onSelectMode(mode.id)}
          testId={`plus-menu-mode-${mode.id}`}
        >
          <span className="plus-menu-icon">{modeIcon(mode.id)}</span>
          <span className="plus-menu-label" title={mode.description}>
            {mode.label}
          </span>
          {props.agentMode === mode.id ? <span className="plus-menu-check">✓</span> : null}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={props.onAttachImage} testId="plus-menu-image">
        <span className="plus-menu-icon">
          <IconFolder />
        </span>
        <span className="plus-menu-label">Image</span>
      </DropdownMenuItem>

      <DropdownMenuSub
        open={props.submenu === 'skills'}
        onOpenChange={(open) => props.onSubmenu(open ? 'skills' : 'none')}
      >
        <DropdownMenuSubTrigger testId="plus-menu-skills">
          <span className="plus-menu-icon">
            <IconSkill width={16} height={16} />
          </span>
          <span className="plus-menu-label">Skills</span>
          <span className="plus-menu-chevron">›</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="plus-submenu" label="Skills">
          <DropdownMenuLabel className="plus-menu-caption muted">Skills</DropdownMenuLabel>
          {props.skills.length === 0 ? (
            <DropdownMenuLabel className="plus-menu-empty muted">
              No skills loaded
            </DropdownMenuLabel>
          ) : (
            props.skills.slice(0, 12).map((skill) => (
              <DropdownMenuLabel key={skill.id} className="plus-menu-static">
                <span className="plus-menu-label">{skill.name}</span>
                <span className="plus-menu-flag muted">{skill.enabled ? 'on' : 'off'}</span>
              </DropdownMenuLabel>
            ))
          )}
          <DropdownMenuItem onSelect={props.onOpenSkillsPanel} testId="plus-menu-manage-skills">
            Manage skills…
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub
        open={props.submenu === 'mcp'}
        onOpenChange={(open) => props.onSubmenu(open ? 'mcp' : 'none')}
      >
        <DropdownMenuSubTrigger testId="plus-menu-mcp">
          <span className="plus-menu-icon">
            <IconMcp width={16} height={16} />
          </span>
          <span className="plus-menu-label">MCP Servers</span>
          <span className="plus-menu-chevron">›</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="plus-submenu" label="MCP Servers">
          <DropdownMenuLabel className="plus-menu-caption muted">MCP servers</DropdownMenuLabel>
          {props.mcpServers.length === 0 ? (
            <DropdownMenuLabel className="plus-menu-empty muted">
              No servers configured
            </DropdownMenuLabel>
          ) : (
            props.mcpServers.map((server) => (
              <DropdownMenuLabel key={server.id} className="plus-menu-static">
                <span className="plus-menu-label">{server.name}</span>
                <span className={server.running ? 'status-dot ok' : 'status-dot'}>
                  {server.running ? 'on' : 'off'}
                </span>
              </DropdownMenuLabel>
            ))
          )}
          <DropdownMenuItem onSelect={props.onOpenMcpPanel} testId="plus-menu-open-mcp">
            Open MCP Settings
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      {props.orchestrationSchemeOptions && props.orchestrationSchemeOptions.length > 0 ? (
        <DropdownMenuSub
          open={props.submenu === 'orchestration'}
          onOpenChange={(open) => props.onSubmenu(open ? 'orchestration' : 'none')}
        >
          <DropdownMenuSubTrigger testId="plus-menu-orchestration">
            <span className="plus-menu-icon">
              <IconSpark width={16} height={16} />
            </span>
            <span className="plus-menu-label">Orchestration</span>
            <span className="plus-menu-chevron">›</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="plus-submenu" label="Orchestration Scheme">
            <DropdownMenuLabel className="plus-menu-caption muted">Orchestration</DropdownMenuLabel>
            {props.orchestrationSchemeOptions.map((scheme) => (
              <DropdownMenuItem
                key={scheme.id}
                onSelect={() => props.onOrchestrationSchemeChange?.(scheme.id)}
                testId={`plus-menu-orchestration-${scheme.id}`}
              >
                <span className="plus-menu-label">{scheme.name}</span>
                {(props.orchestrationSchemeId ?? 'off') === scheme.id ? (
                  <span className="plus-menu-check">✓</span>
                ) : null}
              </DropdownMenuItem>
            ))}
            {props.onOpenOrchestrationSchemeSettings ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={props.onOpenOrchestrationSchemeSettings}
                  testId="plus-menu-manage-orchestration"
                >
                  Manage schemes…
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
    </DropdownMenu>
  );
}
