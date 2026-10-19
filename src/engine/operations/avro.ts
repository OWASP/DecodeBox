import { OperationError } from '../types';
import { asBytes } from '../core/bytes';
import { arg, type Operation } from './types';


type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = Json;

const MAGIC = [0x4f, 0x62, 0x6a, 0x01];

class Reader {
  at = 0;
  readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get done(): boolean {
    return this.at >= this.bytes.length;
  }

  need(count: number): void {
    if (this.at + count > this.bytes.length) {
      throw new OperationError(
        `The file ends in the middle of a value (wanted ${count} more bytes at offset ${this.at}).`,
      );
    }
  }

  take(count: number): Uint8Array {
    this.need(count);
    const slice = this.bytes.subarray(this.at, this.at + count);
    this.at += count;
    return slice;
  }

  long(): bigint {
    let value = 0n;
    let shift = 0n;
    for (;;) {
      this.need(1);
      const byte = this.bytes[this.at++]!;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7n;
      if (shift > 63n) throw new OperationError('A varint runs past 64 bits.');
    }
    return (value >> 1n) ^ -(value & 1n);
  }

  int(): number {
    return Number(this.long());
  }

  float(): number {
    this.need(4);
    const value = this.view.getFloat32(this.at, true);
    this.at += 4;
    return value;
  }

  double(): number {
    this.need(8);
    const value = this.view.getFloat64(this.at, true);
    this.at += 8;
    return value;
  }

  string(): string {
    const length = Number(this.long());
    if (length < 0) throw new OperationError('A string claims a negative length.');
    return new TextDecoder().decode(this.take(length));
  }
}

type Named = Map<string, Schema>;

function fullName(schema: { [key: string]: Json }, enclosing: string): string {
  const name = String(schema.name ?? '');
  if (name.includes('.')) return name;
  const namespace = schema.namespace !== undefined ? String(schema.namespace) : enclosing;
  return namespace ? `${namespace}.${name}` : name;
}

function typeOf(schema: Schema): string {
  if (typeof schema === 'string') return schema;
  if (Array.isArray(schema)) return 'union';
  if (schema && typeof schema === 'object') return String(schema.type ?? '');
  throw new OperationError('A schema entry is neither a name, a union, nor an object.');
}

function logical(schema: Schema, value: Json): Json {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return value;
  const kind = schema.logicalType;
  if (typeof kind !== 'string') return value;

  if (kind === 'date' && typeof value === 'number') {
    return new Date(value * 86400000).toISOString().slice(0, 10);
  }
  if (kind === 'timestamp-millis' && typeof value === 'number') {
    return new Date(value).toISOString();
  }
  if (kind === 'timestamp-micros' && typeof value === 'number') {
    return new Date(value / 1000).toISOString();
  }
  if (kind === 'time-millis' && typeof value === 'number') {
    return new Date(value).toISOString().slice(11, 23);
  }
  return value;
}

function readValue(r: Reader, schema: Schema, named: Named, namespace: string, depth: number): Json {
  if (depth > 64) throw new OperationError('The schema nests more than 64 levels deep.');

  if (typeof schema === 'string' && named.has(schema)) {
    return readValue(r, named.get(schema)!, named, namespace, depth + 1);
  }

  const kind = typeOf(schema);
  const object = typeof schema === 'object' && !Array.isArray(schema) && schema ? schema : null;

  switch (kind) {
    case 'null':
      return null;
    case 'boolean':
      return r.take(1)[0] !== 0;
    case 'int':
      return logical(schema, r.int());
    case 'long': {
      const value = r.long();
      const asNumber = Number(value);
      const safe = BigInt(Number.MAX_SAFE_INTEGER);
      return logical(schema, value > safe || value < -safe ? value.toString() : asNumber);
    }
    case 'float':
      return r.float();
    case 'double':
      return r.double();
    case 'bytes': {
      const length = Number(r.long());
      return Array.from(r.take(length), (b) => b.toString(16).padStart(2, '0')).join('');
    }
    case 'string':
      return r.string();
    case 'enum': {
      const symbols = object?.symbols;
      const index = r.int();
      if (!Array.isArray(symbols)) throw new OperationError('An enum has no symbols.');
      const symbol = symbols[index];
      if (symbol === undefined) throw new OperationError(`Enum index ${index} is out of range.`);
      return symbol;
    }
    case 'fixed': {
      const size = Number(object?.size ?? 0);
      const bytes = r.take(size);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    case 'array': {
      const items = object?.items ?? null;
      const out: Json[] = [];
      for (;;) {
        let count = Number(r.long());
        if (count === 0) break;
        if (count < 0) {
          count = -count;
          r.long();
        }
        for (let i = 0; i < count; i++) out.push(readValue(r, items, named, namespace, depth + 1));
      }
      return out;
    }
    case 'map': {
      const values = object?.values ?? null;
      const out: { [key: string]: Json } = {};
      for (;;) {
        let count = Number(r.long());
        if (count === 0) break;
        if (count < 0) {
          count = -count;
          r.long();
        }
        for (let i = 0; i < count; i++) out[r.string()] = readValue(r, values, named, namespace, depth + 1);
      }
      return out;
    }
    case 'union': {
      const branches = schema as Schema[];
      const index = r.int();
      const branch = branches[index];
      if (branch === undefined) {
        throw new OperationError(`Union branch ${index} is not one of the ${branches.length} declared.`);
      }
      return readValue(r, branch, named, namespace, depth + 1);
    }
    case 'record': {
      const fields = object?.fields;
      if (!Array.isArray(fields)) throw new OperationError('A record has no fields.');
      const inner = object ? fullName(object, namespace).split('.').slice(0, -1).join('.') : namespace;
      const out: { [key: string]: Json } = {};
      for (const field of fields) {
        if (!field || typeof field !== 'object' || Array.isArray(field)) {
          throw new OperationError('A record field is not an object.');
        }
        out[String(field.name)] = readValue(r, field.type ?? null, named, inner, depth + 1);
      }
      return out;
    }
    default:
      throw new OperationError(`Unknown Avro type '${kind}'.`);
  }
}

function collectNames(schema: Schema, named: Named, namespace: string): void {
  if (Array.isArray(schema)) {
    for (const branch of schema) collectNames(branch, named, namespace);
    return;
  }
  if (!schema || typeof schema !== 'object') return;

  const kind = String(schema.type ?? '');
  if (kind === 'record' || kind === 'enum' || kind === 'fixed') {
    const name = fullName(schema, namespace);
    named.set(name, schema);
    named.set(String(schema.name ?? ''), schema);
  }

  const inner =
    schema.namespace !== undefined ? String(schema.namespace) : fullName(schema, namespace).split('.').slice(0, -1).join('.') || namespace;

  if (kind === 'record' && Array.isArray(schema.fields)) {
    for (const field of schema.fields) {
      if (field && typeof field === 'object' && !Array.isArray(field)) {
        collectNames(field.type ?? null, named, inner);
      }
    }
  }
  if (kind === 'array') collectNames(schema.items ?? null, named, inner);
  if (kind === 'map') collectNames(schema.values ?? null, named, inner);
}

async function inflate(bytes: Uint8Array, format: 'deflate-raw' | 'deflate'): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const avroOperations: Operation[] = [
  {
    id: 'avro-to-json',
    name: 'Avro to JSON',
    category: 'Data format',
    description: 'Reads an Avro object container file using the schema stored in its header.',
    aliases: ['from avro', 'apache avro', 'avro decode'],
    args: [
      { name: 'Indent', type: 'number', value: 2, min: 0, max: 8 },
      { name: 'Include schema', type: 'boolean', value: false },
      { name: 'One record per line', type: 'boolean', value: false },
    ],
    run: async (input, args) => {
      const bytes = asBytes(input);
      if (bytes.length < 4 || MAGIC.some((b, i) => bytes[i] !== b)) {
        throw new OperationError(
          "Not an Avro container file: it does not start with the 'Obj\\x01' magic.",
        );
      }

      const r = new Reader(bytes);
      r.at = 4;

      const meta = new Map<string, Uint8Array>();
      for (;;) {
        let count = Number(r.long());
        if (count === 0) break;
        if (count < 0) {
          count = -count;
          r.long();
        }
        for (let i = 0; i < count; i++) {
          const key = r.string();
          const length = Number(r.long());
          meta.set(key, r.take(length).slice());
        }
      }

      const schemaText = meta.get('avro.schema');
      if (!schemaText) throw new OperationError('The file header carries no avro.schema.');
      let schema: Schema;
      try {
        schema = JSON.parse(new TextDecoder().decode(schemaText)) as Schema;
      } catch {
        throw new OperationError('The schema in the header is not valid JSON.');
      }

      const codec = meta.has('avro.codec')
        ? new TextDecoder().decode(meta.get('avro.codec')!)
        : 'null';
      if (codec !== 'null' && codec !== 'deflate') {
        throw new OperationError(
          `This file uses the '${codec}' codec, which needs a compressor DecodeBox does not carry. Only null and deflate can be read.`,
        );
      }

      const sync = r.take(16).slice();
      const named: Named = new Map();
      collectNames(schema, named, '');

      const records: Json[] = [];
      while (!r.done) {
        const count = Number(r.long());
        const size = Number(r.long());
        let block: Uint8Array = r.take(size).slice();
        if (codec === 'deflate') {
          try {
            block = await inflate(block, 'deflate-raw');
          } catch {
            throw new OperationError('A deflate block in this file could not be decompressed.');
          }
        }

        const inner = new Reader(block);
        for (let i = 0; i < count; i++) {
          records.push(readValue(inner, schema, named, '', 0));
        }

        const marker = r.take(16);
        if (marker.some((b, i) => b !== sync[i])) {
          throw new OperationError(
            `The sync marker after a block does not match the header's: the file is truncated or corrupt.`,
          );
        }
      }

      const indent = Number(arg(args, 'Indent', 2));
      if (arg(args, 'One record per line', false)) {
        return records.map((record) => JSON.stringify(record)).join('\n');
      }
      const payload = arg(args, 'Include schema', false)
        ? { schema, codec, count: records.length, records }
        : records;
      return JSON.stringify(payload, null, indent);
    },
  },
];
