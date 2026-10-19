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

describe('bcrypt', () => {
  it('matches the OpenBSD reference hashes', async () => {
    const cases: Array<[string, number, string, string]> = [
      ['', 6, 'DCq7YPn5Rq63x1Lad4cll.', '$2a$06$DCq7YPn5Rq63x1Lad4cll.TV4S6ytwfsfvkgY8jIucDrjc8deX1s.'],
      ['a', 6, 'm0CrhHm10qJ3lXRY.5zDGO', '$2a$06$m0CrhHm10qJ3lXRY.5zDGO3rS2KdeeWLuGmsfGlMfOxih58VYVfxe'],
      ['abc', 6, 'If6bvum7DFjUnE9p2uDeDu', '$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i'],
      [
        'abcdefghijklmnopqrstuvwxyz',
        6,
        '.rCVZVOThsIa97pEDOxvGu',
        '$2a$06$.rCVZVOThsIa97pEDOxvGuRRgzG64bvtJ0938xuqzv18d3ZpQhstC',
      ],
    ];
    for (const [password, cost, salt, expected] of cases) {
      expect(
        await run(password, ['bcrypt', { Rounds: cost, Salt: salt, Version: '2a' }]),
        password || '(empty)',
      ).toBe(expected);
    }
  }, 60000);

  it('compares a password against a hash', async () => {
    const hash = '$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i';
    expect(await run('abc', ['bcrypt-compare', { Hash: hash }])).toMatch(/^Match/);
    expect(await run('abd', ['bcrypt-compare', { Hash: hash }])).toBe('No match.');
  }, 30000);

  it('splits a hash into its parts', async () => {
    const parsed = await run('$2a$06$If6bvum7DFjUnE9p2uDeDu0YHzrHM6tf.iqN8.yx.jNN1ILEf7h0i', 'bcrypt-parse');
    expect(parsed).toContain('Version: 2a');
    expect(parsed).toContain('Rounds: 6 (64 iterations)');
    expect(parsed).toContain('Salt: If6bvum7DFjUnE9p2uDeDu');
  });

  it('refuses a cost that would never finish', async () => {
    const result = await bake('x', recipe(['bcrypt', { Rounds: 31, Salt: 'DCq7YPn5Rq63x1Lad4cll.' }]));
    expect(result.error?.message).toMatch(/between 4 and 16/);
  });
});

describe('scrypt', () => {
  it('matches the RFC 7914 vectors', async () => {
    expect(
      await run('', [
        'scrypt',
        { Salt: '', 'Iterations (N)': 16, 'Memory factor (r)': 1, 'Parallelisation factor (p)': 1, 'Key length': 64 },
      ]),
    ).toBe(
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
    );

    expect(
      await run('password', [
        'scrypt',
        {
          Salt: '4e61436c',
          'Iterations (N)': 1024,
          'Memory factor (r)': 8,
          'Parallelisation factor (p)': 16,
          'Key length': 64,
        },
      ]),
    ).toBe(
      'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
    );

    expect(
      await run('pleaseletmein', [
        'scrypt',
        {
          Salt: '536f6469756d43686c6f72696465',
          'Iterations (N)': 16384,
          'Memory factor (r)': 8,
          'Parallelisation factor (p)': 1,
          'Key length': 64,
        },
      ]),
    ).toBe(
      '7023bdcb3afd7348461c06cd81fd38ebfda8fbba904f8e3ea9b543f6545da1f2' +
        'd5432955613f0fcf62d49705242a9af9e61e85dc0d651e40dfcf017b45575887',
    );
  }, 120000);

  it('refuses an N that is not a power of two', async () => {
    const result = await bake('x', recipe(['scrypt', { 'Iterations (N)': 100 }]));
    expect(result.error?.message).toMatch(/power of two/);
  });
});
