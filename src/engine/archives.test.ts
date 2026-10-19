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

async function raw(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (result.error) throw new Error(`${String(entries[0])}: ${result.error.message}`);
  return result.output;
}

async function run(input: string, ...entries: Entry[]): Promise<string> {
  return renderText(await raw(input, ...entries));
}

const SAMPLE = 'the quick brown fox jumps over the lazy dog, and does so repeatedly and at length';

describe('ZIP', () => {
  it('writes an archive the reader here can open', async () => {
    const archive = await raw(SAMPLE, ['zip', { Filename: 'note.txt' }]);
    expect(await run(archive, 'list-zip')).toContain('note.txt');
    expect(await run(archive, ['extract-from-zip', { Filename: 'note.txt' }])).toBe(SAMPLE);
  });

  it('writes a stored archive too', async () => {
    const archive = await raw(SAMPLE, [
      'zip',
      { Filename: 'note.txt', 'Compression method': 'None (Store)' },
    ]);
    expect(await run(archive, ['extract-from-zip', { Filename: 'note.txt' }])).toBe(SAMPLE);
  });
});

describe('tar', () => {
  it('writes an archive it can read back', async () => {
    const archive = await raw(SAMPLE, ['tar', { Filename: 'note.txt' }]);
    expect(archive.length % 512).toBe(0);
    expect(await run(archive, 'untar')).toContain('note.txt');
    expect(await run(archive, ['untar', { 'File to extract': 'note.txt' }])).toBe(SAMPLE);
  });

  it('carries the ustar magic at the offset tar puts it', async () => {
    const archive = await raw('x', 'tar');
    expect(archive.slice(257, 262)).toBe('ustar');
  });

  it('says so when a member is not there', async () => {
    const archive = await raw(SAMPLE, ['tar', { Filename: 'note.txt' }]);
    const result = await bake(archive, recipe(['untar', { 'File to extract': 'other.txt' }]));
    expect(result.error?.message).toMatch(/is not in this archive/);
  });
});

describe('LZ4', () => {
  it('round-trips, and shrinks repetitive input', async () => {
    const repetitive = 'abcdefgh'.repeat(200);
    const compressed = await raw(repetitive, 'lz4-compress');
    expect(compressed.length).toBeLessThan(repetitive.length / 2);
    expect(await run(compressed, 'lz4-decompress')).toBe(repetitive);
  });

  it('writes the frame magic every LZ4 reader looks for', async () => {
    const compressed = await raw(SAMPLE, 'lz4-compress');
    expect(
      Array.from(compressed.slice(0, 4), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    ).toBe('04224d18');
  });

  it('handles data it cannot compress', async () => {
    const random = Array.from({ length: 500 }, (_, i) => String.fromCharCode((i * 37) % 251)).join('');
    expect(await run(await raw(random, 'lz4-compress'), 'lz4-decompress')).toBe(random);
  });

  it('refuses something that is not a frame', async () => {
    const result = await bake('not lz4 at all', recipe('lz4-decompress'));
    expect(result.error?.message).toMatch(/not an LZ4 frame/);
  });
});

describe('LZString', () => {
  it('matches what the lz-string reference produces', async () => {
    expect(await run('hello', 'lzstring-compress')).toBe('BYUwNmD2Q===');
    expect(await run('BYUwNmD2Q===', 'lzstring-decompress')).toBe('hello');
    expect(await run('hello', ['lzstring-compress', { 'Compression format': 'URI encoded' }])).toBe(
      'BYUwNmD2Q',
    );
    expect(
      await run('BYUwNmD2Q', ['lzstring-decompress', { 'Compression format': 'URI encoded' }]),
    ).toBe('hello');
    expect(await run(SAMPLE, 'lzstring-compress')).toBe(
      'C4CwpgBAjgrglgYwNYQEYCcD2B3AdhAM0wA8IArGAWwAcBnCTANzHQlEgBsBDALwE8IAE0wBzADQQuuQUMxh6tTBHRhqYLsDCCOAqTI0QOYXCNBA',
    );
  });

  it('round-trips longer text in every format', async () => {
    for (const format of ['Base64', 'URI encoded', 'UTF-16', 'Raw']) {
      const compressed = await raw(SAMPLE, ['lzstring-compress', { 'Compression format': format }]);
      expect(
        await run(compressed, ['lzstring-decompress', { 'Compression format': format }]),
        format,
      ).toBe(SAMPLE);
    }
  });

  it('shrinks repetitive text', async () => {
    const repetitive = 'abcabcabc'.repeat(50);
    const compressed = await raw(repetitive, 'lzstring-compress');
    expect(compressed.length).toBeLessThan(repetitive.length / 2);
    expect(await run(compressed, 'lzstring-decompress')).toBe(repetitive);
  });
});

describe('LZNT1', () => {
  it('expands a chunk with a back-reference in it', async () => {
    const hex = '05b0' + '08' + '414243' + '0320' + '0000';
    expect(await run(hex, 'from-hex', 'lznt1-decompress')).toBe('ABCABCABC');
  });

  it('passes an uncompressed chunk through', async () => {
    const hex = '0230' + '414243' + '0000';
    expect(await run(hex, 'from-hex', 'lznt1-decompress')).toBe('ABC');
  });
});
