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

describe('HKDF', () => {
  it('matches RFC 5869 test case 1', async () => {
    expect(
      await run('0b'.repeat(22), 'from-hex', [
        'derive-hkdf-key',
        {
          Salt: '000102030405060708090a0b0c',
          Info: 'f0f1f2f3f4f5f6f7f8f9',
          'Hashing function': 'SHA-256',
          'L (number of output octets)': 42,
        },
      ]),
    ).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('matches RFC 5869 test case 3, which has no salt and no info', async () => {
    expect(
      await run('0b'.repeat(22), 'from-hex', [
        'derive-hkdf-key',
        {
          'Extract mode': 'no salt',
          'Hashing function': 'SHA-256',
          'L (number of output octets)': 42,
        },
      ]),
    ).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    );
  });
});

describe('AES key wrap', () => {
  it('matches the RFC 3394 vectors', async () => {
    expect(
      await run('00112233445566778899aabbccddeeff', [
        'aes-key-wrap',
        { 'Key (KEK)': '000102030405060708090a0b0c0d0e0f' },
      ]),
    ).toBe('1fa68b0a8112b447aef34bd8fb5a7b829d3e862371d2cfe5');

    expect(
      await run('00112233445566778899aabbccddeeff0001020304050607', [
        'aes-key-wrap',
        { 'Key (KEK)': '000102030405060708090a0b0c0d0e0f1011121314151617' },
      ]),
    ).toBe('031d33264e15d33268f24ec260743edce1c6c7ddee725a936ba814915c6762d2');
  });

  it('unwraps, and refuses when the integrity check fails', async () => {
    expect(
      await run('1fa68b0a8112b447aef34bd8fb5a7b829d3e862371d2cfe5', [
        'aes-key-unwrap',
        { 'Key (KEK)': '000102030405060708090a0b0c0d0e0f' },
      ]),
    ).toBe('00112233445566778899aabbccddeeff');

    const result = await bake(
      '1fa68b0a8112b447aef34bd8fb5a7b829d3e862371d2cfe5',
      recipe(['aes-key-unwrap', { 'Key (KEK)': '000102030405060708090a0b0c0d0e00' }]),
    );
    expect(result.error?.message).toMatch(/did not verify/);
  });
});

describe('CMAC', () => {
  it('matches the RFC 4493 vectors', async () => {
    const key = '2b7e151628aed2a6abf7158809cf4f3c';
    expect(await run('', ['cmac', { Key: key }])).toBe('bb1d6929e95937287fa37d129b756746');
    expect(
      await run('6bc1bee22e409f96e93d7e117393172a', 'from-hex', ['cmac', { Key: key }]),
    ).toBe('070a16b46b4d4144f79bdd9dd04a287c');
    expect(
      await run(
        '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411',
        'from-hex',
        ['cmac', { Key: key }],
      ),
    ).toBe('dfa66747de9ae63030ca32611497c827');
  });
});

describe('LM hash', () => {
  it('matches the published hashes', async () => {
    expect(await run('', 'lm-hash')).toBe('aad3b435b51404eeaad3b435b51404ee');
    expect(await run('PASSWORD', 'lm-hash')).toBe('e52cac67419a9a224a3b108f3fa6cb6d');
  });
});

describe('EVP key derivation', () => {
  it('derives the key and IV OpenSSL would', async () => {
    const derived = await run('', [
      'derive-evp-key',
      {
        Passphrase: 'password',
        Salt: '0102030405060708',
        'Key size (bits)': 128,
        'IV size (bits)': 128,
        'Hashing function': 'SHA-256',
      },
    ]);
    expect(derived).toContain('Key: ');
    expect(derived).toContain('IV:  ');
    expect(derived.split('\n')[0]).toHaveLength(37);
  });
});

describe('JWT', () => {
  it('signs and verifies with a shared secret', async () => {
    const token = await run('{"sub":"1234567890","name":"Test"}', [
      'jwt-sign',
      { 'Private/Secret key': 'secret', 'Signing algorithm': 'HS256' },
    ]);
    expect(token.split('.')).toHaveLength(3);
    expect(JSON.parse(await run(token, ['jwt-verify', { 'Public/Secret key': 'secret' }]))).toEqual({
      sub: '1234567890',
      name: 'Test',
    });
  });

  it('matches the token in the JWT introduction', async () => {
    const token = await run('{"sub":"1234567890","name":"John Doe","iat":1516239022}', [
      'jwt-sign',
      { 'Private/Secret key': 'your-256-bit-secret', 'Signing algorithm': 'HS256' },
    ]);
    expect(token).toBe(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
        'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    );
  });

  it('refuses the wrong secret', async () => {
    const token = await run('{"a":1}', [
      'jwt-sign',
      { 'Private/Secret key': 'secret', 'Signing algorithm': 'HS256' },
    ]);
    const result = await bake(token, recipe(['jwt-verify', { 'Public/Secret key': 'wrong' }]));
    expect(result.error?.message).toMatch(/does not verify/);
  });

  it('will not pretend an unsigned token is verified', async () => {
    const unsigned = 'eyJhbGciOiJub25lIn0.eyJhIjoxfQ.';
    const result = await bake(unsigned, recipe(['jwt-verify', { 'Public/Secret key': 'secret' }]));
    expect(result.error?.message).toMatch(/no signature at all/);
  });
});
