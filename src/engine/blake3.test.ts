import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
import { blake3 } from './operations/blake3';
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

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const pattern = (length: number): Uint8Array =>
  Uint8Array.from({ length }, (_, i) => i % 251);

describe('BLAKE3', () => {
  it('matches the published vectors across the chunk boundaries', async () => {
    const cases: Array<[number, string]> = [
      [0, 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262'],
      [1, '2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213'],
      [2, '7b7015bb92cf0b318037702a6cdd81dee41224f734684c2c122cd6359cb1ee63'],
      [3, 'e1be4d7a8ab5560aa4199eea339849ba8e293d55ca0a81006726d184519e647f'],
      [63, 'e9bc37a594daad83be9470df7f7b3798297c3d834ce80ba85d6e207627b7db7b'],
      [64, '4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98'],
      [65, 'de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee'],
      [1023, '10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11'],
      [1024, '42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7'],
      [1025, 'd00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444'],
      [2048, 'e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a'],
      [2049, '5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c426c95c1af0b6879522563030'],
      [3072, 'b98cb0ff3623be03326b373de6b9095218513e64f1ee2edd2525c7ad1e5cffd2'],
      [4096, '015094013f57a5277b59d8475c0501042c0b642e531b0a1c8f58d2163229e969'],
    ];
    for (const [length, expected] of cases) {
      expect(hex(blake3(pattern(length), 32)), `${length} bytes`).toBe(expected);
    }
  }, 30000);

  it('extends its output rather than truncating it', async () => {
    const short = hex(blake3(pattern(1), 32));
    const long = hex(blake3(pattern(1), 131));
    expect(long.startsWith(short)).toBe(true);
    expect(long).toHaveLength(262);
  });

  it('runs through the operation as well as the function', async () => {
    expect(await run('', 'blake3')).toBe(
      'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262',
    );
    expect(await run('abc', ['blake3', { Length: 16 }])).toHaveLength(32);
  });

  it('gives a different answer when keyed', async () => {
    const key = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
    const plain = await run('message', 'blake3');
    const keyed = await run('message', ['blake3', { Mode: 'Keyed', Key: key }]);
    expect(keyed).not.toBe(plain);
    expect(keyed).toHaveLength(64);
  });

  it('derives a different key for each context', async () => {
    const first = await run('material', [
      'blake3',
      { Mode: 'Derive key', Context: 'DecodeBox 2026 test one' },
    ]);
    const second = await run('material', [
      'blake3',
      { Mode: 'Derive key', Context: 'DecodeBox 2026 test two' },
    ]);
    expect(first).not.toBe(second);
    expect(first).toHaveLength(64);
  });

  it('refuses a keyed hash without a 32-byte key', async () => {
    const result = await bake('x', recipe(['blake3', { Mode: 'Keyed', Key: 'aabb' }]));
    expect(result.error?.message).toMatch(/32-byte key/);
  });

  it('refuses key derivation with no context', async () => {
    const result = await bake('x', recipe(['blake3', { Mode: 'Derive key' }]));
    expect(result.error?.message).toMatch(/needs a context string/);
  });
});
