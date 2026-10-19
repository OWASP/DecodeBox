import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';


const utf8 = new TextEncoder();

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

class Bytes {
  private parts: number[] = [];

  push(...values: number[]): void {
    for (const value of values) this.parts.push(value & 0xff);
  }

  add(values: Uint8Array | number[]): void {
    for (const value of values) this.parts.push(value & 0xff);
  }

  le(value: number, width: number): void {
    for (let i = 0; i < width; i++) this.parts.push(Math.floor(value / 256 ** i) & 0xff);
  }

  get length(): number {
    return this.parts.length;
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}


const TAR_BLOCK = 512;

function tarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(TAR_BLOCK);
  const write = (text: string, at: number, width: number) => {
    const bytes = utf8.encode(text.slice(0, width - 1));
    header.set(bytes, at);
  };

  write(name, 0, 100);
  write('000644 ', 100, 8);
  write('000000 ', 108, 8);
  write('000000 ', 116, 8);
  write(`${size.toString(8).padStart(11, '0')} `, 124, 12);
  write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')} `, 136, 12);
  header[156] = 0x30;
  write('ustar  ', 257, 8);

  header.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of header) sum += byte;
  write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return header;
}


const LZ4_MAGIC = 0x184d2204;

function lz4CompressBlock(bytes: Uint8Array): Uint8Array {
  const out = new Bytes();
  const hashTable = new Int32Array(4096).fill(-1);
  const hashAt = (at: number) =>
    (((bytes[at] as number) |
      ((bytes[at + 1] as number) << 8) |
      ((bytes[at + 2] as number) << 16) |
      ((bytes[at + 3] as number) << 24)) *
      2654435761) >>>
    20;

  let anchor = 0;
  let at = 0;

  const emit = (literalEnd: number, matchLength: number, offset: number) => {
    const literals = literalEnd - anchor;
    const token = (Math.min(literals, 15) << 4) | Math.min(matchLength, 15);
    out.push(token);
    if (literals >= 15) {
      let rest = literals - 15;
      while (rest >= 255) {
        out.push(255);
        rest -= 255;
      }
      out.push(rest);
    }
    out.add(bytes.subarray(anchor, literalEnd));
    if (offset === 0) return;
    out.push(offset & 0xff, (offset >> 8) & 0xff);
    if (matchLength >= 15) {
      let rest = matchLength - 15;
      while (rest >= 255) {
        out.push(255);
        rest -= 255;
      }
      out.push(rest);
    }
  };

  while (at + 12 < bytes.length) {
    const hash = hashAt(at);
    const candidate = hashTable[hash] as number;
    hashTable[hash] = at;

    if (
      candidate >= 0 &&
      at - candidate < 65536 &&
      bytes[candidate] === bytes[at] &&
      bytes[candidate + 1] === bytes[at + 1] &&
      bytes[candidate + 2] === bytes[at + 2] &&
      bytes[candidate + 3] === bytes[at + 3]
    ) {
      let length = 4;
      while (
        at + length < bytes.length - 5 &&
        bytes[candidate + length] === bytes[at + length]
      ) {
        length++;
      }
      emit(at, length - 4, at - candidate);
      at += length;
      anchor = at;
      continue;
    }
    at++;
  }
  emit(bytes.length, 0, 0);
  return out.toBytes();
}

function lz4DecompressBlock(bytes: Uint8Array, out: number[]): void {
  let at = 0;
  while (at < bytes.length) {
    const token = bytes[at++] as number;
    let literals = token >> 4;
    if (literals === 15) {
      let more = 255;
      while (more === 255 && at < bytes.length) {
        more = bytes[at++] as number;
        literals += more;
      }
    }
    for (let i = 0; i < literals && at < bytes.length; i++) out.push(bytes[at++] as number);
    if (at + 1 >= bytes.length) break;

    const offset = (bytes[at++] as number) | ((bytes[at++] as number) << 8);
    if (offset === 0) throw new OperationError('An LZ4 match has an offset of zero.');
    let length = token & 0x0f;
    if (length === 15) {
      let more = 255;
      while (more === 255 && at < bytes.length) {
        more = bytes[at++] as number;
        length += more;
      }
    }
    length += 4;

    const start = out.length - offset;
    if (start < 0) throw new OperationError('An LZ4 match points before the start of the data.');
    for (let i = 0; i < length; i++) out.push(out[start + i] as number);
  }
}


const LZSTRING_KEYS: Record<string, string> = {
  Base64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=',
  'URI encoded': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$',
};

const LZSTRING_FORMATS = ['Base64', 'URI encoded', 'UTF-16', 'Raw'];

function lzStringCompress(input: string, bitsPerChar: number, toChar: (n: number) => string): string {
  if (input === '') return '';

  const dictionary = new Map<string, number>();
  const pending = new Set<string>();
  const data: string[] = [];
  let value = 0;
  let position = 0;
  let word = '';
  let enlargeIn = 2;
  let dictSize = 3;
  let numBits = 2;

  const writeBit = (bit: number) => {
    value = (value << 1) | bit;
    if (position === bitsPerChar - 1) {
      position = 0;
      data.push(toChar(value));
      value = 0;
    } else {
      position++;
    }
  };
  const writeBits = (n: number, count: number) => {
    let rest = n;
    for (let i = 0; i < count; i++) {
      writeBit(rest & 1);
      rest >>= 1;
    }
  };
  const grow = () => {
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  };

  for (const char of input) {
    if (!dictionary.has(char)) {
      dictionary.set(char, dictSize++);
      pending.add(char);
    }
    const extended = word + char;
    if (dictionary.has(extended)) {
      word = extended;
      continue;
    }

    if (pending.has(word)) {
      const code = word.charCodeAt(0);
      if (code < 256) {
        writeBits(0, numBits);
        writeBits(code, 8);
      } else {
        writeBit(1);
        writeBits(0, numBits - 1);
        writeBits(code, 16);
      }
      grow();
      pending.delete(word);
    } else {
      writeBits(dictionary.get(word) as number, numBits);
    }
    grow();
    dictionary.set(extended, dictSize++);
    word = char;
  }

  if (word !== '') {
    if (pending.has(word)) {
      const code = word.charCodeAt(0);
      if (code < 256) {
        writeBits(0, numBits);
        writeBits(code, 8);
      } else {
        writeBit(1);
        writeBits(0, numBits - 1);
        writeBits(code, 16);
      }
      grow();
      pending.delete(word);
    } else {
      writeBits(dictionary.get(word) as number, numBits);
    }
    grow();
  }

  writeBits(2, numBits);
  for (;;) {
    value <<= 1;
    if (position === bitsPerChar - 1) {
      data.push(toChar(value));
      break;
    }
    position++;
  }
  return data.join('');
}

function lzStringDecompress(length: number, resetValue: number, at: (index: number) => number): string {
  const dictionary: string[] = ['0', '1', '2'];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let entry = '';
  const result: string[] = [];

  let position = resetValue;
  let index = 0;
  let value = at(0);

  const readBits = (count: number): number => {
    let out = 0;
    let power = 1;
    for (let i = 0; i < count; i++) {
      const resb = value & position;
      position >>= 1;
      if (position === 0) {
        position = resetValue;
        value = at(++index);
      }
      out |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }
    return out;
  };

  let word: string;
  const first = readBits(2);
  if (first === 0) word = String.fromCharCode(readBits(8));
  else if (first === 1) word = String.fromCharCode(readBits(16));
  else return '';

  dictionary[3] = word;
  result.push(word);

  for (;;) {
    if (index > length) return '';
    const code = readBits(numBits);

    if (code === 0) {
      dictionary[dictSize++] = String.fromCharCode(readBits(8));
      enlargeIn--;
    } else if (code === 1) {
      dictionary[dictSize++] = String.fromCharCode(readBits(16));
      enlargeIn--;
    } else if (code === 2) {
      return result.join('');
    }
    if (code === 0 || code === 1) {
      if (enlargeIn === 0) {
        enlargeIn = 2 ** numBits;
        numBits++;
      }
      entry = dictionary[dictSize - 1] as string;
    } else if (dictionary[code] !== undefined) {
      entry = dictionary[code] as string;
    } else if (code === dictSize) {
      entry = word + word.charAt(0);
    } else {
      throw new OperationError('The compressed stream refers to an unknown dictionary entry.');
    }

    result.push(entry);
    dictionary[dictSize++] = word + entry.charAt(0);
    enlargeIn--;
    word = entry;

    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}


function lznt1Decompress(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let at = 0;

  while (at + 1 < bytes.length) {
    const header = (bytes[at] as number) | ((bytes[at + 1] as number) << 8);
    at += 2;
    if (header === 0) break;

    const size = (header & 0x0fff) + 1;
    const compressed = (header & 0x8000) !== 0;
    const end = Math.min(at + size, bytes.length);

    if (!compressed) {
      for (; at < end; at++) out.push(bytes[at] as number);
      continue;
    }

    const chunkStart = out.length;
    while (at < end) {
      const flags = bytes[at++] as number;
      for (let bit = 0; bit < 8 && at < end; bit++) {
        if ((flags & (1 << bit)) === 0) {
          out.push(bytes[at++] as number);
          continue;
        }
        const pair = (bytes[at] as number) | ((bytes[at + 1] as number) << 8);
        at += 2;

        let shift = 12;
        let limit = 16;
        while (out.length - chunkStart > limit) {
          shift--;
          limit <<= 1;
        }
        const length = (pair & ((1 << shift) - 1)) + 3;
        const offset = (pair >> shift) + 1;
        const from = out.length - offset;
        if (from < 0) throw new OperationError('An LZNT1 reference points before the chunk.');
        for (let i = 0; i < length; i++) out.push(out[from + i] as number);
      }
    }
  }
  return new Uint8Array(out);
}

export const archiveOperations: Operation[] = [
  {
    id: 'zip',
    name: 'Zip',
    category: 'Compression',
    description: 'Puts the input into a ZIP archive as a single named file.',
    aliases: ['create zip', 'archive'],
    args: [
      { name: 'Filename', type: 'string', value: 'file.txt' },
      { name: 'Comment', type: 'string', value: '' },
      {
        name: 'Compression method',
        type: 'option',
        value: 'Deflate',
        options: ['Deflate', 'None (Store)'],
      },
    ],
    run: async (input, args) => {
      const name = String(arg(args, 'Filename', 'file.txt')) || 'file.txt';
      const comment = String(arg(args, 'Comment', ''));
      const deflated = String(arg(args, 'Compression method', 'Deflate')) === 'Deflate';

      const content = asBytes(input);
      const body = deflated ? await deflateRaw(content) : content;
      const nameBytes = utf8.encode(name);
      const crc = crc32(content);

      const local = new Bytes();
      local.add(utf8.encode('PK\x03\x04'));
      local.le(20, 2);
      local.le(0, 2);
      local.le(deflated ? 8 : 0, 2);
      local.le(0, 2);
      local.le(0, 2);
      local.le(crc, 4);
      local.le(body.length, 4);
      local.le(content.length, 4);
      local.le(nameBytes.length, 2);
      local.le(0, 2);
      local.add(nameBytes);
      local.add(body);

      const central = new Bytes();
      central.add(utf8.encode('PK\x01\x02'));
      central.le(20, 2);
      central.le(20, 2);
      central.le(0, 2);
      central.le(deflated ? 8 : 0, 2);
      central.le(0, 2);
      central.le(0, 2);
      central.le(crc, 4);
      central.le(body.length, 4);
      central.le(content.length, 4);
      central.le(nameBytes.length, 2);
      central.le(0, 2);
      central.le(0, 2);
      central.le(0, 2);
      central.le(0, 2);
      central.le(0, 4);
      central.le(0, 4);
      central.add(nameBytes);

      const end = new Bytes();
      const commentBytes = utf8.encode(comment);
      end.add(utf8.encode('PK\x05\x06'));
      end.le(0, 2);
      end.le(0, 2);
      end.le(1, 2);
      end.le(1, 2);
      end.le(central.length, 4);
      end.le(local.length, 4);
      end.le(commentBytes.length, 2);
      end.add(commentBytes);

      const out = new Bytes();
      out.add(local.toBytes());
      out.add(central.toBytes());
      out.add(end.toBytes());
      return bytesToLatin1(out.toBytes());
    },
  },
  {
    id: 'tar',
    name: 'Tar',
    category: 'Compression',
    description: 'Puts the input into a tar archive as a single named file.',
    aliases: ['create tar', 'tarball'],
    args: [{ name: 'Filename', type: 'string', value: 'file.txt' }],
    run: (input, args) => {
      const name = String(arg(args, 'Filename', 'file.txt')) || 'file.txt';
      const content = asBytes(input);
      const out = new Bytes();

      out.add(tarHeader(name, content.length));
      out.add(content);
      const padding = (TAR_BLOCK - (content.length % TAR_BLOCK)) % TAR_BLOCK;
      out.add(new Uint8Array(padding));
      out.add(new Uint8Array(TAR_BLOCK * 2));
      return bytesToLatin1(out.toBytes());
    },
  },
  {
    id: 'untar',
    name: 'Untar',
    category: 'Compression',
    description: 'Lists the files in a tar archive, or extracts one of them.',
    aliases: ['extract tar', 'open tarball'],
    args: [{ name: 'File to extract', type: 'string', value: '', hint: 'Blank to list them all' }],
    run: (input, args) => {
      const bytes = asBytes(input);
      const wanted = String(arg(args, 'File to extract', '')).trim();
      const listing: string[] = [];

      for (let at = 0; at + TAR_BLOCK <= bytes.length; ) {
        const header = bytes.subarray(at, at + TAR_BLOCK);
        if (header.every((byte) => byte === 0)) break;

        const name = bytesToLatin1(header.subarray(0, 100)).replace(/\0.*$/, '');
        const sizeText = bytesToLatin1(header.subarray(124, 136)).replace(/[^0-7]/g, '');
        const size = sizeText === '' ? 0 : parseInt(sizeText, 8);
        const start = at + TAR_BLOCK;

        if (name === '') break;
        if (wanted !== '' && name === wanted) {
          return bytesToLatin1(bytes.subarray(start, start + size));
        }
        listing.push(`${String(size).padStart(10)}  ${name}`);
        at = start + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
      }

      if (listing.length === 0) throw new OperationError('No tar members found.');
      if (wanted !== '') throw new OperationError(`'${wanted}' is not in this archive.`);
      return listing.join('\n');
    },
    detection: {
      minLength: 512,
      test: (_text, bytes) =>
        bytesToLatin1(bytes.subarray(257, 262)) === 'ustar'
          ? { label: 'tar', detail: "The 'ustar' magic sits at offset 257 of a tar header." }
          : null,
    },
  },
  {
    id: 'lz4-compress',
    name: 'LZ4 Compress',
    category: 'Compression',
    description: 'Compresses the input as an LZ4 frame.',
    aliases: ['lz4'],
    args: [],
    run: (input) => {
      const content = asBytes(input);
      const block = lz4CompressBlock(content);
      const stored = block.length >= content.length;
      const body = stored ? content : block;

      const out = new Bytes();
      out.le(LZ4_MAGIC, 4);
      out.push(0x60, 0x70, 0x73);
      out.le(stored ? body.length | 0x80000000 : body.length, 4);
      out.add(body);
      out.le(0, 4);
      return bytesToLatin1(out.toBytes());
    },
  },
  {
    id: 'lz4-decompress',
    name: 'LZ4 Decompress',
    category: 'Compression',
    description: 'Decompresses an LZ4 frame.',
    aliases: ['lz4 decode', 'unlz4'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      if (bytes.length < 7) throw new OperationError('Too short to be an LZ4 frame.');
      const magic = bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! * 0x1000000);
      if (magic !== LZ4_MAGIC) throw new OperationError('This is not an LZ4 frame.');

      const flags = bytes[4] as number;
      const contentSize = (flags & 0x08) !== 0;
      let at = 7 + (contentSize ? 8 : 0);

      const out: number[] = [];
      while (at + 4 <= bytes.length) {
        const size =
          (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! * 0x1000000)) >>> 0;
        at += 4;
        if (size === 0) break;

        const uncompressed = (size & 0x80000000) !== 0;
        const length = size & 0x7fffffff;
        const block = bytes.subarray(at, at + length);
        at += length;
        if (uncompressed) for (const byte of block) out.push(byte);
        else lz4DecompressBlock(block, out);
      }
      return bytesToLatin1(new Uint8Array(out));
    },
    detection: {
      magic: '04224d18',
      minLength: 8,
      formatName: 'LZ4',
    },
  },
  {
    id: 'lzstring-compress',
    name: 'LZString Compress',
    category: 'Compression',
    description: 'Compresses text with lz-string, the coder made for browser storage.',
    aliases: ['lz-string', 'localstorage compress'],
    args: [
      { name: 'Compression format', type: 'option', value: 'Base64', options: LZSTRING_FORMATS },
    ],
    run: (input, args) => {
      const format = String(arg(args, 'Compression format', 'Base64'));
      const key = LZSTRING_KEYS[format];
      if (key) {
        const compressed = lzStringCompress(input, 6, (n) => key.charAt(n));
        return format === 'Base64' ? compressed + '='.repeat((4 - (compressed.length % 4)) % 4) : compressed;
      }
      if (format === 'UTF-16') {
        return `${lzStringCompress(input, 15, (n) => String.fromCharCode(n + 32))} `;
      }
      return lzStringCompress(input, 16, (n) => String.fromCharCode(n));
    },
  },
  {
    id: 'lzstring-decompress',
    name: 'LZString Decompress',
    category: 'Compression',
    description: 'Decompresses text produced by lz-string.',
    aliases: ['lz-string decode', 'localstorage decompress'],
    args: [
      { name: 'Compression format', type: 'option', value: 'Base64', options: LZSTRING_FORMATS },
    ],
    run: (input, args) => {
      const format = String(arg(args, 'Compression format', 'Base64'));
      if (input === '') return '';

      const key = LZSTRING_KEYS[format];
      if (key) {
        const lookup = new Map<string, number>();
        for (let i = 0; i < key.length; i++) if (!lookup.has(key[i] as string)) lookup.set(key[i] as string, i);
        const text = format === 'URI encoded' ? input.replace(/ /g, '+') : input;
        return lzStringDecompress(text.length, 32, (i) => lookup.get(text.charAt(i) ?? '') ?? 0);
      }
      if (format === 'UTF-16') {
        return lzStringDecompress(input.length, 16384, (i) => input.charCodeAt(i) - 32);
      }
      return lzStringDecompress(input.length, 32768, (i) => input.charCodeAt(i));
    },
  },
  {
    id: 'lznt1-decompress',
    name: 'LZNT1 Decompress',
    category: 'Compression',
    description: 'Decompresses the LZNT1 stream Windows uses in hives and shadow copies.',
    aliases: ['lznt1', 'windows compression', 'registry'],
    args: [],
    run: (input) => bytesToLatin1(lznt1Decompress(asBytes(input))),
  },
];
