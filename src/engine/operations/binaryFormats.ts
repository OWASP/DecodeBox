import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';



class Writer {
  private parts: number[] = [];

  byte(value: number): void {
    this.parts.push(value & 0xff);
  }

  bytes(values: Uint8Array | number[]): void {
    for (const value of values) this.parts.push(value & 0xff);
  }

  uint(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) this.parts.push((value / 256 ** i) & 0xff);
  }

  uintLE(value: number, width: number): void {
    for (let i = 0; i < width; i++) this.parts.push(Math.floor(value / 256 ** i) & 0xff);
  }

  float64(value: number, little: boolean): void {
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setFloat64(0, value, little);
    for (let i = 0; i < 8; i++) this.parts.push(buffer.getUint8(i));
  }

  get length(): number {
    return this.parts.length;
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

class Reader {
  at = 0;

  constructor(readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.at >= this.bytes.length;
  }

  byte(): number {
    if (this.at >= this.bytes.length) throw new OperationError('Input ends in the middle of a value.');
    return this.bytes[this.at++] as number;
  }

  take(count: number): Uint8Array {
    if (count < 0 || this.at + count > this.bytes.length) {
      throw new OperationError(`A field claims ${count} bytes but the data ends first.`);
    }
    const slice = this.bytes.subarray(this.at, this.at + count);
    this.at += count;
    return slice;
  }

  uint(width: number): number {
    let value = 0;
    for (const byte of this.take(width)) value = value * 256 + byte;
    return value;
  }

  uintLE(width: number): number {
    let value = 0;
    const slice = this.take(width);
    for (let i = width - 1; i >= 0; i--) value = value * 256 + (slice[i] as number);
    return value;
  }

  view(count: number): DataView {
    const slice = this.take(count);
    return new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
  }
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder('utf-8', { fatal: false });

const MAX_DEPTH = 64;

function checkDepth(depth: number): void {
  if (depth > MAX_DEPTH) throw new OperationError(`Nested more than ${MAX_DEPTH} deep.`);
}


function writeCborHead(out: Writer, major: number, value: number): void {
  const tag = major << 5;
  if (value < 24) {
    out.byte(tag | value);
  } else if (value < 0x100) {
    out.byte(tag | 24);
    out.byte(value);
  } else if (value < 0x10000) {
    out.byte(tag | 25);
    out.uint(value, 2);
  } else if (value < 0x100000000) {
    out.byte(tag | 26);
    out.uint(value, 4);
  } else {
    out.byte(tag | 27);
    out.uint(value, 8);
  }
}

function encodeCbor(value: unknown, out: Writer, depth = 0): void {
  checkDepth(depth);
  if (value === null || value === undefined) {
    out.byte(0xf6);
    return;
  }
  if (typeof value === 'boolean') {
    out.byte(value ? 0xf5 : 0xf4);
    return;
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      if (value >= 0) writeCborHead(out, 0, value);
      else writeCborHead(out, 1, -value - 1);
    } else {
      out.byte(0xfb);
      out.float64(value, false);
    }
    return;
  }
  if (typeof value === 'string') {
    const bytes = utf8.encode(value);
    writeCborHead(out, 3, bytes.length);
    out.bytes(bytes);
    return;
  }
  if (Array.isArray(value)) {
    writeCborHead(out, 4, value.length);
    for (const item of value) encodeCbor(item, out, depth + 1);
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  writeCborHead(out, 5, entries.length);
  for (const [key, item] of entries) {
    encodeCbor(key, out, depth + 1);
    encodeCbor(item, out, depth + 1);
  }
}

function readCborLength(reader: Reader, info: number): number | null {
  if (info < 24) return info;
  if (info === 24) return reader.byte();
  if (info === 25) return reader.uint(2);
  if (info === 26) return reader.uint(4);
  if (info === 27) return reader.uint(8);
  if (info === 31) return null;
  throw new OperationError(`${info} is not a valid CBOR length.`);
}

function readHalfFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : NaN;
  return sign * (mantissa + 1024) * 2 ** (exponent - 25);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeCbor(reader: Reader, depth = 0): unknown {
  checkDepth(depth);
  const initial = reader.byte();
  const major = initial >> 5;
  const info = initial & 0x1f;

  switch (major) {
    case 0:
      return readCborLength(reader, info);
    case 1: {
      const value = readCborLength(reader, info);
      return value === null ? null : -value - 1;
    }
    case 2: {
      const length = readCborLength(reader, info);
      if (length !== null) return `0x${hex(reader.take(length))}`;
      let out = '';
      while (reader.bytes[reader.at] !== 0xff) {
        const chunk = readCborLength(reader, reader.byte() & 0x1f);
        out += hex(reader.take(chunk ?? 0));
      }
      reader.byte();
      return `0x${out}`;
    }
    case 3: {
      const length = readCborLength(reader, info);
      if (length !== null) return fromUtf8.decode(reader.take(length));
      let out = '';
      while (reader.bytes[reader.at] !== 0xff) out += String(decodeCbor(reader, depth + 1));
      reader.byte();
      return out;
    }
    case 4: {
      const length = readCborLength(reader, info);
      const items: unknown[] = [];
      if (length === null) {
        while (reader.bytes[reader.at] !== 0xff) items.push(decodeCbor(reader, depth + 1));
        reader.byte();
      } else {
        for (let i = 0; i < length; i++) items.push(decodeCbor(reader, depth + 1));
      }
      return items;
    }
    case 5: {
      const length = readCborLength(reader, info);
      const map: Record<string, unknown> = {};
      const readPair = () => {
        const key = decodeCbor(reader, depth + 1);
        map[String(key)] = decodeCbor(reader, depth + 1);
      };
      if (length === null) {
        while (reader.bytes[reader.at] !== 0xff) readPair();
        reader.byte();
      } else {
        for (let i = 0; i < length; i++) readPair();
      }
      return map;
    }
    case 6: {
      readCborLength(reader, info);
      return decodeCbor(reader, depth + 1);
    }
    default:
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 23) return null;
      if (info === 25) return readHalfFloat(reader.uint(2));
      if (info === 26) return reader.view(4).getFloat32(0, false);
      if (info === 27) return reader.view(8).getFloat64(0, false);
      if (info === 31) throw new OperationError('Unexpected CBOR break.');
      return null;
  }
}


function encodeMsgpack(value: unknown, out: Writer, depth = 0): void {
  checkDepth(depth);
  if (value === null || value === undefined) {
    out.byte(0xc0);
    return;
  }
  if (typeof value === 'boolean') {
    out.byte(value ? 0xc3 : 0xc2);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      out.byte(0xcb);
      out.float64(value, false);
    } else if (value >= 0) {
      if (value < 0x80) {
        out.byte(value);
      } else if (value < 0x100) {
        out.byte(0xcc);
        out.byte(value);
      } else if (value < 0x10000) {
        out.byte(0xcd);
        out.uint(value, 2);
      } else if (value < 0x100000000) {
        out.byte(0xce);
        out.uint(value, 4);
      } else {
        out.byte(0xcf);
        out.uint(value, 8);
      }
    } else if (value >= -32) {
      out.byte(0xe0 | (value + 32));
    } else if (value >= -0x80) {
      out.byte(0xd0);
      out.byte(value + 0x100);
    } else if (value >= -0x8000) {
      out.byte(0xd1);
      out.uint(value + 0x10000, 2);
    } else if (value >= -0x80000000) {
      out.byte(0xd2);
      out.uint(value + 0x100000000, 4);
    } else {
      out.byte(0xcb);
      out.float64(value, false);
    }
    return;
  }
  if (typeof value === 'string') {
    const bytes = utf8.encode(value);
    if (bytes.length < 32) {
      out.byte(0xa0 | bytes.length);
    } else if (bytes.length < 0x100) {
      out.byte(0xd9);
      out.byte(bytes.length);
    } else if (bytes.length < 0x10000) {
      out.byte(0xda);
      out.uint(bytes.length, 2);
    } else {
      out.byte(0xdb);
      out.uint(bytes.length, 4);
    }
    out.bytes(bytes);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length < 16) {
      out.byte(0x90 | value.length);
    } else if (value.length < 0x10000) {
      out.byte(0xdc);
      out.uint(value.length, 2);
    } else {
      out.byte(0xdd);
      out.uint(value.length, 4);
    }
    for (const item of value) encodeMsgpack(item, out, depth + 1);
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length < 16) {
    out.byte(0x80 | entries.length);
  } else if (entries.length < 0x10000) {
    out.byte(0xde);
    out.uint(entries.length, 2);
  } else {
    out.byte(0xdf);
    out.uint(entries.length, 4);
  }
  for (const [key, item] of entries) {
    encodeMsgpack(key, out, depth + 1);
    encodeMsgpack(item, out, depth + 1);
  }
}

function decodeMsgpack(reader: Reader, depth = 0): unknown {
  checkDepth(depth);
  const byte = reader.byte();

  const readArray = (count: number) => {
    const items: unknown[] = [];
    for (let i = 0; i < count; i++) items.push(decodeMsgpack(reader, depth + 1));
    return items;
  };
  const readMap = (count: number) => {
    const map: Record<string, unknown> = {};
    for (let i = 0; i < count; i++) {
      const key = decodeMsgpack(reader, depth + 1);
      map[String(key)] = decodeMsgpack(reader, depth + 1);
    }
    return map;
  };

  if (byte <= 0x7f) return byte;
  if (byte >= 0xe0) return byte - 0x100;
  if (byte >= 0x80 && byte <= 0x8f) return readMap(byte & 0x0f);
  if (byte >= 0x90 && byte <= 0x9f) return readArray(byte & 0x0f);
  if (byte >= 0xa0 && byte <= 0xbf) return fromUtf8.decode(reader.take(byte & 0x1f));

  switch (byte) {
    case 0xc0:
      return null;
    case 0xc2:
      return false;
    case 0xc3:
      return true;
    case 0xc4:
      return `0x${hex(reader.take(reader.byte()))}`;
    case 0xc5:
      return `0x${hex(reader.take(reader.uint(2)))}`;
    case 0xc6:
      return `0x${hex(reader.take(reader.uint(4)))}`;
    case 0xca:
      return reader.view(4).getFloat32(0, false);
    case 0xcb:
      return reader.view(8).getFloat64(0, false);
    case 0xcc:
      return reader.byte();
    case 0xcd:
      return reader.uint(2);
    case 0xce:
      return reader.uint(4);
    case 0xcf:
      return reader.uint(8);
    case 0xd0: {
      const value = reader.byte();
      return value >= 0x80 ? value - 0x100 : value;
    }
    case 0xd1: {
      const value = reader.uint(2);
      return value >= 0x8000 ? value - 0x10000 : value;
    }
    case 0xd2: {
      const value = reader.uint(4);
      return value >= 0x80000000 ? value - 0x100000000 : value;
    }
    case 0xd3:
      return Number(reader.view(8).getBigInt64(0, false));
    case 0xd9:
      return fromUtf8.decode(reader.take(reader.byte()));
    case 0xda:
      return fromUtf8.decode(reader.take(reader.uint(2)));
    case 0xdb:
      return fromUtf8.decode(reader.take(reader.uint(4)));
    case 0xdc:
      return readArray(reader.uint(2));
    case 0xdd:
      return readArray(reader.uint(4));
    case 0xde:
      return readMap(reader.uint(2));
    case 0xdf:
      return readMap(reader.uint(4));
    default:
      throw new OperationError(`0x${byte.toString(16)} is not a MessagePack type.`);
  }
}


function encodeBsonValue(out: Writer, key: string, value: unknown, depth: number): void {
  checkDepth(depth);
  const name = () => {
    out.bytes(utf8.encode(key));
    out.byte(0);
  };

  if (value === null || value === undefined) {
    out.byte(0x0a);
    name();
    return;
  }
  if (typeof value === 'boolean') {
    out.byte(0x08);
    name();
    out.byte(value ? 1 : 0);
    return;
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= -0x80000000 && value < 0x80000000) {
      out.byte(0x10);
      name();
      out.uintLE(value < 0 ? value + 0x100000000 : value, 4);
      return;
    }
    out.byte(0x01);
    name();
    out.float64(value, true);
    return;
  }
  if (typeof value === 'string') {
    out.byte(0x02);
    name();
    const bytes = utf8.encode(value);
    out.uintLE(bytes.length + 1, 4);
    out.bytes(bytes);
    out.byte(0);
    return;
  }
  const nested = encodeBsonDocument(value as Record<string, unknown>, depth + 1);
  out.byte(Array.isArray(value) ? 0x04 : 0x03);
  name();
  out.bytes(nested);
}

function encodeBsonDocument(value: Record<string, unknown> | unknown[], depth = 0): Uint8Array {
  const body = new Writer();
  const entries = Array.isArray(value)
    ? value.map((item, i) => [String(i), item] as const)
    : Object.entries(value);
  for (const [key, item] of entries) encodeBsonValue(body, key, item, depth);
  body.byte(0);

  const out = new Writer();
  out.uintLE(body.length + 4, 4);
  out.bytes(body.toBytes());
  return out.toBytes();
}

function readCString(reader: Reader): string {
  const start = reader.at;
  while (reader.at < reader.bytes.length && reader.bytes[reader.at] !== 0) reader.at++;
  const text = fromUtf8.decode(reader.bytes.subarray(start, reader.at));
  reader.at++;
  return text;
}

function decodeBsonDocument(reader: Reader, depth = 0): Record<string, unknown> | unknown[] {
  checkDepth(depth);
  const length = reader.uintLE(4);
  const end = reader.at + length - 5;
  const out: Record<string, unknown> = {};
  let isArray = true;
  let index = 0;

  while (reader.at < end) {
    const type = reader.byte();
    const key = readCString(reader);
    if (key !== String(index++)) isArray = false;

    switch (type) {
      case 0x01:
        out[key] = reader.view(8).getFloat64(0, true);
        break;
      case 0x02: {
        const size = reader.uintLE(4);
        out[key] = fromUtf8.decode(reader.take(size - 1));
        reader.byte();
        break;
      }
      case 0x03:
      case 0x04:
        out[key] = decodeBsonDocument(reader, depth + 1);
        break;
      case 0x05: {
        const size = reader.uintLE(4);
        reader.byte();
        out[key] = `0x${hex(reader.take(size))}`;
        break;
      }
      case 0x07:
        out[key] = hex(reader.take(12));
        break;
      case 0x08:
        out[key] = reader.byte() !== 0;
        break;
      case 0x09:
        out[key] = new Date(Number(reader.view(8).getBigInt64(0, true))).toISOString();
        break;
      case 0x0a:
        out[key] = null;
        break;
      case 0x10: {
        const value = reader.uintLE(4);
        out[key] = value >= 0x80000000 ? value - 0x100000000 : value;
        break;
      }
      case 0x11:
      case 0x12:
        out[key] = Number(reader.view(8).getBigInt64(0, true));
        break;
      default:
        throw new OperationError(`0x${type.toString(16)} is not a BSON element type.`);
    }
  }
  reader.byte();
  return isArray && Object.keys(out).length > 0 ? Object.values(out) : out;
}


const RISON_ID_START = /[^-0123456789 '!:(),*@$\s]/;
const RISON_ID_REST = /[^ '!:(),*@$\s]/;

function isRisonId(text: string): boolean {
  if (text.length === 0) return false;
  if (!RISON_ID_START.test(text[0] as string)) return false;
  return [...text.slice(1)].every((char) => RISON_ID_REST.test(char));
}

function encodeRison(value: unknown): string {
  if (value === null || value === undefined) return '!n';
  if (typeof value === 'boolean') return value ? '!t' : '!f';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value).replace('e+', 'e') : '!n';
  }
  if (typeof value === 'string') {
    if (isRisonId(value)) return value;
    return `'${value.replace(/(['!])/g, '!$1')}'`;
  }
  if (Array.isArray(value)) return `!(${value.map(encodeRison).join(',')})`;

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `(${entries.map(([key, item]) => `${encodeRison(key)}:${encodeRison(item)}`).join(',')})`;
}

class RisonParser {
  at = 0;

  constructor(readonly text: string) {}

  parse(depth = 0): unknown {
    checkDepth(depth);
    const char = this.text[this.at];
    if (char === undefined) throw new OperationError('Rison input ends early.');

    if (char === '!') {
      this.at++;
      const kind = this.text[this.at++];
      if (kind === 't') return true;
      if (kind === 'f') return false;
      if (kind === 'n') return null;
      if (kind === '(') {
        const items: unknown[] = [];
        if (this.text[this.at] === ')') {
          this.at++;
          return items;
        }
        for (;;) {
          items.push(this.parse(depth + 1));
          const separator = this.text[this.at++];
          if (separator === ')') return items;
          if (separator !== ',') throw new OperationError('Expected , or ) in a Rison array.');
        }
      }
      throw new OperationError(`'!${kind ?? ''}' is not a Rison literal.`);
    }

    if (char === '(') {
      this.at++;
      const out: Record<string, unknown> = {};
      if (this.text[this.at] === ')') {
        this.at++;
        return out;
      }
      for (;;) {
        const key = this.parse(depth + 1);
        if (this.text[this.at++] !== ':') throw new OperationError('Expected : in a Rison object.');
        out[String(key)] = this.parse(depth + 1);
        const separator = this.text[this.at++];
        if (separator === ')') return out;
        if (separator !== ',') throw new OperationError('Expected , or ) in a Rison object.');
      }
    }

    if (char === "'") {
      this.at++;
      let out = '';
      while (this.at < this.text.length) {
        const c = this.text[this.at++] as string;
        if (c === '!') out += this.text[this.at++] ?? '';
        else if (c === "'") return out;
        else out += c;
      }
      throw new OperationError('Unterminated Rison string.');
    }

    const start = this.at;
    while (this.at < this.text.length && /[^:,()]/.test(this.text[this.at] as string)) this.at++;
    const token = this.text.slice(start, this.at);
    if (token === '') throw new OperationError('Empty Rison value.');
    if (/^-?\d+(\.\d+)?(e-?\d+)?$/.test(token)) return Number(token);
    return token;
  }
}


function jsonPath(root: unknown, path: string): unknown[] {
  const tokens = path
    .replace(/^\$/, '')
    .replace(/\['([^']*)'\]/g, '.$1')
    .replace(/\["([^"]*)"\]/g, '.$1')
    .replace(/\[(\d+|\*|-?\d*:-?\d*)\]/g, '.[$1]')
    .split('.')
    .filter((token, i, all) => token !== '' || all[i + 1] === '');

  let current: unknown[] = [root];
  let descend = false;

  for (const token of tokens) {
    if (token === '') {
      descend = true;
      continue;
    }

    const pool = descend ? current.flatMap((node) => [node, ...everyDescendant(node)]) : current;
    descend = false;

    const next: unknown[] = [];
    for (const node of pool) {
      if (token === '*' || token === '[*]') {
        if (Array.isArray(node)) next.push(...node);
        else if (node && typeof node === 'object') next.push(...Object.values(node));
        continue;
      }
      const slice = /^\[(-?\d*):(-?\d*)\]$/.exec(token);
      if (slice && Array.isArray(node)) {
        const from = slice[1] === '' ? 0 : Number(slice[1]);
        const to = slice[2] === '' ? node.length : Number(slice[2]);
        next.push(...node.slice(from, to));
        continue;
      }
      const index = /^\[(-?\d+)\]$/.exec(token);
      if (index && Array.isArray(node)) {
        const at = Number(index[1]);
        const value = node[at < 0 ? node.length + at : at];
        if (value !== undefined) next.push(value);
        continue;
      }
      if (node && typeof node === 'object' && token in (node as Record<string, unknown>)) {
        next.push((node as Record<string, unknown>)[token]);
      }
    }
    current = next;
  }
  return current;
}

function everyDescendant(node: unknown): unknown[] {
  if (!node || typeof node !== 'object') return [];
  const children = Array.isArray(node) ? node : Object.values(node);
  return children.flatMap((child) => [child, ...everyDescendant(child)]);
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    throw new OperationError('Input must be JSON.');
  }
}

export const binaryFormatOperations: Operation[] = [
  {
    id: 'cbor-encode',
    name: 'CBOR Encode',
    category: 'Data format',
    description: 'Encodes JSON as CBOR, the binary object format of RFC 8949.',
    aliases: ['concise binary', 'rfc8949'],
    args: [],
    run: (input) => {
      const out = new Writer();
      encodeCbor(parseJson(input), out);
      return bytesToLatin1(out.toBytes());
    },
  },
  {
    id: 'cbor-decode',
    name: 'CBOR Decode',
    category: 'Data format',
    description: 'Decodes CBOR into JSON.',
    aliases: ['concise binary decode', 'rfc8949 decode'],
    args: [],
    run: (input) => JSON.stringify(decodeCbor(new Reader(asBytes(input))), null, 2),
    detection: {
      minLength: 2,
      test: (_text, bytes) => {
        const first = bytes[0] ?? 0;
        const major = first >> 5;
        if (major !== 4 && major !== 5) return null;
        try {
          const reader = new Reader(bytes);
          decodeCbor(reader);
          return reader.done ? { label: 'CBOR', detail: 'Decodes cleanly as a CBOR map or array.' } : null;
        } catch {
          return null;
        }
      },
    },
  },
  {
    id: 'to-messagepack',
    name: 'To MessagePack',
    category: 'Data format',
    description: 'Encodes JSON as MessagePack.',
    aliases: ['msgpack', 'messagepack encode'],
    args: [],
    run: (input) => {
      const out = new Writer();
      encodeMsgpack(parseJson(input), out);
      return bytesToLatin1(out.toBytes());
    },
  },
  {
    id: 'from-messagepack',
    name: 'From MessagePack',
    category: 'Data format',
    description: 'Decodes MessagePack into JSON.',
    aliases: ['msgpack decode', 'messagepack decode'],
    args: [],
    run: (input) => JSON.stringify(decodeMsgpack(new Reader(asBytes(input))), null, 2),
  },
  {
    id: 'bson-serialise',
    name: 'BSON serialise',
    category: 'Code tidy',
    description: 'Encodes JSON as BSON, the document format MongoDB stores.',
    aliases: ['mongodb', 'bson encode'],
    args: [],
    run: (input) => {
      const value = parseJson(input);
      if (value === null || typeof value !== 'object') {
        throw new OperationError('BSON stores documents, so the input must be an object or array.');
      }
      return bytesToLatin1(encodeBsonDocument(value as Record<string, unknown>));
    },
  },
  {
    id: 'bson-deserialise',
    name: 'BSON deserialise',
    category: 'Code tidy',
    description: 'Decodes a BSON document into JSON.',
    aliases: ['mongodb decode', 'bson decode'],
    args: [],
    run: (input) => JSON.stringify(decodeBsonDocument(new Reader(asBytes(input))), null, 2),
  },
  {
    id: 'rison-encode',
    name: 'Rison Encode',
    category: 'Data format',
    description: 'Encodes JSON as Rison, the compact notation used inside URLs.',
    aliases: ['rison', 'url object'],
    args: [
      {
        name: 'Encode option',
        type: 'option',
        value: 'Encode',
        options: ['Encode', 'Encode Object', 'Encode Array', 'Encode URI'],
      },
    ],
    run: (input, args) => {
      const value = parseJson(input);
      const option = String(arg(args, 'Encode option', 'Encode'));

      if (option === 'Encode Object') {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          throw new OperationError('Encoding as an object needs an object.');
        }
        return encodeRison(value).slice(1, -1);
      }
      if (option === 'Encode Array') {
        if (!Array.isArray(value)) throw new OperationError('Encoding as an array needs an array.');
        return encodeRison(value).slice(2, -1);
      }
      const encoded = encodeRison(value);
      return option === 'Encode URI'
        ? encodeURIComponent(encoded).replace(/%(2C|3A|40|24|2F|20)/g, (_m, code: string) =>
            ({ '2C': ',', '3A': ':', '40': '@', '24': '$', '2F': '/', '20': '+' })[code] ?? _m,
          )
        : encoded;
    },
  },
  {
    id: 'rison-decode',
    name: 'Rison Decode',
    category: 'Data format',
    description: 'Decodes Rison back into JSON.',
    aliases: ['rison decode', 'url object decode'],
    args: [
      {
        name: 'Decode option',
        type: 'option',
        value: 'Decode',
        options: ['Decode', 'Decode Object', 'Decode Array'],
      },
    ],
    run: (input, args) => {
      const option = String(arg(args, 'Decode option', 'Decode'));
      const text = input.trim();
      const wrapped =
        option === 'Decode Object' ? `(${text})` : option === 'Decode Array' ? `!(${text})` : text;

      const parser = new RisonParser(wrapped);
      const value = parser.parse();
      if (parser.at < wrapped.length) {
        throw new OperationError(`Unexpected text after the Rison value at ${parser.at}.`);
      }
      return JSON.stringify(value, null, 4);
    },
  },
  {
    id: 'jpath-expression',
    name: 'JPath expression',
    category: 'Extractors',
    description: 'Selects values from JSON with a JSONPath expression.',
    aliases: ['jsonpath', 'json query', 'jq path'],
    args: [
      { name: 'Query', type: 'string', value: '' },
      { name: 'Result delimiter', type: 'string', value: '\\n' },
    ],
    run: (input, args) => {
      const query = String(arg(args, 'Query', '')).trim();
      if (query === '') throw new OperationError('Enter a JSONPath expression.');
      if (/[?(]/.test(query)) {
        throw new OperationError('Filter expressions are not supported; use a plain path.');
      }
      const results = jsonPath(parseJson(input), query);
      const delimiter = String(arg(args, 'Result delimiter', '\\n')).replace(/\\n/g, '\n');
      return results.map((value) => JSON.stringify(value)).join(delimiter);
    },
  },
];
