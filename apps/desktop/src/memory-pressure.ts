import { globalMemoryGovernor, type MemoryPressureLevel } from './memory-governor';

const MIB = 1024 * 1024;

export const MEMORY_PRESSURE_MODERATE_BYTES = 768 * MIB;
export const MEMORY_PRESSURE_CRITICAL_BYTES = 1536 * MIB;
export const MEMORY_PRESSURE_HYSTERESIS_BYTES = 64 * MIB;

const OS_CRITICAL_AVAILABLE_BYTES = 64 * MIB;
const OS_MODERATE_AVAILABLE_BYTES = 256 * MIB;

export type MemoryPressureSample = {
  bytes: number;
  availableBytes?: number;
};

export function classifyMemoryPressure(
  sample: MemoryPressureSample,
  currentLevel: MemoryPressureLevel = 'normal',
): MemoryPressureLevel {
  let baseLevel: MemoryPressureLevel = 'normal';
  if (sample.availableBytes !== undefined) {
    if (sample.availableBytes <= OS_CRITICAL_AVAILABLE_BYTES) {
      return 'critical';
    }
    if (sample.availableBytes <= OS_MODERATE_AVAILABLE_BYTES) {
      baseLevel = 'moderate';
    }
  }

  if (currentLevel === 'critical') {
    if (sample.bytes >= MEMORY_PRESSURE_CRITICAL_BYTES - MEMORY_PRESSURE_HYSTERESIS_BYTES) {
      return 'critical';
    }
    if (sample.bytes >= MEMORY_PRESSURE_MODERATE_BYTES - MEMORY_PRESSURE_HYSTERESIS_BYTES) {
      return 'moderate';
    }
    return baseLevel;
  }

  if (currentLevel === 'moderate') {
    if (sample.bytes >= MEMORY_PRESSURE_CRITICAL_BYTES) {
      return 'critical';
    }
    if (sample.bytes >= MEMORY_PRESSURE_MODERATE_BYTES - MEMORY_PRESSURE_HYSTERESIS_BYTES) {
      return 'moderate';
    }
    return baseLevel;
  }

  if (sample.bytes >= MEMORY_PRESSURE_CRITICAL_BYTES) {
    return 'critical';
  }
  if (sample.bytes >= MEMORY_PRESSURE_MODERATE_BYTES) {
    return 'moderate';
  }

  return baseLevel;
}

export function applyMemoryPressureSample(sample: MemoryPressureSample): MemoryPressureLevel {
  const currentLevel = globalMemoryGovernor.getLevel();
  const nextLevel = classifyMemoryPressure(sample, currentLevel);
  globalMemoryGovernor.setLevel(nextLevel);
  return nextLevel;
}
