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

async function toJson(yaml: string): Promise<unknown> {
  return JSON.parse(await run(yaml, ['yaml-to-json', { Indent: 0 }]));
}

describe('YAML to JSON', () => {
  it('reads a nested mapping', async () => {
    const yaml = ['name: decodebox', 'owner:', '  org: OWASP', '  stage: incubator'].join('\n');
    expect(await toJson(yaml)).toEqual({
      name: 'decodebox',
      owner: { org: 'OWASP', stage: 'incubator' },
    });
  });

  it('reads a sequence at its key’s indentation and below it', async () => {
    const flush = ['ports:', '- 80', '- 443'].join('\n');
    const nested = ['ports:', '  - 80', '  - 443'].join('\n');
    expect(await toJson(flush)).toEqual({ ports: [80, 443] });
    expect(await toJson(nested)).toEqual({ ports: [80, 443] });
  });

  it('reads a sequence of mappings', async () => {
    const yaml = [
      'containers:',
      '  - name: web',
      '    image: nginx',
      '  - name: db',
      '    image: postgres',
    ].join('\n');
    expect(await toJson(yaml)).toEqual({
      containers: [
        { name: 'web', image: 'nginx' },
        { name: 'db', image: 'postgres' },
      ],
    });
  });

  it('resolves the core scalar types', async () => {
    const yaml = [
      'a: true',
      'b: False',
      'c: null',
      'd: ~',
      'e: 42',
      'f: -1.5e3',
      'g: 0x1f',
      'h: plain text',
      'i: "quoted: colon"',
      "j: 'it''s here'",
      'k:',
    ].join('\n');
    expect(await toJson(yaml)).toEqual({
      a: true,
      b: false,
      c: null,
      d: null,
      e: 42,
      f: -1500,
      g: 31,
      h: 'plain text',
      i: 'quoted: colon',
      j: "it's here",
      k: null,
    });
  });

  it('ignores comments but not a # inside a string', async () => {
    const yaml = ['# leading comment', 'key: value # trailing', 'hash: "a # b"'].join('\n');
    expect(await toJson(yaml)).toEqual({ key: 'value', hash: 'a # b' });
  });

  it('reads flow collections', async () => {
    const yaml = ['list: [1, 2, "three"]', 'map: {a: 1, b: two}', 'empty: []'].join('\n');
    expect(await toJson(yaml)).toEqual({
      list: [1, 2, 'three'],
      map: { a: 1, b: 'two' },
      empty: [],
    });
  });

  it('reads literal and folded block scalars', async () => {
    const yaml = ['literal: |', '  line one', '  line two', 'folded: >', '  one', '  two'].join(
      '\n',
    );
    expect(await toJson(yaml)).toEqual({ literal: 'line one\nline two\n', folded: 'one two\n' });
  });

  it('strips the trailing newline for |-', async () => {
    expect(await toJson(['k: |-', '  only line'].join('\n'))).toEqual({ k: 'only line' });
  });

  it('returns every document when there is more than one', async () => {
    const yaml = ['a: 1', '---', 'a: 2'].join('\n');
    expect(await toJson(yaml)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('refuses anchors rather than misreading them', async () => {
    const result = await bake(['base: &ref', '  a: 1', 'copy: *ref'].join('\n'), recipe('yaml-to-json'));
    expect(result.error?.message).toMatch(/Anchors and aliases are not supported/);
  });

  it('refuses tags rather than dropping them', async () => {
    const result = await bake('when: !!timestamp 2026-01-01', recipe('yaml-to-json'));
    expect(result.error?.message).toMatch(/Tags are not supported/);
  });
});

describe('JSON to YAML', () => {
  it('writes a nested structure in block style', async () => {
    const json = JSON.stringify({ name: 'decodebox', owner: { org: 'OWASP' }, ports: [80, 443] });
    expect(await run(json, 'json-to-yaml')).toBe(
      ['name: decodebox', 'owner:', '  org: OWASP', 'ports:', '- 80', '- 443'].join('\n'),
    );
  });

  it('round-trips back through the parser', async () => {
    const value = {
      name: 'a b',
      truthy: true,
      nothing: null,
      count: 3,
      nested: { list: [{ x: 1 }, { x: 2 }], empty: [] },
      'needs: quotes': 'yes',
    };
    const yaml = await run(JSON.stringify(value), 'json-to-yaml');
    expect(JSON.parse(await run(yaml, ['yaml-to-json', { Indent: 0 }]))).toEqual(value);
  });

  it('quotes a string that would otherwise read as a boolean', async () => {
    expect(await run(JSON.stringify({ answer: 'yes' }), 'json-to-yaml')).toBe('answer: "yes"');
  });

  it('refuses input that is not JSON', async () => {
    const result = await bake('not json', recipe('json-to-yaml'));
    expect(result.error?.message).toMatch(/Not valid JSON/);
  });
});
