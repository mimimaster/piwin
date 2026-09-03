/**
 * Composer + menu catalogs (skills / MCP). Isolated from App so the dock can
 * refresh those lists without dragging Host request plumbing through the shell.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ComposerPlusSubmenu } from '../composer-plus-menu';
import type { HostClient } from '../host-client';

export type ComposerMenuSkill = { id: string; name: string; enabled: boolean };
export type ComposerMenuMcp = { id: string; name: string; running: boolean };

export function mapComposerMenuSkills(
  skills: ReadonlyArray<{ id: string; name?: string; enabled?: boolean }>,
): ComposerMenuSkill[] {
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name ?? skill.id,
    enabled: skill.enabled !== false,
  }));
}

export function mapComposerMenuMcp(
  mcpServers: Readonly<Record<string, unknown>>,
): ComposerMenuMcp[] {
  return Object.keys(mcpServers).map((serverId) => ({
    id: serverId,
    name: serverId,
    running: false,
  }));
}

export type UseComposerPlusMenuArgs = {
  hostClient: HostClient;
  projectPath: string | null;
  /** Skip the first fetch until Host can answer `skills/list`. */
  hostReady?: boolean;
};

export function useComposerPlusMenu(args: UseComposerPlusMenuArgs) {
  const { hostClient, projectPath, hostReady } = args;
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
        skills?: Array<{ id: string; name?: string; enabled?: boolean }>;
      };
      setMenuSkills(mapComposerMenuSkills(data.skills ?? []));
    }
    const mcpResponse = hostClient.supportsCommand('mcp/get')
      ? await hostClient.request({ type: 'mcp/get' } as never)
      : null;
    if (mcpResponse?.success && mcpResponse.data) {
      const data = mcpResponse.data as {
        document?: { mcpServers?: Record<string, { command?: string }> };
      };
      setMenuMcp(mapComposerMenuMcp(data.document?.mcpServers ?? {}));
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

  return {
    plusMenuOpen,
    setPlusMenuOpen,
    plusSubmenu,
    setPlusSubmenu,
    menuSkills,
    menuMcp,
    refreshComposerMenus,
  };
}
