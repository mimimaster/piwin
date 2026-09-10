/**
 * Composer "+" menu: P0/P1 attachments plus Skills, MCP, and Flashcards.
 * Modes live on the toolbar (Agent / Goal); this menu is attachments + Skills/MCP.
 * Built on ui-kit menu primitives (Radix portal, positioning, Escape, arrow nav).
 */

import { type ReactElement, type ReactNode } from 'react';
import type { SkillSource } from '@piwin/contracts';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@piwin/ui-kit';
import { IconCards, IconFile, IconMcp, IconPaperclip, IconSkill } from './shell-icons';
import { useDesktopLocale } from './desktop-locale-context';

export type ComposerPlusSubmenu = 'none' | 'skills' | 'mcp' | 'knowledge';

export type ComposerSkillOption = {
  id: string;
  name: string;
  enabled: boolean;
  /** SkillSource from Host list — used to hide project skills in Conversation. */
  source?: SkillSource;
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
  onOpenKnowledge?: ((subTab?: 'doccards' | 'cards' | 'wiki') => void) | undefined;
  onOpenCardsPanel?: (() => void) | undefined;
  /** Optional for isolated menu consumers that do not expose file uploads. */
  onAttachFile?: () => void;
  /** Optional image-only picker for quick access to screenshots. */
  onAttachImage?: () => void;
  /** Conversation chat keeps attachments and hides Skills / MCP. */
  hideAgentExtras?: boolean;
};

export function ComposerPlusMenu(props: ComposerPlusMenuProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
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
        <DropdownMenuLabel className="plus-menu-caption muted">
          {isZh ? '附件' : 'Attachments'}
        </DropdownMenuLabel>
      ) : null}

      {props.onAttachFile ? (
        <DropdownMenuItem onSelect={props.onAttachFile} testId="plus-menu-file">
          <span className="plus-menu-icon">
            <IconFile width={16} height={16} />
          </span>
          <span className="plus-menu-label">{isZh ? '添加文件' : 'Attach file'}</span>
        </DropdownMenuItem>
      ) : null}

      {props.onAttachImage ? (
        <DropdownMenuItem onSelect={props.onAttachImage} testId="plus-menu-image">
          <span className="plus-menu-icon">
            <IconPaperclip width={16} height={16} />
          </span>
          <span className="plus-menu-label">{isZh ? '添加图片' : 'Attach image'}</span>
        </DropdownMenuItem>
      ) : null}

      {props.onOpenKnowledge || props.onOpenCardsPanel ? (
        <DropdownMenuItem
          onSelect={() => {
            if (props.onOpenCardsPanel) {
              props.onOpenCardsPanel();
              return;
            }
            props.onOpenKnowledge?.();
          }}
          testId="plus-menu-open-flashcards"
        >
          <span className="plus-menu-icon">
            <IconCards width={16} height={16} />
          </span>
          <span className="plus-menu-label">{isZh ? '闪卡' : 'Flashcards'}</span>
        </DropdownMenuItem>
      ) : null}

      {props.hideAgentExtras === true ? null : (
        <DropdownMenuLabel className="plus-menu-caption muted">
          {isZh ? '技能与 MCP' : 'Skills & MCP'}
        </DropdownMenuLabel>
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
              <span className="plus-menu-label">{isZh ? '技能' : 'Skills'}</span>
              <span className="plus-menu-chevron">›</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="plus-submenu" label="Skills">
              <DropdownMenuLabel className="plus-menu-caption muted">
                {isZh ? '技能' : 'Skills'}
              </DropdownMenuLabel>
              {props.skills.length === 0 ? (
                <DropdownMenuLabel className="plus-menu-empty muted">
                  {isZh ? '未加载任何技能' : 'No skills loaded'}
                </DropdownMenuLabel>
              ) : (
                props.skills.slice(0, 12).map((skill) => (
                  <DropdownMenuLabel key={skill.id} className="plus-menu-static">
                    <span className="plus-menu-label">{skill.name}</span>
                    <span
                      className={`plus-menu-state-dot${skill.enabled ? ' is-on' : ''}`}
                      role="img"
                      aria-label={
                        skill.enabled
                          ? isZh
                            ? '已启用'
                            : 'enabled'
                          : isZh
                            ? '未启用'
                            : 'disabled'
                      }
                    />
                  </DropdownMenuLabel>
                ))
              )}
              <DropdownMenuItem onSelect={props.onOpenSkillsPanel} testId="plus-menu-manage-skills">
                {isZh ? '管理技能…' : 'Manage skills…'}
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
                  {isZh ? '未配置任何服务器' : 'No servers configured'}
                </DropdownMenuLabel>
              ) : (
                props.mcpServers.map((server) => (
                  <DropdownMenuLabel key={server.id} className="plus-menu-static">
                    <span className="plus-menu-label">{server.name}</span>
                    <span
                      className={`plus-menu-state-dot${server.running ? ' is-on' : ''}`}
                      role="img"
                      aria-label={
                        server.running
                          ? isZh
                            ? '在线'
                            : 'online'
                          : isZh
                            ? '离线'
                            : 'offline'
                      }
                    />
                  </DropdownMenuLabel>
                ))
              )}
              <DropdownMenuItem onSelect={props.onOpenMcpPanel} testId="plus-menu-open-mcp">
                {isZh ? '打开 MCP 设置' : 'Open MCP Settings'}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      )}
    </DropdownMenu>
  );
}
