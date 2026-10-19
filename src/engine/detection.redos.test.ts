import { describe, expect, it } from 'vitest';
import { detect } from './index';
import { getOperation } from './operations';

/*
 * Detection runs on whatever is pasted, before anyone has decided it is CSV, so every
 * detection pattern has to finish in time proportional to the input. A pattern that
 * backtracks exponentially lets a few dozen characters freeze the page.
 */
describe('detection patterns stay linear on hostile input', () => {
  const csvPattern = getOperation('csv-to-json')?.detection?.pattern;

  it('has a CSV detection pattern to test', () => {
    expect(csvPattern).toBeInstanceOf(RegExp);
  });

  it('rejects many comma-only lines that fail at the end, quickly', () => {
    // 16 of these lines took seconds with the old pattern, 18 took over thirty.
    const hostile = 'a,b' + '\n,,,'.repeat(5000) + '\nx';
    const started = performance.now();
    expect(csvPattern?.test(hostile)).toBe(false);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('still recognises ordinary CSV, including CRLF line endings', () => {
    expect(csvPattern?.test('name,age\nalice,30\nbob,25')).toBe(true);
    expect(csvPattern?.test('name,age\r\nalice,30\r\nbob,25\r\n'.trim())).toBe(true);
    expect(csvPattern?.test('a,b,c\n1,2,3\n4,5,6')).toBe(true);
  });

  it('still rejects text that is not CSV', () => {
    expect(csvPattern?.test('one line only, with a comma')).toBe(false);
    expect(csvPattern?.test('a,b\nno comma here')).toBe(false);
    expect(csvPattern?.test('a;b\nc;d')).toBe(false);
  });

  it('lets full detection finish on the hostile input', async () => {
    const hostile = 'a,b' + '\n,,,'.repeat(200) + '\nx';
    const started = performance.now();
    const candidates = await detect(hostile);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(candidates.some((c) => c.format === 'CSV')).toBe(false);
  });
});
