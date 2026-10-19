import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
import type { Recipe } from './types';


type Entry = string | [string, Record<string, string | number | boolean>];

function recipe(...entries: Entry[]): Recipe {
  return {
    id: 'test',
    name: 'test',
    steps: entries.map((entry, i) => {
      const [opId, overrides] = typeof entry === 'string' ? [entry, {}] : entry;
      const op = getOperation(opId);
      if (!op) throw new Error(`Unknown operation '${opId}'`);
      return {
        uid: `s${i}`,
        opId,
        args: op.args.map((a) => ({ ...a, value: overrides[a.name] ?? a.value })),
        disabled: false,
      };
    }),
  };
}

async function run(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (result.error) throw new Error(`${String(entries[0])}: ${result.error.message}`);
  return renderText(result.output);
}

describe('Convert co-ordinate format', () => {
  it('produces the geohash everyone quotes', async () => {
    expect(
      await run('42.6, -5.6', [
        'convert-coordinate-format',
        { 'Output format': 'Geohash', 'Geohash length': 5 },
      ]),
    ).toBe('ezs42');

    expect(
      await run('57.64911, 10.40744', [
        'convert-coordinate-format',
        { 'Output format': 'Geohash', 'Geohash length': 11 },
      ]),
    ).toBe('u4pruydqqvj');
  });

  it('reads a geohash back to the middle of its box', async () => {
    const decoded = await run('u4pruydqqvj', [
      'convert-coordinate-format',
      { 'Output format': 'Decimal Degrees', 'Decimal places': 5 },
    ]);
    expect(decoded).toBe('57.64911, 10.40744');
  });

  it('converts decimal degrees to degrees, minutes and seconds', async () => {
    expect(
      await run('51.4778, -0.0014', [
        'convert-coordinate-format',
        { 'Output format': 'Degrees Minutes Seconds', 'Decimal places': 1 },
      ]),
    ).toBe("51° 28' 40.1\" N, 0° 0' 5.0\" W");
  });

  it('converts to degrees and decimal minutes', async () => {
    expect(
      await run('51.4778, -0.0014', [
        'convert-coordinate-format',
        { 'Output format': 'Degrees Decimal Minutes', 'Decimal places': 3 },
      ]),
    ).toBe("51° 28.668' N, 0° 0.084' W");
  });

  it('reads degrees, minutes and seconds back', async () => {
    expect(
      await run('51° 28\' 40.1" N, 0° 0\' 5.0" W', [
        'convert-coordinate-format',
        { 'Decimal places': 4 },
      ]),
    ).toBe('51.4778, -0.0014');
  });

  it('lets a hemisphere letter override the sign', async () => {
    expect(await run('51.5 S, 0.1 W', ['convert-coordinate-format', { 'Decimal places': 1 }])).toBe(
      '-51.5, -0.1',
    );
  });

  it('refuses a latitude that is not one', async () => {
    const result = await bake('95.0, 10.0', recipe('convert-coordinate-format'));
    expect(result.error?.message).toMatch(/latitude runs from -90 to 90/);
  });

  it('refuses a longitude that is not one', async () => {
    const result = await bake('10.0, 195.0', recipe('convert-coordinate-format'));
    expect(result.error?.message).toMatch(/longitude runs from -180 to 180/);
  });

  it('refuses a geohash with a letter that is not in the alphabet', async () => {
    const result = await bake(
      'ezs4a',
      recipe(['convert-coordinate-format', { 'Input format': 'Geohash' }]),
    );
    expect(result.error?.message).toMatch(/not a geohash character/);
  });
});

describe('Primality test', () => {
  it('knows the small cases', async () => {
    expect(await run('2', 'primality-test')).toBe('2 is prime.');
    expect(await run('97', 'primality-test')).toBe('97 is prime.');
    expect(await run('1', 'primality-test')).toBe('1 is composite.');
    expect(await run('91', 'primality-test')).toBe('91 is composite.'); 
  });

  it('handles a Mersenne prime and its neighbour', async () => {
    expect(await run('2147483647', 'primality-test')).toMatch(/is prime/); 
    expect(await run('2147483649', 'primality-test')).toBe('2147483649 is composite.');
  });

  it('handles a Carmichael number, which fools a naive test', async () => {
    expect(await run('561', 'primality-test')).toBe('561 is composite.');
    expect(await run('62745', 'primality-test')).toBe('62745 is composite.');
  });

  it('handles a large prime', async () => {
    expect(await run('170141183460469231731687303715884105727', 'primality-test')).toMatch(
      /is prime with probability/,
    );
  });

  it('refuses something that is not a number', async () => {
    const result = await bake('not a number', recipe('primality-test'));
    expect(result.error?.message).toMatch(/not a whole number/);
  });
});

describe('Pseudo-Random Prime Generator', () => {
  it('generates a prime of the size asked for', async () => {
    const value = await run('', ['pseudo-random-prime-generator', { Bits: 128 }]);
    expect(BigInt(value).toString(2)).toHaveLength(128);
    expect(await run(value, 'primality-test')).toMatch(/is prime/);
  }, 60000);

  it('generates a different one each time', async () => {
    const first = await run('', ['pseudo-random-prime-generator', { Bits: 64 }]);
    const second = await run('', ['pseudo-random-prime-generator', { Bits: 64 }]);
    expect(first).not.toBe(second);
  }, 60000);

  it('writes it as hex when asked', async () => {
    const hex = await run('', ['pseudo-random-prime-generator', { Bits: 64, Output: 'Hex' }]);
    expect(hex).toMatch(/^[0-9a-f]{16}$/);
    expect(await run(BigInt('0x' + hex).toString(), 'primality-test')).toMatch(/is prime/);
  }, 60000);
});
