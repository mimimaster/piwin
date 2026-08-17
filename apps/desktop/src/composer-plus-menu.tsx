/**
 * Composer "+" menu: P0/P1 attachments plus Skills, MCP, and Knowledge Center.
 * Modes are always Agent; orchestration lives on the toolbar.
 * Built on ui-kit menu primitives (Radix portal, positioning, Escape, arrow nav).
 */

import { type ReactElement, type ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@piwin/ui-kit';
import { IconBook, IconCards, IconDocument, IconFile, IconMcp, IconPaperclip, IconSkill } from './shell-icons';

export type ComposerPlusSubmenu = 'none' | 'skills' | 'mcp' | 'knowledge';

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
  submenu: ComposerPlusSubmenu;
  onSubmenu: (submenu: ComposerPlusSubmenu) => void;
  skills: ComposerSkillOption[];
  onOpenSkillsPanel: () => void;
  mcpServers: ComposerMcpOption[];
  onOpenMcpPanel: () => void;
  /** Open Knowledge Center overlay from composer menu. */
  onOpenKnowledge?: ((subTab?: 'doccards' | 'cards' | 'wiki') => void) | undefined;
  /** Open the right-panel Flashcards due queue. */
  onOpenCardsPanel?: (() => void) | undefined;
  /** Optional for isolated menu consumers that do not expose file uploads. */
  onAttachFile?: () => void;
  /** Optional image-only picker for quick access to screenshots. */
  onAttachImage?: () => void;
  /** Conversation chat keeps attachments and hides Skills / MCP. */
  hideAgentExtras?: boolean;
};

export function ComposerPlusMenu(props: ComposerPlusMenuProps): ReactElement {
  return (
    <DropdownMenu
      open={props.open}
      onOpenChange={props.onOpenChange}
      // Non-modal: the composer textarea behind the menu must stay usable.
      modal={false}
      side="top"
      align="start"
      label="Add tools and context"
      testId="composer-plus-menu"
      contentClassName="plus-menu"
      trigger={props.trigger}
    >
      {props.onAttachFile || props.onAttachImage ? (
        <DropdownMenuLabel className="plus-menu-caption muted">Attachments</DropdownMenuLabel>
      ) : null}

      {props.onAttachFile ? (
        <DropdownMenuItem onSelect={props.onAttachFile} testId="plus-menu-file">
          <span className="plus-menu-icon">
            <IconFile width={16} height={16} />
          </span>
          <span className="plus-menu-label">Attach file</span>
        </DropdownMenuItem>
      ) : null}

      {props.onAttachImage ? (
        <DropdownMenuItem onSelect={props.onAttachImage} testId="plus-menu-image">
          <span className="plus-menu-icon">
            <IconPaperclip width={16} height={16} />
          </span>
          <span className="plus-menu-label">Attach image</span>
        </DropdownMenuItem>
      ) : null}

      {props.onOpenKnowledge ? (
        <>
          <DropdownMenuLabel className="plus-menu-caption muted">Knowledge</DropdownMenuLabel>
          <DropdownMenuSub
            open={props.submenu === 'knowledge'}
            onOpenChange={(open) => props.onSubmenu(open ? 'knowledge' : 'none')}
          >
            <DropdownMenuSubTrigger testId="plus-menu-knowledge">
              <span className="plus-menu-icon">
                <IconBook width={16} height={16} />
              </span>
              <span className="plus-menu-label">Knowledge Center</span>
              <span className="plus-menu-chevron">›</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="plus-submenu" label="Knowledge Center">
              <DropdownMenuLabel className="plus-menu-caption muted">Knowledge flows</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => props.onOpenKnowledge?.('doccards')}
                testId="plus-menu-open-doccards"
              >
                <span className="plus-menu-icon">
                  <IconDocument width={14} height={14} />
                </span>
                <span className="plus-menu-label">Learn from folder</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => props.onOpenCardsPanel?.()}
                testId="plus-menu-open-flashcards"
              >
                <span className="plus-menu-icon">
                  <IconCards width={14} height={14} />
                </span>
                <span className="plus-menu-label">Flashcards (知识卡片复习)</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      ) : null}

      {props.hideAgentExtras === true ? null : (
        <DropdownMenuLabel className="plus-menu-caption muted">Skills & MCP</DropdownMenuLabel>
      )}

      {props.hideAgentExtras === true ? null : (
        <>
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
        </>
      )}
    </DropdownMenu>
  );
}
