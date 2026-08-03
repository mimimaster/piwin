import { describe, expect, it } from 'vitest';
import type { ResourceCatalog, ResourceCatalogEntry, ResourceId } from '@piwin/contracts';
import { normalizeResourceId } from '@piwin/contracts';
import {
  resolveResourceActivations,
  type ResourcePolicyInput,
} from './resource-policy-resolver.js';

function entry(
  overrides: Partial<ResourceCatalogEntry> & { resourceId: string },
): ResourceCatalogEntry {
  return {
    kind: 'skill',
    name: overrides.resourceId,
    path: `/resources/${overrides.resourceId}`,
    source: 'user',
    ...overrides,
  };
}

function catalog(entries: ResourceCatalogEntry[]): ResourceCatalog {
  return { version: 1, entries, diagnostics: [] };
}

function policyInput(overrides: Partial<ResourcePolicyInput> = {}): ResourcePolicyInput {
  return {
    catalog: catalog([]),
    disabledIds: [],
    familyDisabled: {},
    projectTrusted: true,
    ...overrides,
  };
}

describe('normalizeResourceId (contracts)', () => {
  it('normalizes case, whitespace and punctuation', () => {
    expect(normalizeResourceId(' My Review_Skill ')).toBe('my-review-skill');
    expect(normalizeResourceId('Web Search')).toBe('web-search');
    expect(normalizeResourceId('a__b--c')).toBe('a-b-c');
  });

  it('throws on an empty result', () => {
    expect(() => normalizeResourceId('  --- ')).toThrow();
    expect(() => normalizeResourceId('')).toThrow();
  });
});

describe('resolveResourceActivations', () => {
  it('includes user resources when enabled', () => {
    const result = resolveResourceActivations(
      policyInput({
        catalog: catalog([entry({ resourceId: 'review', source: 'user' })]),
      }),
    );
    expect(result.activations[0]?.effectiveEnabled).toBe(true);
    expect(result.activeEntries.map((item) => item.resourceId)).toEqual(['review']);
  });

  it('general-scope behavior: project resources are excluded when untrusted', () => {
    const result = resolveResourceActivations(
      policyInput({
        projectTrusted: false,
        catalog: catalog([
          entry({ resourceId: 'user-skill', source: 'user' }),
          entry({ resourceId: 'project-skill', source: 'project' }),
        ]),
      }),
    );
    const byId = new Map(result.activations.map((item) => [item.resourceId, item]));
    expect(byId.get('user-skill')?.effectiveEnabled).toBe(true);
    expect(byId.get('project-skill')?.effectiveEnabled).toBe(false);
    expect(byId.get('project-skill')?.blockedReason).toBe('project-untrusted');
    expect(result.activeEntries.map((item) => item.resourceId)).toEqual(['user-skill']);
  });

  it('trusted project includes project resources', () => {
    const result = resolveResourceActivations(
      policyInput({
        projectTrusted: true,
        catalog: catalog([entry({ resourceId: 'proj', source: 'project' })]),
      }),
    );
    expect(result.activations[0]?.effectiveEnabled).toBe(true);
  });

  it('disabled logical ID applies to every copy regardless of source', () => {
    const result = resolveResourceActivations(
      policyInput({
        disabledIds: ['dup-skill'],
        catalog: catalog([
          entry({ resourceId: 'dup-skill', source: 'user' }),
          entry({ resourceId: 'dup-skill', source: 'project' }),
        ]),
      }),
    );
    const activations = result.activations;
    expect(activations).toHaveLength(1);
    expect(activations[0]?.effectiveEnabled).toBe(false);
    expect(activations[0]?.blockedReason).toBe('disabled');
    expect(result.activeEntries).toHaveLength(0);
  });

  it('family master disable removes the whole family', () => {
    const result = resolveResourceActivations(
      policyInput({
        familyDisabled: { skill: true },
        catalog: catalog([
          entry({ resourceId: 'a', kind: 'skill' }),
          entry({ resourceId: 'b', kind: 'prompt' }),
        ]),
      }),
    );
    const byId = new Map(result.activations.map((item) => [item.resourceId, item]));
    expect(byId.get('a')?.effectiveEnabled).toBe(false);
    expect(byId.get('b')?.effectiveEnabled).toBe(true);
  });

  it('empty allowlist blocks every resource', () => {
    const result = resolveResourceActivations(
      policyInput({
        allowlist: [],
        catalog: catalog([entry({ resourceId: 'a' })]),
      }),
    );
    expect(result.activations[0]?.effectiveEnabled).toBe(false);
    expect(result.activations[0]?.blockedReason).toBe('not-allowed');
  });

  it('allowlist permits only matching IDs', () => {
    const result = resolveResourceActivations(
      policyInput({
        allowlist: ['a'],
        catalog: catalog([entry({ resourceId: 'a' }), entry({ resourceId: 'b' })]),
      }),
    );
    const byId = new Map(result.activations.map((item) => [item.resourceId, item]));
    expect(byId.get('a')?.effectiveEnabled).toBe(true);
    expect(byId.get('b')?.effectiveEnabled).toBe(false);
  });
});
