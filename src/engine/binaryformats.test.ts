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

async function raw(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (result.error) throw new Error(`${String(entries[0])}: ${result.error.message}`);
  return result.output;
}

async function run(input: string, ...entries: Entry[]): Promise<string> {
  return renderText(await raw(input, ...entries));
}

const toHex = (byteString: string) =>
  Array.from(byteString, (c) => (c.charCodeAt(0) & 0xff).toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string) =>
  (hex.match(/../g) ?? []).map((pair) => String.fromCharCode(parseInt(pair, 16))).join('');

describe('CBOR', () => {
  it('encodes the RFC 8949 appendix vectors', async () => {
    const cases: Array<[string, string]> = [
      ['0', '00'],
      ['1', '01'],
      ['10', '0a'],
      ['23', '17'],
      ['24', '1818'],
      ['100', '1864'],
      ['1000', '1903e8'],
      ['-1', '20'],
      ['-10', '29'],
      ['-100', '3863'],
      ['false', 'f4'],
      ['true', 'f5'],
      ['null', 'f6'],
      ['""', '60'],
      ['"a"', '6161'],
      ['"IETF"', '6449455446'],
      ['[]', '80'],
      ['[1,2,3]', '83010203'],
      ['{}', 'a0'],
      ['{"a":1,"b":[2,3]}', 'a26161016162820203'],
      ['["a",{"b":"c"}]', '826161a161626163'],
    ];
    for (const [json, hex] of cases) {
      expect(toHex(await raw(json, 'cbor-encode')), json).toBe(hex);
    }
  });

  it('decodes them back, including the float widths it never writes', async () => {
    expect(await run(fromHex('a26161016162820203'), 'cbor-decode')).toBe(
      JSON.stringify({ a: 1, b: [2, 3] }, null, 2),
    );
    expect(JSON.parse(await run(fromHex('f93e00'), 'cbor-decode'))).toBe(1.5);
    expect(JSON.parse(await run(fromHex('f90001'), 'cbor-decode'))).toBeCloseTo(5.960464477539063e-8);
    expect(JSON.parse(await run(fromHex('fa47c35000'), 'cbor-decode'))).toBe(100000);
    expect(JSON.parse(await run(fromHex('fb3ff199999999999a'), 'cbor-decode'))).toBe(1.1);
  });

  it('reads indefinite-length arrays and strings', async () => {
    expect(JSON.parse(await run(fromHex('9f018202039f0405ffff'), 'cbor-decode'))).toEqual([
      1,
      [2, 3],
      [4, 5],
    ]);
    expect(JSON.parse(await run(fromHex('7f657374726561646d696e67ff'), 'cbor-decode'))).toBe(
      'streaming',
    );
  });

  it('round-trips a document', async () => {
    const json = '{"name":"test","nested":{"list":[1,2,3],"flag":true},"nothing":null}';
    expect(await run(json, 'cbor-encode', 'cbor-decode')).toBe(
      JSON.stringify(JSON.parse(json), null, 2),
    );
  });
});

describe('MessagePack', () => {
  it('encodes the specification vectors', async () => {
    const cases: Array<[string, string]> = [
      ['0', '00'],
      ['127', '7f'],
      ['128', 'cc80'],
      ['-1', 'ff'],
      ['-32', 'e0'],
      ['-33', 'd0df'],
      ['null', 'c0'],
      ['true', 'c3'],
      ['false', 'c2'],
      ['"a"', 'a161'],
      ['[1,2,3]', '93010203'],
      ['{"a":1}', '81a16101'],
    ];
    for (const [json, hex] of cases) {
      expect(toHex(await raw(json, 'to-messagepack')), json).toBe(hex);
    }
  });

  it('round-trips a document', async () => {
    const json = '{"a":[1,-1,1.5],"b":"text","c":null}';
    expect(await run(json, 'to-messagepack', 'from-messagepack')).toBe(
      JSON.stringify(JSON.parse(json), null, 2),
    );
  });
});

describe('BSON', () => {
  it('encodes the example from the specification', async () => {
    expect(toHex(await raw('{"hello":"world"}', 'bson-serialise'))).toBe(
      '160000000268656c6c6f0006000000776f726c640000',
    );
  });

  it('round-trips values of every supported type', async () => {
    const json = '{"i":42,"d":1.5,"s":"text","b":true,"n":null,"a":[1,2],"o":{"k":"v"}}';
    expect(await run(json, 'bson-serialise', 'bson-deserialise')).toBe(
      JSON.stringify(JSON.parse(json), null, 2),
    );
  });
});

describe('Rison', () => {
  it('matches the published encodings', async () => {
    expect(await run('{"any":"json","yes":true}', 'rison-encode')).toBe('(any:json,yes:!t)');
    expect(
      await run('{"supportsObjects":true,"ints":435}', [
        'rison-encode',
        { 'Encode option': 'Encode Object' },
      ]),
    ).toBe('ints:435,supportsObjects:!t');
    expect(
      await run('["A","B",{"supportsObjects":true}]', [
        'rison-encode',
        { 'Encode option': 'Encode Array' },
      ]),
    ).toBe('A,B,(supportsObjects:!t)');
  });

  it('decodes back to the same value', async () => {
    expect(JSON.parse(await run('(any:json,yes:!t)', 'rison-decode'))).toEqual({
      any: 'json',
      yes: true,
    });
    expect(JSON.parse(await run("(a:!(1,2,3),b:'quoted string',c:!n)", 'rison-decode'))).toEqual({
      a: [1, 2, 3],
      b: 'quoted string',
      c: null,
    });
  });

  it('refuses an array encoding of something that is not an array', async () => {
    const result = await bake('{"a":1}', recipe(['rison-encode', { 'Encode option': 'Encode Array' }]));
    expect(result.error?.message).toMatch(/needs an array/);
  });
});

describe('JSONPath', () => {
  const store = JSON.stringify({
    store: {
      book: [
        { title: 'Moby Dick', price: 8.99 },
        { title: 'The Raven', price: 12.5 },
      ],
      bicycle: { colour: 'red', price: 19.95 },
    },
  });

  it('selects by path, index and wildcard', async () => {
    expect(await run(store, ['jpath-expression', { Query: '$.store.bicycle.colour' }])).toBe('"red"');
    expect(await run(store, ['jpath-expression', { Query: '$.store.book[0].title' }])).toBe(
      '"Moby Dick"',
    );
    expect(await run(store, ['jpath-expression', { Query: '$.store.book[*].title' }])).toBe(
      '"Moby Dick"\n"The Raven"',
    );
  });

  it('descends recursively', async () => {
    expect(await run(store, ['jpath-expression', { Query: '$..price' }])).toBe('8.99\n12.5\n19.95');
  });

  it('says plainly that filters are not supported', async () => {
    const result = await bake(store, recipe(['jpath-expression', { Query: '$..book[?(@.price<10)]' }]));
    expect(result.error?.message).toMatch(/Filter expressions are not supported/);
  });
});
