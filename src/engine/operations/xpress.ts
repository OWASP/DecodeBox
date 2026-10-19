import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';


class Input {
  at = 0;

  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.at;
  }

  byte(): number {
    if (this.at >= this.bytes.length) {
      throw new OperationError('The compressed data ends in the middle of an item.');
    }
    return this.bytes[this.at++]!;
  }

  u16(): number {
    return this.byte() | (this.byte() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
}

const MAX_OUTPUT = 64 * 1024 * 1024;

function grow(out: number[], length: number): void {
  if (out.length + length > MAX_OUTPUT) {
    throw new OperationError('This data expands past 64 MB, which is more than a tab should hold.');
  }
}


function decompressLz77(bytes: Uint8Array): Uint8Array {
  const input = new Input(bytes);
  const out: number[] = [];

  let flags = 0;
  let flagsLeft = 0;
  let halfByteAt = -1;

  while (input.remaining > 0 || flagsLeft > 0) {
    if (flagsLeft === 0) {
      if (input.remaining < 4) break;
      flags = input.u32();
      flagsLeft = 32;
    }
    flagsLeft--;

    if ((flags & (1 << flagsLeft)) === 0) {
      if (input.remaining === 0) break;
      grow(out, 1);
      out.push(input.byte());
      continue;
    }

    if (input.remaining === 0) break;
    const header = input.u16();
    let length = header & 7;
    const offset = (header >> 3) + 1;

    if (length === 7) {
      if (halfByteAt < 0) {
        halfByteAt = input.at;
        length = input.byte() & 0x0f;
      } else {
        length = bytes[halfByteAt]! >> 4;
        halfByteAt = -1;
      }

      if (length === 15) {
        length = input.byte();
        if (length === 255) {
          length = input.u16();
          if (length === 0) length = input.u32();
          if (length < 15 + 7) {
            throw new OperationError('A match declares a length shorter than its own encoding.');
          }
          length -= 15 + 7;
        }
        length += 15;
      }
      length += 7;
    }
    length += 3;

    if (offset > out.length) {
      throw new OperationError(
        `A match points ${offset} bytes back, but only ${out.length} have been produced.`,
      );
    }
    grow(out, length);
    for (let i = 0; i < length; i++) out.push(out[out.length - offset]!);
  }

  return new Uint8Array(out);
}


const SYMBOLS = 512;
const CHUNK = 65536;

interface Huffman {
  first: Int32Array;
  offset: Int32Array;
  count: Int32Array;
  sorted: Int32Array;
  maxLength: number;
}

function buildHuffman(lengths: Uint8Array): Huffman {
  const count = new Int32Array(16);
  for (const length of lengths) if (length > 0) count[length]! += 1;

  const first = new Int32Array(16);
  const offset = new Int32Array(16);
  let code = 0;
  let index = 0;
  let maxLength = 0;

  for (let length = 1; length < 16; length++) {
    first[length] = code;
    offset[length] = index;
    code = (code + count[length]!) << 1;
    index += count[length]!;
    if (count[length]! > 0) maxLength = length;
  }

  const sorted = new Int32Array(index);
  const cursor = offset.slice();
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol]!;
    if (length > 0) sorted[cursor[length]!++] = symbol;
  }

  return { first, offset, count, sorted, maxLength };
}

class BitReader {
  private buffer = 0;
  private bits = 0;

  constructor(private readonly input: Input) {
    this.buffer = ((this.word() << 16) | this.word()) >>> 0;
    this.bits = 16;
  }

  overrun = 0;

  private word(): number {
    if (this.input.remaining < 2) {
      this.overrun += 2;
      return 0;
    }
    return this.input.u16();
  }

  peek(count: number): number {
    return count === 0 ? 0 : this.buffer >>> (32 - count);
  }

  skip(count: number): void {
    this.buffer = (this.buffer << count) >>> 0;
    this.bits -= count;
    if (this.bits <= 0) {
      this.buffer = (this.buffer | (this.word() << -this.bits)) >>> 0;
      this.bits += 16;
    }
  }

  take(count: number): number {
    const value = this.peek(count);
    this.skip(count);
    return value;
  }

  byte(): number {
    if (this.input.remaining === 0) {
      this.overrun += 1;
      return 0;
    }
    return this.input.byte();
  }

  u16(): number {
    return this.byte() | (this.byte() << 8);
  }
}

function decodeSymbol(reader: BitReader, table: Huffman): number {
  let code = 0;
  for (let length = 1; length <= table.maxLength; length++) {
    code = (code << 1) | reader.take(1);
    const available = table.count[length]!;
    const first = table.first[length]!;
    if (available > 0 && code >= first && code - first < available) {
      const symbol = table.sorted[table.offset[length]! + (code - first)];
      if (symbol !== undefined) return symbol;
    }
  }
  throw new OperationError('A Huffman code in this chunk is not in the table.');
}

function decodeItem(reader: BitReader, table: Huffman, out: number[]): void {
  const symbol = decodeSymbol(reader, table);
  if (symbol < 256) {
    grow(out, 1);
    out.push(symbol);
    return;
  }

  const value = symbol - 256;
  let length = value & 0x0f;
  const offsetBits = value >> 4;

  if (length === 15) {
    length = reader.byte() + 15;
    if (length === 270) length = reader.u16();
  }
  const offset = (1 << offsetBits) | reader.take(offsetBits);
  length += 3;

  if (offset > out.length) {
    throw new OperationError(
      `A match points ${offset} bytes back, but only ${out.length} have been produced.`,
    );
  }
  grow(out, length);
  for (let i = 0; i < length; i++) out.push(out[out.length - offset]!);
}

function decompressHuffman(bytes: Uint8Array, expected: number): Uint8Array {
  const input = new Input(bytes);
  const out: number[] = [];

  while (input.remaining > 256 && (expected === 0 || out.length < expected)) {
    const lengths = new Uint8Array(SYMBOLS);
    for (let i = 0; i < 256; i++) {
      const byte = input.byte();
      lengths[i * 2] = byte & 0x0f;
      lengths[i * 2 + 1] = byte >> 4;
    }
    const table = buildHuffman(lengths);
    if (table.sorted.length === 0) {
      throw new OperationError('A chunk declares a Huffman table with no symbols in it.');
    }

    const reader = new BitReader(input);
    const chunkStart = out.length;
    const limit = expected > 0 ? Math.min(CHUNK, expected - chunkStart) : CHUNK;

    while (out.length - chunkStart < limit) {
      if (reader.overrun >= 4) break;
      try {
        decodeItem(reader, table, out);
      } catch (error) {
        if (reader.overrun > 0) break;
        throw error;
      }
    }
  }

  if (out.length === 0) {
    throw new OperationError('No chunk was found: an XPRESS Huffman stream starts with a 256-byte table.');
  }
  return new Uint8Array(expected > 0 ? out.slice(0, expected) : out);
}

export const xpressOperations: Operation[] = [
  {
    id: 'xpress-decompress',
    name: 'XPRESS Decompress',
    category: 'Compression',
    description: "Decompresses Microsoft's plain LZ77 XPRESS, used throughout Windows.",
    aliases: ['ms-xca', 'xpress lz77', 'windows compression', 'rtldecompressbuffer'],
    budgetMs: 30000,
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      if (bytes.length < 4) throw new OperationError('There is not even a flag word here.');
      return bytesToLatin1(decompressLz77(bytes));
    },
  },
  {
    id: 'xpress-huffman-decompress',
    name: 'XPRESS LZ77+Huffman Decompress',
    category: 'Compression',
    description: "Decompresses Microsoft's XPRESS Huffman variant, one 64 KiB chunk at a time.",
    aliases: ['ms-xca huffman', 'xpress huff', 'windows compression huffman'],
    budgetMs: 30000,
    args: [
      {
        name: 'Decompressed size',
        type: 'number',
        value: 0,
        min: 0,
        hint: 'The format does not record it; 0 decodes until the stream runs out',
      },
    ],
    run: (input, args) => {
      const bytes = asBytes(input);
      if (bytes.length < 257) {
        throw new OperationError('An XPRESS Huffman chunk starts with a 256-byte table of code lengths.');
      }
      return bytesToLatin1(decompressHuffman(bytes, Math.max(0, Number(arg(args, 'Decompressed size', 0)))));
    },
  },
];
