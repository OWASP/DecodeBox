import { describe, expect, it } from 'vitest';
import { OPERATIONS } from './operations/index';
import { identifyHash } from './detection/hashes';


const SAMPLES: Record<string, string> = {
  text: 'The quick brown fox jumps over the lazy dog. 12345',
  base64: 'VGhlIHF1aWNrIGJyb3duIGZveA==',
  hex: '54 68 65 20 71 75 69 63 6b',
  json: '{"user":"ada","role":"admin","n":42}',
  url: 'https://user:pw@example.com:8443/a/b?x=1&y=2#f',
  cidr: '10.0.0.0/24',
  iso: '2023-11-14T22:13:20Z',
  digits: '12345',
  digest: '5d41402abc4b2a76b9719d911017c592',
  binary: String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13),
  empty: '',
};

const ALL = Object.values(SAMPLES);

function isRefusal(error: unknown): boolean {
  return error instanceof Error && error.constructor.name === 'OperationError';
}

describe('the whole catalogue', () => {
  it(
    'never throws anything but an OperationError, whatever it is handed',
    { timeout: 600_000 },
    async () => {
      const broken: string[] = [];

      for (const op of OPERATIONS) {
        if (op.isFlowControl) continue;
        for (const sample of ALL) {
          try {
            const out = await op.run(sample, op.args.map((a) => ({ ...a })));
            if (typeof out !== 'string') broken.push(`${op.id}: returned ${typeof out}`);
          } catch (error) {
            if (isRefusal(error)) continue;
            const name = error instanceof Error ? error.constructor.name : typeof error;
            const message = error instanceof Error ? error.message : String(error);
            broken.push(`${op.id}: ${name} — ${message.slice(0, 80)}`);
          }
        }
      }

      expect(broken).toEqual([]);
    },
  );

  it('gives every operation a name, a description and a category', () => {
    const thin = OPERATIONS.filter(
      (op) => !op.name?.trim() || !op.description?.trim() || !op.category?.trim(),
    ).map((op) => op.id);
    expect(thin).toEqual([]);
  });

  it('never declares an argument the operation cannot read back', () => {
    const wrong: string[] = [];
    for (const op of OPERATIONS) {
      for (const a of op.args) {
        if (a.type === 'option' && a.options && !a.options.includes(String(a.value))) {
          wrong.push(`${op.id}.${a.name}: default ${String(a.value)} is not in its options`);
        }
        if (a.type === 'toggleString' && a.toggleValues && a.toggleValue) {
          if (!a.toggleValues.includes(a.toggleValue)) {
            wrong.push(`${op.id}.${a.name}: toggle ${a.toggleValue} is not in its toggleValues`);
          }
        }
        if (a.type === 'number' && typeof a.value === 'number') {
          if (a.min !== undefined && a.value < a.min) wrong.push(`${op.id}.${a.name}: below min`);
          if (a.max !== undefined && a.value > a.max) wrong.push(`${op.id}.${a.name}: above max`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('has no two operations sharing an id', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const op of OPERATIONS) {
      if (seen.has(op.id)) duplicates.push(op.id);
      seen.add(op.id);
    }
    expect(duplicates).toEqual([]);
  });
});

describe('hash detection covers what the tool can produce', () => {
  it('identifies every digest a hashing operation produces', async () => {
    const unrecognised: string[] = [];
    const hashOps = OPERATIONS.filter((op) => op.category === 'Hashing' && !op.isFlowControl);

    for (const op of hashOps) {
      let digest: string;
      try {
        digest = String(await op.run('The quick brown fox jumps over the lazy dog', op.args.map((a) => ({ ...a }))));
      } catch {
        continue;
      }
      const value = digest.trim();
      if (value.length === 0 || value.includes('\n') || value.length > 128) continue;
      if (/^-?\d+$/.test(value)) continue;
      if (value.length < 8) continue;

      const found = identifyHash(value);
      if (!found || found.matches.length === 0) {
        unrecognised.push(`${op.id} produced ${value.length} chars: ${value.slice(0, 32)}`);
      }
    }

    expect(unrecognised).toEqual([]);
  });

  it('stays silent on values too short to carry any signal', () => {
    expect(identifyHash('a89c')).toBeNull();
    expect(identifyHash('abcd')).toBeNull();
  });

  it('recognises a fuzzy hash as a fuzzy hash', () => {
    const found = identifyHash('3:FJKKIUKact:FHIGi');
    expect(found?.matches[0]?.name).toMatch(/ssdeep/);
  });

  it('says nothing about a bare number, which could be anything', () => {
    expect(identifyHash('776992547')).toBeNull();
    expect(identifyHash('0000000001')).toBeNull();
  });

  it('recognises MurmurHash once it is written as hex', () => {
    const names = identifyHash('2e4ff723')?.matches.map((m) => m.name) ?? [];
    expect(names).toContain('MurmurHash3 (32-bit)');
  });
});
