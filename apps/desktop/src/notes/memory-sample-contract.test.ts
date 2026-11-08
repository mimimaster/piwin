import { describe, expect, it } from 'vitest';
import {
  SAMPLE_FULL_PAYLOAD,
  SAMPLE_PARTIAL_PAYLOAD,
  isFiniteByteCount,
  isMemoryPressureEventDetail,
  isNativeOsPressureLevel,
  isProcessSampleArray,
  mainFootprintBytes,
  type MemoryPressureEventDetail,
} from './memory-sample-contract';

describe('isFiniteByteCount', () => {
  it('accepts finite non-negative numbers only', () => {
    expect(isFiniteByteCount(0)).toBe(true);
    expect(isFiniteByteCount(1024)).toBe(true);
    expect(isFiniteByteCount(-1)).toBe(false);
    expect(isFiniteByteCount(Number.NaN)).toBe(false);
    expect(isFiniteByteCount(Infinity)).toBe(false);
    expect(isFiniteByteCount('1024')).toBe(false);
    expect(isFiniteByteCount(undefined)).toBe(false);
  });
});

describe('isNativeOsPressureLevel', () => {
  it('accepts the four native tiers only', () => {
    for (const level of ['normal', 'warning', 'urgent', 'critical']) {
      expect(isNativeOsPressureLevel(level)).toBe(true);
    }
    expect(isNativeOsPressureLevel('moderate')).toBe(false);
    expect(isNativeOsPressureLevel('')).toBe(false);
    expect(isNativeOsPressureLevel(4)).toBe(false);
  });
});

describe('isProcessSampleArray', () => {
  it('accepts well-formed samples incl. missing optional fields', () => {
    expect(isProcessSampleArray(SAMPLE_FULL_PAYLOAD.processes)).toBe(true);
    expect(isProcessSampleArray(SAMPLE_PARTIAL_PAYLOAD.processes)).toBe(true);
    expect(isProcessSampleArray([])).toBe(true);
  });

  it('rejects malformed samples', () => {
    expect(
      isProcessSampleArray([{ windowLabel: 'main', role: 'auxiliary', shared: false }]),
    ).toBe(false);
    expect(isProcessSampleArray([{ windowLabel: 'x', role: 'auxiliary' }])).toBe(false);
    expect(isProcessSampleArray([null])).toBe(false);
    expect(isProcessSampleArray('nope')).toBe(false);
    expect(
      isProcessSampleArray([
        { windowLabel: 'main', role: 'main', pid: 1.5, shared: false },
      ]),
    ).toBe(false);
    // 0 bytes is never a valid sample — missing stays missing.
    expect(
      isProcessSampleArray([
        { windowLabel: 'main', role: 'main', footprintBytes: 0, shared: false },
      ]),
    ).toBe(false);
    expect(
      isProcessSampleArray([
        { windowLabel: 'main', role: 'main', footprintBytes: -5, shared: false },
      ]),
    ).toBe(false);
  });
});

describe('isMemoryPressureEventDetail', () => {
  it('accepts legacy minimal payloads', () => {
    expect(isMemoryPressureEventDetail({})).toBe(true);
    expect(isMemoryPressureEventDetail({ bytes: 1234 })).toBe(true);
    expect(isMemoryPressureEventDetail({ level: 'moderate' })).toBe(true);
  });

  it('accepts the shipped fixtures', () => {
    expect(isMemoryPressureEventDetail(SAMPLE_FULL_PAYLOAD)).toBe(true);
    expect(isMemoryPressureEventDetail(SAMPLE_PARTIAL_PAYLOAD)).toBe(true);
  });

  it('rejects malformed optionals while tolerating absent fields', () => {
    expect(isMemoryPressureEventDetail({ bytes: -5 })).toBe(false);
    expect(isMemoryPressureEventDetail({ osPressure: 'moderate' })).toBe(false);
    expect(isMemoryPressureEventDetail({ processes: 'x' })).toBe(false);
    expect(isMemoryPressureEventDetail({ quality: 'degraded' })).toBe(false);
    expect(isMemoryPressureEventDetail({ sampleId: 1.2 })).toBe(false);
    expect(isMemoryPressureEventDetail(null)).toBe(false);
    expect(isMemoryPressureEventDetail('payload')).toBe(false);
  });
});

describe('mainFootprintBytes', () => {
  it('prefers the main process sample over legacy bytes', () => {
    const detail: MemoryPressureEventDetail = {
      bytes: 111,
      processes: [
        { windowLabel: 'main', role: 'main', footprintBytes: 222, shared: false },
        { windowLabel: 'pin', role: 'auxiliary', footprintBytes: 999, shared: false },
      ],
    };
    expect(mainFootprintBytes(detail)).toBe(222);
  });

  it('falls back to legacy bytes when the main process is unsampled', () => {
    const detail: MemoryPressureEventDetail = {
      bytes: 333,
      processes: [{ windowLabel: 'main', role: 'main', shared: false }],
    };
    expect(mainFootprintBytes(detail)).toBe(333);
  });

  it('treats zero as missing: footprint 0 falls back, bytes 0 is omitted', () => {
    expect(
      mainFootprintBytes({
        bytes: 400,
        processes: [
          { windowLabel: 'main', role: 'main', footprintBytes: 0, shared: false },
        ],
      }),
    ).toBe(400);
    expect(mainFootprintBytes({ bytes: 0 })).toBeUndefined();
    expect(mainFootprintBytes({})).toBeUndefined();
    expect(
      mainFootprintBytes({
        processes: [
          { windowLabel: 'pin', role: 'auxiliary', footprintBytes: 5, shared: false },
        ],
      }),
    ).toBeUndefined();
  });
});

describe('serialization fixtures', () => {
  it('full fixture carries all windows sampled and no errors', () => {
    expect(SAMPLE_FULL_PAYLOAD.quality).toBe('full');
    expect(SAMPLE_FULL_PAYLOAD.errors).toEqual([]);
    expect(SAMPLE_FULL_PAYLOAD.unknownWindows).toEqual([]);
    expect(SAMPLE_FULL_PAYLOAD.processes?.every((p) => p.footprintBytes !== undefined)).toBe(
      true,
    );
    expect(SAMPLE_FULL_PAYLOAD.osPressure).toBe('normal');
    // startClock stays a string to survive u64 → JS Number conversion.
    expect(typeof SAMPLE_FULL_PAYLOAD.processes?.[0]?.startClock).toBe('string');
  });

  it('partial fixture exercises missing fields and the ratio fallback', () => {
    expect(SAMPLE_PARTIAL_PAYLOAD.quality).toBe('partial');
    expect(SAMPLE_PARTIAL_PAYLOAD.availableBytesKind).toBe('reclaimable-estimate');
    expect(SAMPLE_PARTIAL_PAYLOAD.unknownWindows).toEqual(['pet-overlay']);
    const aux = SAMPLE_PARTIAL_PAYLOAD.processes?.find((p) => p.role === 'auxiliary');
    expect(aux?.footprintBytes).toBeUndefined();
    expect(aux?.pid).toBeUndefined();
    expect(SAMPLE_PARTIAL_PAYLOAD.retiredProcesses?.[0]?.pid).toBe(4200);
  });

  it('round-trips through JSON without field loss', () => {
    for (const fixture of [SAMPLE_FULL_PAYLOAD, SAMPLE_PARTIAL_PAYLOAD]) {
      const reparsed = JSON.parse(JSON.stringify(fixture)) as unknown;
      expect(isMemoryPressureEventDetail(reparsed)).toBe(true);
      expect(reparsed).toEqual(fixture);
    }
  });
});
