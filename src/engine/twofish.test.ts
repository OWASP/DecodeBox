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

const ZERO_BLOCK = '00000000000000000000000000000000';

const raw = (key: string) => ({
  Key: key,
  Mode: 'ECB',
  Padding: 'None',
  Input: 'Hex',
  Output: 'Hex',
});

describe('Twofish', () => {
  it('matches the published vectors for all three key lengths', async () => {
    const cases: Array<[string, string]> = [
      [ZERO_BLOCK, '9f589f5cf6122c32b6bfec2f2ae8c35a'],
      ['0123456789abcdeffedcba98765432100011223344556677', 'cfd1d2e5a9be9cdf501f13b892bd2248'],
      [
        '0123456789abcdeffedcba987654321000112233445566778899aabbccddeeff',
        '37527be0052334b89f0cfccae87cfa20',
      ],
    ];
    for (const [key, expected] of cases) {
      expect(await run(ZERO_BLOCK, ['twofish-encrypt', raw(key)]), `${key.length * 4}-bit`).toBe(
        expected,
      );
    }
  });

  it('decrypts each of them back', async () => {
    const cases: Array<[string, string]> = [
      [ZERO_BLOCK, '9f589f5cf6122c32b6bfec2f2ae8c35a'],
      ['0123456789abcdeffedcba98765432100011223344556677', 'cfd1d2e5a9be9cdf501f13b892bd2248'],
      [
        '0123456789abcdeffedcba987654321000112233445566778899aabbccddeeff',
        '37527be0052334b89f0cfccae87cfa20',
      ],
    ];
    for (const [key, cipher] of cases) {
      expect(await run(cipher, ['twofish-decrypt', raw(key)])).toBe(ZERO_BLOCK);
    }
  });

  it('round-trips a longer message through CBC', async () => {
    const settings = {
      Key: '000102030405060708090a0b0c0d0e0f',
      IV: '0f0e0d0c0b0a09080706050403020100',
      Mode: 'CBC',
    };
    const plain = 'Twofish was never broken; it merely lost.';
    const cipher = await run(plain, ['twofish-encrypt', settings]);
    expect(cipher).toMatch(/^[0-9a-f]+$/);
    expect(await run(cipher, ['twofish-decrypt', { ...settings, Input: 'Hex', Output: 'Raw' }])).toBe(
      plain,
    );
  });

  it('produces different ciphertext for each mode', async () => {
    const settings = {
      Key: '000102030405060708090a0b0c0d0e0f',
      IV: '0f0e0d0c0b0a09080706050403020100',
    };
    const seen = new Set<string>();
    for (const mode of ['CBC', 'CFB', 'OFB', 'CTR', 'ECB']) {
      seen.add(
        await run('the same sixteen and then some more of it', [
          'twofish-encrypt',
          { ...settings, Mode: mode },
        ]),
      );
    }
    expect(seen.size).toBe(5);
  });

  it('refuses a key of the wrong length', async () => {
    const result = await bake(ZERO_BLOCK, recipe(['twofish-encrypt', raw('0011223344')]));
    expect(result.error?.message).toMatch(/16, 24 or 32 bytes/);
  });
});
