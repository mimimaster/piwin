import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  activatePiBuiltinTools,
  buildPiSessionExcludedToolNames,
  PI_NATIVE_TOOL_NAMES,
} from './pi-session-tool-selection.js';

describe('buildPiSessionExcludedToolNames', () => {
  it('excludes Pi-native tools the policy does not grant', () => {
    expect(
      buildPiSessionExcludedToolNames({
        piBuiltinToolNames: ['read', 'grep', 'ls'],
        hostTools: [{ name: 'write_file' }, { name: 'web_search' }],
      }),
    ).toEqual(['bash', 'edit', 'write', 'find']);
  });

  it('keeps a native name that a Host tool reuses so the Host tool is not filtered', () => {
    expect(
      buildPiSessionExcludedToolNames({
        piBuiltinToolNames: ['read'],
        hostTools: [{ name: 'bash' }],
      }),
    ).toEqual(['edit', 'write', 'grep', 'find', 'ls']);
  });

  it('excludes every native tool when nothing is granted', () => {
    expect(buildPiSessionExcludedToolNames({ piBuiltinToolNames: [], hostTools: [] })).toEqual([
      ...PI_NATIVE_TOOL_NAMES,
    ]);
  });
});

describe('activatePiBuiltinTools', () => {
  it('ignores sessions without tool activation methods', () => {
    expect(() => activatePiBuiltinTools({ prompt: () => undefined }, ['read'])).not.toThrow();
  });
});

describe('Pi session tool selection (installed Pi)', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function tool(name: string): ToolDefinition {
    return {
      name,
      label: name,
      description: name,
      parameters: { type: 'object', properties: {} },
      execute: async () => ({ content: [], details: {} }),
    } as unknown as ToolDefinition;
  }

  async function createSession(
    tools = {
      piBuiltinToolNames: ['read', 'grep', 'ls'],
      hostTools: [{ name: 'bash' }, { name: 'web_search' }],
    },
  ) {
    const cwd = await mkdtemp(join(tmpdir(), 'piwin-tool-selection-cwd-'));
    const agentDir = await mkdtemp(join(tmpdir(), 'piwin-tool-selection-agent-'));
    dirs.push(cwd, agentDir);
    const settingsManager = SettingsManager.inMemory();
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noContextFiles: true,
      noSkills: true,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories: [
        (pi: ExtensionAPI) => {
          pi.registerTool(tool('ext_load_time'));
          pi.registerTool(tool('write'));
          pi.on('session_start', () => {
            pi.registerTool(tool('ext_session_start'));
          });
        },
      ],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(cwd),
      excludeTools: buildPiSessionExcludedToolNames(tools),
      customTools: tools.hostTools.map((hostTool) => tool(hostTool.name)),
    });
    activatePiBuiltinTools(session, tools.piBuiltinToolNames);
    await session.bindExtensions({ mode: 'rpc' });
    return session;
  }

  it('leaves no native tool behind when every mirrored native name is excluded', async () => {
    // Fails when a Pi upgrade adds a native tool PI_NATIVE_TOOL_NAMES misses.
    const session = await createSession({ piBuiltinToolNames: [], hostTools: [] });
    const nativeNames = session
      .getAllTools()
      .filter((entry) => entry.sourceInfo.source === 'builtin')
      .map((entry) => entry.name);
    expect(nativeNames).toEqual([]);
  });

  it('exposes Host tools, granted built-ins and extension tools, but not excluded natives', async () => {
    const session = await createSession();
    const active = session.getActiveToolNames();

    expect(active).toEqual(
      expect.arrayContaining([
        'read',
        'grep',
        'ls',
        'bash',
        'web_search',
        'ext_load_time',
        'ext_session_start',
      ]),
    );
    expect(active).not.toContain('edit');
    expect(active).not.toContain('find');
    // An extension cannot re-enable an excluded native name.
    expect(active).not.toContain('write');

    const bash = session.getAllTools().find((entry) => entry.name === 'bash');
    expect(bash?.sourceInfo.source).toBe('sdk');
  });
});
