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

const SECRET = '12345678901234567890';

describe('Generate HOTP', () => {
  it('matches every counter in RFC 4226 appendix D', async () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    for (let counter = 0; counter < expected.length; counter++) {
      expect(
        await run(SECRET, ['generate-hotp', { 'Secret encoding': 'UTF-8', Counter: counter }]),
        `counter ${counter}`,
      ).toBe(expected[counter]);
    }
  });

  it('reads the same secret written as Base32 or hex', async () => {
    const base32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const hex = '3132333435363738393031323334353637383930';
    expect(await run(base32, ['generate-hotp', { 'Secret encoding': 'Base32' }])).toBe('755224');
    expect(await run(hex, ['generate-hotp', { 'Secret encoding': 'Hex' }])).toBe('755224');
  });

  it('produces the number of digits asked for', async () => {
    expect(await run(SECRET, ['generate-hotp', { 'Secret encoding': 'UTF-8', Digits: 8 }])).toBe(
      '84755224',
    );
    expect(
      await run(SECRET, ['generate-hotp', { 'Secret encoding': 'UTF-8', Digits: 4 }]),
    ).toHaveLength(4);
  });

  it('refuses a digit count no implementation would accept', async () => {
    const result = await bake(
      SECRET,
      recipe(['generate-hotp', { 'Secret encoding': 'UTF-8', Digits: 12 }]),
    );
    expect(result.error?.message).toMatch(/between 4 and 10/);
  });

  it('refuses a secret that is not Base32', async () => {
    const result = await bake('not base 32!', recipe('generate-hotp'));
    expect(result.error?.message).toMatch(/not a Base32 character/);
  });
});

describe('Generate TOTP', () => {
  it('matches the SHA-1 rows of RFC 6238 appendix B', async () => {
    const cases: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [time, expected] of cases) {
      expect(
        await run(SECRET, [
          'generate-totp',
          { 'Secret encoding': 'UTF-8', Digits: 8, Timestamp: time },
        ]),
        `T = ${time}`,
      ).toBe(expected);
    }
  });

  it('is HOTP over the number of time steps', async () => {
    expect(
      await run(SECRET, ['generate-totp', { 'Secret encoding': 'UTF-8', Timestamp: 59 }]),
    ).toBe(await run(SECRET, ['generate-hotp', { 'Secret encoding': 'UTF-8', Counter: 1 }]));
  });

  it('shows the neighbouring codes when asked', async () => {
    const report = await run(SECRET, [
      'generate-totp',
      { 'Secret encoding': 'UTF-8', Digits: 8, Timestamp: 59, 'Show the window': true },
    ]);
    expect(report).toContain('Code:      94287082');
    expect(report).toContain('Previous:  755224'.slice(0, 10));
    expect(report).toMatch(/Valid for: \d+s \(step 1\)/);
  });

  it('uses the clock when no timestamp is given', async () => {
    const code = await run(SECRET, ['generate-totp', { 'Secret encoding': 'UTF-8' }]);
    expect(code).toMatch(/^\d{6}$/);
  });
});
