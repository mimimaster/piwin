/**
 * Composer "+" menu: attachments, plus Skills and Connectors in Agent sessions.
 * Modes live on the toolbar (Agent / Goal). Connectors lists MCP servers with a
 * per-session switch; Conversation chat never loads MCP, so it only attaches.
 * Built on ui-kit menu primitives (Radix portal, positioning, Escape, arrow nav).
 */

import { type ReactElement, type ReactNode } from 'react';
import type { McpServerRuntimeStatus, SkillSource } from '@piwin/contracts';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSwitchItem,
} from '@piwin/ui-kit';
import { IconFile, IconImage, IconMcp, IconPlug, IconSkill } from './shell-icons';
import { useDesktopLocale } from './desktop-locale-context';
import type { SessionMcpSwitches } from './hooks/use-session-mcp-switches';

export type ComposerPlusSubmenu = 'none' | 'skills' | 'connectors';

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
  status: McpServerRuntimeStatus | 'unknown';
  toolCount?: number;
  globallyDisabled: boolean;
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
  /** Session-level MCP switches; rows render read-only without them. */
  mcpSwitches?: Pick<
    SessionMcpSwitches,
    'supported' | 'disabledServerIds' | 'error' | 'setServerEnabled'
  >;
  onOpenMcpPanel: () => void;
  /** Optional for isolated menu consumers that do not expose file uploads. */
  onAttachFile?: () => void;
  /** Optional image-only picker for quick access to screenshots. */
  onAttachImage?: () => void;
  /** Conversation chat keeps attachments and hides Skills / Connectors. */
  hideAgentExtras?: boolean;
};

function connectorMeta(server: ComposerMcpOption, isZh: boolean): string | null {
  if (server.globallyDisabled) return isZh ? '全局已停用' : 'Off globally';
  if (server.status === 'error') return isZh ? '出错' : 'Error';
  if (server.status === 'starting') return isZh ? '启动中' : 'Starting';
  if (server.toolCount !== undefined) {
    return isZh ? `${server.toolCount} 个工具` : `${server.toolCount} tools`;
  }
  return null;
}

export function ComposerPlusMenu(props: ComposerPlusMenuProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const hasAttachments = Boolean(props.onAttachFile || props.onAttachImage);
  const showAgentExtras = props.hideAgentExtras !== true;
  const switches = props.mcpSwitches?.supported === true ? props.mcpSwitches : null;
  const enabledConnectorCount = props.mcpServers.filter(
    (server) => !server.globallyDisabled && !switches?.disabledServerIds.includes(server.id),
  ).length;

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
      {hasAttachments ? (
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
            <IconImage width={16} height={16} />
          </span>
          <span className="plus-menu-label">{isZh ? '添加图片' : 'Attach image'}</span>
        </DropdownMenuItem>
      ) : null}

      {showAgentExtras && hasAttachments ? <DropdownMenuSeparator /> : null}

      {showAgentExtras ? (
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
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={props.onOpenSkillsPanel} testId="plus-menu-manage-skills">
                {isZh ? '管理技能…' : 'Manage skills…'}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub
            open={props.submenu === 'connectors'}
            onOpenChange={(open) => props.onSubmenu(open ? 'connectors' : 'none')}
          >
            <DropdownMenuSubTrigger testId="plus-menu-connectors">
              <span className="plus-menu-icon">
                <IconPlug width={16} height={16} />
              </span>
              <span className="plus-menu-label">{isZh ? '连接器' : 'Connectors'}</span>
              {enabledConnectorCount > 0 ? (
                <span className="plus-menu-count">{enabledConnectorCount}</span>
              ) : null}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="plus-submenu plus-connectors" label="Connectors">
              <DropdownMenuLabel className="plus-menu-caption muted">
                {isZh ? '本会话的 MCP 服务器' : 'MCP servers in this session'}
              </DropdownMenuLabel>
              {props.mcpServers.length === 0 ? (
                <DropdownMenuLabel className="plus-menu-empty muted">
                  {isZh ? '未配置任何服务器' : 'No servers configured'}
                </DropdownMenuLabel>
              ) : (
                props.mcpServers.map((server) => {
                  const meta = connectorMeta(server, isZh);
                  const metaNode = meta ? (
                    <span
                      className={`plus-menu-meta${server.status === 'error' ? ' is-error' : ''}`}
                    >
                      {meta}
                    </span>
                  ) : null;
                  if (!switches) {
                    return (
                      <DropdownMenuLabel key={server.id} className="plus-menu-static">
                        <span className="plus-menu-icon">
                          <IconMcp width={14} height={14} />
                        </span>
                        <span className="plus-menu-label">{server.name}</span>
                        {metaNode}
                      </DropdownMenuLabel>
                    );
                  }
                  const checked =
                    !server.globallyDisabled && !switches.disabledServerIds.includes(server.id);
                  return (
                    <DropdownMenuSwitchItem
                      key={server.id}
                      checked={checked}
                      disabled={server.globallyDisabled}
                      onCheckedChange={(next) => switches.setServerEnabled(server.id, next)}
                      testId={`plus-menu-connector-${server.id}`}
                      icon={<IconMcp width={14} height={14} />}
                    >
                      <span className="plus-menu-connector-name">{server.name}</span>
                      {metaNode}
                    </DropdownMenuSwitchItem>
                  );
                })
              )}
              {switches?.error ? (
                <DropdownMenuLabel className="plus-menu-empty plus-menu-error">
                  {switches.error}
                </DropdownMenuLabel>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={props.onOpenMcpPanel} testId="plus-menu-open-mcp">
                {isZh ? '管理连接器…' : 'Manage connectors…'}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      ) : null}
    </DropdownMenu>
  );
}
