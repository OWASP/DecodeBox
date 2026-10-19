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

const FERNET_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const FERNET_TOKEN =
  'gAAAAAAdwJ6wAAECAwQFBgcICQoLDA0OD5CE_x51_b9LhGpRnybEmoChuvCzuKIWbKT3dYPukjfdbBzanKDqXPre774BaRqxTA==';
const FERNET_TOKEN_2 =
  'gAAAAABlU_EAEBESExQVFhcYGRobHB0eH8b3-7dk_wd6alhM8bTK-h5zolvXrmkJ48yx0xmFMqeSH_wr-HqD7OXbQWCju6hDYgGHAO_T38lqUImu1PE8CKE=';

describe('Fernet', () => {
  it('decrypts a token the reference library made', async () => {
    expect(await run(FERNET_TOKEN, ['fernet-decrypt', { Key: FERNET_KEY }])).toBe('hello world');
    expect(await run(FERNET_TOKEN_2, ['fernet-decrypt', { Key: FERNET_KEY }])).toBe(
      'sixteen bytes!!!',
    );
  });

  it('reads the timestamp out of the header', async () => {
    const report = await run(FERNET_TOKEN, [
      'fernet-decrypt',
      { Key: FERNET_KEY, 'Show the header': true },
    ]);
    expect(report).toContain('1985-10-26T08:20:00.000Z'); 
    expect(report).toContain('IV:        000102030405060708090a0b0c0d0e0f');
    expect(report).toContain('hello world');
  });

  it('refuses a token whose HMAC does not match', async () => {
    const at = 40;
    const tampered =
      FERNET_TOKEN.slice(0, at) + (FERNET_TOKEN[at] === 'A' ? 'B' : 'A') + FERNET_TOKEN.slice(at + 1);
    const result = await bake(tampered, recipe(['fernet-decrypt', { Key: FERNET_KEY }]));
    expect(result.error?.message).toMatch(/HMAC does not match/);
  });

  it('refuses the right token with the wrong key', async () => {
    const other = 'B'.repeat(43) + '=';
    const result = await bake(FERNET_TOKEN, recipe(['fernet-decrypt', { Key: other }]));
    expect(result.error?.message).toMatch(/HMAC does not match/);
  });

  it('round-trips through its own encryptor', async () => {
    const token = await run('a message of some length', [
      'fernet-encrypt',
      { Key: FERNET_KEY, Timestamp: 1700000000 },
    ]);
    expect(token.startsWith('gAAAAABlU')).toBe(true); 
    expect(await run(token, ['fernet-decrypt', { Key: FERNET_KEY }])).toBe(
      'a message of some length',
    );
  });

  it('uses a fresh IV each time, so the same message does not repeat', async () => {
    const first = await run('same', ['fernet-encrypt', { Key: FERNET_KEY, Timestamp: 1 }]);
    const second = await run('same', ['fernet-encrypt', { Key: FERNET_KEY, Timestamp: 1 }]);
    expect(first).not.toBe(second);
  });

  it('refuses a key of the wrong size', async () => {
    const result = await bake(FERNET_TOKEN, recipe(['fernet-decrypt', { Key: 'c2hvcnQ=' }]));
    expect(result.error?.message).toMatch(/32 bytes of URL-safe Base64/);
  });

  it('refuses something that is not a token at all', async () => {
    const result = await bake('AAAA', recipe(['fernet-decrypt', { Key: FERNET_KEY }]));
    expect(result.error?.message).toMatch(/too short/);
  });
});

const COOKIE = 'eyJ1c2VyIjoiYWRtaW4iLCJsb2dnZWRfaW4iOnRydWV9.ZVPxAA.N1KNjvn-Vk9Nsc9lUFLwYKUjoMA';
const COMPRESSED_COOKIE = '.eJyrVkpJLElUslKqGAUVxAKlWgANEI_1.ZVPxAA.lDd5Qk4dsGf-tD3guC0QqyI2Zpw';
const SECRET = 'super-secret';

describe('Flask Session Decode', () => {
  it('reads the payload without needing the key', async () => {
    const report = await run(COOKIE, 'flask-session-decode');
    expect(report).toContain('"user": "admin"');
    expect(report).toContain('"logged_in": true');
    expect(report).toContain('Signed at:  2023-11-14T22:13:20.000Z');
    expect(report).toContain('Compressed: no');
  });

  it('decompresses a payload that was squeezed', async () => {
    const report = await run(COMPRESSED_COOKIE, 'flask-session-decode');
    expect(report).toContain('Compressed: yes');
    expect(report).toContain('xxxxx');
  });

  it('can show the payload on its own', async () => {
    const payload = await run(COOKIE, ['flask-session-decode', { 'Show the signature': false }]);
    expect(JSON.parse(payload)).toEqual({ user: 'admin', logged_in: true });
  });

  it('refuses something with too few parts', async () => {
    const result = await bake('just.two', recipe('flask-session-decode'));
    expect(result.error?.message).toMatch(/three parts/);
  });
});

describe('Flask Session Sign and Verify', () => {
  it('produces the same cookie itsdangerous does', async () => {
    const payload = JSON.stringify({ user: 'admin', logged_in: true });
    expect(
      await run(payload, [
        'flask-session-sign',
        { 'Secret key': SECRET, Timestamp: 1700000000 },
      ]),
    ).toBe(COOKIE);
  });

  it('compresses when it saves space', async () => {
    const payload = JSON.stringify({ data: 'x'.repeat(300) });
    const cookie = await run(payload, [
      'flask-session-sign',
      { 'Secret key': SECRET, Timestamp: 1700000000, Compress: true },
    ]);

    expect(cookie.startsWith('.')).toBe(true);
    expect(cookie.length).toBeLessThan(payload.length);
    expect(await run(cookie, ['flask-session-verify', { 'Secret key': SECRET }])).toMatch(
      /^Verified/,
    );
    expect(
      await run(cookie, ['flask-session-decode', { 'Show the signature': false }]),
    ).toContain('xxxxx');
  });

  it('leaves a short payload uncompressed even when asked', async () => {
    const signed = await run('{"a":1}', [
      'flask-session-sign',
      { 'Secret key': SECRET, Timestamp: 1700000000, Compress: true },
    ]);
    expect(signed.startsWith('.')).toBe(false);
  });

  it('verifies a genuine cookie and rejects a wrong key', async () => {
    expect(await run(COOKIE, ['flask-session-verify', { 'Secret key': SECRET }])).toMatch(
      /^Verified/,
    );
    expect(await run(COOKIE, ['flask-session-verify', { 'Secret key': 'wrong' }])).toMatch(
      /^Not verified/,
    );
  });

  it('rejects a cookie whose payload has been edited', async () => {
    const forged = 'eyJ1c2VyIjoicm9vdCJ9' + COOKIE.slice(COOKIE.indexOf('.'));
    expect(await run(forged, ['flask-session-verify', { 'Secret key': SECRET }])).toMatch(
      /^Not verified/,
    );
  });

  it('honours a salt other than the default', async () => {
    const signed = await run('{"a":1}', [
      'flask-session-sign',
      { 'Secret key': SECRET, Salt: 'other-salt', Timestamp: 1700000000 },
    ]);
    expect(
      await run(signed, ['flask-session-verify', { 'Secret key': SECRET, Salt: 'other-salt' }]),
    ).toMatch(/^Verified/);
    expect(await run(signed, ['flask-session-verify', { 'Secret key': SECRET }])).toMatch(
      /^Not verified/,
    );
  });

  it('refuses to sign or verify without a key', async () => {
    for (const op of ['flask-session-sign', 'flask-session-verify']) {
      const result = await bake(COOKIE, recipe(op));
      expect(result.error?.message, op).toMatch(/needs the secret key/);
    }
  });
});
