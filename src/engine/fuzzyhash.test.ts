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

const BASE = 'The quick brown fox jumps over the lazy dog. '.repeat(30);
const EDITED = BASE.replace('lazy dog. The quick', 'lazy cat. The quick');
const OTHER = 'Completely unrelated text about something else entirely. '.repeat(30);

describe('SSDEEP', () => {
  it('writes the block size and two hashes', async () => {
    const hash = await run(BASE, 'ssdeep');
    expect(hash).toMatch(/^\d+:[A-Za-z0-9+/]*:[A-Za-z0-9+/]*$/);
    const [size, left, right] = hash.split(':');
    expect(Number(size)).toBeGreaterThanOrEqual(3);
    expect(left!.length).toBeLessThanOrEqual(64);
    expect(right!.length).toBeLessThanOrEqual(32);
  });

  it('hashes an empty input the way the format does', async () => {
    expect(await run('', 'ssdeep')).toBe('3::');
  });

  it('is deterministic', async () => {
    expect(await run(BASE, 'ssdeep')).toBe(await run(BASE, 'ssdeep'));
  });

  it('chooses a larger block size for a larger input', async () => {
    const varied = (n: number): string =>
      Array.from({ length: n }, (_, i) => String.fromCharCode(32 + ((i * 7919) % 90))).join('');

    const small = Number((await run(varied(200), 'ssdeep')).split(':')[0]);
    const large = Number((await run(varied(200000), 'ssdeep')).split(':')[0]);
    expect(large).toBeGreaterThan(small);
  }, 60000);

  it('honours a block size that is given to it', async () => {
    expect((await run(BASE, ['ssdeep', { 'Block size': 12 }])).startsWith('12:')).toBe(true);
  });

  it('gives the same answer as CTPH, which is the same algorithm', async () => {
    expect(await run(BASE, 'ssdeep')).toBe(await run(BASE, 'ctph'));
  });
});

describe('Compare SSDEEP hashes', () => {
  it('scores a file against itself at 100', async () => {
    const hash = await run(BASE, 'ssdeep');
    expect(await run(hash, ['compare-ssdeep-hashes', { 'Second hash': hash }])).toBe('100');
  });

  it('scores a small edit high but not perfect', async () => {
    const a = await run(BASE, 'ssdeep');
    const b = await run(EDITED, 'ssdeep');
    expect(a).not.toBe(b);

    const score = Number(await run(a, ['compare-ssdeep-hashes', { 'Second hash': b }]));
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThan(100);
  });

  it('scores unrelated content at zero', async () => {
    const a = await run(BASE, 'ssdeep');
    const c = await run(OTHER, 'ssdeep');
    expect(await run(a, ['compare-ssdeep-hashes', { 'Second hash': c }])).toBe('0');
  });

  it('takes two hashes one per line as well', async () => {
    const a = await run(BASE, 'ssdeep');
    expect(await run(`${a}\n${a}`, 'compare-ssdeep-hashes')).toBe('100');
  });

  it('refuses block sizes too far apart to be comparable', async () => {
    expect(
      await run('3:abcdefgh:ijkl', ['compare-ssdeep-hashes', { 'Second hash': '192:abcdefgh:ijkl' }]),
    ).toBe('0');
  });

  it('refuses something that is not a fuzzy hash', async () => {
    const result = await bake(
      'not a hash',
      recipe(['compare-ssdeep-hashes', { 'Second hash': '3::' }]),
    );
    expect(result.error?.message).toMatch(/not a fuzzy hash/);
  });

  it('says so when only one hash is given', async () => {
    const result = await bake('3::', recipe('compare-ssdeep-hashes'));
    expect(result.error?.message).toMatch(/Two hashes are needed/);
  });

  it('agrees with the CTPH comparison, which is the same scoring', async () => {
    const a = await run(BASE, 'ssdeep');
    const b = await run(EDITED, 'ssdeep');
    expect(await run(a, ['compare-ssdeep-hashes', { 'Second hash': b }])).toBe(
      await run(a, ['compare-ctph-hashes', { 'Second hash': b }]),
    );
  });
});
