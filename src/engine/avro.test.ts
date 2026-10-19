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


function varint(value: number): number[] {
  let zigzag = BigInt(value) < 0n ? (BigInt(-value) << 1n) - 1n : BigInt(value) << 1n;
  const out: number[] = [];
  do {
    let byte = Number(zigzag & 0x7fn);
    zigzag >>= 7n;
    if (zigzag > 0n) byte |= 0x80;
    out.push(byte);
  } while (zigzag > 0n);
  return out;
}

function text(value: string): number[] {
  const utf8 = Array.from(new TextEncoder().encode(value));
  return [...varint(utf8.length), ...utf8];
}

const SYNC = Array.from({ length: 16 }, (_, i) => i + 1);

async function deflateRaw(bytes: number[]): Promise<number[]> {
  const stream = new Blob([new Uint8Array(bytes) as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return Array.from(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function container(
  schema: unknown,
  body: number[],
  count: number,
  codec: 'null' | 'deflate' | 'snappy' = 'null',
): Promise<string> {
  const block = codec === 'deflate' ? await deflateRaw(body) : body;
  const bytes = [
    0x4f,
    0x62,
    0x6a,
    0x01,
    ...varint(2), 
    ...text('avro.schema'),
    ...text(JSON.stringify(schema)),
    ...text('avro.codec'),
    ...text(codec),
    0x00, 
    ...SYNC,
    ...varint(count),
    ...varint(block.length),
    ...block,
    ...SYNC,
  ];
  return String.fromCharCode(...bytes);
}

async function decode(file: string, overrides: Record<string, string | number | boolean> = {}) {
  return JSON.parse(await run(file, ['avro-to-json', { Indent: 0, ...overrides }]));
}


const USER = {
  type: 'record',
  name: 'User',
  fields: [
    { name: 'name', type: 'string' },
    { name: 'age', type: ['null', 'int'] },
  ],
};

describe('Avro to JSON', () => {
  it('reads records using the schema in the header', async () => {
    const body = [0x06, 0x61, 0x6e, 0x6e, 0x00, 0x06, 0x62, 0x6f, 0x62, 0x02, 0x52];
    expect(await decode(await container(USER, body, 2))).toEqual([
      { name: 'ann', age: null },
      { name: 'bob', age: 41 },
    ]);
  });

  it('reads a deflate-compressed block', async () => {
    const body = [0x06, 0x61, 0x6e, 0x6e, 0x00];
    expect(await decode(await container(USER, body, 1, 'deflate'))).toEqual([
      { name: 'ann', age: null },
    ]);
  });

  it('reads every primitive type', async () => {
    const schema = {
      type: 'record',
      name: 'Everything',
      fields: [
        { name: 'nothing', type: 'null' },
        { name: 'flag', type: 'boolean' },
        { name: 'count', type: 'int' },
        { name: 'big', type: 'long' },
        { name: 'ratio', type: 'double' },
        { name: 'raw', type: 'bytes' },
        { name: 'label', type: 'string' },
      ],
    };
    const double = new DataView(new ArrayBuffer(8));
    double.setFloat64(0, 0.5, true);
    const body = [
      0x01,
      ...varint(-3),
      ...varint(1234567),
      ...Array.from(new Uint8Array(double.buffer)),
      ...varint(2),
      0xde,
      0xad,
      ...text('hi'),
    ];
    expect(await decode(await container(schema, body, 1))).toEqual([
      {
        nothing: null,
        flag: true,
        count: -3,
        big: 1234567,
        ratio: 0.5,
        raw: 'dead',
        label: 'hi',
      },
    ]);
  });

  it('reads arrays, maps, enums and fixed fields', async () => {
    const schema = {
      type: 'record',
      name: 'Shapes',
      fields: [
        { name: 'tags', type: { type: 'array', items: 'string' } },
        { name: 'meta', type: { type: 'map', values: 'int' } },
        { name: 'colour', type: { type: 'enum', name: 'Colour', symbols: ['red', 'green'] } },
        { name: 'id', type: { type: 'fixed', name: 'Id', size: 3 } },
      ],
    };
    const body = [
      ...varint(2),
      ...text('a'),
      ...text('b'),
      0x00, 
      ...varint(1),
      ...text('k'),
      ...varint(9),
      0x00, 
      ...varint(1), 
      0xaa,
      0xbb,
      0xcc,
    ];
    expect(await decode(await container(schema, body, 1))).toEqual([
      { tags: ['a', 'b'], meta: { k: 9 }, colour: 'green', id: 'aabbcc' },
    ]);
  });

  it('resolves a reference to a named record defined earlier', async () => {
    const schema = {
      type: 'record',
      name: 'Node',
      fields: [
        { name: 'value', type: 'int' },
        { name: 'next', type: ['null', 'Node'] },
      ],
    };
    const body = [0x02, 0x02, 0x04, 0x00];
    expect(await decode(await container(schema, body, 1))).toEqual([
      { value: 1, next: { value: 2, next: null } },
    ]);
  });

  it('renders the logical types that have an obvious spelling', async () => {
    const schema = {
      type: 'record',
      name: 'Times',
      fields: [
        { name: 'day', type: { type: 'int', logicalType: 'date' } },
        { name: 'when', type: { type: 'long', logicalType: 'timestamp-millis' } },
      ],
    };
    const body = [...varint(20000), ...varint(1262304000000)];
    expect(await decode(await container(schema, body, 1))).toEqual([
      { day: '2024-10-04', when: '2010-01-01T00:00:00.000Z' },
    ]);
  });

  it('keeps a long that a double could not hold exactly', async () => {
    const schema = { type: 'record', name: 'Big', fields: [{ name: 'n', type: 'long' }] };
    const body = varint(Number.MAX_SAFE_INTEGER);
    const decoded = (await decode(await container(schema, body, 1))) as Array<{ n: number }>;
    expect(decoded[0]!.n).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('can report the schema and one record per line', async () => {
    const body = [0x06, 0x61, 0x6e, 0x6e, 0x00, 0x06, 0x62, 0x6f, 0x62, 0x02, 0x52];
    const file = await container(USER, body, 2);

    const lines = await run(file, ['avro-to-json', { 'One record per line': true }]);
    expect(lines.split('\n')).toHaveLength(2);
    expect(JSON.parse(lines.split('\n')[1]!)).toEqual({ name: 'bob', age: 41 });

    const withSchema = (await decode(file, { 'Include schema': true })) as { schema: { name: string }; count: number };
    expect(withSchema.schema.name).toBe('User');
    expect(withSchema.count).toBe(2);
  });

  it('refuses a file that is not Avro', async () => {
    const result = await bake('hello there', recipe('avro-to-json'));
    expect(result.error?.message).toMatch(/does not start with/);
  });

  it('names the codec it cannot read instead of returning nonsense', async () => {
    const body = [0x06, 0x61, 0x6e, 0x6e, 0x00];
    const result = await bake(await container(USER, body, 1, 'snappy'), recipe('avro-to-json'));
    expect(result.error?.message).toMatch(/'snappy' codec/);
  });

  it('notices a broken sync marker rather than reading past it', async () => {
    const body = [0x06, 0x61, 0x6e, 0x6e, 0x00];
    const file = await container(USER, body, 1);
    const broken = file.slice(0, -1) + 'ÿ';
    const result = await bake(broken, recipe('avro-to-json'));
    expect(result.error?.message).toMatch(/sync marker/);
  });
});
