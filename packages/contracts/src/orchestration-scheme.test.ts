import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ULTRA_CODE_SCHEME,
  ORCHESTRATION_SCHEME_OFF_ID,
  REVIEWED_DELIVERY_REVIEWER_REPORT_CONTRACT,
  REVIEWED_DELIVERY_SCHEME_ID,
  isValidOrchestrationSchemeId,
  OrchestrationSchemeError,
  PIWIN_REPORT_CONTRACT_MARKER,
  ULTRA_CODE_SCOUT_REPORT_CONTRACT,
  applySchemeToSubagentSpawnInput,
  formatSubagentReportContractBlock,
  clampThinkingLevelToMax,
  compareThinkingLevel,
  formatOrchestrationSchemePreamble,
  listOrchestrationSchemes,
  mergeOrchestrationSchemeIntoPrompt,
  migrateSchemeMembers,
  resolveOrchestrationScheme,
  resolveUnpinnedOrchestrationDefaultRole,
} from './orchestration-scheme.js';
import type {
  OrchestrationSchemeConfigSlice,
  OrchestrationSchemeMember,
  OrchestrationSchemeSettings,
} from './orchestration-scheme.js';

function baseConfig(
  overrides?: Partial<OrchestrationSchemeConfigSlice> & {
    schemes?: OrchestrationSchemeSettings[];
  },
): OrchestrationSchemeConfigSlice {
  return {
    maxConcurrency: 4,
    maxTasksPerRun: 8,
    ...(overrides ?? {}),
  };
}

describe('resolveOrchestrationScheme', () => {
  it('returns undefined for off / omit / empty', () => {
    const config = baseConfig();
    expect(resolveOrchestrationScheme(config, undefined)).toBeUndefined();
    expect(resolveOrchestrationScheme(config, ORCHESTRATION_SCHEME_OFF_ID)).toBeUndefined();
    expect(resolveOrchestrationScheme(config, '  ')).toBeUndefined();
    expect(resolveOrchestrationScheme(config, 'off')).toBeUndefined();
  });

  it('resolves builtin ultra-code with scout roster and clamps', () => {
    const config = baseConfig({ maxConcurrency: 4, maxTasksPerRun: 8 });
    const resolved = resolveOrchestrationScheme(config, 'ultra-code', {
      knownProfileIds: ['explorer', 'reviewer'],
    });
    expect(resolved?.schemeId).toBe('ultra-code');
    expect(resolved?.defaultRole).toBe('scout');
    expect(resolved?.defaultProfileId).toBe('explorer');
    expect(resolved?.exposeSpawnMetadata).toBe(false);
    expect(resolved?.maxConcurrency).toBe(4);
    expect(resolved?.maxTasksPerRun).toBe(8);
    expect(resolved?.maxSubagentThinkingLevel).toBe('low');
    expect(resolved?.systemPreamble).toMatch(/scout/i);
    expect(resolved?.systemPreamble).toMatch(/delegat/i);
    expect(resolved?.systemPreamble).toMatch(/foundational/i);
    expect(resolved?.systemPreamble).toMatch(/citations/i);
    expect(resolved?.members).toHaveLength(1);
    expect(resolved?.members[0]?.role).toBe('scout');
    expect(resolved?.members[0]?.profileId).toBe('explorer');
    expect(resolved?.members[0]?.available).toBe(true);
    expect(resolved?.members[0]?.reportContract).toMatch(/complete \| partial \| blocked/);
    expect(resolved?.scheme.source).toBe('builtin');
  });

  it('throws on unknown scheme id (never silent off)', () => {
    const config = baseConfig();
    expect(() => resolveOrchestrationScheme(config, 'nope')).toThrow(OrchestrationSchemeError);
    try {
      resolveOrchestrationScheme(config, 'nope');
    } catch (error) {
      expect(error).toBeInstanceOf(OrchestrationSchemeError);
      expect((error as OrchestrationSchemeError).code).toBe('unknown-scheme');
    }
  });

  it('throws on invalid scheme id characters', () => {
    expect(isValidOrchestrationSchemeId('ultra-code')).toBe(true);
    expect(isValidOrchestrationSchemeId('off')).toBe(false);
    expect(isValidOrchestrationSchemeId('Bad_Id')).toBe(false);
    expect(() => resolveOrchestrationScheme(baseConfig(), 'Bad_Id')).toThrow(
      OrchestrationSchemeError,
    );
  });

  it('merges settings override for ultra-code including members', () => {
    const config = baseConfig({
      schemes: [
        {
          id: 'ultra-code',
          name: 'Ultra Custom',
          description: 'override',
          defaultRole: 'searcher',
          defaultProfileId: 'explorer',
          exposeSpawnMetadata: true,
          waitPolicy: 'await-all',
          systemPreamble: 'custom preamble for ultra',
          maxConcurrency: 2,
          members: [
            {
              role: 'searcher',
              description: 'custom scout',
              profileId: 'explorer',
              fallback: 'main',
            },
            {
              role: 'reviewer',
              description: 'custom review',
              profileId: 'reviewer',
              fallback: 'none',
            },
          ],
        },
      ],
    });
    const resolved = resolveOrchestrationScheme(config, 'ultra-code', {
      knownProfileIds: ['explorer', 'reviewer'],
    });
    expect(resolved?.scheme.name).toBe('Ultra Custom');
    expect(resolved?.exposeSpawnMetadata).toBe(true);
    expect(resolved?.scheme.source).toBe('settings');
    expect(resolved?.maxConcurrency).toBe(2);
    expect(resolved?.members.map((member) => member.role)).toEqual(['scout', 'reviewer']);
  });

  it('lists custom schemes after builtins', () => {
    const config = baseConfig({
      schemes: [
        {
          id: 'my-review',
          name: 'My Review',
          description: 'custom',
          defaultProfileId: 'reviewer',
          exposeSpawnMetadata: true,
          waitPolicy: 'await-all',
          systemPreamble: 'review carefully',
        },
      ],
    });
    const list = listOrchestrationSchemes(config);
    expect(list.map((item) => item.id)).toEqual([
      'ultra-code',
      'reviewed-delivery',
      'my-review',
    ]);
  });
});

describe('migrateSchemeMembers', () => {
  it('synthesizes scout from v1 explorer defaultProfileId', () => {
    const members = migrateSchemeMembers({
      id: 'legacy',
      defaultProfileId: 'explorer',
    });
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('scout');
    expect(members[0]?.profileId).toBe('explorer');
    expect(members[0]?.description.length).toBeGreaterThan(10);
  });

  it('preserves reportContract on explicit members', () => {
    const members = migrateSchemeMembers({
      id: 'x',
      members: [
        {
          role: 'searcher',
          description: 'scout',
          profileId: 'explorer',
          reportContract: 'Return file:line only.',
        },
      ],
    });
    expect(members[0]?.reportContract).toBe('Return file:line only.');
  });

  it('keeps explicit members', () => {
    const members = migrateSchemeMembers({
      id: 'x',
      members: [
        { role: 'coder', description: 'implement stuff', profileId: 'implementer' },
      ],
    });
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('coder');
  });

  it('resolves v1 scheme without members via resolveOrchestrationScheme', () => {
    const config = baseConfig({
      schemes: [
        {
          id: 'legacy-pack',
          name: 'Legacy',
          description: 'v1 shape',
          defaultProfileId: 'explorer',
          exposeSpawnMetadata: false,
          waitPolicy: 'await-all',
          systemPreamble: 'go scout',
        },
      ],
    });
    const resolved = resolveOrchestrationScheme(config, 'legacy-pack', {
      knownProfileIds: ['explorer'],
    });
    expect(resolved?.defaultRole).toBe('scout');
    expect(resolved?.members[0]?.role).toBe('scout');
    expect(resolved?.defaultProfileId).toBe('explorer');
  });
});

describe('thinking clamp helpers', () => {
  it('orders thinking levels', () => {
    expect(compareThinkingLevel('low', 'high')).toBeLessThan(0);
    expect(compareThinkingLevel('ultra', 'max')).toBeGreaterThan(0);
  });

  it('clamps to max', () => {
    expect(clampThinkingLevelToMax('high', 'low')).toBe('low');
    expect(clampThinkingLevelToMax('minimal', 'low')).toBe('minimal');
    expect(clampThinkingLevelToMax(undefined, 'low')).toBe('low');
  });
});

describe('preamble and roster merge', () => {
  it('names run, start, wait, and cancel with a valid role requirement', () => {
    const resolved = resolveOrchestrationScheme(baseConfig(), 'ultra-code', {
      knownProfileIds: ['explorer'],
    })!;
    const preamble = formatOrchestrationSchemePreamble(resolved);
    expect(preamble).toMatch(/piwin_subagent_run/);
    expect(preamble).toMatch(/piwin_subagent_start/);
    expect(preamble).toMatch(/piwin_subagent_wait/);
    expect(preamble).toMatch(/piwin_subagent_cancel/);
    expect(preamble).toMatch(/role set to one of the roster roles/);
  });

  it('prefixes model-facing text with roster', () => {
    const resolved = resolveOrchestrationScheme(baseConfig(), 'ultra-code', {
      knownProfileIds: ['explorer'],
    })!;
    const merged = mergeOrchestrationSchemeIntoPrompt(resolved, 'find the bug');
    expect(merged.startsWith('[piwin-scheme:ultra-code]')).toBe(true);
    expect(merged).toContain('[piwin-scheme-roster]');
    expect(merged).toContain('scout:');
    expect(merged).toContain('find the bug');
    expect(formatOrchestrationSchemePreamble(resolved)).toContain(BUILTIN_ULTRA_CODE_SCHEME.id);
    const contract = formatSubagentReportContractBlock(
      resolved.members[0]?.reportContract,
    );
    expect(contract).toContain(PIWIN_REPORT_CONTRACT_MARKER);
    expect(contract).toContain('complete | partial | blocked');
  });
});

describe('applySchemeToSubagentSpawnInput', () => {
  it('forces default scout role and clears free model when generic', () => {
    const resolved = resolveOrchestrationScheme(baseConfig(), 'ultra-code', {
      knownProfileIds: ['explorer'],
    })!;
    const applied = applySchemeToSubagentSpawnInput(resolved, {
      profileId: 'implementer',
      model: { protocol: 'openai-compatible', providerId: 'x', modelId: 'y' },
      thinkingLevel: 'high',
    });
    expect(applied.role).toBe('scout');
    expect(applied.profileId).toBe('explorer');
    expect(applied.forcedProfile).toBe(true);
    expect(applied.clearedModel).toBe(true);
    expect(applied.thinkingLevel).toBe('low');
    expect(applied.isolation).toBe('readonly');
    expect(applied.reportContract).toBe(ULTRA_CODE_SCOUT_REPORT_CONTRACT);
    expect(applied.fallback).toBeUndefined();
  });

  it('fills builtin searcher reportContract onto an ultra-code overlay that omitted it', () => {
    const config = baseConfig({
      schemes: [
        {
          id: 'ultra-code',
          name: 'Ultra overlay',
          description: 'overlay without contract',
          defaultRole: 'searcher',
          defaultProfileId: 'explorer',
          exposeSpawnMetadata: false,
          waitPolicy: 'await-all',
          systemPreamble: 'custom overlay preamble still wins',
          members: [
            {
              role: 'searcher',
              description: 'custom scout',
              profileId: 'explorer',
              fallback: 'main',
            },
          ],
        },
      ],
    });
    const resolved = resolveOrchestrationScheme(config, 'ultra-code', {
      knownProfileIds: ['explorer'],
    });
    expect(resolved?.systemPreamble).toBe('custom overlay preamble still wins');
    expect(resolved?.members[0]?.role).toBe('scout');
    expect(resolved?.members[0]?.reportContract).toBe(ULTRA_CODE_SCOUT_REPORT_CONTRACT);
  });

  it('keeps an explicit overlay reportContract', () => {
    const config = baseConfig({
      schemes: [
        {
          id: 'ultra-code',
          name: 'Ultra overlay',
          description: 'overlay with custom contract',
          defaultRole: 'searcher',
          defaultProfileId: 'explorer',
          exposeSpawnMetadata: false,
          waitPolicy: 'await-all',
          systemPreamble: 'custom',
          members: [
            {
              role: 'searcher',
              description: 'custom scout',
              profileId: 'explorer',
              fallback: 'main',
              reportContract: 'Return JSON only.',
            },
          ],
        },
      ],
    });
    const resolved = resolveOrchestrationScheme(config, 'ultra-code', {
      knownProfileIds: ['explorer'],
    });
    expect(resolved?.members[0]?.role).toBe('scout');
    expect(resolved?.members[0]?.reportContract).toBe('Return JSON only.');
  });

  it('aliases ultra-code spawn role searcher onto scout', () => {
    const resolved = resolveOrchestrationScheme(baseConfig(), 'ultra-code', {
      knownProfileIds: ['explorer'],
    })!;
    const applied = applySchemeToSubagentSpawnInput(resolved, { role: 'searcher' });
    expect(applied.role).toBe('scout');
    expect(applied.fallback).toBeUndefined();
  });

  it('resolves explicit role', () => {
    const config = baseConfig({
      schemes: [
        {
          id: 'team',
          name: 'Team',
          description: 'multi',
          exposeSpawnMetadata: false,
          waitPolicy: 'await-all',
          systemPreamble: 'use roles',
          defaultRole: 'searcher',
          members: [
            {
              role: 'searcher',
              description: 'scout',
              profileId: 'explorer',
              isolation: 'readonly',
            },
            {
              role: 'coder',
              description: 'implement',
              profileId: 'implementer',
              isolation: 'worktree',
              thinkingLevel: 'medium',
            },
          ],
        },
      ],
    });
    const resolved = resolveOrchestrationScheme(config, 'team', {
      knownProfileIds: ['explorer', 'implementer'],
    })!;
    const applied = applySchemeToSubagentSpawnInput(resolved, { role: 'coder' });
    expect(applied.role).toBe('coder');
    expect(applied.profileId).toBe('implementer');
    expect(applied.isolation).toBe('worktree');
    expect(applied.thinkingLevel).toBe('medium');
  });

  it('returns fallback main for unknown role', () => {
    const resolved = resolveOrchestrationScheme(baseConfig(), 'ultra-code', {
      knownProfileIds: ['explorer'],
    })!;
    const applied = applySchemeToSubagentSpawnInput(resolved, { role: 'nope' });
    expect(applied.fallback?.kind).toBe('main');
    expect(applied.fallback?.role).toBe('nope');
  });

  it('returns fallback none when member unavailable and fallback none', () => {
    const config = baseConfig({
      schemes: [
        {
          id: 'strict',
          name: 'Strict',
          description: 'x',
          exposeSpawnMetadata: false,
          waitPolicy: 'await-all',
          systemPreamble: 'strict',
          members: [
            {
              role: 'searcher',
              description: 'scout',
              profileId: 'missing-profile',
              fallback: 'none',
            },
          ],
        },
      ],
    });
    const resolved = resolveOrchestrationScheme(config, 'strict', {
      knownProfileIds: ['explorer'],
    })!;
    expect(resolved.members[0]?.available).toBe(false);
    const applied = applySchemeToSubagentSpawnInput(resolved, { role: 'searcher' });
    expect(applied.fallback?.kind).toBe('none');
  });

  it('passes through when no scheme', () => {
    const applied = applySchemeToSubagentSpawnInput(undefined, {
      profileId: 'reviewer',
      thinkingLevel: 'medium',
    });
    expect(applied.profileId).toBe('reviewer');
    expect(applied.thinkingLevel).toBe('medium');
    expect(applied.forcedProfile).toBe(false);
  });
});

describe('resolveUnpinnedOrchestrationDefaultRole', () => {
  it('returns scout for builtin Ultra Code (no pinned model)', () => {
    expect(resolveUnpinnedOrchestrationDefaultRole(BUILTIN_ULTRA_CODE_SCHEME)).toBe('scout');
  });

  it('returns undefined when the default member pins a model', () => {
    expect(
      resolveUnpinnedOrchestrationDefaultRole({
        id: 'pinned',
        defaultRole: 'searcher',
        members: [
          {
            role: 'searcher',
            description: 'scout',
            model: { protocol: 'openai-compatible', providerId: 'p', modelId: 'cheap' },
          },
        ],
      }),
    ).toBeUndefined();
  });
});

const REVIEWED_DELIVERY_PROFILES = ['implementer', 'reviewer'] as const;

function reviewedDeliveryOverlay(members: OrchestrationSchemeMember[]): OrchestrationSchemeSettings {
  return {
    id: REVIEWED_DELIVERY_SCHEME_ID,
    name: 'Reviewed Delivery overlay',
    description: 'settings overlay',
    defaultRole: 'worker',
    defaultProfileId: 'implementer',
    exposeSpawnMetadata: false,
    waitPolicy: 'await-all',
    systemPreamble: 'overlay preamble still wins',
    members,
  };
}

describe('reviewed-delivery builtin', () => {
  it('built-in scheme resolves valid roles and compatible isolation', () => {
    const resolved = resolveOrchestrationScheme(baseConfig(), REVIEWED_DELIVERY_SCHEME_ID, {
      knownProfileIds: REVIEWED_DELIVERY_PROFILES,
    });
    expect(resolved?.schemeId).toBe('reviewed-delivery');
    expect(resolved?.scheme.source).toBe('builtin');
    expect(resolved?.defaultRole).toBe('worker');
    expect(resolved?.exposeSpawnMetadata).toBe(false);
    expect(resolved?.waitPolicy).toBe('await-all');
    expect(resolved?.members.map((member) => member.role)).toEqual(['worker', 'reviewer']);
    expect(resolved?.members.find((member) => member.role === 'worker')).toMatchObject({
      isolation: 'worktree',
      fallback: 'main',
      available: true,
    });
    expect(resolved?.members.find((member) => member.role === 'reviewer')).toMatchObject({
      isolation: 'readonly',
      fallback: 'main',
      available: true,
      reportContract: REVIEWED_DELIVERY_REVIEWER_REPORT_CONTRACT,
    });
    expect(resolved?.members.every((member) => member.model === undefined)).toBe(true);
  });

  it('preamble names all required tools and does not describe a generic infinite loop', () => {
    const resolved = resolveOrchestrationScheme(baseConfig(), REVIEWED_DELIVERY_SCHEME_ID, {
      knownProfileIds: REVIEWED_DELIVERY_PROFILES,
    })!;
    const preamble = resolved.systemPreamble;
    expect(preamble).toMatch(/piwin_subagent_start/);
    expect(preamble).toMatch(/piwin_subagent_wait/);
    expect(preamble).toMatch(/piwin_subagent_continue/);
    expect(preamble).toMatch(/piwin_subagent_result_apply/);
    expect(preamble).toMatch(/piwin_subagent_verification_submit/);
    expect(preamble).toMatch(/resultRef/);
    expect(preamble).toMatch(/two continuations/i);
    expect(preamble).not.toMatch(/repeat indefinitely|loop forever|keep looping until/i);
    expect(resolved.members.find((member) => member.role === 'reviewer')?.reportContract).toMatch(
      /piwin_subagent_review_submit/,
    );
  });

  it('pinned worker/reviewer models stay distinct through resolve and spawn application', () => {
    const workerModel = {
      protocol: 'openai-compatible' as const,
      providerId: 'worker-provider',
      modelId: 'worker-model',
    };
    const reviewerModel = {
      protocol: 'openai-compatible' as const,
      providerId: 'reviewer-provider',
      modelId: 'reviewer-model',
    };
    const config = baseConfig({
      schemes: [
        reviewedDeliveryOverlay([
          {
            role: 'worker',
            description: 'implement',
            profileId: 'implementer',
            isolation: 'worktree',
            fallback: 'main',
            model: workerModel,
          },
          {
            role: 'reviewer',
            description: 'review',
            profileId: 'reviewer',
            isolation: 'readonly',
            fallback: 'main',
            model: reviewerModel,
          },
        ]),
      ],
    });
    const resolved = resolveOrchestrationScheme(config, REVIEWED_DELIVERY_SCHEME_ID, {
      knownProfileIds: REVIEWED_DELIVERY_PROFILES,
      knownModelKeys: [
        'worker-provider::worker-model',
        'reviewer-provider::reviewer-model',
      ],
    })!;
    expect(resolved.scheme.source).toBe('settings');
    expect(resolved.members.find((member) => member.role === 'worker')?.model).toEqual(workerModel);
    expect(resolved.members.find((member) => member.role === 'reviewer')?.model).toEqual(
      reviewerModel,
    );
    const workerSpawn = applySchemeToSubagentSpawnInput(resolved, { role: 'worker' });
    const reviewerSpawn = applySchemeToSubagentSpawnInput(resolved, { role: 'reviewer' });
    expect(workerSpawn.model).toEqual(workerModel);
    expect(reviewerSpawn.model).toEqual(reviewerModel);
    expect(workerSpawn.model).not.toEqual(reviewerSpawn.model);
    expect(workerSpawn.isolation).toBe('worktree');
    expect(reviewerSpawn.isolation).toBe('readonly');
  });

  it('unavailable role follows configured fallback without model substitution', () => {
    const missingReviewerModel = {
      protocol: 'openai-compatible' as const,
      providerId: 'reviewer-provider',
      modelId: 'missing-reviewer',
    };
    const config = baseConfig({
      schemes: [
        reviewedDeliveryOverlay([
          {
            role: 'worker',
            description: 'implement',
            profileId: 'implementer',
            isolation: 'worktree',
            fallback: 'main',
          },
          {
            role: 'reviewer',
            description: 'review',
            profileId: 'reviewer',
            isolation: 'readonly',
            fallback: 'main',
            model: missingReviewerModel,
          },
        ]),
      ],
    });
    const resolved = resolveOrchestrationScheme(config, REVIEWED_DELIVERY_SCHEME_ID, {
      knownProfileIds: REVIEWED_DELIVERY_PROFILES,
      knownModelKeys: ['worker-provider::worker-model'],
    })!;
    const reviewer = resolved.members.find((member) => member.role === 'reviewer');
    expect(reviewer?.available).toBe(false);
    expect(reviewer?.fallback).toBe('main');
    const applied = applySchemeToSubagentSpawnInput(resolved, {
      role: 'reviewer',
      model: { protocol: 'openai-compatible', providerId: 'other', modelId: 'substitute' },
    });
    expect(applied.fallback?.kind).toBe('main');
    expect(applied.clearedModel).toBe(true);
    expect(applied.model).toBeUndefined();
  });

  it('old settings load unchanged', () => {
    const customScheme: OrchestrationSchemeSettings = {
      id: 'my-review',
      name: 'My Review',
      description: 'custom',
      defaultProfileId: 'reviewer',
      exposeSpawnMetadata: true,
      waitPolicy: 'await-all',
      systemPreamble: 'review carefully',
    };
    const schemes = [customScheme];
    const config = baseConfig({ schemes });
    const list = listOrchestrationSchemes(config);
    expect(list.map((item) => item.id)).toEqual([
      'ultra-code',
      'reviewed-delivery',
      'my-review',
    ]);
    expect(list.find((item) => item.id === 'reviewed-delivery')?.source).toBe('builtin');
    expect(list.find((item) => item.id === 'my-review')?.source).toBe('settings');
    expect(config.schemes?.map((scheme) => scheme.id)).toEqual(['my-review']);
    expect(schemes.map((scheme) => scheme.id)).toEqual(['my-review']);
  });
});
