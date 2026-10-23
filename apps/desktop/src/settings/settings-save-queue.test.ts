import { describe, expect, it } from 'vitest';
import type { HostResponse, PiwinConfig, SettingsMutation } from '@piwin/contracts';
import { createSettingsApplyChain } from './settings-apply-chain.js';
import {
  planSettingsSave,
  settingsApplyCommand,
  executeSettingsSaveCycle,
  settingsSaveApplyFailureNotice,
  settingsSaveThrownNotice,
  shouldRetrySettingsApply,
} from './settings-save-queue.js';

const config = { providers: [] } as unknown as PiwinConfig;
const mutation: SettingsMutation = {
  kind: 'replace-domain',
  domain: 'permissions',
  value: { mode: 'ask-all', preset: 'ask' },
};

function okGet(snapshot: unknown): HostResponse {
  return {
    type: 'response',
    command: 'settings/get',
    success: true,
    data: { snapshot },
  };
}

describe('planSettingsSave', () => {
  it('notices a failed settings/get', () => {
    expect(
      planSettingsSave({
        getResponse: {
          type: 'response',
          command: 'settings/get',
          success: false,
          error: 'offline',
        },
        buildMutations: () => [mutation],
        transport: 'live',
      }),
    ).toEqual({ kind: 'read-failed', message: 'Settings read failed: offline' });
  });

  it('notices a successful get with no snapshot', () => {
    expect(
      planSettingsSave({
        getResponse: {
          type: 'response',
          command: 'settings/get',
          success: true,
          data: {},
        },
        buildMutations: () => [mutation],
        transport: 'live',
      }),
    ).toEqual({
      kind: 'missing-snapshot',
      message: 'Settings read returned no snapshot',
    });
  });

  it('returns empty-mutations when the builder yields none', () => {
    expect(
      planSettingsSave({
        getResponse: okGet({ config, revision: 'rev-1', domainRevisions: {} }),
        buildMutations: () => [],
        transport: 'live',
      }),
    ).toEqual({ kind: 'empty-mutations' });
  });

  it('plans an apply with the filtered mutations and snapshot revision', () => {
    const plan = planSettingsSave({
      getResponse: okGet({
        config,
        revision: 'rev-9',
        domainRevisions: { permissions: 'hash-p' },
      }),
      buildMutations: () => [mutation],
      transport: 'live',
    });
    expect(plan.kind).toBe('apply');
    if (plan.kind !== 'apply') {
      return;
    }
    expect(plan.mutations).toEqual([mutation]);
    expect(plan.snapshot.revision).toBe('rev-9');
    expect(settingsApplyCommand(plan)).toEqual({
      type: 'settings/apply',
      input: {
        expectedRevision: 'rev-9',
        mutations: [mutation],
        expectedDomainRevisions: { permissions: 'hash-p' },
      },
    });
  });

  it('drops knowledge on remote apply when the Host snapshot has no knowledge hash', () => {
    const knowledge: SettingsMutation = {
      kind: 'replace-domain',
      domain: 'knowledge',
      value: { embedding: { enabled: true } },
    };
    const notes: SettingsMutation = {
      kind: 'replace-domain',
      domain: 'notes',
      value: { embedding: { provider: 'openai-compatible', baseUrl: 'https://x', model: 'm' } },
    };
    const plan = planSettingsSave({
      getResponse: okGet({
        config,
        revision: 'rev-2',
        domainRevisions: { notes: 'hash-n' },
      }),
      buildMutations: () => [knowledge, notes],
      transport: 'remote',
    });
    expect(plan.kind).toBe('apply');
    if (plan.kind !== 'apply') return;
    expect(plan.mutations.map((item) => item.domain)).toEqual(['notes']);
    expect(settingsApplyCommand(plan).input.expectedDomainRevisions).toEqual({ notes: 'hash-n' });
  });
});

describe('settingsSaveApplyFailureNotice', () => {
  it('is silent on success and surfaces hostFailureNotice on apply failure', () => {
    expect(
      settingsSaveApplyFailureNotice(
        { type: 'response', command: 'settings/apply', success: true },
        'en',
      ),
    ).toEqual({ kind: 'ok' });
    expect(
      settingsSaveApplyFailureNotice(
        {
          type: 'response',
          command: 'settings/apply',
          success: false,
          error: 'revision conflict',
        },
        'en',
      ),
    ).toEqual({ kind: 'notice', message: 'revision conflict' });
  });
});

describe('settingsSaveThrownNotice', () => {
  it('wraps the thrown error', () => {
    expect(settingsSaveThrownNotice(new Error('boom'))).toBe('Settings save failed: boom');
  });
});

describe('executeSettingsSaveCycle', () => {
  const snapshot = {
    config,
    revision: 'rev-1',
    domainRevisions: { permissions: 'hash-p' },
  };
  const conflict: HostResponse = {
    type: 'response',
    command: 'settings/apply',
    success: false,
    error: 'settings-revision-conflict',
    problem: { code: 'settings-revision-conflict' },
  };
  const okApply: HostResponse = {
    type: 'response',
    command: 'settings/apply',
    success: true,
  };

  it('retries a revision conflict against a fresh snapshot and succeeds', async () => {
    let gets = 0;
    let applies = 0;
    const result = await executeSettingsSaveCycle({
      requestGet: async () => {
        gets += 1;
        return okGet({
          ...snapshot,
          revision: gets === 1 ? 'rev-1' : 'rev-2',
          domainRevisions: { permissions: gets === 1 ? 'hash-p' : 'hash-p2' },
        });
      },
      requestApply: async () => {
        applies += 1;
        return applies === 1 ? conflict : okApply;
      },
      buildMutations: () => [mutation],
      transport: 'live',
      locale: 'zh-CN',
    });
    expect(result).toEqual({ kind: 'ok' });
    expect(gets).toBe(2);
    expect(applies).toBe(2);
  });

  it('surfaces the domain-conflict copy after a second miss', async () => {
    const result = await executeSettingsSaveCycle({
      requestGet: async () => okGet(snapshot),
      requestApply: async () => conflict,
      buildMutations: () => [mutation],
      transport: 'live',
      locale: 'zh-CN',
    });
    expect(result).toEqual({
      kind: 'failed',
      message: '这部分设置已被另一端改过，请先重新加载再保存',
    });
  });
});

describe('lastSession vs composer desktop CAS', () => {

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  type DesktopDoc = {
    revision: string;
    desktop: Record<string, unknown>;
  };

  function desktopHash(desktop: Record<string, unknown>): string {
    return JSON.stringify(desktop);
  }

  function applyDesktopCas(
    doc: DesktopDoc,
    input: {
      expectedRevision?: string;
      expectedDomainRevisions?: Partial<Record<string, string>>;
      mutations: SettingsMutation[];
    },
  ): 'ok' | 'conflict' {
    const currentHash = desktopHash(doc.desktop);
    if (input.expectedRevision !== undefined && input.expectedRevision !== doc.revision) {
      const expectedHash = input.expectedDomainRevisions?.desktop;
      if (expectedHash === undefined || expectedHash !== currentHash) {
        return 'conflict';
      }
    }
    for (const mutation of input.mutations) {
      if (mutation.domain === 'desktop' && mutation.value && typeof mutation.value === 'object') {
        doc.desktop = mutation.value as Record<string, unknown>;
      }
    }
    doc.revision = `r:${desktopHash(doc.desktop)}`;
    return 'ok';
  }

  function createOverlappingDesktopSave(doc: DesktopDoc, buildMutations: (current: PiwinConfig) => SettingsMutation[]) {
    return executeSettingsSaveCycle({
      requestGet: async () => {
        const snap = {
          config: { providers: [], desktop: { ...doc.desktop } } as unknown as PiwinConfig,
          revision: doc.revision,
          domainRevisions: { desktop: desktopHash(doc.desktop) },
        };
        await delay(25);
        return okGet(snap);
      },
      requestApply: async (plan) => {
        const result = applyDesktopCas(doc, settingsApplyCommand(plan).input);
        if (result === 'conflict') {
          return {
            type: 'response',
            command: 'settings/apply',
            success: false,
            error: 'settings-revision-conflict',
            problem: { code: 'settings-revision-conflict' },
          };
        }
        return { type: 'response', command: 'settings/apply', success: true };
      },
      buildMutations,
      transport: 'live',
      locale: 'zh-CN',
    });
  }

  const lastSessionMutations = (current: PiwinConfig): SettingsMutation[] => [
    {
      kind: 'replace-domain',
      domain: 'desktop',
      value: {
        ...current.desktop,
        lastSession: { sessionId: 'sess-1', scope: { kind: 'general' } },
      },
    },
  ];

  const composerMutations = (current: PiwinConfig): SettingsMutation[] => [
    {
      kind: 'replace-domain',
      domain: 'desktop',
      value: {
        ...current.desktop,
        composerProfile: { thinkingLevel: 'high' },
      },
    },
  ];

  it('loses overlapping lastSession + composer + lastSession retries (the two-toast case)', async () => {
    const doc: DesktopDoc = { revision: 'r0', desktop: {} };
    const results = await Promise.all([
      createOverlappingDesktopSave(doc, lastSessionMutations),
      createOverlappingDesktopSave(doc, composerMutations),
      createOverlappingDesktopSave(doc, lastSessionMutations),
    ]);
    expect(results.some((result) => result.kind === 'failed')).toBe(true);
  });

  it('keeps lastSession and composer when the same writes are chained', async () => {
    const doc: DesktopDoc = { revision: 'r0', desktop: {} };
    const chain = createSettingsApplyChain();
    const results = await Promise.all([
      chain.enqueue(() => createOverlappingDesktopSave(doc, lastSessionMutations)),
      chain.enqueue(() => createOverlappingDesktopSave(doc, composerMutations)),
      chain.enqueue(() => createOverlappingDesktopSave(doc, lastSessionMutations)),
    ]);
    expect(results.every((result) => result.kind === 'ok' || result.kind === 'empty')).toBe(true);
    expect(doc.desktop).toMatchObject({
      lastSession: { sessionId: 'sess-1', scope: { kind: 'general' } },
      composerProfile: { thinkingLevel: 'high' },
    });
  });
});

describe('shouldRetrySettingsApply', () => {
  const conflict: HostResponse = {
    type: 'response',
    command: 'settings/apply',
    success: false,
    error: 'settings-revision-conflict',
    problem: { code: 'settings-revision-conflict' },
  };

  it('retries the first revision conflict and then gives up', () => {
    expect(shouldRetrySettingsApply(conflict, 0)).toBe(true);
    expect(shouldRetrySettingsApply(conflict, 1)).toBe(false);
  });

  it('does not retry a non-conflict failure', () => {
    expect(
      shouldRetrySettingsApply(
        {
          type: 'response',
          command: 'settings/apply',
          success: false,
          error: 'offline',
        },
        0,
      ),
    ).toBe(false);
  });
});
