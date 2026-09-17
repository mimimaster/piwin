/**
 * Composer + menu catalogs (skills / MCP connectors). Isolated from App so the
 * dock can refresh those lists without dragging Host request plumbing through
 * the shell.
 */
import { useCallback, useEffect, useState } from 'react';
import type { McpServerHealth, McpServerRuntimeStatus, SkillSource } from '@piwin/contracts';
import type { ComposerPlusSubmenu } from '../composer-plus-menu';
import type { HostClient } from '../host-client';
import { SKILLS_CHANGED_EVENT } from '../skills-changed.js';
import { useSessionMcpSwitches } from './use-session-mcp-switches.js';

export type ComposerMenuSkill = {
  id: string;
  name: string;
  enabled: boolean;
  source?: SkillSource;
};
export type ComposerMenuMcp = {
  id: string;
  name: string;
  /** Global runtime status; `unknown` until `mcp/status` answers. */
  status: McpServerRuntimeStatus | 'unknown';
  /** Tools the server exposes, when the Host has listed them. */
  toolCount?: number;
  /** Switched off in the global MCP config — no session can turn it on. */
  globallyDisabled: boolean;
};

export function mapComposerMenuSkills(
  skills: ReadonlyArray<{
    id: string;
    name?: string;
    enabled?: boolean;
    source?: SkillSource;
  }>,
): ComposerMenuSkill[] {
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name ?? skill.id,
    enabled: skill.enabled !== false,
    ...(skill.source ? { source: skill.source } : {}),
  }));
}

export function mapComposerMenuMcp(
  mcpServers: Readonly<Record<string, { disabled?: boolean }>>,
  health: readonly McpServerHealth[] = [],
): ComposerMenuMcp[] {
  const healthById = new Map(health.map((entry) => [entry.serverId, entry]));
  return Object.keys(mcpServers).map((serverId) => {
    const entry = healthById.get(serverId);
    const globallyDisabled = mcpServers[serverId]?.disabled === true || entry?.disabled === true;
    return {
      id: serverId,
      name: serverId,
      status: entry?.status ?? (globallyDisabled ? 'disabled' : 'unknown'),
      ...(entry && entry.toolCount > 0 ? { toolCount: entry.toolCount } : {}),
      globallyDisabled,
    };
  });
}

export type UseComposerPlusMenuArgs = {
  hostClient: HostClient;
  projectPath: string | null;
  /** Skip the first fetch until Host can answer `skills/list`. */
  hostReady?: boolean;
  /** Session whose MCP switches the Connectors flyout edits; null in a draft. */
  activeSessionId: string | null;
  sessionDisabledMcpServerIds: readonly string[] | undefined;
};

export function useComposerPlusMenu(args: UseComposerPlusMenuArgs) {
  const { hostClient, projectPath, hostReady } = args;
  const mcpSwitches = useSessionMcpSwitches({
    hostClient,
    activeSessionId: args.activeSessionId,
    sessionDisabledServerIds: args.sessionDisabledMcpServerIds,
  });
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [plusSubmenu, setPlusSubmenu] = useState<ComposerPlusSubmenu>('none');
  const [menuSkills, setMenuSkills] = useState<ComposerMenuSkill[]>([]);
  const [menuMcp, setMenuMcp] = useState<ComposerMenuMcp[]>([]);

  const refreshComposerMenus = useCallback(async (): Promise<void> => {
    const skillsResponse = await hostClient.request({
      type: 'skills/list',
      ...(hostClient.getTransport() !== 'remote' && projectPath ? { projectPath } : {}),
    } as never);
    if (skillsResponse.success && skillsResponse.data) {
      const data = skillsResponse.data as {
        skills?: Array<{
          id: string;
          name?: string;
          enabled?: boolean;
          source?: SkillSource;
        }>;
      };
      setMenuSkills(mapComposerMenuSkills(data.skills ?? []));
    }
    const mcpResponse = hostClient.supportsCommand('mcp/get')
      ? await hostClient.request({ type: 'mcp/get' } as never)
      : null;
    if (mcpResponse?.success && mcpResponse.data) {
      const data = mcpResponse.data as {
        document?: { mcpServers?: Record<string, { command?: string; disabled?: boolean }> };
      };
      const statusResponse = hostClient.supportsCommand('mcp/status')
        ? await hostClient.request({ type: 'mcp/status' } as never)
        : null;
      const health =
        statusResponse?.success && statusResponse.data
          ? ((statusResponse.data as { servers?: McpServerHealth[] }).servers ?? [])
          : [];
      setMenuMcp(mapComposerMenuMcp(data.document?.mcpServers ?? {}, health));
    }
  }, [hostClient, projectPath]);

  useEffect(() => {
    // Skills live under ~/.piwin, not the current session. Draft composers
    // (no session yet) still need the catalog so `/` can list them.
    if (hostReady === false) {
      return;
    }
    void refreshComposerMenus();
  }, [hostReady, refreshComposerMenus]);

  useEffect(() => {
    const onSkillsChanged = (): void => {
      void refreshComposerMenus();
    };
    window.addEventListener(SKILLS_CHANGED_EVENT, onSkillsChanged);
    return () => {
      window.removeEventListener(SKILLS_CHANGED_EVENT, onSkillsChanged);
    };
  }, [refreshComposerMenus]);

  return {
    plusMenuOpen,
    setPlusMenuOpen,
    plusSubmenu,
    setPlusSubmenu,
    menuSkills,
    menuMcp,
    mcpSwitches,
    refreshComposerMenus,
  };
}
