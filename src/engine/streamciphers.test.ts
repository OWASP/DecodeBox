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

const zeros = (bytes: number) => '00'.repeat(bytes);

describe('ChaCha20', () => {
  it('matches the keystream in RFC 8439', async () => {
    const key = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
    const keystream = await run(zeros(64), [
      'chacha',
      { Key: key, Nonce: '000000090000004a00000000', Counter: 1, Input: 'Hex', Output: 'Hex' },
    ]);
    expect(keystream).toBe(
      '10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4e' +
        'd2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e',
    );
  });

  it('encrypts the RFC 8439 sample text', async () => {
    const key = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
    const plaintext =
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";
    const encrypted = await run(plaintext, [
      'chacha',
      { Key: key, Nonce: '000000000000004a00000000', Counter: 1 },
    ]);
    expect(encrypted.startsWith('6e2e359a2568f98041ba0728dd0d6981')).toBe(true);
  });
});

describe('Salsa20', () => {
  it('matches the eStream vector for a 128-bit key', async () => {
    const keystream = await run(zeros(64), [
      'salsa20',
      {
        Key: '80000000000000000000000000000000',
        Nonce: '0000000000000000',
        Input: 'Hex',
        Output: 'Hex',
      },
    ]);
    expect(keystream.slice(0, 64).toUpperCase()).toBe(
      '4DFA5E481DA23EA09A31022050859936DA52FCEE218005164F267CB65F5CFD7F',
    );
  });

  it('matches the NaCl HSalsa20-derived XSalsa20 vector', async () => {
    const keystream = await run(zeros(32), [
      'xsalsa20',
      {
        Key: '1b27556473e985d462cd51197a9a46c76009549eac6474f206c4ee0844f68389',
        Nonce: '69696ee955b62b73cd62bda875fc73d68219e0036b7a0b37',
        Input: 'Hex',
        Output: 'Hex',
      },
    ]);
    expect(keystream.toUpperCase()).toBe(
      'EEA6A7251C1E72916D11C2CB214D3C252539121D8E234E652D651FA4C8CFF880',
    );
  });
});

describe('Rabbit', () => {
  it('matches the RFC 4503 keystream with no IV', async () => {
    const keystream = await run(zeros(48), [
      'rabbit',
      { Key: '00000000000000000000000000000000', IV: '', Input: 'Hex', Output: 'Hex' },
    ]);
    expect(keystream).toBe(
      'b15754f036a5d6ecf56b45261c4af70288e8d815c59c0c397b696c4789c68aa7' +
        'f416a1c3700cd451da68d1881673d696',
    );
  });

  it('takes the least significant bytes for a short final block', async () => {
    expect(
      await run(zeros(8), [
        'rabbit',
        { Key: '00000000000000000000000000000000', IV: '', Input: 'Hex', Output: 'Hex' },
      ]),
    ).toBe('f56b45261c4af702');
  });
});

describe('RC4 and CipherSaber', () => {
  it('drops the keystream it is told to', async () => {
    const undropped = await run('hello', [
      'rc4-drop',
      { Passphrase: 'key', 'Number of dwords to drop': 0 },
    ]);
    const dropped = await run('hello', [
      'rc4-drop',
      { Passphrase: 'key', 'Number of dwords to drop': 192 },
    ]);
    expect(undropped).not.toBe(dropped);
    expect(undropped).toBe(
      await run('hello', ['rc4', { Key: 'key' }], ['to-hex', { Delimiter: 'None' }]),
    );
  });

  it('round-trips CipherSaber-2 through its random IV', async () => {
    const encrypted = await run('attack at dawn', ['ciphersaber2-encrypt', { Key: 'secret' }]);
    expect(encrypted).toHaveLength('attack at dawn'.length + 10);
    expect(await run(encrypted, ['ciphersaber2-decrypt', { Key: 'secret' }])).toBe(
      'attack at dawn',
    );
  });

  it('gives a different ciphertext each time, because the IV is fresh', async () => {
    const first = await run('same message', ['ciphersaber2-encrypt', { Key: 'secret' }]);
    const second = await run('same message', ['ciphersaber2-encrypt', { Key: 'secret' }]);
    expect(first).not.toBe(second);
  });
});

describe('nonce handling', () => {
  it('refuses a nonce of the wrong length rather than padding it', async () => {
    const result = await bake(
      'hello',
      recipe([
        'chacha',
        { Key: '00'.repeat(32), Nonce: '0011' },
      ]),
    );
    expect(result.error?.message).toMatch(/8 or 12-byte nonce/);
  });
});
