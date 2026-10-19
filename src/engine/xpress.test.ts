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

describe('XPRESS Decompress', () => {
  it('reads a stream of nothing but literals', async () => {
    expect(await run('ffff1f0068656c6c6f20776f726c64', 'from-hex', 'xpress-decompress')).toBe(
      'hello world',
    );
  });

  it('reads literals and matches together', async () => {
    const stream =
      '0000000054686520717569636b2062726f776e20666f78206a756d7073206f7665722074ffff1f' +
      '80f0006c617a7920646f672e2067010f41';
    expect(await run(stream, 'from-hex', 'xpress-decompress')).toBe(
      'The quick brown fox jumps over the lazy dog. '.repeat(3),
    );
  });

  it('reads the long-match encoding, where the length needs its own bytes', async () => {
    const out = await run('ffffff7f6107000ffff001', 'from-hex', 'xpress-decompress');
    expect(out).toHaveLength(500);
    expect(/^a+$/.test(out)).toBe(true);
  });

  it('reads a match followed by more literals', async () => {
    expect(await run('ffffff435a07000fffb40b7461696c', 'from-hex', 'xpress-decompress')).toBe(
      'Z'.repeat(3000) + 'tail',
    );
  });

  it('reads data that does not compress at all', async () => {
    const stream =
      '00000000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f000000' +
      '00202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f000000004041' +
      '42434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f000000006061626364' +
      '65666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f000000008081828384858687' +
      '88898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f00000000a0a1a2a3a4a5a6a7a8a9aa' +
      'abacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf00000000c0c1c2c3c4c5c6c7c8c9cacbcccd' +
      'cecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedf00000000e0e1e2e3e4e5e6e7e8e9eaebecedeeeff0' +
      'f1f2f3f4f5f6f7f8f9fafbfcfdfeffffffffff';
    const out = await run(stream, 'from-hex', 'xpress-decompress');
    expect(out).toHaveLength(256);
    expect(out.charCodeAt(0)).toBe(0);
    expect(out.charCodeAt(255)).toBe(255);
  });

  it('refuses a match pointing before the start of the data', async () => {
    const result = await bake('000000800000', recipe('from-hex', 'xpress-decompress'));
    expect(result.error?.message).toMatch(/points \d+ bytes back/);
  });

  it('refuses input with no flag word at all', async () => {
    const result = await bake('ab', recipe('from-hex', 'xpress-decompress'));
    expect(result.error?.message).toMatch(/not even a flag word/);
  });
});

describe('XPRESS LZ77+Huffman Decompress', () => {
  const HELLO =
    '000000000000000000000000000000000400000000000000000000000000000000000000000000' +
    '000000000000000000000044000400023000030030000000000000000000000000000000000000' +
    '000000000000000000000000000000000000000000000000000000000000000000000000000000' +
    '000000000000000000000003000000000000000000000000000000000000000000000000000000' +
    '000000000000000000000000000000000000000000000000000000000000000000000000000000' +
    '000000000000000000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000005fe339100680000';

  const RUNS =
    '000000000000000000000000000000000000000000000000000000000000000000000000000000' +
    '000000000000000000200000000000000000000000000000000000000000000000000000000000' +
    '000000000000000000000000000000000000000000000000000000000000000000000000000000' +
    '000000000000000000000002000000000000100000000000000000000000000000000000000000' +
    '000000000000000000000000000000000000000000000000000000000000000000000000000000' +
    '000000000000000000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000980000fff001';

  it('reads a chunk of literals through the 512-symbol table', async () => {
    expect(
      await run(HELLO, 'from-hex', ['xpress-huffman-decompress', { 'Decompressed size': 11 }]),
    ).toBe('hello world');
  });

  it('reads a match whose length needs bytes from outside the bit stream', async () => {
    const out = await run(RUNS, 'from-hex', ['xpress-huffman-decompress', { 'Decompressed size': 500 }]);
    expect(out).toHaveLength(500);
    expect(/^a+$/.test(out)).toBe(true);
  });

  it('decodes the data even when the size is not known', async () => {
    const out = await run(HELLO, 'from-hex', 'xpress-huffman-decompress');
    expect(out.startsWith('hello world')).toBe(true);
  });

  it('refuses input too short to hold a table', async () => {
    const result = await bake('00'.repeat(100), recipe('from-hex', 'xpress-huffman-decompress'));
    expect(result.error?.message).toMatch(/256-byte table/);
  });

  it('refuses a table with no symbols in it', async () => {
    const result = await bake('00'.repeat(300), recipe('from-hex', 'xpress-huffman-decompress'));
    expect(result.error?.message).toMatch(/no symbols in it/);
  });
});
