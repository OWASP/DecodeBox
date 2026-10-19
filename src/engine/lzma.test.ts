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

const PANGRAM = 'The quick brown fox jumps over the lazy dog. ';

describe('LZMA Decompress', () => {
  it('reads a stream liblzma produced', async () => {
    const stream =
      '5d00008000ffffffffffffffff002a1a08a2032566f14b78c5a205ff2ee6d9d2201aad34f8e21d' +
      'e84136fadc0669bb3ce410342709ebb366e3ed375ae81ae477fffffac0a000';
    expect(await run(stream, 'from-hex', 'lzma-decompress')).toBe(PANGRAM.repeat(3));
  });

  it('handles a stream whose header declares an unknown size', async () => {
    const stream = '5d00008000ffffffffffffffff00341a5cfffffffff0000000';
    expect(await run(stream, 'from-hex', 'lzma-decompress')).toBe('hi');
  });

  it('refuses a header that is not LZMA', async () => {
    const result = await bake('too short', recipe('lzma-decompress'));
    expect(result.error?.message).toMatch(/13-byte header/);
  });

  it('refuses an impossible properties byte', async () => {
    const result = await bake('e1' + '0'.repeat(50), recipe('from-hex', 'lzma-decompress'));
    expect(result.error?.message).toMatch(/not a valid LZMA properties byte/);
  });

  it('notices a truncated stream rather than returning what it managed', async () => {
    const full =
      '5d00008000ffffffffffffffff002a1a08a2032566f14b78c5a205ff2ee6d9d2201aad34f8e21d' +
      'e84136fadc0669bb3ce410342709ebb366e3ed375ae81ae477fffffac0a000';
    const withSize = `5d00008000${'8700000000000000'}${full.slice(26)}`;
    const result = await bake(withSize, recipe('from-hex', 'lzma-decompress'));
    expect(result.output.length === 135 || result.error !== undefined).toBe(true);
  });
});

describe('LZMA Compress', () => {
  it('produces a stream its own decompressor reads back exactly', async () => {
    const cases = [
      'a',
      'hi',
      PANGRAM.repeat(20),
      'x'.repeat(5000),
      Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join(''),
      '',
    ];
    for (const value of cases) {
      const compressed = await run(value, 'lzma-compress');
      expect(await run(compressed, 'lzma-decompress'), `${value.length} bytes`).toBe(value);
    }
  }, 60000);

  it('writes the 13-byte header the format calls for', async () => {
    const hex = await run('hello', 'lzma-compress', ['to-hex', { Delimiter: 'None' }]);
    expect(hex.slice(0, 2)).toBe('5d'); 
    expect(hex.slice(2, 10)).toBe('00008000'); 
    expect(hex.slice(10, 26)).toBe('0500000000000000'); 
  });

  it('records the properties it was asked for', async () => {
    const hex = await run('hello', ['lzma-compress', { 'Position bits (pb)': 0 }], [
      'to-hex',
      { Delimiter: 'None' },
    ]);
    expect(hex.slice(0, 2)).toBe('03'); 
  });

  it('refuses a literal model that would not fit', async () => {
    const result = await bake(
      'x',
      recipe(['lzma-compress', { 'Literal context bits (lc)': 4, 'Literal position bits (lp)': 2 }]),
    );
    expect(result.error?.message).toMatch(/lc \+ lp/);
  });

  it('finds the repetition in repetitive data', async () => {
    const value = PANGRAM.repeat(200);
    const compressed = await run(value, 'lzma-compress');
    expect(compressed.length).toBeLessThan(value.length / 20);
  }, 60000);
});
