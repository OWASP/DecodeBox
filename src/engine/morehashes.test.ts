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

function digests(report: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of report.split('\n')) {
    const parts = line.trimEnd().split(/\s{2,}/);
    if (parts.length === 2 && parts[1] !== undefined) out.set(parts[0]!.trim(), parts[1]);
  }
  return out;
}

describe('HAS-160', () => {
  it('matches the vectors published with the standard', async () => {
    const cases: Array<[string, string]> = [
      ['', '307964ef34151d37c8047adec7ab50f4ff89762d'],
      ['a', '4872bcbc4cd0f0a9dc7c2f7045e5b43b6c830db8'],
      ['abc', '975e810488cf2a3d49838478124afce4b1c78804'],
      ['message digest', '2338dbc8638d31225f73086246ba529f96710bc6'],
      ['abcdefghijklmnopqrstuvwxyz', '596185c9ab6703d0d0dbb98702bc0f5729cd1d3c'],
    ];
    for (const [input, expected] of cases) {
      expect(await run(input, 'has-160'), input || '(empty)').toBe(expected);
    }
  });

  it('handles an input that spans more than one block', async () => {
    expect(await run('a'.repeat(64), 'has-160')).toHaveLength(40);
  });
});

describe('Generate all hashes', () => {
  it('runs every digest over the same input', async () => {
    const report = await run('abc', 'generate-all-hashes');
    expect(report).toContain('Input length: 3 bytes');

    const found = digests(report);
    expect(found.get('MD5')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(found.get('SHA1')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(found.get('SHA2 256')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(found.get('HAS-160')).toBe('975e810488cf2a3d49838478124afce4b1c78804');
    expect(found.get('RIPEMD 160')).toBe('8eb208f7e05d987a9b044a8e98c6b087f15a0bfc');
  });

  it('lists every digest, including any that failed', async () => {
    const report = await run('abc', ['generate-all-hashes', { 'Include length': false }]);
    expect(report.split('\n').length).toBeGreaterThan(15);
    expect(report.startsWith('MD2')).toBe(true);
  });
});
