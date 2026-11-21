import { describe, expect, it } from 'vitest';
import {
  createDefaultWebConfig,
  SYSTEM_PROMPT_BUILTIN_ID,
  SYSTEM_PROMPT_INHERIT_ID,
  type PiwinConfig,
  type ProjectRecord,
} from '@piwin/contracts';
import {
  applyPresetScopeConfig,
  applyProjectPresetBinding,
  buildSystemPromptProjectOptions,
  derivePresetActivationScope,
  formatPresetStatusBadge,
  formatProjectOptionLabel,
  listBoundProjectsForPreset,
} from './system-prompt-projects';

function makeProject(path: string, displayName?: string): ProjectRecord {
  return {
    path,
    trust: 'trusted',
    ...(displayName ? { displayName } : {}),
    lastOpenedAt: '2026-11-20T00:00:00.000Z',
    createdAt: '2026-11-20T00:00:00.000Z',
  };
}

function makeConfig(projectPresetIds?: Record<string, string>): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [],
    media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1024,
    },
    web: createDefaultWebConfig(),
    ...(projectPresetIds
      ? {
          systemPrompts: {
            presets: [],
            projectPresetIds,
          },
        }
      : {}),
  };
}

describe('system-prompt-projects helpers', () => {
  it('deduplicates and preserves priority order across current, recent, configured, and extra paths', () => {
    const options = buildSystemPromptProjectOptions({
      currentProjectPath: '/repos/demo',
      recentProjects: [makeProject('/repos/other'), makeProject('/repos/demo')],
      projectPresetIds: {
        '/repos/configured-only': 'reviewer',
        '/repos/other': 'concise',
      },
      extraProjectPaths: ['/repos/picked', '/repos/configured-only', '  '],
    });

    expect(options.map((item) => item.path)).toEqual([
      '/repos/demo',
      '/repos/other',
      '/repos/configured-only',
      '/repos/picked',
    ]);
    expect(options[0]?.isCurrent).toBe(true);
    expect(options[0]?.assignedPresetId).toBeUndefined();
    expect(options[1]?.isCurrent).toBe(false);
    expect(options[1]?.assignedPresetId).toBe('concise');
    expect(options[2]?.assignedPresetId).toBe('reviewer');
    expect(options[3]?.assignedPresetId).toBeUndefined();
  });

  it('disambiguates duplicate basenames with immediate parent directory or full path fallback', () => {
    const options = buildSystemPromptProjectOptions({
      currentProjectPath: '/team-a/app',
      recentProjects: [
        makeProject('/team-b/app'),
        makeProject('app', 'app'),
        makeProject('/solo/unique'),
      ],
    });

    expect(options.map((item) => item.displayLabel)).toEqual([
      'app (team-a)',
      'app (team-b)',
      'app',
      'unique',
    ]);
    expect(formatProjectOptionLabel(options[0]!, true)).toBe('app (team-a)（当前）');
    expect(formatProjectOptionLabel(options[0]!, false)).toBe('app (team-a) (Current)');
    expect(formatProjectOptionLabel(options[1]!, true)).toBe('app (team-b)');
  });

  it('lists projects bound to a specific preset', () => {
    const options = buildSystemPromptProjectOptions({
      currentProjectPath: '/repos/demo',
      recentProjects: [makeProject('/repos/other'), makeProject('/repos/third')],
      projectPresetIds: {
        '/repos/demo': 'reviewer',
        '/repos/other': 'concise',
        '/repos/third': 'reviewer',
      },
    });

    expect(listBoundProjectsForPreset(options, 'reviewer').map((item) => item.path)).toEqual([
      '/repos/demo',
      '/repos/third',
    ]);
  });

  it('assigns, overwrites, and removes project bindings while omitting empty maps', () => {
    const base = makeConfig();
    const assigned = applyProjectPresetBinding(base, ' /repos/demo ', 'reviewer');
    expect(assigned.systemPrompts?.projectPresetIds).toEqual({ '/repos/demo': 'reviewer' });

    const overwritten = applyProjectPresetBinding(assigned, '/repos/demo', SYSTEM_PROMPT_BUILTIN_ID);
    expect(overwritten.systemPrompts?.projectPresetIds).toEqual({
      '/repos/demo': SYSTEM_PROMPT_BUILTIN_ID,
    });

    const cleared = applyProjectPresetBinding(overwritten, '/repos/demo', SYSTEM_PROMPT_INHERIT_ID);
    expect(cleared.systemPrompts?.projectPresetIds).toBeUndefined();
    expect('projectPresetIds' in (cleared.systemPrompts ?? {})).toBe(false);

    // Blank path is a no-op.
    expect(applyProjectPresetBinding(base, '   ', 'reviewer')).toBe(base);
  });

  it('derives, updates, and formats preset activation scopes while preserving unrelated bindings', () => {
    const initial: PiwinConfig = {
      ...makeConfig({
        '/repos/other': 'concise',
        '/repos/optout': SYSTEM_PROMPT_BUILTIN_ID,
      }),
    };

    expect(derivePresetActivationScope(initial.systemPrompts!, 'reviewer')).toEqual({
      scope: 'off',
      boundPaths: [],
    });
    expect(formatPresetStatusBadge(initial.systemPrompts!, 'reviewer', true)).toEqual({
      tone: 'inactive',
      text: '未启用',
    });

    const withProjects = applyPresetScopeConfig(initial, 'reviewer', {
      scope: 'projects',
      projectPaths: ['/repos/demo', ' /repos/extra '],
    });
    expect(withProjects.systemPrompts?.defaultPresetId).toBeUndefined();
    expect(withProjects.systemPrompts?.projectPresetIds).toEqual({
      '/repos/other': 'concise',
      '/repos/optout': SYSTEM_PROMPT_BUILTIN_ID,
      '/repos/demo': 'reviewer',
      '/repos/extra': 'reviewer',
    });
    expect(derivePresetActivationScope(withProjects.systemPrompts!, 'reviewer')).toEqual({
      scope: 'projects',
      boundPaths: ['/repos/demo', '/repos/extra'],
    });
    expect(formatPresetStatusBadge(withProjects.systemPrompts!, 'reviewer', true)).toEqual({
      tone: 'active',
      text: '2 个项目',
    });
    expect(formatPresetStatusBadge(withProjects.systemPrompts!, 'reviewer', false)).toEqual({
      tone: 'active',
      text: '2 projects',
    });

    const asGlobal = applyPresetScopeConfig(withProjects, 'reviewer', { scope: 'global' });
    expect(asGlobal.systemPrompts?.defaultPresetId).toBe('reviewer');
    expect(asGlobal.systemPrompts?.projectPresetIds).toEqual({
      '/repos/other': 'concise',
      '/repos/optout': SYSTEM_PROMPT_BUILTIN_ID,
    });
    expect(formatPresetStatusBadge(asGlobal.systemPrompts!, 'reviewer', true)).toEqual({
      tone: 'global',
      text: '全局默认',
    });

    const turnedOff = applyPresetScopeConfig(asGlobal, 'reviewer', { scope: 'off' });
    expect(turnedOff.systemPrompts?.defaultPresetId).toBeUndefined();
    expect('defaultPresetId' in (turnedOff.systemPrompts ?? {})).toBe(false);
    expect(turnedOff.systemPrompts?.projectPresetIds).toEqual({
      '/repos/other': 'concise',
      '/repos/optout': SYSTEM_PROMPT_BUILTIN_ID,
    });
  });
});
