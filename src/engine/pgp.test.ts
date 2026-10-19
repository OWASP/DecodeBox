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

const RSA_KEY = [
  '-----BEGIN PGP PUBLIC KEY BLOCK-----',
  '',
  'mQENBGqgMmYBCADPZZQU6l68P6+0bawRy9TW2PPRrXHPWC4IZQu1J7fRarMMv3+o',
  'WY09VO2lzWqf/kMCO+8kbsSUnpIS608lUgwc9FzaFj3k5vWvuuD4wgMceDj+/FHP',
  '4YyEXqTvQNpHhMAzOq4S1hxRSIJZqp7uVU2R+SVciiippNWpmTykK8NggC/Qevjg',
  'LzU6kfO1p3MwBLAfpF16jLDB4YnRwDHr76zvixNDm7iTd9tD0WBdqMm8nw8K5qAz',
  'zhKaC01kgN8iLT9ImNObENy2bMfzShAliCygncYCOFpDO73C1fQAd5ta3KIrqv1g',
  'p73Ux1O7s+BkYzjizJmXt+y6cAB4nkT79ddzABEBAAG0JURlY29kZUJveCBUZXN0',
  'IDx0ZXN0QGV4YW1wbGUuaW52YWxpZD6JAU4EEwEKADgWIQTiHqBgoMTTz659jz9H',
  '8Bg0I1TwtwUCaqAyZgIbAwULCQgHAgYVCgkICwIEFgIDAQIeAQIXgAAKCRBH8Bg0',
  'I1Twt4FlB/wJHgUmIOqdze3kThmeYITvJnMJ8Feabg7gzra5iov/uGCcU24Nvbkr',
  '0iZiDPTfESl+17D1GC+++KJSyT3FW3jfPjF7V7ZvX3YsI8Nur+XWoYU7p1LM+Nkg',
  'gVaof3y+xyiQFySIfgFC2AhiokiEUSxd8dePeUVVWfgMORbhVv0EsHQjtlCr9W1E',
  'gOyBHXbIX0LPsNecr2r4SGECVA7J5pW3k/jkSLtaK60x1COIdjgElLZbyNEcG/Fi',
  'SrrPPPbzsxhX5YVxLL3IEH8hjo1hj/y0RVhue38l++330qo5sEGHIUs06uRuv2iu',
  'wWk6f3ulpq9GN3ZO1E8yHu/WXf02dohT',
  '=3nvP',
  '-----END PGP PUBLIC KEY BLOCK-----',
].join('\n');

const ED_KEY = [
  '-----BEGIN PGP PUBLIC KEY BLOCK-----',
  '',
  'mDMEaqAyihYJKwYBBAHaRw8BAQdAb7uiiklvfQyELfXlvcMLiC1JOAIceaWVE5ME',
  'FT/pLaG0HEVkIFRlc3QgPGVkQGV4YW1wbGUuaW52YWxpZD6IkAQTFgoAOBYhBNVz',
  'bh3DdreCGD1KaA2BydGyvT2kBQJqoDKKAhsDBQsJCAcCBhUKCQgLAgQWAgMBAh4B',
  'AheAAAoJEA2BydGyvT2ktmEA/1EhyDSu9j2xmt38Mp4ho7I9C3rvIcuZkc0gpQmy',
  'PKYaAQDwOcuhNZ+LaFyDQkbYLkCEj02g7Jx3GylF+uQUSwjPBLg4BGqgMooSCisG',
  'AQQBl1UBBQEBB0CT1ObB6rjS9/tKnDE4ZF4RucY5QH/4XZCIjB0qHZZYewMBCAeI',
  'eAQYFgoAIBYhBNVzbh3DdreCGD1KaA2BydGyvT2kBQJqoDKKAhsMAAoJEA2BydGy',
  'vT2kaAMA/Aj+PvQakOhpYW/tlgtS7r9dr6AcGdFl7qx5z59L/bQ/APsFn/eb1ngo',
  '3poLw+plyECKltEiToiDOeu/Nq6Qi0WNAA==',
  '=fjPm',
  '-----END PGP PUBLIC KEY BLOCK-----',
].join('\n');

describe('Parse PGP Key', () => {
  it('reads an RSA key and computes the fingerprint GnuPG reports', async () => {
    const report = await run(RSA_KEY, 'parse-pgp-key');
    expect(report).toContain('PGP public key block');
    expect(report).toContain('Algorithm:   RSA (encrypt or sign)');
    expect(report).toContain('Key size:    2048 bits');
    expect(report).toContain('Fingerprint: E21E A060 A0C4 D3CF AE7D 8F3F 47F0 1834 2354 F0B7');
    expect(report).toContain('Key ID:      47F018342354F0B7');
    expect(report).toContain('User ID: DecodeBox Test <test@example.invalid>');
  });

  it('reads the self-signature on it', async () => {
    const report = await run(RSA_KEY, 'parse-pgp-key');
    expect(report).toContain('Type:        positive certification');
    expect(report).toContain('Hash:        SHA-512');
    expect(report).toContain('Issuer key:  E21EA060A0C4D3CFAE7D8F3F47F018342354F0B7');
  });

  it('reads an elliptic curve key and its subkey', async () => {
    const report = await run(ED_KEY, 'parse-pgp-key');
    expect(report).toContain('Algorithm:   EdDSA');
    expect(report).toContain('Curve:       Ed25519');
    expect(report).toContain('Fingerprint: D573 6E1D C376 B782 183D 4A68 0D81 C9D1 B2BD 3DA4');

    expect(report).toContain('Public subkey');
    expect(report).toContain('Algorithm:   ECDH');
    expect(report).toContain('Curve:       Curve25519');
    expect(report).toContain('Key ID:      0ACB065264B4A172');
    expect(report).toContain('Type:        subkey binding');
  });

  it('counts the packets it found', async () => {
    expect(await run(ED_KEY, 'parse-pgp-key')).toContain('5 packets');
    expect(await run(RSA_KEY, 'parse-pgp-key')).toContain('3 packets');
  });

  it('shows the packets it normally passes over when asked', async () => {
    const quiet = await run(RSA_KEY, 'parse-pgp-key');
    const loud = await run(RSA_KEY, ['parse-pgp-key', { 'Show every packet': true }]);
    expect(loud.length).toBeGreaterThanOrEqual(quiet.length);
  });

  it('refuses something that is not a key block', async () => {
    const result = await bake('just some text', recipe('parse-pgp-key'));
    expect(result.error?.message).toMatch(/neither an armored PGP block/);
  });

  it('refuses an armored block whose Base64 is broken', async () => {
    const broken = [
      '-----BEGIN PGP PUBLIC KEY BLOCK-----',
      '',
      'not base64 at all!!',
      '-----END PGP PUBLIC KEY BLOCK-----',
    ].join('\n');
    const result = await bake(broken, recipe('parse-pgp-key'));
    expect(result.error?.message).toMatch(/not valid Base64/);
  });

  it('refuses a truncated key block rather than reading past the end', async () => {
    const truncated = RSA_KEY.split('\n').slice(0, 5).join('\n') + '\n-----END PGP PUBLIC KEY BLOCK-----';
    const result = await bake(truncated, recipe('parse-pgp-key'));
    expect(result.error?.message).toMatch(/runs past the end|not valid Base64/);
  });
});
