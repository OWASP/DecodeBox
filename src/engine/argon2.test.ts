import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
import { argon2 } from './operations/argon2';
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

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('Argon2', () => {
  it('matches all three RFC 9106 vectors', async () => {
    const common = {
      password: new Uint8Array(32).fill(0x01),
      salt: new Uint8Array(16).fill(0x02),
      secret: new Uint8Array(8).fill(0x03),
      associated: new Uint8Array(12).fill(0x04),
      passes: 3,
      memoryKiB: 32,
      parallelism: 4,
      tagLength: 32,
    };
    expect(hex(argon2({ ...common, type: 0 })), 'Argon2d').toBe(
      '512b391b6f1162975371d30919734294f868e3be3984f3c1a13a4db9fabe4acb',
    );
    expect(hex(argon2({ ...common, type: 1 })), 'Argon2i').toBe(
      'c814d9d1dc7f37aa13f0d77f2494bda1c8de6b016dd388d29952a4c4672b6ce8',
    );
    expect(hex(argon2({ ...common, type: 2 })), 'Argon2id').toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  }, 60000);

  it('writes the encoded form other tools read', async () => {
    const out = await run('password', [
      'argon2',
      { Salt: 'somesalt', 'Memory (KiB)': 256, Iterations: 2, Parallelism: 1 },
    ]);
    expect(out).toMatch(/^\$argon2id\$v=19\$m=256,t=2,p=1\$c29tZXNhbHQ\$[A-Za-z0-9+/]{43}$/);
  }, 60000);

  it('gives the raw tag when asked for hex', async () => {
    const out = await run('password', [
      'argon2',
      { Salt: 'somesalt', 'Memory (KiB)': 256, Iterations: 2, Parallelism: 1, Output: 'Hex' },
    ]);
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  }, 60000);

  it('changes with every parameter', async () => {
    const base = { Salt: 'somesalt', 'Memory (KiB)': 64, Iterations: 1, Parallelism: 1, Output: 'Hex' };
    const first = await run('password', ['argon2', base]);
    const variants = [
      { ...base, Iterations: 2 },
      { ...base, 'Memory (KiB)': 128 },
      { ...base, Parallelism: 2 },
      { ...base, Salt: 'othersalt' },
      { ...base, Type: 'Argon2i' },
      { ...base, Type: 'Argon2d' },
    ];
    for (const variant of variants) {
      expect(await run('password', ['argon2', variant]), JSON.stringify(variant)).not.toBe(first);
    }
    expect(await run('other', ['argon2', base])).not.toBe(first);
  }, 120000);

  it('is longer when a longer tag is asked for', async () => {
    const out = await run('password', [
      'argon2',
      { Salt: 'somesalt', 'Memory (KiB)': 64, Iterations: 1, 'Tag length': 64, Output: 'Hex' },
    ]);
    expect(out).toHaveLength(128);
  }, 60000);

  it('refuses a salt shorter than the specification allows', async () => {
    const result = await bake('password', recipe(['argon2', { Salt: 'short' }]));
    expect(result.error?.message).toMatch(/at least eight bytes/);
  });
});

describe('Argon2 compare', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const encoded = await run('correct horse', [
      'argon2',
      { Salt: 'somesalt', 'Memory (KiB)': 256, Iterations: 2, Parallelism: 1 },
    ]);
    expect(await run('correct horse', ['argon2-compare', { Hash: encoded }])).toMatch(/^Match/);
    expect(await run('battery staple', ['argon2-compare', { Hash: encoded }])).toBe('No match.');
  }, 120000);

  it('reads the parameters out of the hash rather than being told them', async () => {
    const encoded = await run('secret', [
      'argon2',
      { Salt: 'anothersalt', 'Memory (KiB)': 128, Iterations: 3, Parallelism: 2, Type: 'Argon2i' },
    ]);
    expect(encoded).toContain('$argon2i$v=19$m=128,t=3,p=2$');
    expect(await run('secret', ['argon2-compare', { Hash: encoded }])).toMatch(/^Match/);
  }, 120000);

  it('refuses something that is not an encoded hash', async () => {
    const result = await bake('x', recipe(['argon2-compare', { Hash: 'not a hash' }]));
    expect(result.error?.message).toMatch(/not an encoded Argon2 hash/);
  });

  it('refuses an unknown variant', async () => {
    const result = await bake(
      'x',
      recipe(['argon2-compare', { Hash: '$argon2x$v=19$m=64,t=1,p=1$c2FsdHNhbHQ$abcd' }]),
    );
    expect(result.error?.message).toMatch(/not an Argon2 variant/);
  });
});
