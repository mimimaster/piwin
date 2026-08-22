import { afterEach, describe, expect, it } from 'vitest';
import { globalHighlightCache } from './syntax/highlight-cache';
import { globalMemoryGovernor } from './memory-governor';
import {
  MEMORY_PRESSURE_CRITICAL_BYTES,
  MEMORY_PRESSURE_HYSTERESIS_BYTES,
  MEMORY_PRESSURE_MODERATE_BYTES,
  MEMORY_PRESSURE_RECOVERY_DWELL_MS,
  applyMemoryPressureEvent,
  applyMemoryPressureSample,
  classifyMemoryPressure,
  getLastMemoryPressureBytes,
  resetLastMemoryPressureBytes,
  resetMemoryPressureRecoveryDwell,
} from './memory-pressure';

const MIB = 1024 * 1024;

describe('classifyMemoryPressure', () => {
  it('stays normal below the moderate family footprint', () => {
    expect(classifyMemoryPressure({ bytes: MEMORY_PRESSURE_MODERATE_BYTES - 1 })).toBe('normal');
    expect(classifyMemoryPressure({ bytes: 400 * MIB })).toBe('normal');
  });

  it('enters moderate before disabling highlighting', () => {
    expect(classifyMemoryPressure({ bytes: MEMORY_PRESSURE_MODERATE_BYTES })).toBe('moderate');
    expect(classifyMemoryPressure({ bytes: MEMORY_PRESSURE_CRITICAL_BYTES - 1 })).toBe('moderate');
  });

  it('enters critical only at the high family ceiling', () => {
    expect(classifyMemoryPressure({ bytes: MEMORY_PRESSURE_CRITICAL_BYTES })).toBe('critical');
    expect(classifyMemoryPressure({ bytes: 3 * 1024 * MIB })).toBe('critical');
  });

  it('promotes to at least moderate when the OS reports scarce available memory', () => {
    expect(
      classifyMemoryPressure({ bytes: 200 * MIB, availableBytes: 200 * MIB }),
    ).toBe('moderate');
    expect(
      classifyMemoryPressure({ bytes: 200 * MIB, availableBytes: 32 * MIB }),
    ).toBe('critical');
  });

  it('uses hysteresis so a brief dip does not leave critical or moderate', () => {
    expect(
      classifyMemoryPressure(
        { bytes: MEMORY_PRESSURE_CRITICAL_BYTES - MEMORY_PRESSURE_HYSTERESIS_BYTES + 1 },
        'critical',
      ),
    ).toBe('critical');
    expect(
      classifyMemoryPressure(
        { bytes: MEMORY_PRESSURE_CRITICAL_BYTES - MEMORY_PRESSURE_HYSTERESIS_BYTES - 1 },
        'critical',
      ),
    ).toBe('moderate');
    expect(
      classifyMemoryPressure(
        { bytes: MEMORY_PRESSURE_MODERATE_BYTES - MEMORY_PRESSURE_HYSTERESIS_BYTES + 1 },
        'moderate',
      ),
    ).toBe('moderate');
    expect(
      classifyMemoryPressure(
        { bytes: MEMORY_PRESSURE_MODERATE_BYTES - MEMORY_PRESSURE_HYSTERESIS_BYTES - 1 },
        'moderate',
      ),
    ).toBe('normal');
  });
});

describe('applyMemoryPressureSample', () => {
  afterEach(() => {
    globalMemoryGovernor.reset();
    globalHighlightCache.clear();
  });

  it('drives the governor and purges highlight cache on moderate pressure', () => {
    globalHighlightCache.set('k1', [[{ content: 'const x = 1;', offset: 0 }]], 20);
    expect(globalHighlightCache.getEntryCount()).toBe(1);

    const level = applyMemoryPressureSample({ bytes: MEMORY_PRESSURE_MODERATE_BYTES });
    expect(level).toBe('moderate');
    expect(globalMemoryGovernor.getLevel()).toBe('moderate');
    expect(globalMemoryGovernor.isHighlightDisabled()).toBe(false);
    expect(globalHighlightCache.getEntryCount()).toBe(0);
  });

  it('does not disable highlighting for a typical long-session plateau', () => {
    // ~1.2 GB family is today's observed packed-app plateau.
    const level = applyMemoryPressureSample({ bytes: Math.round(1.2 * 1024 * MIB) });
    expect(level).toBe('moderate');
    expect(globalMemoryGovernor.isHighlightDisabled()).toBe(false);
  });
});

describe('applyMemoryPressureEvent', () => {
  afterEach(() => {
    globalMemoryGovernor.reset();
    globalHighlightCache.clear();
    resetMemoryPressureRecoveryDwell();
    resetLastMemoryPressureBytes();
  });

  it('classifies native byte samples through the shared thresholds', () => {
    expect(applyMemoryPressureEvent({ bytes: MEMORY_PRESSURE_MODERATE_BYTES }, 0)).toBe('moderate');
    expect(globalMemoryGovernor.getLevel()).toBe('moderate');
    expect(getLastMemoryPressureBytes()).toBe(MEMORY_PRESSURE_MODERATE_BYTES);

    expect(
      applyMemoryPressureEvent({ bytes: 100 * MIB }, MEMORY_PRESSURE_RECOVERY_DWELL_MS),
    ).toBe('normal');
    expect(globalMemoryGovernor.getLevel()).toBe('normal');
  });

  it('holds a degradation tier for the recovery dwell to prevent glass flicker', () => {
    expect(applyMemoryPressureEvent({ bytes: MEMORY_PRESSURE_MODERATE_BYTES }, 0)).toBe('moderate');

    // Footprint falls right back below the hysteresis floor: recovery must
    // wait out the dwell window instead of blinking effects back on.
    expect(applyMemoryPressureEvent({ bytes: 100 * MIB }, 5_000)).toBe('moderate');
    expect(
      applyMemoryPressureEvent({ bytes: 100 * MIB }, MEMORY_PRESSURE_RECOVERY_DWELL_MS - 1),
    ).toBe('moderate');
    expect(
      applyMemoryPressureEvent({ bytes: 100 * MIB }, MEMORY_PRESSURE_RECOVERY_DWELL_MS),
    ).toBe('normal');
  });

  it('escalates immediately even within a dwell window', () => {
    expect(applyMemoryPressureEvent({ bytes: MEMORY_PRESSURE_MODERATE_BYTES }, 0)).toBe('moderate');
    expect(
      applyMemoryPressureEvent({ bytes: MEMORY_PRESSURE_CRITICAL_BYTES }, 5_000),
    ).toBe('critical');
  });

  it('honors OS available-memory scarcity carried with the sample', () => {
    expect(
      applyMemoryPressureEvent({ bytes: 100 * MIB, availableBytes: 32 * MIB }, 0),
    ).toBe('critical');
  });

  it('lets explicit level payloads bypass the dwell for manual recovery', () => {
    expect(applyMemoryPressureEvent({ bytes: MEMORY_PRESSURE_MODERATE_BYTES }, 0)).toBe('moderate');
    expect(applyMemoryPressureEvent({ level: 'normal' }, 5_000)).toBe('normal');
    expect(globalMemoryGovernor.getLevel()).toBe('normal');
  });

  it('applies legacy level-only payloads directly', () => {
    expect(applyMemoryPressureEvent({ level: 'critical' })).toBe('critical');
    expect(globalMemoryGovernor.getLevel()).toBe('critical');
  });

  it('ignores missing or malformed payloads', () => {
    expect(applyMemoryPressureEvent(undefined)).toBe('normal');
    expect(applyMemoryPressureEvent({})).toBe('normal');
    expect(applyMemoryPressureEvent({ level: 'bogus' as never })).toBe('normal');
    expect(applyMemoryPressureEvent({ bytes: Number.NaN })).toBe('normal');
    expect(globalMemoryGovernor.getLevel()).toBe('normal');
  });
});
