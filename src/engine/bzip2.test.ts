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

async function unbzip(hex: string): Promise<string> {
  return run(hex, 'from-hex', 'bzip2-decompress');
}

const PANGRAM = 'The quick brown fox jumps over the lazy dog. ';

describe('Bzip2 Decompress', () => {
  it('reads a stream libbz2 produced', async () => {
    const stream =
      '425a68313141592653594032ba9c0000101380400104003ffffff0200048cffd528264c23348d' +
      'a9b442bf551ea3434326234368868e9b3a649a137b796e8490954a2b70e5aa8b5f106229410e4' +
      'f4fc43a3e2a20a29018cb162e2ee48a70a120806575380';
    expect(await unbzip(stream)).toBe(PANGRAM.repeat(3));
  });

  it('undoes the run-length coding that comes before the transform', async () => {
    const stream =
      '425a683131415926535949dc4f630000018101a00000800008200020aa6d4198ba83c5dc914e1' +
      '424127713d8c0';
    const out = await unbzip(stream);
    expect(out).toHaveLength(1000);
    expect(/^a+$/.test(out)).toBe(true);
  });

  it('reads a stream at the largest block size', async () => {
    const stream = '425a6839314159265359774bb01400000000800040200021184682ee48a70a120ee9760280';
    expect(await unbzip(stream)).toBe('x');
  });

  it('returns bytes, not text, so UTF-8 survives the round trip', async () => {
    const stream =
      '425a6839314159265359f74d5e0d000008907a400023c4040000802800006820003100000ac86' +
      '9a69bd2926193a68b2683362f8bb9229c28487ba6af0680';
    expect(await unbzip(stream)).toBe('نمونهٔ فارسی');
  });

  it('refuses data that is not bzip2', async () => {
    const result = await bake('just some text', recipe('bzip2-decompress'));
    expect(result.error?.message).toMatch(/does not start with 'BZh'/);
  });

  it('notices a corrupted block instead of returning wrong bytes', async () => {
    const stream =
      '425a68313141592653594032ba9c0000101380400104003ffffff0200048cffd528264c23348' +
      'da9b442bf551ea3434326234368868e9b3a649a137b797e8490954a2b70e5aa8b5f106229410' +
      'e4f4fc43a3e2a20a29018cb162e2ee48a70a120806575380'; 
    const result = await bake(stream, recipe('from-hex', 'bzip2-decompress'));
    expect(result.error?.message).toMatch(/checksum|corrupt|not valid|out of range/);
  });
});

describe('Bzip2 Compress', () => {
  it('produces a stream its own decompressor reads back exactly', async () => {
    const cases = [
      'a',
      'hello',
      PANGRAM.repeat(20),
      'x'.repeat(5000),
      Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join(''),
    ];
    for (const value of cases) {
      const compressed = await run(value, 'bzip2-compress');
      expect(await run(compressed, 'bzip2-decompress'), `${value.length} bytes`).toBe(value);
    }
  }, 60000);

  it('writes the header libbz2 expects', async () => {
    const hex = await run('hello', 'bzip2-compress', ['to-hex', { Delimiter: 'None' }]);
    expect(hex.startsWith('425a6839')).toBe(true); 
    expect(hex.slice(8, 20)).toBe('314159265359'); 
  });

  it('honours the block size argument', async () => {
    const hex = await run('hello', ['bzip2-compress', { 'Block size (100k units)': 1 }], [
      'to-hex',
      { Delimiter: 'None' },
    ]);
    expect(hex.startsWith('425a6831')).toBe(true); 
  });

  it('actually compresses repetitive data', async () => {
    const value = PANGRAM.repeat(200);
    const compressed = await run(value, 'bzip2-compress');
    expect(compressed.length).toBeLessThan(value.length / 10);
  }, 60000);

  it('refuses an empty input rather than writing a stream with no block', async () => {
    const result = await bake('', recipe('bzip2-compress'));
    expect(result.error?.message).toMatch(/nothing to compress/);
  });
});
