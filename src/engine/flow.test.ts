import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
import type { Recipe } from './types';

type Entry = string | [string, Record<string, string | number | boolean>];

function recipe(...entries: Entry[]): Recipe {
  return {
    id: 'flow',
    name: 'flow',
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
  if (result.error) throw new Error(`step ${result.error.stepIndex}: ${result.error.message}`);
  return renderText(result.output);
}

describe('fork', () => {
  it('runs the following operations on each piece separately', async () => {
    const lines = ['aGVsbG8=', 'd29ybGQ=', 'YWdhaW4='].join('\n');
    expect(await run(lines, 'fork', 'from-base64')).toBe('hello\nworld\nagain');
  });

  it('honours the split and join delimiters, including escapes', async () => {
    const csv = 'aGVsbG8=,d29ybGQ=';
    expect(
      await run(csv, ['fork', { 'Split on': ',', 'Join with': ' | ' }], 'from-base64'),
    ).toBe('hello | world');
  });

  it('ends at a Merge and continues afterwards', async () => {
    const out = await run('aGVsbG8=\nd29ybGQ=', 'fork', 'from-base64', 'merge', 'to-upper-case');
    expect(out).toBe('HELLO\nWORLD');
  });

  it('keeps going when one branch fails', async () => {
    const out = await run('aGVsbG8=\n!!!not base64!!!\nd29ybGQ=', 'fork', 'from-base64');
    expect(out.split('\n')[0]).toBe('hello');
    expect(out.split('\n')[2]).toBe('world');
  });

  it('fails the whole recipe when told not to ignore errors', async () => {
    const result = await bake(
      'aGVsbG8=\n%%%',
      recipe(['fork', { 'Ignore errors': false }], 'from-hex'),
    );
    expect(result.error).toBeDefined();
  });

  it('nests', async () => {
    const input = 'aGk=,dGhlcmU=;YWxs,Z29vZA==';
    const out = await run(
      input,
      ['fork', { 'Split on': ';', 'Join with': ' / ' }],
      ['fork', { 'Split on': ',', 'Join with': '+' }],
      'from-base64',
      'merge',
      'merge',
    );
    expect(out).toBe('hi+there / all+good');
  });
});

describe('subsection', () => {
  it('transforms only the matching parts and leaves the rest alone', async () => {
    const log = 'user=aGVsbG8= action=login user=d29ybGQ=';
    const out = await run(
      log,
      ['subsection', { Pattern: '(?<=user=)[A-Za-z0-9+/=]+' }],
      'from-base64',
    );
    expect(out).toBe('user=hello action=login user=world');
  });

  it('leaves a non-matching input untouched', async () => {
    expect(await run('nothing here', ['subsection', { Pattern: 'zzz' }], 'to-upper-case')).toBe(
      'nothing here',
    );
  });

  it('keeps the surrounding text when a section fails to convert', async () => {
    const out = await run('a=61626 b=616263', ['subsection', { Pattern: '[0-9a-f]{5,}' }], 'from-hex');
    expect(out).toBe('a=61626 b=abc');
  });
});

describe('register', () => {
  it('captures groups and substitutes them into later arguments', async () => {
    const out = await run(
      'key=41; payload',
      ['register', { Pattern: 'key=([0-9a-f]{2})' }],
      ['find-replace', { Find: 'key=41; ', Replace: '' }],
      ['xor', { Key: '$R0' }],
    );
    const back = await run(out, ['xor', { Key: '41' }]);
    expect(back).toBe('payload');
  });

  it('leaves the placeholder alone when nothing was captured', async () => {
    const out = await run(
      'no key here',
      ['register', { Pattern: 'key=([0-9a-f]+)' }],
      ['find-replace', { Find: 'here', Replace: '$R0' }],
    );
    expect(out).toBe('no key $R0');
  });

  it('does not mutate the recipe it was given', async () => {
    const r = recipe(
      ['register', { Pattern: '(\\d+)' }],
      ['find-replace', { Find: 'x', Replace: '$R0' }],
    );
    await bake('42 x', r);
    const second = await bake('99 x', r);
    expect(second.output).toBe('99 99');
  });
});

describe('jumps', () => {
  it('loops until the condition stops matching', async () => {
    const triple = btoa(btoa(btoa('deep secret')));
    const out = await run(
      triple,
      ['label', { Name: 'top' }],
      'from-base64',
      ['conditional-jump', { Pattern: '^[A-Za-z0-9+/=]+$', Label: 'top', 'Maximum jumps': 5 }],
    );
    expect(out).toBe('deep secret');
  });

  it('stops at the jump ceiling rather than looping forever', async () => {
    const started = Date.now();
    const result = await bake(
      'aaaa',
      recipe(['label', { Name: 'top' }], ['jump', { Label: 'top', 'Maximum jumps': 3 }]),
    );
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.error).toBeUndefined();
    expect(result.output).toBe('aaaa');
  });

  it('reports a missing label instead of hanging', async () => {
    const result = await bake('x', recipe(['jump', { Label: 'nowhere' }]));
    expect(result.error?.message).toContain('nowhere');
  });

  it('skips the jump when the condition does not hold', async () => {
    const out = await run(
      'plain text',
      ['label', { Name: 'top' }],
      ['conditional-jump', { Pattern: '^[0-9]+$', Label: 'top' }],
      'to-upper-case',
    );
    expect(out).toBe('PLAIN TEXT');
  });
});

describe('inert steps', () => {
  it('passes through comments, labels and stray merges', async () => {
    expect(
      await run('hello', ['comment', { Text: 'why this exists' }], 'merge', ['label', { Name: 'a' }]),
    ).toBe('hello');
  });

  it('respects a disabled flow-control step', async () => {
    const r = recipe('fork', 'from-base64');
    r.steps[0]!.disabled = true;
    const result = await bake('aGVsbG8=\nd29ybGQ=', r);
    expect(result.output === '' || !result.output.includes('\n')).toBe(true);
  });
});

describe('bounds', () => {
  it('survives a fork over a very large number of pieces', async () => {
    const many = Array.from({ length: 5000 }, () => 'YQ==').join('\n');
    const started = Date.now();
    const result = await bake(many, recipe('fork', 'from-base64'));
    expect(Date.now() - started).toBeLessThan(20000);
    expect(result.output.length).toBeGreaterThan(0);
  }, 30000);

  it('never rejects, whatever the recipe does', async () => {
    const nasty: Recipe[] = [
      recipe('merge', 'merge', 'merge'),
      recipe('fork'),
      recipe('subsection'),
      recipe(['subsection', { Pattern: '(' }]),
      recipe(['register', { Pattern: '[' }]),
      recipe(['conditional-jump', { Pattern: '(((' }]),
    ];
    for (const r of nasty) {
      const result = await bake('some input', r);
      expect(typeof result.output).toBe('string');
    }
  });
});

describe('return', () => {
  it('ends the recipe, so later operations never run', async () => {
    expect(await run('aGVsbG8=', 'from-base64', 'return', 'to-hex')).toBe('hello');
  });

  it('unwinds out of a fork rather than being swallowed as an error', async () => {
    const result = await bake('aGVsbG8=\nd29ybGQ=', recipe('fork', 'from-base64', 'return'));
    expect(result.error).toBeUndefined();
    expect(renderText(result.output)).toBe('hello');
  });

  it('returns nothing when it is the only step', async () => {
    expect(await run('untouched', 'return')).toBe('untouched');
  });
});

describe('magic', () => {
  it('finds a multi-step chain and names every step of it', async () => {
    const nested = await run('the quick brown fox jumps over the lazy dog', 'gzip', 'to-base64');
    const report = await run(nested, ['magic', { Depth: 3 }]);
    expect(report).toMatch(/gzip/i);
    expect(report).toContain('Base64');
    expect(report).toContain('the quick brown fox');
  }, 30000);

  it('keeps only the chains matching a crib', async () => {
    const nested = await run('user=administrator', 'to-base64');
    expect(await run(nested, ['magic', { Crib: 'administrator' }])).toContain('administrator');

    const missing = await run(nested, ['magic', { Crib: 'not-in-there' }]);
    expect(missing).toContain('no readable decoding');
  }, 30000);

  it('says so plainly when nothing decodes', async () => {
    const report = await run('just some ordinary english words here', ['magic', { Depth: 2 }]);
    expect(report).toMatch(/no readable decoding|Magic searched/);
  }, 30000);

  it('refuses empty input rather than reporting an empty search', async () => {
    const result = await bake('   ', recipe('magic'));
    expect(result.error?.message).toMatch(/needs some input/);
  });
});
