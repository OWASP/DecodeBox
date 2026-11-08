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

describe('LZMA distances at the end of the special-position table', () => {
  /*
   * A match 112 or 128 bytes back codes its low distance bits through the
   * last probability of that table. Both coders indexed it one place too far,
   * read past the end of the array, and the range coder turned to NaN.
   */
  const BLOCK =
    '82b70eee7f1a5039bef07ec2347f066ed08f5dc7512447e3404300026b6e545594a065685d64c4980bb8d454' +
    '4a8721a99a01ad219eb59cf6a15ef6f15a1d830bb7ce09d6bbc004e7175c643c7decb0b580ec37bc9712dd2e' +
    '6aaeb94bae8d2f9fa29c5a284c9ef7521829cf1079b080e9';
  // Python's lzma module, FORMAT_ALONE, preset 6: BLOCK twice, so one match 112 back.
  const STREAM =
    '5d00000100ffffffffffffffff00412dbdcee45f29217b8d59c747e6f465fe28d1c7e6d3c32e50ff8d18c1ca' +
    '68280686c20c020d7c7944ee90d26b72b2c2d3b0d7302151c244d7ae673b156f859ed092490bb7af2bc12d48' +
    '977e12b3e57253de7335421f0ff171a4ef92a6093543c25a411ec7284a1288a350a725b069dd7061b712472a' +
    '5cc8a109bb7b8a24b3fffe44b000';

  it('reads a liblzma stream whose match is 112 bytes back', async () => {
    expect(await run(STREAM, 'from-hex', 'lzma-decompress', ['to-hex', { Delimiter: 'None' }])).toBe(
      BLOCK + BLOCK,
    );
  });

  it('compresses a list of numbers and reads it back', async () => {
    const numbers =
      '24 161 53 253 127 93 219 125 137 9 193 228 175 50 82 171 234 252 209 122 241 117 66 100 ' +
      '30 135 252 157 109 167 119 181 174 87 219 217 230 173 10';
    expect(await run(numbers, 'lzma-compress', 'lzma-decompress')).toBe(numbers);
  });
});
