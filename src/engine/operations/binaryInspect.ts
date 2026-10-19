import { OperationError } from '../types';
import { asBytes } from '../core/bytes';
import { arg, type Operation } from './types';



type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const APPLE_EPOCH = 978307200;

class Reader {
  constructor(
    readonly bytes: Uint8Array,
    readonly view: DataView,
  ) {}

  int(at: number, size: number): number {
    let value = 0;
    for (let i = 0; i < size; i++) {
      const byte = this.bytes[at + i];
      if (byte === undefined) throw new OperationError('The file ends inside an integer.');
      value = value * 256 + byte;
    }
    return value;
  }
}

function isoDate(seconds: number): string {
  const millis = (seconds + APPLE_EPOCH) * 1000;
  if (!Number.isFinite(millis) || Math.abs(millis) > 8.64e15) return `(date out of range: ${seconds})`;
  return new Date(millis).toISOString();
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function readBinaryPlist(bytes: Uint8Array): Json {
  if (bytes.length < 40) throw new OperationError('A binary property list is at least 40 bytes.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r = new Reader(bytes, view);

  const trailer = bytes.length - 32;
  const offsetSize = bytes[trailer + 6]!;
  const refSize = bytes[trailer + 7]!;
  const count = r.int(trailer + 8, 8);
  const top = r.int(trailer + 16, 8);
  const tableAt = r.int(trailer + 24, 8);

  if (offsetSize === 0 || refSize === 0) throw new OperationError('The trailer declares a zero-byte size.');
  if (count > 1_000_000) throw new OperationError(`${count} objects is more than this can be.`);
  if (tableAt + count * offsetSize > bytes.length) {
    throw new OperationError('The offset table runs past the end of the file.');
  }

  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(r.int(tableAt + i * offsetSize, offsetSize));

  const seen = new Set<number>();

  const lengthAt = (at: number): { length: number; next: number } => {
    const low = bytes[at]! & 0x0f;
    if (low !== 0x0f) return { length: low, next: at + 1 };
    const sizeMarker = bytes[at + 1]!;
    if ((sizeMarker & 0xf0) !== 0x10) throw new OperationError('A length field is not an integer.');
    const size = 1 << (sizeMarker & 0x0f);
    return { length: r.int(at + 2, size), next: at + 2 + size };
  };

  const readObject = (index: number, depth: number): Json => {
    if (depth > 64) throw new OperationError('The property list nests more than 64 levels deep.');
    if (seen.has(index)) throw new OperationError('The property list refers back to itself.');

    const at = offsets[index];
    if (at === undefined || at >= bytes.length) {
      throw new OperationError(`Object ${index} is outside the file.`);
    }
    const marker = bytes[at]!;
    const kind = marker >> 4;

    switch (kind) {
      case 0x0:
        if (marker === 0x00) return null;
        if (marker === 0x08) return false;
        if (marker === 0x09) return true;
        if (marker === 0x0f) return null; 
        throw new OperationError(`Marker 0x${marker.toString(16)} is not one the format defines.`);
      case 0x1: {
        const size = 1 << (marker & 0x0f);
        if (size === 8) return Number(view.getBigInt64(at + 1));
        return r.int(at + 1, size);
      }
      case 0x2:
        return (marker & 0x0f) === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1);
      case 0x3:
        return isoDate(view.getFloat64(at + 1));
      case 0x4: {
        const { length, next } = lengthAt(at);
        return hex(bytes.subarray(next, next + length));
      }
      case 0x5: {
        const { length, next } = lengthAt(at);
        return new TextDecoder('ascii').decode(bytes.subarray(next, next + length));
      }
      case 0x6: {
        const { length, next } = lengthAt(at);
        return new TextDecoder('utf-16be').decode(bytes.subarray(next, next + length * 2));
      }
      case 0x8:
        return `UID ${r.int(at + 1, (marker & 0x0f) + 1)}`;
      case 0xa:
      case 0xc: {
        const { length, next } = lengthAt(at);
        seen.add(index);
        const out: Json[] = [];
        for (let i = 0; i < length; i++) out.push(readObject(r.int(next + i * refSize, refSize), depth + 1));
        seen.delete(index);
        return out;
      }
      case 0xd: {
        const { length, next } = lengthAt(at);
        seen.add(index);
        const out: { [key: string]: Json } = {};
        for (let i = 0; i < length; i++) {
          const key = readObject(r.int(next + i * refSize, refSize), depth + 1);
          const value = readObject(r.int(next + length * refSize + i * refSize, refSize), depth + 1);
          out[typeof key === 'string' ? key : JSON.stringify(key)] = value;
        }
        seen.delete(index);
        return out;
      }
      default:
        throw new OperationError(`Marker 0x${marker.toString(16)} is not one the format defines.`);
    }
  };

  return readObject(top, 0);
}

function readXmlPlist(text: string): Json {
  const tags = /<(\/?)([a-zA-Z]+)([^>]*)>|([^<]+)/g;
  const stack: Array<{ name: string; value: Json; pendingKey?: string }> = [];
  let result: Json = null;
  let text_ = '';
  let match: RegExpExecArray | null;

  const place = (value: Json): void => {
    const top = stack[stack.length - 1];
    if (!top) {
      result = value;
      return;
    }
    if (Array.isArray(top.value)) top.value.push(value);
    else if (top.pendingKey !== undefined) {
      (top.value as { [key: string]: Json })[top.pendingKey] = value;
      top.pendingKey = undefined;
    } else {
      throw new OperationError('A value appeared in a dict without a key before it.');
    }
  };

  while ((match = tags.exec(text)) !== null) {
    const [, closing, name, attributes, content] = match;
    if (content !== undefined) {
      text_ += content;
      continue;
    }

    const selfClosing = (attributes ?? '').trim().endsWith('/');
    const tag = name!.toLowerCase();

    if (closing === '/' || selfClosing) {
      const body = text_
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
      text_ = '';

      switch (tag) {
        case 'key': {
          const top = stack[stack.length - 1];
          if (!top || Array.isArray(top.value)) throw new OperationError('A key appeared outside a dict.');
          top.pendingKey = body;
          break;
        }
        case 'string':
          place(body);
          break;
        case 'integer':
          place(Number.parseInt(body.trim(), 10));
          break;
        case 'real':
          place(Number.parseFloat(body.trim()));
          break;
        case 'true':
          place(true);
          break;
        case 'false':
          place(false);
          break;
        case 'data': {
          const cleaned = body.replace(/\s+/g, '');
          try {
            place(hex(Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0))));
          } catch {
            throw new OperationError('A <data> element is not valid Base64.');
          }
          break;
        }
        case 'date':
          place(body.trim());
          break;
        case 'dict':
        case 'array': {
          if (selfClosing) {
            place(tag === 'dict' ? {} : []);
            break;
          }
          const finished = stack.pop();
          if (!finished) throw new OperationError(`A </${tag}> closes nothing.`);
          place(finished.value);
          break;
        }
        default:
          break; 
      }
      continue;
    }

    text_ = '';
    if (tag === 'dict') stack.push({ name: tag, value: {} });
    else if (tag === 'array') stack.push({ name: tag, value: [] });
  }

  if (stack.length > 0) throw new OperationError('The XML ends with an element still open.');
  return result;
}


const ELF_TYPES: Record<number, string> = {
  0: 'NONE',
  1: 'REL (relocatable object)',
  2: 'EXEC (executable)',
  3: 'DYN (shared object or PIE executable)',
  4: 'CORE (core dump)',
};

const ELF_MACHINES: Record<number, string> = {
  0x02: 'SPARC',
  0x03: 'x86',
  0x08: 'MIPS',
  0x14: 'PowerPC',
  0x15: 'PowerPC 64',
  0x16: 'S/390',
  0x28: 'ARM',
  0x2a: 'SuperH',
  0x32: 'IA-64',
  0x3e: 'x86-64',
  0xb7: 'AArch64',
  0xf3: 'RISC-V',
};

const ELF_OS: Record<number, string> = {
  0: 'System V',
  1: 'HP-UX',
  2: 'NetBSD',
  3: 'Linux',
  6: 'Solaris',
  9: 'FreeBSD',
  12: 'OpenBSD',
};

const SECTION_TYPES: Record<number, string> = {
  0: 'NULL',
  1: 'PROGBITS',
  2: 'SYMTAB',
  3: 'STRTAB',
  4: 'RELA',
  5: 'HASH',
  6: 'DYNAMIC',
  7: 'NOTE',
  8: 'NOBITS',
  9: 'REL',
  11: 'DYNSYM',
  14: 'INIT_ARRAY',
  15: 'FINI_ARRAY',
  0x6ffffff6: 'GNU_HASH',
  0x6fffffff: 'GNU_versym',
  0x6ffffffe: 'GNU_verneed',
};

const SEGMENT_TYPES: Record<number, string> = {
  0: 'NULL',
  1: 'LOAD',
  2: 'DYNAMIC',
  3: 'INTERP',
  4: 'NOTE',
  6: 'PHDR',
  7: 'TLS',
  0x6474e550: 'GNU_EH_FRAME',
  0x6474e551: 'GNU_STACK',
  0x6474e552: 'GNU_RELRO',
};

function readElf(bytes: Uint8Array, wanted: string): string {
  if (bytes.length < 52 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
    throw new OperationError("Not an ELF file: it does not start with 0x7F 'ELF'.");
  }

  const is64 = bytes[4] === 2;
  const little = bytes[5] !== 2;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const u16 = (at: number): number => view.getUint16(at, little);
  const u32 = (at: number): number => view.getUint32(at, little);
  const addr = (at: number): number =>
    is64 ? Number(view.getBigUint64(at, little)) : view.getUint32(at, little);

  const entry = addr(is64 ? 24 : 24);
  const phoff = addr(is64 ? 32 : 28);
  const shoff = addr(is64 ? 40 : 32);
  const phentsize = u16(is64 ? 54 : 42);
  const phnum = u16(is64 ? 56 : 44);
  const shentsize = u16(is64 ? 58 : 46);
  const shnum = u16(is64 ? 60 : 48);
  const shstrndx = u16(is64 ? 62 : 50);

  const lines = [
    'ELF header',
    `  Class:        ${is64 ? '64-bit' : '32-bit'}`,
    `  Byte order:   ${little ? 'little-endian' : 'big-endian'}`,
    `  OS ABI:       ${ELF_OS[bytes[7]!] ?? `unknown (${bytes[7]})`}`,
    `  Type:         ${ELF_TYPES[u16(16)] ?? `unknown (${u16(16)})`}`,
    `  Machine:      ${ELF_MACHINES[u16(18)] ?? `unknown (0x${u16(18).toString(16)})`}`,
    `  Entry point:  0x${entry.toString(16)}`,
    `  Sections:     ${shnum} at 0x${shoff.toString(16)}`,
    `  Segments:     ${phnum} at 0x${phoff.toString(16)}`,
  ];

  const cString = (at: number): string => {
    let end = at;
    while (end < bytes.length && bytes[end] !== 0) end++;
    return new TextDecoder('ascii').decode(bytes.subarray(at, end));
  };

  let stringTable = -1;
  if (shstrndx < shnum && shoff > 0 && shoff + (shstrndx + 1) * shentsize <= bytes.length) {
    stringTable = addr(shoff + shstrndx * shentsize + (is64 ? 24 : 16));
  }

  const wantSections = wanted === 'Everything' || wanted === 'Sections';
  const wantSegments = wanted === 'Everything' || wanted === 'Segments';

  if (wantSections && shnum > 0 && shoff > 0) {
    lines.push('', 'Sections', '  Name                 Type          Address      Size');
    for (let i = 0; i < Math.min(shnum, 200); i++) {
      const at = shoff + i * shentsize;
      if (at + shentsize > bytes.length) break;
      const nameOffset = u32(at);
      const name = stringTable >= 0 ? cString(stringTable + nameOffset) : `#${i}`;
      const type = u32(at + 4);
      const address = addr(at + (is64 ? 16 : 12));
      const size = addr(at + (is64 ? 32 : 20));
      lines.push(
        `  ${name.padEnd(20)} ${(SECTION_TYPES[type] ?? String(type)).padEnd(13)} ` +
          `0x${address.toString(16).padStart(8, '0')}   ${size}`,
      );
    }
  }

  if (wantSegments && phnum > 0 && phoff > 0) {
    lines.push('', 'Segments', '  Type          Flags  Offset       Virtual      Size');
    for (let i = 0; i < Math.min(phnum, 100); i++) {
      const at = phoff + i * phentsize;
      if (at + phentsize > bytes.length) break;
      const type = u32(at);
      const flags = is64 ? u32(at + 4) : u32(at + 24);
      const offset = addr(at + (is64 ? 8 : 4));
      const virtual = addr(at + (is64 ? 16 : 8));
      const size = addr(at + (is64 ? 32 : 16));
      const rwx = `${flags & 4 ? 'r' : '-'}${flags & 2 ? 'w' : '-'}${flags & 1 ? 'x' : '-'}`;
      lines.push(
        `  ${(SEGMENT_TYPES[type] ?? `0x${type.toString(16)}`).padEnd(13)} ${rwx}    ` +
          `0x${offset.toString(16).padStart(8, '0')}   0x${virtual.toString(16).padStart(8, '0')}   ${size}`,
      );

      if (type === 3) {
        lines.push(`      interpreter: ${cString(offset)}`);
      }
    }
  }

  return lines.join('\n');
}

export const binaryInspectOperations: Operation[] = [
  {
    id: 'plist-viewer',
    name: 'P-list Viewer',
    category: 'Other',
    description: "Reads an Apple property list, binary or XML, and writes it as JSON.",
    aliases: ['plist', 'bplist', 'apple property list', 'macos config'],
    budgetMs: 20000,
    args: [{ name: 'Indent', type: 'number', value: 2, min: 0, max: 8 }],
    run: (input, args) => {
      const bytes = asBytes(input);
      const isBinary = new TextDecoder('ascii').decode(bytes.subarray(0, 8)) === 'bplist00';
      const value = isBinary ? readBinaryPlist(bytes) : readXmlPlist(input);

      if (!isBinary && value === null && !/<plist/i.test(input)) {
        throw new OperationError(
          "That is neither a binary property list (which starts with 'bplist00') nor an XML one.",
        );
      }
      return JSON.stringify(value, null, Number(arg(args, 'Indent', 2)));
    },
    detection: { magic: '62706c697374', formatName: 'binary plist', minLength: 40 },
  },
  {
    id: 'elf-info',
    name: 'ELF Info',
    category: 'Forensics',
    description: 'Reads the header, sections and segments of an ELF binary.',
    aliases: ['readelf', 'elf header', 'linux binary', 'so file'],
    budgetMs: 20000,
    args: [
      {
        name: 'Show',
        type: 'option',
        value: 'Everything',
        options: ['Everything', 'Header only', 'Sections', 'Segments'],
      },
    ],
    run: (input, args) => readElf(asBytes(input), String(arg(args, 'Show', 'Everything'))),
    detection: { magic: '7f454c46', formatName: 'ELF', minLength: 52 },
  },
];
