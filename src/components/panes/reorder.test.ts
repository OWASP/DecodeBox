import { describe, expect, it } from 'vitest';
import { dropTarget, finalIndex, seamAt, type Span } from './reorder';

const spans: Span[] = [
  { top: 0, height: 40 },
  { top: 40, height: 40 },
  { top: 80, height: 40 },
  { top: 120, height: 40 },
];

describe('seamAt', () => {
  it('is 0 above the first midpoint', () => {
    expect(seamAt(-50, spans)).toBe(0);
    expect(seamAt(0, spans)).toBe(0);
    expect(seamAt(19, spans)).toBe(0);
  });

  it('crosses at the midpoint, not the edge', () => {
    expect(seamAt(20, spans)).toBe(1);
    expect(seamAt(59, spans)).toBe(1);
    expect(seamAt(60, spans)).toBe(2);
  });

  it('is one past the end below everything', () => {
    expect(seamAt(140, spans)).toBe(4);
    expect(seamAt(9999, spans)).toBe(4);
  });

  it('has no seams in an empty list', () => {
    expect(seamAt(50, [])).toBe(0);
  });
});

describe('finalIndex', () => {
  it('leaves a seam above the step alone', () => {
    expect(finalIndex(0, 2)).toBe(0);
    expect(finalIndex(2, 2)).toBe(2);
  });

  it('closes up a seam below the step', () => {
    expect(finalIndex(4, 0)).toBe(3);
    expect(finalIndex(3, 1)).toBe(2);
  });
});

describe('dropTarget', () => {
  it('drops the first step at the end when dragged past everything', () => {
    expect(dropTarget(500, spans, 0)).toBe(3);
  });

  it('drops the last step at the start when dragged above everything', () => {
    expect(dropTarget(-10, spans, 3)).toBe(0);
  });

  it('is a no-op where the step already is', () => {
    for (let y = 40; y < 80; y += 1) expect(dropTarget(y, spans, 1)).toBe(1);
  });

  it('never leaves the list', () => {
    for (const from of [0, 1, 2, 3]) {
      for (let y = -200; y < 400; y += 7) {
        const target = dropTarget(y, spans, from);
        expect(target).toBeGreaterThanOrEqual(0);
        expect(target).toBeLessThan(spans.length);
      }
    }
  });

  it('moves a step exactly one place for a one-block drag', () => {
    expect(dropTarget(101, spans, 1)).toBe(2);
    expect(dropTarget(19, spans, 1)).toBe(0);
  });
});
