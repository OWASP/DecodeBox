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

const bare = (extra: Record<string, string | number | boolean>) => ({
  Mode: 'ECB',
  Padding: 'None',
  Input: 'Hex',
  Output: 'Hex',
  ...extra,
});

describe('Blowfish', () => {
  it('matches the published test vectors', async () => {
    const cases: Array<[string, string, string]> = [
      ['0000000000000000', '0000000000000000', '4ef99745'.concat('6198dd78')],
      ['ffffffffffffffff', 'ffffffffffffffff', '51866fd5b85ecb8a'],
      ['3000000000000000', '1000000000000001', '7d856f9a613063f2'],
      ['0123456789abcdef', '1111111111111111', '61f9c3802281b096'],
      ['fedcba9876543210', '0123456789abcdef', '0aceab0fc6a0a28d'],
    ];
    for (const [key, plaintext, expected] of cases) {
      expect(await run(plaintext, ['blowfish-encrypt', bare({ Key: key })]), key).toBe(expected);
      expect(await run(expected, ['blowfish-decrypt', bare({ Key: key })]), key).toBe(plaintext);
    }
  });

  it('takes a key of any length between 4 and 56 bytes', async () => {
    const encrypted = await run('hello there', [
      'blowfish-encrypt',
      { Key: '0123456789abcdef0123456789abcdef0123456789abcdef', IV: '0011223344556677' },
    ]);
    expect(
      await run(encrypted, [
        'blowfish-decrypt',
        {
          Key: '0123456789abcdef0123456789abcdef0123456789abcdef',
          IV: '0011223344556677',
          Input: 'Hex',
          Output: 'Raw',
        },
      ]),
    ).toBe('hello there');
  });
});

describe('RC2', () => {
  it('matches the RFC 2268 vectors', async () => {
    expect(
      await run('0000000000000000', ['rc2-encrypt', bare({ Key: '0000000000000000', 'Effective key bits': 63 })]),
    ).toBe('ebb773f993278eff');
    expect(
      await run('ffffffffffffffff', ['rc2-encrypt', bare({ Key: 'ffffffffffffffff', 'Effective key bits': 64 })]),
    ).toBe('278b27e42e2f0d49');
    expect(
      await run('1000000000000001', ['rc2-encrypt', bare({ Key: '3000000000000000', 'Effective key bits': 64 })]),
    ).toBe('30649edf9be7d2c2');
  });

  it('decrypts back', async () => {
    expect(
      await run('ebb773f993278eff', ['rc2-decrypt', bare({ Key: '0000000000000000', 'Effective key bits': 63 })]),
    ).toBe('0000000000000000');
  });
});

describe('RC6', () => {
  it('matches the submission vector for an all-zero key', async () => {
    expect(
      await run('00000000000000000000000000000000', [
        'rc6-encrypt',
        bare({ Key: '00000000000000000000000000000000' }),
      ]),
    ).toBe('8fc3a53656b1f778c129df4e9848a41e');
  });

  it('round-trips a longer key', async () => {
    const key = '0123456789abcdef0112233445566778';
    const encrypted = await run('02132435465768798a9bacbdcedfe0f1', ['rc6-encrypt', bare({ Key: key })]);
    expect(await run(encrypted, ['rc6-decrypt', bare({ Key: key })])).toBe(
      '02132435465768798a9bacbdcedfe0f1',
    );
  });
});

describe('PRESENT', () => {
  it('matches the vectors in the paper', async () => {
    expect(
      await run('0000000000000000', ['present-encrypt', bare({ Key: '00000000000000000000' })]),
    ).toBe('5579c1387b228445');
    expect(
      await run('0000000000000000', ['present-encrypt', bare({ Key: 'ffffffffffffffffffff' })]),
    ).toBe('e72c46c0f5945049');
    expect(
      await run('ffffffffffffffff', ['present-encrypt', bare({ Key: '00000000000000000000' })]),
    ).toBe('a112ffc72f68417b');
  });

  it('decrypts back', async () => {
    expect(
      await run('5579c1387b228445', ['present-decrypt', bare({ Key: '00000000000000000000' })]),
    ).toBe('0000000000000000');
  });
});
