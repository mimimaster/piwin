import { describe, expect, it } from 'vitest';
import {
  memoryWorkloadFixtures,
  type MemoryWorkloadFixture,
} from './memory-workload-fixtures';

const EXPECTED_NAMES = [
  'textStream',
  'backgroundRun',
  'historyNavigation',
  'mediaRich',
  'artifactInteractive',
  'splitPanes',
  'notifications',
];

describe('memory workload fixtures', () => {
  it('exports exactly the seven named workloads', () => {
    expect(Object.keys(memoryWorkloadFixtures).sort()).toEqual([...EXPECTED_NAMES].sort());
  });

  it.each(EXPECTED_NAMES)('%s has a bounded deterministic shape', (name) => {
    const fixture: MemoryWorkloadFixture = memoryWorkloadFixtures[name] as MemoryWorkloadFixture;
    expect(fixture.name.length).toBeGreaterThan(0);
    expect(Number.isInteger(fixture.seed)).toBe(true);
    expect(fixture.seed).toBeGreaterThan(0);
    expect(fixture.durationSeconds).toBeGreaterThan(0);
    expect(fixture.durationSeconds).toBeLessThanOrEqual(120);
    expect(fixture.steps.length).toBeGreaterThan(0);
    expect(fixture.steps.length).toBeLessThanOrEqual(64);

    for (const step of fixture.steps) {
      expect(step.at).toBeGreaterThanOrEqual(0);
      expect(step.at).toBeLessThanOrEqual(fixture.durationSeconds);
      expect(step.action.length).toBeGreaterThan(0);
      for (const value of Object.values(step.params)) {
        expect(['string', 'number', 'boolean']).toContain(typeof value);
      }
    }
  });

  it('steps within each fixture are non-decreasing in time', () => {
    for (const fixture of Object.values(memoryWorkloadFixtures)) {
      const times = fixture.steps.map((step) => step.at);
      const sorted = [...times].sort((a, b) => a - b);
      expect(times).toEqual(sorted);
    }
  });

  it('fixtures are deterministic snapshots (re-import yields identical data)', async () => {
    const reimported = (await import('./memory-workload-fixtures')).memoryWorkloadFixtures;
    expect(reimported).toBe(memoryWorkloadFixtures);
    expect(JSON.parse(JSON.stringify(memoryWorkloadFixtures))).toEqual(
      JSON.parse(JSON.stringify(reimported)),
    );
  });
});
