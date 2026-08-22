import { describe, expect, it } from 'vitest';
import type { HostResponse, PiwinConfig, SettingsMutation } from '@piwin/contracts';
import {
  planSettingsSave,
  settingsApplyCommand,
  settingsSaveApplyFailureNotice,
  settingsSaveThrownNotice,
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
