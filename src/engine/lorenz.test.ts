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

const LENGTHS = [41, 31, 29, 26, 23, 43, 47, 51, 53, 59, 61, 37];

function pattern(length: number, seed: number): string {
  let state = seed || 1;
  let out = '';
  for (let i = 0; i < length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    out += (state >> 16) & 1 ? '1' : '0';
  }
  return out;
}

const WHEELS = LENGTHS.map((length, i) => pattern(length, i + 1)).join('\n');

const PLAIN = 'ATTACKATDAWNONTHEEASTERNFRONTREPEATATDAWN';

describe('Lorenz', () => {
  it('is its own inverse', async () => {
    const settings = { 'Wheel patterns': WHEELS, 'Start positions': '1 2 3 4 5 6 7 8 9 10 11 12' };
    const cipher = await run(PLAIN, ['lorenz', settings]);
    expect(cipher).not.toBe(PLAIN);
    expect(await run(cipher, ['lorenz', settings])).toBe(PLAIN);
  });

  it('changes with every wheel and every start position', async () => {
    const base = { 'Wheel patterns': WHEELS, 'Start positions': '1 1 1 1 1 1 1 1 1 1 1 1' };
    const first = await run(PLAIN, ['lorenz', base]);

    for (let wheel = 0; wheel < 12; wheel++) {
      const positions = LENGTHS.map((_, i) => (i === wheel ? 2 : 1)).join(' ');
      const moved = await run(PLAIN, ['lorenz', { ...base, 'Start positions': positions }]);
      expect(moved, `wheel ${wheel + 1}`).not.toBe(first);
    }
  }, 30000);

  it('applies the SZ42 limitations, which change the key stream', async () => {
    const base = { 'Wheel patterns': WHEELS, 'Start positions': '1 1 1 1 1 1 1 1 1 1 1 1' };
    const plain = await run(PLAIN, ['lorenz', base]);
    const chi2 = await run(PLAIN, ['lorenz', { ...base, Limitation: 'Chi 2 one back' }]);
    const psi1 = await run(PLAIN, ['lorenz', { ...base, Limitation: 'Psi 1 one back' }]);

    expect(new Set([plain, chi2, psi1]).size).toBe(3);
    expect(await run(chi2, ['lorenz', { ...base, Limitation: 'Chi 2 one back' }])).toBe(PLAIN);
  });

  it('works on five-bit codes as well as text', async () => {
    const settings = { 'Wheel patterns': WHEELS, 'Start positions': '' };
    const codes = await run(PLAIN, ['lorenz', { ...settings, Output: 'Five-bit numbers' }]);
    expect(codes).toMatch(/^[\d ]+$/);

    const back = await run(codes, [
      'lorenz',
      { ...settings, Input: 'Five-bit numbers', Output: 'Text' },
    ]);
    expect(back).toBe(PLAIN);
  });

  it('refuses the wrong number of wheels', async () => {
    const result = await bake(PLAIN, recipe(['lorenz', { 'Wheel patterns': '0101\n1010' }]));
    expect(result.error?.message).toMatch(/Twelve wheel patterns are needed/);
  });

  it('refuses a wheel with the wrong number of pins', async () => {
    const short = LENGTHS.map((length, i) => pattern(i === 0 ? length - 1 : length, i + 1)).join('\n');
    const result = await bake(PLAIN, recipe(['lorenz', { 'Wheel patterns': short }]));
    expect(result.error?.message).toMatch(/Wheel 1 has 41 pins/);
  });

  it('refuses a start position the wheel does not have', async () => {
    const result = await bake(
      PLAIN,
      recipe(['lorenz', { 'Wheel patterns': WHEELS, 'Start positions': '99 1 1 1 1 1 1 1 1 1 1 1' }]),
    );
    expect(result.error?.message).toMatch(/Wheel 1 has 41 positions/);
  });
});

describe('Colossus', () => {
  it('finds the chi settings a message was enciphered with', async () => {
    const chi1Start = 7;
    const chi2Start = 19;
    const positions = [chi1Start, chi2Start, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1].join(' ');

    const message = (
      'THE GERMAN HIGH COMMAND SENT MANY MESSAGES BY TELEPRINTER DURING THE WAR ' +
      'AND EACH ONE CARRIED A KEY THAT CHANGED WITH EVERY LETTER SENT ALONG THE LINE '
    ).repeat(12);
    const cipher = await run(message, [
      'lorenz',
      { 'Wheel patterns': WHEELS, 'Start positions': positions, Output: 'Five-bit numbers' },
    ]);

    const report = await run(cipher, [
      'colossus',
      {
        'Chi 1 pattern': pattern(41, 1),
        'Chi 2 pattern': pattern(31, 2),
        Input: 'Five-bit numbers',
        Results: 3,
      },
    ]);

    const rows = report.split('\n');
    const best = rows[rows.findIndex((line) => line.startsWith('Chi 1')) + 1]!;
    const [foundChi1, foundChi2] = best.trim().split(/\s+/).map(Number);
    expect(foundChi1).toBe(chi1Start);
    expect(foundChi2).toBe(chi2Start);
  }, 120000);

  it('refuses a message too short for a count to mean anything', async () => {
    const result = await bake(
      'SHORT',
      recipe(['colossus', { 'Chi 1 pattern': pattern(41, 1), 'Chi 2 pattern': pattern(31, 2) }]),
    );
    expect(result.error?.message).toMatch(/needs a long message/);
  });

  it('refuses a pattern with the wrong number of pins', async () => {
    const result = await bake(
      'A'.repeat(200),
      recipe(['colossus', { 'Chi 1 pattern': '0101', 'Chi 2 pattern': pattern(31, 2) }]),
    );
    expect(result.error?.message).toMatch(/Chi 1 has 41 pins/);
  });
});
