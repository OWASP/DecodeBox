import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';


type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface Traits {
  className: string;
  dynamic: boolean;
  properties: string[];
}

class Reader {
  at = 0;
  readonly view: DataView;

  readonly strings: string[] = [];
  readonly objects: Json[] = [];
  readonly traits: Traits[] = [];

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  need(count: number): void {
    if (this.at + count > this.bytes.length) {
      throw new OperationError(
        `The data ends in the middle of a value (wanted ${count} more bytes at offset ${this.at}).`,
      );
    }
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.at++]!;
  }

  u16(): number {
    this.need(2);
    const value = this.view.getUint16(this.at);
    this.at += 2;
    return value;
  }

  i16(): number {
    this.need(2);
    const value = this.view.getInt16(this.at);
    this.at += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.at);
    this.at += 4;
    return value;
  }

  i32(): number {
    this.need(4);
    const value = this.view.getInt32(this.at);
    this.at += 4;
    return value;
  }

  double(): number {
    this.need(8);
    const value = this.view.getFloat64(this.at);
    this.at += 8;
    return value;
  }

  utf8(length: number): string {
    this.need(length);
    const text = new TextDecoder().decode(this.bytes.subarray(this.at, this.at + length));
    this.at += length;
    return text;
  }

  u29(): number {
    let value = 0;
    for (let i = 0; i < 3; i++) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value >>> 0;
    }
    return (((value << 8) | this.u8()) >>> 0) & 0x1fffffff;
  }
}

function isoDate(millis: number): string {
  if (!Number.isFinite(millis) || Math.abs(millis) > 8.64e15) {
    return `(date out of range: ${millis})`;
  }
  return new Date(millis).toISOString();
}


function amf0Value(r: Reader, depth: number): Json {
  if (depth > 64) throw new OperationError('The data nests more than 64 levels deep.');
  const marker = r.u8();

  switch (marker) {
    case 0x00:
      return r.double();
    case 0x01:
      return r.u8() !== 0;
    case 0x02:
      return r.utf8(r.u16());
    case 0x03:
      return amf0Object(r, {}, depth);
    case 0x05:
      return null;
    case 0x06:
      return null; 
    case 0x07: {
      const index = r.u16();
      const found = r.objects[index];
      if (found === undefined) throw new OperationError(`Reference to object ${index}, which is not in the stream.`);
      return found;
    }
    case 0x08: {
      r.u32(); 
      return amf0Object(r, {}, depth);
    }
    case 0x0a: {
      const count = r.u32();
      const out: Json[] = [];
      r.objects.push(out);
      for (let i = 0; i < count; i++) out.push(amf0Value(r, depth + 1));
      return out;
    }
    case 0x0b: {
      const millis = r.double();
      r.i16(); 
      return isoDate(millis);
    }
    case 0x0c:
      return r.utf8(r.u32());
    case 0x0d:
      return '(unsupported)';
    case 0x0f:
      return r.utf8(r.u32());
    case 0x10: {
      const className = r.utf8(r.u16());
      return amf0Object(r, { $class: className }, depth);
    }
    case 0x11:
      return amf3Value(r, depth + 1);
    default:
      throw new OperationError(`Unknown AMF0 marker 0x${marker.toString(16)} at offset ${r.at - 1}.`);
  }
}

function amf0Object(r: Reader, seed: { [key: string]: Json }, depth: number): Json {
  const out: { [key: string]: Json } = seed;
  r.objects.push(out);
  for (;;) {
    const length = r.u16();
    if (length === 0) {
      const end = r.u8();
      if (end !== 0x09) throw new OperationError('An AMF0 object ended without its end marker.');
      return out;
    }
    const key = r.utf8(length);
    out[key] = amf0Value(r, depth + 1);
  }
}


function amf3String(r: Reader): string {
  const header = r.u29();
  if ((header & 1) === 0) {
    const found = r.strings[header >> 1];
    if (found === undefined) {
      throw new OperationError(`Reference to string ${header >> 1}, which is not in the stream.`);
    }
    return found;
  }
  const text = r.utf8(header >> 1);
  if (text.length > 0) r.strings.push(text);
  return text;
}

function amf3Traits(r: Reader, header: number): Traits {
  if ((header & 2) === 0) {
    const found = r.traits[header >> 2];
    if (found === undefined) {
      throw new OperationError(`Reference to traits ${header >> 2}, which is not in the stream.`);
    }
    return found;
  }
  if ((header & 4) !== 0) {
    const className = amf3String(r);
    throw new OperationError(
      `'${className}' is externalizable: only the class itself knows how to read its bytes.`,
    );
  }
  const traits: Traits = {
    className: amf3String(r),
    dynamic: (header & 8) !== 0,
    properties: [],
  };
  const count = header >> 4;
  for (let i = 0; i < count; i++) traits.properties.push(amf3String(r));
  r.traits.push(traits);
  return traits;
}

function amf3Value(r: Reader, depth: number): Json {
  if (depth > 64) throw new OperationError('The data nests more than 64 levels deep.');
  const marker = r.u8();

  const byReference = (header: number): Json | undefined => {
    if ((header & 1) !== 0) return undefined;
    const found = r.objects[header >> 1];
    if (found === undefined) {
      throw new OperationError(`Reference to object ${header >> 1}, which is not in the stream.`);
    }
    return found;
  };

  switch (marker) {
    case 0x00:
    case 0x01:
      return null;
    case 0x02:
      return false;
    case 0x03:
      return true;
    case 0x04: {
      const value = r.u29();
      return value > 0x0fffffff ? value - 0x20000000 : value;
    }
    case 0x05:
      return r.double();
    case 0x06:
      return amf3String(r);
    case 0x07:
    case 0x0b: {
      const header = r.u29();
      const referenced = byReference(header);
      if (referenced !== undefined) return referenced;
      const text = r.utf8(header >> 1);
      r.objects.push(text);
      return text;
    }
    case 0x08: {
      const header = r.u29();
      const referenced = byReference(header);
      if (referenced !== undefined) return referenced;
      const iso = isoDate(r.double());
      r.objects.push(iso);
      return iso;
    }
    case 0x09: {
      const header = r.u29();
      const referenced = byReference(header);
      if (referenced !== undefined) return referenced;

      const dense = header >> 1;
      const associative: { [key: string]: Json } = {};
      const items: Json[] = [];
      r.objects.push(items);

      for (;;) {
        const key = amf3String(r);
        if (key.length === 0) break;
        associative[key] = amf3Value(r, depth + 1);
      }
      for (let i = 0; i < dense; i++) items.push(amf3Value(r, depth + 1));

      if (Object.keys(associative).length === 0) return items;
      items.forEach((item, i) => {
        associative[String(i)] = item;
      });
      return associative;
    }
    case 0x0a: {
      const header = r.u29();
      const referenced = byReference(header);
      if (referenced !== undefined) return referenced;

      const traits = amf3Traits(r, header);
      const out: { [key: string]: Json } = {};
      if (traits.className.length > 0) out.$class = traits.className;
      r.objects.push(out);

      for (const name of traits.properties) out[name] = amf3Value(r, depth + 1);
      if (traits.dynamic) {
        for (;;) {
          const key = amf3String(r);
          if (key.length === 0) break;
          out[key] = amf3Value(r, depth + 1);
        }
      }
      return out;
    }
    case 0x0c: {
      const header = r.u29();
      const referenced = byReference(header);
      if (referenced !== undefined) return referenced;
      const length = header >> 1;
      r.need(length);
      const hex = Array.from(r.bytes.subarray(r.at, r.at + length), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('');
      r.at += length;
      r.objects.push(hex);
      return hex;
    }
    case 0x0d:
    case 0x0e:
    case 0x0f:
    case 0x10: {
      const header = r.u29();
      const referenced = byReference(header);
      if (referenced !== undefined) return referenced;
      const count = header >> 1;
      r.u8(); 
      if (marker === 0x10) amf3String(r); 
      const out: Json[] = [];
      r.objects.push(out);
      for (let i = 0; i < count; i++) {
        if (marker === 0x0d) out.push(r.i32());
        else if (marker === 0x0e) out.push(r.u32());
        else if (marker === 0x0f) out.push(r.double());
        else out.push(amf3Value(r, depth + 1));
      }
      return out;
    }
    case 0x11: {
      const header = r.u29();
      const referenced = byReference(header);
      if (referenced !== undefined) return referenced;
      const count = header >> 1;
      r.u8(); 
      const out: { [key: string]: Json } = {};
      r.objects.push(out);
      for (let i = 0; i < count; i++) {
        const key = amf3Value(r, depth + 1);
        out[typeof key === 'object' ? JSON.stringify(key) : String(key)] = amf3Value(r, depth + 1);
      }
      return out;
    }
    default:
      throw new OperationError(`Unknown AMF3 marker 0x${marker.toString(16)} at offset ${r.at - 1}.`);
  }
}


class Writer {
  private readonly chunks: number[] = [];

  byte(value: number): void {
    this.chunks.push(value & 0xff);
  }

  bytes(values: Uint8Array): void {
    for (const value of values) this.chunks.push(value);
  }

  u16(value: number): void {
    this.byte(value >> 8);
    this.byte(value);
  }

  u32(value: number): void {
    this.byte(value >>> 24);
    this.byte(value >>> 16);
    this.byte(value >>> 8);
    this.byte(value);
  }

  double(value: number): void {
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setFloat64(0, value);
    for (let i = 0; i < 8; i++) this.byte(buffer.getUint8(i));
  }

  u29(value: number): void {
    const v = value >>> 0;
    if (v < 0x80) {
      this.byte(v);
    } else if (v < 0x4000) {
      this.byte((v >> 7) | 0x80);
      this.byte(v & 0x7f);
    } else if (v < 0x200000) {
      this.byte((v >> 14) | 0x80);
      this.byte(((v >> 7) & 0x7f) | 0x80);
      this.byte(v & 0x7f);
    } else if (v < 0x20000000) {
      this.byte((v >> 22) | 0x80);
      this.byte(((v >> 15) & 0x7f) | 0x80);
      this.byte(((v >> 8) & 0x7f) | 0x80);
      this.byte(v & 0xff);
    } else {
      throw new OperationError('AMF3 integers hold 29 bits; this one does not fit.');
    }
  }

  finish(): string {
    return bytesToLatin1(new Uint8Array(this.chunks));
  }
}

function writeAmf0(w: Writer, value: Json, depth: number): void {
  if (depth > 64) throw new OperationError('The value nests more than 64 levels deep.');

  if (value === null) {
    w.byte(0x05);
  } else if (typeof value === 'boolean') {
    w.byte(0x01);
    w.byte(value ? 1 : 0);
  } else if (typeof value === 'number') {
    w.byte(0x00);
    w.double(value);
  } else if (typeof value === 'string') {
    const utf8 = new TextEncoder().encode(value);
    if (utf8.length > 0xffff) {
      w.byte(0x0c);
      w.u32(utf8.length);
    } else {
      w.byte(0x02);
      w.u16(utf8.length);
    }
    w.bytes(utf8);
  } else if (Array.isArray(value)) {
    w.byte(0x0a);
    w.u32(value.length);
    for (const item of value) writeAmf0(w, item, depth + 1);
  } else {
    w.byte(0x03);
    for (const [key, child] of Object.entries(value)) {
      const utf8 = new TextEncoder().encode(key);
      w.u16(utf8.length);
      w.bytes(utf8);
      writeAmf0(w, child, depth + 1);
    }
    w.u16(0);
    w.byte(0x09);
  }
}

function writeAmf3String(w: Writer, text: string): void {
  const utf8 = new TextEncoder().encode(text);
  w.u29((utf8.length << 1) | 1);
  w.bytes(utf8);
}

function writeAmf3(w: Writer, value: Json, depth: number): void {
  if (depth > 64) throw new OperationError('The value nests more than 64 levels deep.');

  if (value === null) {
    w.byte(0x01);
  } else if (value === true) {
    w.byte(0x03);
  } else if (value === false) {
    w.byte(0x02);
  } else if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= -0x10000000 && value <= 0x0fffffff) {
      w.byte(0x04);
      w.u29(value < 0 ? value + 0x20000000 : value);
    } else {
      w.byte(0x05);
      w.double(value);
    }
  } else if (typeof value === 'string') {
    w.byte(0x06);
    writeAmf3String(w, value);
  } else if (Array.isArray(value)) {
    w.byte(0x09);
    w.u29((value.length << 1) | 1);
    writeAmf3String(w, ''); 
    for (const item of value) writeAmf3(w, item, depth + 1);
  } else {
    w.byte(0x0a);
    w.u29(0x0b);
    writeAmf3String(w, '');
    for (const [key, child] of Object.entries(value)) {
      writeAmf3String(w, key);
      writeAmf3(w, child, depth + 1);
    }
    writeAmf3String(w, '');
  }
}

export const amfOperations: Operation[] = [
  {
    id: 'amf-decode',
    name: 'AMF Decode',
    category: 'Data format',
    description: 'Reads Adobe Action Message Format (AMF0 or AMF3) and writes it as JSON.',
    aliases: ['action message format', 'flash remoting', 'rtmp', 'amf0', 'amf3'],
    args: [
      { name: 'Format', type: 'option', value: 'AMF3', options: ['AMF3', 'AMF0'] },
      { name: 'Indent', type: 'number', value: 2, min: 0, max: 8 },
    ],
    run: (input, args) => {
      const bytes = asBytes(input);
      if (bytes.length === 0) throw new OperationError('No data to decode.');
      const reader = new Reader(bytes);
      const value =
        arg(args, 'Format', 'AMF3') === 'AMF0' ? amf0Value(reader, 0) : amf3Value(reader, 0);
      return JSON.stringify(value, null, Number(arg(args, 'Indent', 2)));
    },
  },
  {
    id: 'amf-encode',
    name: 'AMF Encode',
    category: 'Data format',
    description: 'Writes JSON as Adobe Action Message Format (AMF0 or AMF3).',
    aliases: ['action message format', 'flash remoting', 'amf0', 'amf3'],
    args: [{ name: 'Format', type: 'option', value: 'AMF3', options: ['AMF3', 'AMF0'] }],
    run: (input, args) => {
      let value: Json;
      try {
        value = JSON.parse(input) as Json;
      } catch (error) {
        throw new OperationError(
          `Not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
        );
      }
      const writer = new Writer();
      if (arg(args, 'Format', 'AMF3') === 'AMF0') writeAmf0(writer, value, 0);
      else writeAmf3(writer, value, 0);
      return writer.finish();
    },
  },
];
