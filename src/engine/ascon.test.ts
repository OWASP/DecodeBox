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

const KEY = '000102030405060708090a0b0c0d0e0f';
const NONCE = '000102030405060708090a0b0c0d0e0f';
const AEAD = { Key: KEY, Nonce: NONCE };

describe('Ascon Hash', () => {
  it('matches the published digest of the empty message', async () => {
    expect(await run('', 'ascon-hash')).toBe(
      '7346bc14f036e87ae03d0997913088f5f68411434b3cf8b54fa796a80d251f91',
    );
  });

  it('is always 256 bits in hash mode', async () => {
    expect(await run('abc', 'ascon-hash')).toHaveLength(64);
    expect(await run('a'.repeat(1000), 'ascon-hash')).toHaveLength(64);
  });

  it('extends to any length in XOF mode', async () => {
    const short = await run('abc', ['ascon-hash', { Mode: 'XOF', Length: 16 }]);
    const long = await run('abc', ['ascon-hash', { Mode: 'XOF', Length: 64 }]);
    expect(short).toHaveLength(32);
    expect(long).toHaveLength(128);
    expect(long.startsWith(short)).toBe(true);
  });

  it('changes with the input', async () => {
    expect(await run('a', 'ascon-hash')).not.toBe(await run('b', 'ascon-hash'));
  });
});

describe('Ascon MAC', () => {
  it('depends on the key', async () => {
    const first = await run('message', ['ascon-mac', { Key: KEY }]);
    const second = await run('message', [
      'ascon-mac',
      { Key: 'ffffffffffffffffffffffffffffffff' },
    ]);
    expect(first).not.toBe(second);
    expect(first).toHaveLength(32);
  });

  it('refuses a key of the wrong size', async () => {
    const result = await bake('x', recipe(['ascon-mac', { Key: 'aabb' }]));
    expect(result.error?.message).toMatch(/key is 16 bytes/);
  });
});

describe('Ascon Encrypt and Decrypt', () => {
  it('matches the first known-answer vector', async () => {
    expect(await run('', ['ascon-encrypt', AEAD])).toBe('e355159f292911f794cb1432a0103a8a');
  });

  it('round-trips messages of every shape', async () => {
    for (const message of ['', 'a', 'abc', '12345678', 'the quick brown fox jumps over it']) {
      const cipher = await run(message, ['ascon-encrypt', AEAD]);
      expect(cipher.length).toBe((message.length + 16) * 2);
      expect(await run(cipher, ['ascon-decrypt', AEAD]), JSON.stringify(message)).toBe(message);
    }
  });

  it('binds the associated data without encrypting it', async () => {
    const withHeader = await run('secret', ['ascon-encrypt', { ...AEAD, 'Associated data': 'header' }]);
    const without = await run('secret', ['ascon-encrypt', AEAD]);
    expect(withHeader).toHaveLength(without.length);
    expect(withHeader).not.toBe(without);

    expect(
      await run(withHeader, ['ascon-decrypt', { ...AEAD, 'Associated data': 'header' }]),
    ).toBe('secret');

    const wrong = await bake(
      withHeader,
      recipe(['ascon-decrypt', { ...AEAD, 'Associated data': 'other' }]),
    );
    expect(wrong.error?.message).toMatch(/tag does not match/);
  });

  it('refuses a tampered ciphertext', async () => {
    const cipher = await run('secret message', ['ascon-encrypt', AEAD]);
    const tampered = `${cipher.slice(0, 4)}${cipher[4] === 'a' ? 'b' : 'a'}${cipher.slice(5)}`;
    const result = await bake(tampered, recipe(['ascon-decrypt', AEAD]));
    expect(result.error?.message).toMatch(/tag does not match/);
  });

  it('refuses a wrong key or nonce', async () => {
    const cipher = await run('secret', ['ascon-encrypt', AEAD]);
    for (const settings of [
      { ...AEAD, Key: 'ffffffffffffffffffffffffffffffff' },
      { ...AEAD, Nonce: 'ffffffffffffffffffffffffffffffff' },
    ]) {
      const result = await bake(cipher, recipe(['ascon-decrypt', settings]));
      expect(result.error?.message).toMatch(/tag does not match/);
    }
  });

  it('refuses a message with no room for a tag', async () => {
    const result = await bake('aabb', recipe(['ascon-decrypt', AEAD]));
    expect(result.error?.message).toMatch(/16-byte tag/);
  });

  it('refuses a nonce of the wrong size', async () => {
    const result = await bake('x', recipe(['ascon-encrypt', { Key: KEY, Nonce: 'aabb' }]));
    expect(result.error?.message).toMatch(/nonce is 16 bytes/);
  });
});
