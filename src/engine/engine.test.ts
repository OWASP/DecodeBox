import { describe, expect, it } from 'vitest';
import {
  autoDecode,
  bake,
  describeChain,
  detect,
  listOperations,
  renderText,
  toChain,
} from './index';
import { identify } from './detection/identify';
import { SAMPLES } from './samples';
import { getOperation } from './operations';
import type { Recipe } from './types';

function sample(id: string): string {
  const found = SAMPLES.find((s) => s.id === id);
  if (!found) throw new Error(`Sample '${id}' is missing`);
  return found.value;
}

function recipe(...opIds: string[]): Recipe {
  return {
    id: 'test',
    name: 'test',
    steps: opIds.map((opId, i) => {
      const op = getOperation(opId);
      if (!op) throw new Error(`Unknown operation '${opId}'`);
      return { uid: `s${i}`, opId, args: op.args.map((a) => ({ ...a })), disabled: false };
    }),
  };
}

describe('operations', () => {
  it('round-trips through every encode/decode pair', async () => {
    const text = 'The quick brown fox — 0123456789';
    const pairs: Array<[string, string]> = [
      ['to-base64', 'from-base64'],
      ['to-base32', 'from-base32'],
      ['to-base58', 'from-base58'],
      ['to-hex', 'from-hex'],
      ['to-binary', 'from-binary'],
      ['to-decimal', 'from-decimal'],
      ['url-encode', 'url-decode'],
      ['to-hexdump', 'from-hexdump'],
      ['gzip', 'gunzip'],
    ];

    for (const [encode, decode] of pairs) {
      const result = await bake(text, recipe(encode, decode));
      expect(result.error, `${encode} → ${decode} failed`).toBeUndefined();
      expect(renderText(result.output), `${encode} → ${decode} lost data`).toBe(text);
    }
  });

  it('reports a descriptive error rather than throwing on malformed input', async () => {
    const result = await bake('not hex at all!!', recipe('from-hex'));
    expect(result.error).toBeDefined();
    expect(result.error?.message.toLowerCase()).toContain('hex');
  });

  it('never returns without a result, even when a step fails', async () => {
    const result = await bake('%%%%', recipe('url-decode', 'json-beautify'));
    expect(result.error?.stepIndex).toBe(0);
    expect(typeof result.output).toBe('string');
  });

  it('exposes every operation with a stable id and searchable aliases', async () => {
    const ops = await listOperations();
    expect(ops.length).toBeGreaterThan(40);
    for (const op of ops) {
      expect(op.id, `${op.name} has a non-slug id`).toMatch(/^[a-z0-9-]+$/);
      expect(op.description.length, `${op.name} has no description`).toBeGreaterThan(10);
      expect(op.aliases.length, `${op.name} has no aliases`).toBeGreaterThan(0);
    }
    expect(new Set(ops.map((o) => o.id)).size).toBe(ops.length);
  });
});

describe('detection', () => {
  it('identifies each sample as its intended format', async () => {
    const expected: Record<string, string> = {
      jwt: 'JWT',
      'double-base64': 'Base64 → Base64',
      'url-encoded': 'URL encoding',
      'gzip-base64': 'Base64 → gzip → JSON',
      powershell: 'Base64 → UTF-16LE',
      hex: 'Hex',
    };

    for (const [id, chain] of Object.entries(expected)) {
      const root = await autoDecode(sample(id));
      expect(describeChain(root), `sample '${id}' was misidentified`).toBe(chain);
    }
  });

  it('fully decodes layered payloads to their original content', async () => {
    const cases: Array<[string, string]> = [
      ['double-base64', 'The quick brown fox jumps over the lazy dog.'],
      ['powershell', 'Get-Process | Where-Object {$_.CPU -gt 100}'],
      ['hex', 'Failed to authenticate agent #17: timeout'],
    ];

    for (const [id, expected] of cases) {
      const chain = toChain(await autoDecode(sample(id)));
      expect(chain[chain.length - 1]?.output, `sample '${id}'`).toBe(expected);
    }
  });

  it('leaves ordinary prose alone', async () => {
    const root = await autoDecode(
      'The deployment failed twice last night and nobody was paged about it.',
    );
    expect(describeChain(root)).toBe('Plain text');
  });

  it('carries evidence for every candidate it reports', async () => {
    const candidates = await detect(sample('jwt'));
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.evidence.length, `${candidate.format} has no evidence`).toBeGreaterThan(0);
      for (const item of candidate.evidence) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.detail.length).toBeGreaterThan(20);
      }
      expect(candidate.confidence).toBeGreaterThan(0);
      expect(candidate.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('terminates on input that decodes into itself', async () => {
    const root = await autoDecode('31323334353637383930'.repeat(8));
    expect(toChain(root).length).toBeLessThanOrEqual(7);
  });

  it('returns nothing for empty input rather than guessing', async () => {
    expect(await detect('')).toEqual([]);
    expect(await detect('   \n  ')).toEqual([]);
  });
});

describe('hash identification', () => {
  const top = (input: string) => identify(input)?.matches[0]?.name;

  it('identifies self-describing password formats with near certainty', () => {
    const cases: Array<[string, string]> = [
      ['$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyDCQ7bQ7Zk1Ry', 'bcrypt'],
      ['$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG', 'Argon2'],
      ['$6$rounds=5000$usesomesillystri$D4IrlXatmP7rx3P3InaxBeoomNEQRPd', 'SHA-512 crypt'],
      ['$1$28772684$iEwNOgGugqO9.bIz5sk8k/', 'MD5 crypt'],
      ['$apr1$71850310$gh9m4xcAn3MGxogwX/ztb.', 'Apache MD5 (APR1)'],
      ['$P$984478476IagS59wHZvyQMArzfx58u.', 'phpass (portable)'],
      ['$S$D5nUE1IJEZbxfsm9Zh1Cd7QRPz2Xdw2CGbrfSDvXwFVCHbrgFHRq', 'Drupal 7 (SHA-512)'],
      ['pbkdf2_sha256$260000$abc$Ai8mLXVmXaSyGtQOa7WOO9nOxJKgOaFEV5oV5AsRAcM=', 'PBKDF2 (Django)'],
      ['{SSHA}0Fj1oDzGXPTB3XjBpBiKrqzWFCUyOe5X', 'Salted SHA-1 (LDAP)'],
      ['*4ACFE3202A5FF5CF467898FC58AAB1D615029441', 'MySQL 4.1+ (SHA-1 twice)'],
      ['$krb5tgs$23$*user$realm$test/spn*$abc123$def456', 'Kerberos TGS-REP'],
    ];

    for (const [input, expected] of cases) {
      expect(top(input), `misidentified: ${input.slice(0, 24)}…`).toBe(expected);
      expect(identify(input)?.matches[0]?.confidence).toBeGreaterThan(0.9);
    }
  });

  it('ranks bare hex digests without pretending to be certain', () => {
    const md5 = identify('5d41402abc4b2a76b9719d911017c592');
    expect(md5?.matches[0]?.name).toBe('MD5');
    expect(md5?.matches[0]?.confidence).toBeLessThan(0.8);
    expect(md5?.matches.map((m) => m.name)).toContain('NTLM');

    expect(top('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d')).toBe('SHA-1');
    expect(top('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')).toBe('SHA-256');
    expect(identify('a'.repeat(128))?.matches.map((m) => m.name)).toContain('SHA-512');
  });

  it('recognises the empty-password LM constant, which changes what to do next', () => {
    const result = identify('aad3b435b51404eeaad3b435b51404ee');
    expect(result?.matches[0]?.name).toBe('LM hash of an empty password');
    expect(result?.matches[0]?.confidence).toBeGreaterThan(0.95);
  });

  it('recognises an LM:NTLM pair as dumped by credential tooling', () => {
    const result = identify(
      'aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0',
    );
    expect(result?.matches[0]?.name).toBe('LM:NTLM pair');
    expect(result?.matches[0]?.context).toContain('empty-password');
  });

  it('flags digests as one-way so nobody hunts for a decode button', () => {
    expect(identify('5d41402abc4b2a76b9719d911017c592')?.oneWay).toBe(true);
    expect(identify('$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyDCQ7bQ7Zk1Ry')?.oneWay).toBe(
      true,
    );
  });

  it('stays quiet on things that are not digests', () => {
    expect(identify('hello world')).toBeNull();
    expect(identify('')).toBeNull();
    expect(identify('abc')).toBeNull();
    expect(identify('abcdef0123456789ab')).toBeNull();
  });
});

describe('artefact identification', () => {
  const top = (input: string) => identify(input)?.matches[0]?.name;

  it('names things that are not encodings', () => {
    const cases: Array<[string, string]> = [
      ['550e8400-e29b-41d4-a716-446655440000', 'UUID'],
      ['00:1B:44:11:3A:B7', 'MAC address'],
      ['-----BEGIN CERTIFICATE-----\nMIIB...', 'X.509 certificate (PEM)'],
      ['-----BEGIN RSA PRIVATE KEY-----\nMIIE...', 'Private key (PEM)'],
      ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIabc user@host', 'SSH public key'],
      ['data:image/png;base64,iVBORw0KGgo=', 'Data URI'],
      ['a:2:{i:0;s:3:"foo";i:1;s:3:"bar";}', 'PHP serialized data'],
      ['rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcA', 'Java serialized object (Base64)'],
      ['1735689600', 'Unix timestamp (seconds)'],
      ['192.168.1.24', 'IPv4 address'],
    ];

    for (const [input, expected] of cases) {
      expect(top(input), `misidentified: ${input.slice(0, 30)}…`).toBe(expected);
    }
  });

  it('validates rather than pattern-matching where it can', () => {
    expect(top('4111111111111112')).not.toBe('Payment card number');
    expect(top('4111111111111111')).toBe('Payment card number');

    expect(top('550e8400-e29b-91d4-a716-446655440000')).not.toBe('UUID');

    expect(identify('0000000001')).toBeNull();
  });

  it('warns about secrets rather than just naming them', () => {
    const key = identify('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNz...');
    expect(key?.matches[0]?.context).toContain('secret');

    const card = identify('4111111111111111');
    expect(card?.matches[0]?.context?.toLowerCase()).toContain('regulated');
  });

  it('stays quiet on ordinary text', () => {
    expect(identify('the deployment failed again')).toBeNull();
  });
});

describe('brute force', () => {
  it('finds a single-byte XOR that nothing else could detect', async () => {
    const plain = 'The quick brown fox jumps over the lazy dog, and the admin user logs in.';
    const key = 0x5a;
    const encoded = Array.from(plain)
      .map((c) => String.fromCharCode(c.charCodeAt(0) ^ key))
      .join('');

    const candidates = await detect(encoded);
    const xor = candidates.find((c) => c.id === 'brute-xor');

    expect(xor, 'the XOR was not found at all').toBeDefined();
    expect(xor?.format).toContain('0x5A');
    expect(xor?.preview).toContain('quick brown fox');
    expect(xor?.confidence).toBeLessThan(0.85);
  });

  it('recovers the plaintext through autoDecode', async () => {
    const plain = 'select * from users where password is null and the admin account is open';
    const encoded = Array.from(plain)
      .map((c) => String.fromCharCode(c.charCodeAt(0) ^ 0x2b))
      .join('');

    const chain = toChain(await autoDecode(encoded));
    expect(chain[chain.length - 1]?.output).toBe(plain);
  });

  it('finds a rotation and names the amount', async () => {
    const rot = 'Gur nqzva cnffjbeq vf va gur svyr, naq gur hfre vf abg gurer';
    const candidates = await detect(rot);
    const found = candidates.find((c) => c.id === 'brute-rot');
    expect(found?.format).toBe('ROT13');
  });

  it('does not invent a key for input that is already explained', async () => {
    const candidates = await detect('The deployment failed twice last night and nobody noticed.');
    expect(candidates.find((c) => c.id === 'brute-xor')).toBeUndefined();
  });
});
