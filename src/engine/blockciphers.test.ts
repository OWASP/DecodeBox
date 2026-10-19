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

const bare = (extra: Record<string, string | number | boolean> = {}) => ({
  Mode: 'ECB',
  Padding: 'None',
  Input: 'Hex',
  Output: 'Hex',
  ...extra,
});

describe('DES', () => {
  it('matches the FIPS 81 worked example', async () => {
    expect(
      await run('4e6f772069732074', ['des-encrypt', bare({ Key: '0123456789abcdef' })]),
    ).toBe('3fa40e8a984d4815');
    expect(
      await run('3fa40e8a984d4815', ['des-decrypt', bare({ Key: '0123456789abcdef' })]),
    ).toBe('4e6f772069732074');
  });

  it('encrypts the all-zero block with the all-zero key to the published value', async () => {
    expect(
      await run('0000000000000000', ['des-encrypt', bare({ Key: '0000000000000000' })]),
    ).toBe('8ca64de9c1b123a7');
  });

  it('refuses a key of the wrong length', async () => {
    const result = await bake('0000', recipe(['des-encrypt', bare({ Key: '0011' })]));
    expect(result.error?.message).toMatch(/8-byte key/);
  });
});

describe('Triple DES', () => {
  it('reduces to plain DES when all three keys are the same', async () => {
    const key = '0123456789abcdef'.repeat(3);
    expect(
      await run('4e6f772069732074', ['triple-des-encrypt', bare({ Key: key })]),
    ).toBe('3fa40e8a984d4815');
  });

  it('round-trips with three different keys', async () => {
    const key = '0123456789abcdef23456789abcdef0145678901234567ab';
    const encrypted = await run('hello there', [
      'triple-des-encrypt',
      { Key: key, IV: '0011223344556677' },
    ]);
    expect(
      await run(encrypted, [
        'triple-des-decrypt',
        { Key: key, IV: '0011223344556677', Input: 'Hex', Output: 'Raw' },
      ]),
    ).toBe('hello there');
  });
});

describe('SM4', () => {
  it('matches the vector in the standard', async () => {
    const key = '0123456789abcdeffedcba9876543210';
    expect(await run(key, ['sm4-encrypt', bare({ Key: key })])).toBe(
      '681edf34d206965e86b3e94f536e4246',
    );
    expect(
      await run('681edf34d206965e86b3e94f536e4246', ['sm4-decrypt', bare({ Key: key })]),
    ).toBe(key);
  });
});

describe('TEA family', () => {
  it('matches the published all-zero vectors', async () => {
    expect(
      await run('0000000000000000', [
        'tea-encrypt',
        bare({ Key: '00000000000000000000000000000000' }),
      ]),
    ).toBe('41ea3a0a94baa940');
    expect(
      await run('0000000000000000', [
        'xtea-encrypt',
        bare({ Key: '00000000000000000000000000000000' }),
      ]),
    ).toBe('dee9d4d8f7131ed9');
  });

  it('round-trips through every mode', async () => {
    const key = '000102030405060708090a0b0c0d0e0f';
    for (const mode of ['CBC', 'CFB', 'OFB', 'CTR', 'ECB']) {
      const encrypted = await run('the quick brown fox', [
        'xtea-encrypt',
        { Key: key, IV: '0011223344556677', Mode: mode },
      ]);
      expect(
        await run(encrypted, [
          'xtea-decrypt',
          { Key: key, IV: '0011223344556677', Mode: mode, Input: 'Hex', Output: 'Raw' },
        ]),
        mode,
      ).toBe('the quick brown fox');
    }
  });

  it('round-trips XXTEA, which has no mode at all', async () => {
    const key = '000102030405060708090a0b0c0d0e0f';
    const encrypted = await run('a message of any length', ['xxtea-encrypt', { Key: key }]);
    expect(await run(encrypted, ['xxtea-decrypt', { Key: key }])).toBe('a message of any length');
  });
});

describe('modes and padding', () => {
  it('reports padding that cannot be right', async () => {
    const result = await bake(
      '00000000000000000000000000000000',
      recipe([
        'des-decrypt',
        { Key: '0123456789abcdef', IV: '0000000000000000', Input: 'Hex', Output: 'Raw' },
      ]),
    );
    expect(result.error?.message).toMatch(/padding is not valid/);
  });

  it('refuses an IV of the wrong size', async () => {
    const result = await bake(
      'hello',
      recipe(['des-encrypt', { Key: '0123456789abcdef', IV: '0011' }]),
    );
    expect(result.error?.message).toMatch(/IV of exactly 8 bytes/);
  });

  it('leaves the ciphertext length alone in the streaming modes', async () => {
    const encrypted = await run('abc', [
      'des-encrypt',
      { Key: '0123456789abcdef', IV: '0000000000000000', Mode: 'CTR' },
    ]);
    expect(encrypted).toHaveLength(6);
  });
});
