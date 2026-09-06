import {
  mockThemeManifest,
  resolveMockThemeId,
} from './host-client-mock-helpers.js';
import type { MockHostBackend } from './host-client-mock.js';
import type {
  HostCommand,
  HostResponse,
} from '@piwin/contracts';
import {
  isJobTerminal,
} from '@piwin/contracts';

export async function handleMockCatalogCommands(
  host: MockHostBackend,
  command: HostCommand,
  id: string,
): Promise<HostResponse | null> {
  switch (command.type) {
      case 'theme/list': {
        const activeThemeId = host.mockActiveThemeId;
        return {
          id,
          type: 'response',
          command: 'theme/list',
          success: true,
          data: {
            activeThemeId,
            themes: [
              {
                id: 'piwin-obsidian',
                name: 'Obsidian',
                version: '1.0.0',
                mode: 'dark',
                path: '/mock/themes/piwin-obsidian',
                source: 'bundled',
                active: activeThemeId === 'piwin-obsidian',
              },
              {
                id: 'piwin-bone',
                name: 'Bone',
                version: '1.0.0',
                mode: 'light',
                path: '/mock/themes/piwin-bone',
                source: 'bundled',
                active: activeThemeId === 'piwin-bone',
              },
              {
                id: 'piwin-ink-wash',
                name: '砚夜泼墨',
                version: '1.0.0',
                mode: 'dark',
                path: '/mock/themes/piwin-ink-wash',
                source: 'bundled',
                active: activeThemeId === 'piwin-ink-wash',
              },
              {
                id: 'piwin-inkstone-paper',
                name: 'Inkstone · 纸',
                version: '1.0.0',
                mode: 'light',
                path: '/mock/themes/piwin-inkstone-paper',
                source: 'bundled',
                active: activeThemeId === 'piwin-inkstone-paper',
              },
              {
                id: 'piwin-inkstone-ink',
                name: 'Inkstone · 墨',
                version: '1.0.0',
                mode: 'dark',
                path: '/mock/themes/piwin-inkstone-ink',
                source: 'bundled',
                active: activeThemeId === 'piwin-inkstone-ink',
              },
            ],
          },
        };
      }
      case 'theme/get-active':
      case 'theme/set-active': {
        if (command.type === 'theme/set-active') {
          host.mockActiveThemeId = resolveMockThemeId(command.themeId);
        }
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: { theme: mockThemeManifest(host.mockActiveThemeId) },
        };
      }
      case 'theme/install-local':
        return {
          id,
          type: 'response',
          command: 'theme/install-local',
          success: true,
          data: { themeId: 'installed-theme', path: command.sourcePath },
        };
      case 'pet/list':
        return {
          id,
          type: 'response',
          command: 'pet/list',
          success: true,
          data: {
            activePetId: 'piwin-default',
            pets: [
              {
                id: 'piwin-default',
                displayName: 'Piwin Default',
                path: '/mock/pets/piwin-default',
                spritesheetAbsolutePath: '/mock/pets/piwin-default/spritesheet.png',
                source: 'bundled',
                active: true,
                valid: true,
                issues: [],
              },
            ],
          },
        };
      case 'pet/get-active':
      case 'pet/set-active':
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: {
            pet: {
              petId: command.type === 'pet/set-active' ? command.petId : 'piwin-default',
              displayName: 'Piwin Default',
              spritesheetAbsolutePath: '/mock/pets/piwin-default/spritesheet.png',
              state: 'idle',
              fps: 6,
              cellWidth: 48,
              cellHeight: 52,
              cols: 8,
              rows: 9,
              stateRows: {
                idle: 0,
                running: 1,
                waiting: 2,
                failed: 3,
                waving: 4,
                jumping: 5,
                review: 6,
              },
            },
          },
        };
      case 'pet/scan-local':
        return {
          id,
          type: 'response',
          command: 'pet/scan-local',
          success: true,
          data: {
            sourcePath: command.sourcePath,
            candidates: [
              {
                sourcePath: `${command.sourcePath}/mock-pet`,
                petId: 'mock-local-pet',
                displayName: 'Mock Local Pet',
                valid: true,
                issues: [],
              },
            ],
          },
        };
      case 'pet/install-local':
        return {
          id,
          type: 'response',
          command: 'pet/install-local',
          success: true,
          data: { petId: 'installed-pet', path: command.sourcePath },
        };
      case 'pet/install-local-batch':
        return {
          id,
          type: 'response',
          command: 'pet/install-local-batch',
          success: true,
          data: {
            installed: command.sourcePaths.map((sourcePath, index) => ({
              petId: `installed-pet-${index + 1}`,
              source: 'local' as const,
              path: sourcePath,
            })),
            failed: [],
          },
        };
      case 'pet/store-query':
        return {
          id,
          type: 'response',
          command: 'pet/store-query',
          success: true,
          data: {
            results: [
              {
                petId: 'mock-registry-pet',
                displayName: 'Mock Registry Pet',
                description: 'A mock pet from the registry.',
                version: '1.0.0',
                source: 'registry' as const,
                location: 'https://example.com/pets/mock-registry-pet.zip',
                installed: false,
                sha256: '0000000000000000000000000000000000000000000000000000000000000000',
                sizeBytes: 1024,
              },
            ],
          },
        };
      case 'pet/install-registry':
        return {
          id,
          type: 'response',
          command: 'pet/install-registry',
          success: true,
          data: {
            petId: 'mock-registry-pet',
            source: 'registry',
            path: '/mock/pets/mock-registry-pet',
          },
        };
      case 'pet/cancel':
        return {
          id,
          type: 'response',
          command: 'pet/cancel',
          success: true,
          data: { cancelled: true },
        };
      case 'skills/list':
        return {
          id,
          type: 'response',
          command: 'skills/list',
          success: true,
          data: {
            skills: [
              {
                id: 'find-skill',
                name: 'find-skill',
                description: 'Mock bundled skill',
                source: 'bundled',
                path: '/mock/skills/find-skill',
                enabled: true,
              },
              {
                id: 'create-skill',
                name: 'create-skill',
                description: 'Create a new Agent Skill',
                source: 'bundled',
                path: '/mock/skills/create-skill',
                enabled: true,
              },
              {
                id: 'writing-plans',
                name: 'writing-plans',
                description: 'Write implementation plans',
                source: 'bundled',
                path: '/mock/skills/writing-plans',
                enabled: true,
              },
            ],
          },
        };
      case 'skills/read': {
        const skillIdRaw =
          (typeof command.skillId === 'string' && command.skillId.trim()) ||
          (typeof command.legacyPath === 'string'
            ? command.legacyPath.replace(/\\/g, '/').match(/\/skills\/([^/]+)/i)?.[1]
            : null) ||
          'executing-plans';
        const skillId = String(skillIdRaw).toLowerCase();
        return {
          id,
          type: 'response',
          command: 'skills/read',
          success: true,
          data: {
            status: 'ready',
            skillId,
            name: skillId,
            effectiveSource: 'user',
            origin: 'unknown',
            displayRef: `skill:${skillId}`,
            content: `---\nname: ${skillId}\ndescription: Mock skill\n---\n\n# ${skillId}\n\nMock skill body for Doc Preview.\n`,
            byteSize: 64,
            truncated: false,
            provenance: 'current-resource',
          },
        };
      }
      case 'skills/install':
        return {
          id,
          type: 'response',
          command: 'skills/install',
          success: true,
          data: {
            skillId: command.name ?? 'mock-skill',
            targetPath: '/mock/.piwin/skills/mock-skill',
          },
        };
      case 'skills/set_enabled':
        return {
          id,
          type: 'response',
          command: 'skills/set_enabled',
          success: true,
          data: {
            skillId: command.skillId,
            enabled: command.enabled,
            disabledIds: command.enabled ? [] : [command.skillId],
          },
        };
      case 'extensions/list': {
        const extensions = [
          {
            id: 'path-guard',
            name: 'path-guard',
            description: 'Block write/edit targeting secret-like paths (.env, keys, credentials).',
            source: 'bundled' as const,
            path: '/mock/.piwin/extensions/path-guard.ts',
            enabled: !host.mockDisabledExtensionIds.has('path-guard'),
            hookEvents: ['tool_call'],
          },
          {
            id: 'goal',
            name: 'goal',
            description: 'Autonomous goal execution loop and tracking extension (@narumitw/pi-goal).',
            source: 'bundled' as const,
            path: '/mock/.piwin/extensions/goal.ts',
            enabled: !host.mockDisabledExtensionIds.has('goal'),
          },
        ];
        if (!host.mockBundledExtensionsInstalled) {
          return {
            id,
            type: 'response',
            command: 'extensions/list',
            success: true,
            data: { extensions: [] },
          };
        }
        return {
          id,
          type: 'response',
          command: 'extensions/list',
          success: true,
          data: { extensions },
        };
      }
      case 'extensions/set_enabled': {
        if (command.enabled) {
          host.mockDisabledExtensionIds.delete(command.extensionId);
        } else {
          host.mockDisabledExtensionIds.add(command.extensionId);
        }
        return {
          id,
          type: 'response',
          command: 'extensions/set_enabled',
          success: true,
          data: {
            extensionId: command.extensionId,
            enabled: command.enabled,
            disabledIds: [...host.mockDisabledExtensionIds],
          },
        };
      }
      case 'extensions/apply': {
        if (!host.sessions.has(command.sessionId)) {
          return {
            id,
            type: 'response',
            command: 'extensions/apply',
            success: false,
            error: `Unknown session: ${command.sessionId}`,
          };
        }
        return {
          id,
          type: 'response',
          command: 'extensions/apply',
          success: true,
          data: {
            sessionId: command.sessionId,
            deploymentId: command.deploymentId ?? `mock-deployment-${Date.now()}`,
            state: command.when === 'new-sessions-only' ? 'new-sessions-only' : 'active',
            when: command.when,
            registryRevision: 'mock-extension-registry',
            generationId: `mock-generation-${command.sessionId}`,
          },
        };
      }
      case 'extensions/ensure-bundled': {
        const installed = host.mockBundledExtensionsInstalled ? [] : ['path-guard', 'goal'];
        host.mockBundledExtensionsInstalled = true;
        return {
          id,
          type: 'response',
          command: 'extensions/ensure-bundled',
          success: true,
          data: { installed },
        };
      }
      case 'extensions/install':
        return {
          id,
          type: 'response',
          command: 'extensions/install',
          success: true,
          data: {
            extensionId: command.name ?? 'mock-extension',
            targetPath: '/mock/.piwin/extensions/mock-extension.ts',
          },
        };
      case 'plugins/list':
        return {
          id,
          type: 'response',
          command: 'plugins/list',
          success: true,
          data: { plugins: [] },
        };
      case 'plugins/install':
        return {
          id,
          type: 'response',
          command: 'plugins/install',
          success: true,
          data: {
            pluginId: 'mock-plugin',
            installedSkills: [],
            mcpServerIds: [],
            secretRefs: [],
          },
        };
      case 'plugins/uninstall':
        return {
          id,
          type: 'response',
          command: 'plugins/uninstall',
          success: true,
          data: { pluginId: command.pluginId ?? '', removed: null },
        };
      case 'plugins/registry/list':
        return {
          id,
          type: 'response',
          command: 'plugins/registry/list',
          success: true,
          data: { index: { version: 1, plugins: [] } },
        };
      case 'plugins/secrets/collect':
        return {
          id,
          type: 'response',
          command: 'plugins/secrets/collect',
          success: true,
          data: { pluginId: command.pluginId ?? '', secretRefs: [] },
        };
      case 'prompts/list':
        return {
          id,
          type: 'response',
          command: 'prompts/list',
          success: true,
          data: {
            prompts: [
              {
                id: 'review',
                name: 'review',
                description: 'Review recent changes',
                source: 'bundled',
                path: '/mock/.piwin/prompts/review.md',
                enabled: !host.mockDisabledPromptIds.has('review'),
              },
            ],
          },
        };
      case 'extension/ui_resolve':
        return {
          id,
          type: 'response',
          command: 'extension/ui_resolve',
          success: true,
          data: { requestId: command.requestId, ok: true },
        };
      case 'prompts/set_enabled': {
        if (command.enabled) {
          host.mockDisabledPromptIds.delete(command.promptId);
        } else {
          host.mockDisabledPromptIds.add(command.promptId);
        }
        return {
          id,
          type: 'response',
          command: 'prompts/set_enabled',
          success: true,
          data: {
            promptId: command.promptId,
            enabled: command.enabled,
            disabledIds: [...host.mockDisabledPromptIds],
          },
        };
      }

      case 'job/list':
        return {
          id,
          type: 'response',
          command: 'job/list',
          success: true,
          data: { jobs: [...host.mockJobs.values()] },
        };
      case 'job/get': {
        const job = host.mockJobs.get(command.jobId);
        if (!job) {
          return {
            id,
            type: 'response',
            command: 'job/get',
            success: false,
            error: `Unknown job: ${command.jobId}`,
          };
        }
        return {
          id,
          type: 'response',
          command: 'job/get',
          success: true,
          data: { job },
        };
      }
      case 'job/start': {
        const jobId = crypto.randomUUID();
        const now = new Date().toISOString();
        const record: import('@piwin/contracts').JobRecord = {
          jobId,
          kind: command.input.kind,
          lifetime: command.input.lifetime,
          command: command.input.command,
          argv: [...command.input.argv],
          cwd: command.input.cwd,
          status: 'running',
          startedAt: now,
          latestLogCursor: 0,
          ...(command.input.ownerRunId ? { ownerRunId: command.input.ownerRunId } : {}),
          ...(command.input.ownerSessionId ? { ownerSessionId: command.input.ownerSessionId } : {}),
          ...(command.input.ownerProjectPath
            ? { ownerProjectPath: command.input.ownerProjectPath }
            : {}),
          ...(command.input.label ? { label: command.input.label } : {}),
        };
        host.mockJobs.set(jobId, record);
        host.mockJobLogs.set(jobId, `[mock] started ${command.input.command}\n`);
        host.emitPush({ type: 'job/started', job: { ...record } });
        host.emitPush({ type: 'job/updated', job: { ...record } });
        return {
          id,
          type: 'response',
          command: 'job/start',
          success: true,
          data: { job: record },
        };
      }
      case 'job/wait': {
        const existing = host.mockJobs.get(command.input.jobId);
        if (!existing) {
          return {
            id,
            type: 'response',
            command: 'job/wait',
            success: false,
            error: `Unknown job: ${command.input.jobId}`,
          };
        }
        if (isJobTerminal(existing.status)) {
          return {
            id,
            type: 'response',
            command: 'job/wait',
            success: true,
            data: { job: existing },
          };
        }
        // No mock child ever terminates on its own; a wait on an active job
        // resolves only when the caller stops it (or the timeout elapses).
        const timeoutMs = command.input.timeoutMs ?? 120_000;
        const deadline = Date.now() + timeoutMs;
        return await new Promise<HostResponse>((resolve) => {
          const startedAt = Date.now();
          const poll = (): void => {
            const current = host.mockJobs.get(command.input.jobId);
            if (current && isJobTerminal(current.status)) {
              resolve({
                id,
                type: 'response',
                command: 'job/wait',
                success: true,
                data: { job: current },
              });
              return;
            }
            if (Date.now() >= deadline || Date.now() - startedAt >= timeoutMs) {
              resolve({
                id,
                type: 'response',
                command: 'job/wait',
                success: false,
                error: `job wait timeout: ${command.input.jobId}`,
              });
              return;
            }
            setTimeout(poll, 50);
          };
          poll();
        });
      }
      case 'job/logs': {
        const text = host.mockJobLogs.get(command.input.jobId) ?? '';
        return {
          id,
          type: 'response',
          command: 'job/logs',
          success: true,
          data: {
            jobId: command.input.jobId,
            chunks: text
              ? [
                  {
                    jobId: command.input.jobId,
                    stream: 'stdout' as const,
                    text,
                    at: new Date().toISOString(),
                    cursor: 0,
                  },
                ]
              : [],
            nextCursor: 0,
            hasMore: false,
          },
        };
      }
      case 'job/stop': {
        const existing = host.mockJobs.get(command.jobId);
        if (!existing) {
          return {
            id,
            type: 'response',
            command: 'job/stop',
            success: false,
            error: `Unknown job: ${command.jobId}`,
          };
        }
        const stopped = {
          ...existing,
          status: 'cancelled' as const,
          endedAt: new Date().toISOString(),
          terminalReason: 'user-stop' as const,
        };
        host.mockJobs.set(command.jobId, stopped);
        host.emitPush({ type: 'job/updated', job: { ...stopped } });
        host.emitPush({ type: 'job/exited', job: { ...stopped } });
        return {
          id,
          type: 'response',
          command: 'job/stop',
          success: true,
          data: {
            job: stopped,
            cleanup: {
              requestedJobIds: [command.jobId],
              stoppedJobIds: [command.jobId],
              alreadyTerminalJobIds: [],
              failedJobIds: [],
            },
          },
        };
      }
      case 'mcp/status':
        return {
          id,
          type: 'response',
          command: 'mcp/status',
          success: true,
          data: { servers: [] },
        };
      case 'mcp/start':
      case 'mcp/stop': {
        const health: {
          serverId: string;
          status: 'error' | 'stopped';
          command: string;
          disabled: boolean;
          toolCount: number;
          lastError?: string;
        } = {
          serverId: command.serverId,
          status: command.type === 'mcp/start' ? 'error' : 'stopped',
          command: 'mock',
          disabled: false,
          toolCount: 0,
        };
        if (command.type === 'mcp/start') {
          health.lastError = 'mock transport cannot start MCP';
        }
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: { health },
        };
      }
      case 'mcp/get':
        return {
          id,
          type: 'response',
          command: 'mcp/get',
          success: true,
          data: {
            path: '~/.piwin/mcp.json',
            document: host.mockMcpDocument,
          },
        };
      case 'mcp/validate': {
        const document = command.document as { mcpServers?: unknown };
        if (!document || typeof document !== 'object' || !document.mcpServers) {
          return {
            id,
            type: 'response',
            command: 'mcp/validate',
            success: true,
            data: {
              valid: false,
              issues: [{ path: 'mcpServers', message: 'missing mcpServers' }],
            },
          };
        }
        return {
          id,
          type: 'response',
          command: 'mcp/validate',
          success: true,
          data: { valid: true, document },
        };
      }
      case 'mcp/save': {
        const document = (command.document ?? {
          mcpServers: {},
        }) as import('@piwin/contracts').McpConfigDocument;
        if (!document.mcpServers || typeof document.mcpServers !== 'object') {
          return {
            id,
            type: 'response',
            command: 'mcp/save',
            success: false,
            error: 'invalid mcp document',
          };
        }
        host.mockMcpDocument = {
          mcpServers: { ...document.mcpServers },
        };
        return {
          id,
          type: 'response',
          command: 'mcp/save',
          success: true,
          data: {
            path: '~/.piwin/mcp.json',
            document: host.mockMcpDocument,
          },
        };
      }
      case 'mcp/list_tools':
        return {
          id,
          type: 'response',
          command: 'mcp/list_tools',
          success: true,
          data: {
            serverId: command.serverId,
            tools: [
              {
                serverId: command.serverId,
                name: 'echo',
                exposedName: `mcp__${command.serverId}__echo`,
                description: 'Mock MCP tool',
              },
            ],
          },
        };
      case 'skills/store-list':
        return {
          id,
          type: 'response',
          command: 'skills/store-list',
          success: true,
          data: {
            entries: [
              {
                id: 'mock-skill-creator',
                name: 'skill-creator',
                description: 'Mock store skill for e2e',
                source: {
                  kind: 'git',
                  url: 'https://github.com/anthropics/skills.git',
                  subdir: 'skills/skill-creator',
                },
              },
            ],
          },
        };
      case 'mcp/registry-list':
        return {
          id,
          type: 'response',
          command: 'mcp/registry-list',
          success: true,
          data: {
            cards: [
              {
                id: 'filesystem',
                title: 'Filesystem',
                description: 'Mock registry filesystem server',
                source: 'static',
                installDraft: {
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
                },
              },
            ],
          },
        };
      case 'mcp/registry-install-draft': {
        host.mockMcpDocument.mcpServers[command.serverId] = command.draft;
        return {
          id,
          type: 'response',
          command: 'mcp/registry-install-draft',
          success: true,
          data: { serverId: command.serverId, document: host.mockMcpDocument },
        };
      }
    default:
      return null;
  }
}

