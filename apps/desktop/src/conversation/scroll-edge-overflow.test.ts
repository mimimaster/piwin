import { describe, expect, it } from 'vitest';
import { measureScrollEdgeOverflow } from './scroll-edge-overflow';

describe('measureScrollEdgeOverflow', () => {
  it('reports no overflow when content fits', () => {
    expect(measureScrollEdgeOverflow({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 })).toEqual({
      above: false,
      below: false,
    });
  });

  it('reports only below at the top of a long list', () => {
    expect(measureScrollEdgeOverflow({ scrollTop: 0, scrollHeight: 900, clientHeight: 300 })).toEqual({
      above: false,
      below: true,
    });
  });

  it('reports both edges mid-scroll', () => {
    expect(measureScrollEdgeOverflow({ scrollTop: 200, scrollHeight: 900, clientHeight: 300 })).toEqual({
      above: true,
      below: true,
    });
  });

  it('reports only above at the bottom', () => {
    expect(measureScrollEdgeOverflow({ scrollTop: 600, scrollHeight: 900, clientHeight: 300 })).toEqual({
      above: true,
      below: false,
    });
  });

  it('treats sub-pixel offsets at either end as resting on the edge', () => {
    expect(
      measureScrollEdgeOverflow({ scrollTop: 0.5, scrollHeight: 900.4, clientHeight: 300 }),
    ).toEqual({ above: false, below: true });
    expect(
      measureScrollEdgeOverflow({ scrollTop: 599.6, scrollHeight: 900.4, clientHeight: 300 }),
    ).toEqual({ above: true, below: false });
  });
});
