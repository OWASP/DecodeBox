import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';


const BLOCK_MAGIC = 0x314159265359n;
const END_MAGIC = 0x177245385090n;


class BitReader {
  private at = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get exhausted(): boolean {
    return this.at >= this.bytes.length * 8;
  }

  bit(): number {
    if (this.at >= this.bytes.length * 8) {
      throw new OperationError('The stream ends in the middle of a block.');
    }
    const byte = this.bytes[this.at >> 3]!;
    const bit = (byte >> (7 - (this.at & 7))) & 1;
    this.at++;
    return bit;
  }

  bits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value * 2 + this.bit()) >>> 0;
    return value;
  }

  big(count: number): bigint {
    let value = 0n;
    for (let i = 0; i < count; i++) value = (value << 1n) | BigInt(this.bit());
    return value;
  }
}

class BitWriter {
  private readonly out: number[] = [];
  private current = 0;
  private filled = 0;

  bit(value: number): void {
    this.current = (this.current << 1) | (value & 1);
    if (++this.filled === 8) {
      this.out.push(this.current & 0xff);
      this.current = 0;
      this.filled = 0;
    }
  }

  bits(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bit((value >>> i) & 1);
  }

  big(value: bigint, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bit(Number((value >> BigInt(i)) & 1n));
  }

  finish(): Uint8Array {
    while (this.filled !== 0) this.bit(0);
    return new Uint8Array(this.out);
  }
}


const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i << 24;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 0x80000000) !== 0 ? (value << 1) ^ 0x04c11db7 : value << 1;
    }
    table[i] = value;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) | 0;
  }
  return ~crc >>> 0;
}


interface Table {
  limit: Int32Array;
  base: Int32Array;
  perm: Int32Array;
  minLen: number;
  maxLen: number;
}

function buildTable(lengths: number[], alphaSize: number): Table {
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);
  const limit = new Int32Array(25);
  const base = new Int32Array(25);
  const perm = new Int32Array(alphaSize);

  let pp = 0;
  for (let length = minLen; length <= maxLen; length++) {
    for (let symbol = 0; symbol < alphaSize; symbol++) {
      if (lengths[symbol] === length) perm[pp++] = symbol;
    }
  }
  for (let i = 0; i < alphaSize; i++) {
    const slot = lengths[i]! + 1;
    base[slot] = base[slot]! + 1;
  }
  for (let i = 1; i < 25; i++) base[i] = base[i]! + base[i - 1]!;

  let vec = 0;
  for (let length = minLen; length <= maxLen; length++) {
    vec += base[length + 1]! - base[length]!;
    limit[length] = vec - 1;
    vec <<= 1;
  }
  for (let length = minLen + 1; length <= maxLen; length++) {
    base[length] = ((limit[length - 1]! + 1) << 1) - base[length]!;
  }

  return { limit, base, perm, minLen, maxLen };
}

function readSymbol(reader: BitReader, table: Table): number {
  let length = table.minLen;
  let vec = reader.bits(length);
  while (length <= 23 && vec > table.limit[length]!) {
    length++;
    vec = (vec << 1) | reader.bit();
  }
  const index = vec - table.base[length]!;
  const symbol = table.perm[index];
  if (symbol === undefined) throw new OperationError('A Huffman code in this block is not valid.');
  return symbol;
}

function inverseBwt(block: Uint8Array, origPtr: number): Uint8Array {
  const counts = new Int32Array(257);
  for (const byte of block) counts[byte + 1] = counts[byte + 1]! + 1;
  for (let i = 1; i < 257; i++) counts[i] = counts[i]! + counts[i - 1]!;

  const next = new Int32Array(block.length);
  const cursor = counts.slice();
  for (let i = 0; i < block.length; i++) {
    const byte = block[i]!;
    next[cursor[byte]!] = i;
    cursor[byte] = cursor[byte]! + 1;
  }

  const out = new Uint8Array(block.length);
  let position = next[origPtr]!;
  for (let i = 0; i < block.length; i++) {
    out[i] = block[position]!;
    position = next[position]!;
  }
  return out;
}

function undoRle(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i]!;
    let run = 1;
    while (run < 4 && i + run < bytes.length && bytes[i + run] === byte) run++;
    for (let k = 0; k < run; k++) out.push(byte);
    i += run;
    if (run === 4) {
      if (i >= bytes.length) throw new OperationError('A run in this block has no length byte.');
      const extra = bytes[i++]!;
      for (let k = 0; k < extra; k++) out.push(byte);
    }
  }
  return new Uint8Array(out);
}

function decodeBlock(reader: BitReader, blockSize: number): { data: Uint8Array; crc: number } {
  const crc = reader.bits(32);
  if (reader.bit() !== 0) {
    throw new OperationError(
      'This block is marked randomised, a deprecated mode no encoder has produced since 1996.',
    );
  }
  const origPtr = reader.bits(24);

  const used: number[] = [];
  const groups = reader.bits(16);
  for (let group = 0; group < 16; group++) {
    if ((groups & (1 << (15 - group))) === 0) continue;
    const members = reader.bits(16);
    for (let bit = 0; bit < 16; bit++) {
      if ((members & (1 << (15 - bit))) !== 0) used.push(group * 16 + bit);
    }
  }
  if (used.length === 0) throw new OperationError('This block declares no symbols at all.');

  const alphaSize = used.length + 2;
  const groupCount = reader.bits(3);
  const selectorCount = reader.bits(15);
  if (groupCount < 2 || groupCount > 6) {
    throw new OperationError(`A block declares ${groupCount} Huffman tables; bzip2 allows 2 to 6.`);
  }

  const selectorMtf: number[] = [];
  for (let i = 0; i < selectorCount; i++) {
    let value = 0;
    while (reader.bit() === 1) {
      if (++value >= groupCount) throw new OperationError('A table selector is out of range.');
    }
    selectorMtf.push(value);
  }
  const order = Array.from({ length: groupCount }, (_, i) => i);
  const selectors = selectorMtf.map((value) => {
    const picked = order.splice(value, 1)[0]!;
    order.unshift(picked);
    return picked;
  });

  const tables: Table[] = [];
  for (let group = 0; group < groupCount; group++) {
    let length = reader.bits(5);
    const lengths: number[] = [];
    for (let symbol = 0; symbol < alphaSize; symbol++) {
      for (;;) {
        if (length < 1 || length > 20) throw new OperationError('A Huffman code length is out of range.');
        if (reader.bit() === 0) break;
        length += reader.bit() === 0 ? 1 : -1;
      }
      lengths.push(length);
    }
    tables.push(buildTable(lengths, alphaSize));
  }

  const mtf = used.slice();
  const block = new Uint8Array(blockSize);
  let written = 0;
  let selector = 0;
  let inGroup = 0;
  let table = tables[selectors[0] ?? 0]!;
  const eob = alphaSize - 1;

  let runLength = 0;
  let runBit = 0;

  for (;;) {
    if (inGroup === 0) {
      const chosen = selectors[selector++];
      if (chosen === undefined) throw new OperationError('The block ran out of table selectors.');
      table = tables[chosen]!;
      inGroup = 50;
    }
    inGroup--;

    const symbol = readSymbol(reader, table);

    if (symbol <= 1) {
      runLength += (symbol + 1) << runBit;
      runBit++;
      continue;
    }

    if (runLength > 0) {
      if (written + runLength > blockSize) throw new OperationError('A block is longer than its declared size.');
      block.fill(mtf[0]!, written, written + runLength);
      written += runLength;
      runLength = 0;
      runBit = 0;
    }

    if (symbol === eob) break;

    const index = symbol - 1;
    const byte = mtf.splice(index, 1)[0]!;
    mtf.unshift(byte);
    if (written >= blockSize) throw new OperationError('A block is longer than its declared size.');
    block[written++] = byte;
  }

  if (origPtr >= written) throw new OperationError('The block pointer points outside the block.');
  const data = undoRle(inverseBwt(block.subarray(0, written), origPtr));

  const actual = crc32(data);
  if (actual !== crc) {
    throw new OperationError(
      `A block's checksum is ${crc.toString(16)} but its data gives ${actual.toString(16)}: it is corrupt.`,
    );
  }
  return { data, crc };
}

function decompress(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0x42 || bytes[1] !== 0x5a || bytes[2] !== 0x68) {
    throw new OperationError("Not a bzip2 stream: it does not start with 'BZh'.");
  }
  const level = bytes[3]! - 0x30;
  if (level < 1 || level > 9) {
    throw new OperationError(`'${String.fromCharCode(bytes[3]!)}' is not a bzip2 block size.`);
  }

  const reader = new BitReader(bytes.subarray(4));
  const pieces: Uint8Array[] = [];
  let combined = 0;

  for (;;) {
    const magic = reader.big(48);
    if (magic === END_MAGIC) {
      const declared = reader.bits(32);
      if (declared !== combined) {
        throw new OperationError(
          `The stream checksum is ${declared.toString(16)} but the data gives ${combined.toString(16)}: it is corrupt.`,
        );
      }
      break;
    }
    if (magic !== BLOCK_MAGIC) {
      throw new OperationError('A block does not begin with the expected marker.');
    }

    const piece = decodeBlock(reader, level * 100000);
    combined = (((combined << 1) | (combined >>> 31)) ^ piece.crc) >>> 0;
    pieces.push(piece.data);

    if (reader.exhausted) break;
  }

  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.length;
  }
  return out;
}


function burrowsWheeler(block: Uint8Array): { last: Uint8Array; origPtr: number } {
  const n = block.length;
  const order = Array.from({ length: n }, (_, i) => i);
  let rank = Array.from(block, (byte) => byte);
  let next = new Array<number>(n);

  for (let k = 1; k < n; k *= 2) {
    const compare = (a: number, b: number): number =>
      rank[a]! - rank[b]! || rank[(a + k) % n]! - rank[(b + k) % n]!;
    order.sort(compare);

    next[order[0]!] = 0;
    for (let i = 1; i < n; i++) {
      next[order[i]!] = next[order[i - 1]!]! + (compare(order[i - 1]!, order[i]!) !== 0 ? 1 : 0);
    }
    rank = next;
    next = new Array<number>(n);
    if (rank[order[n - 1]!] === n - 1) break; 
  }

  const last = new Uint8Array(n);
  let origPtr = 0;
  for (let i = 0; i < n; i++) {
    const start = order[i]!;
    last[i] = block[(start + n - 1) % n]!;
    if (start === 0) origPtr = i;
  }
  return { last, origPtr };
}

function applyRle(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i]!;
    let run = 1;
    while (run < 255 + 4 && i + run < bytes.length && bytes[i + run] === byte) run++;
    if (run < 4) {
      for (let k = 0; k < run; k++) out.push(byte);
    } else {
      out.push(byte, byte, byte, byte, run - 4);
    }
    i += run;
  }
  return new Uint8Array(out);
}

function codeLengths(frequencies: number[], limit: number): number[] {
  const alphaSize = frequencies.length;
  let weights = frequencies.map((f) => Math.max(1, f));

  for (;;) {
    const nodes = weights.map((weight, symbol) => ({ weight, symbol, left: -1, right: -1 }));
    const heap = nodes.map((_, i) => i);
    const all = [...nodes];

    const pop = (): number => {
      let best = 0;
      for (let i = 1; i < heap.length; i++) {
        if (all[heap[i]!]!.weight < all[heap[best]!]!.weight) best = i;
      }
      return heap.splice(best, 1)[0]!;
    };

    while (heap.length > 1) {
      const a = pop();
      const b = pop();
      all.push({ weight: all[a]!.weight + all[b]!.weight, symbol: -1, left: a, right: b });
      heap.push(all.length - 1);
    }

    const lengths = new Array<number>(alphaSize).fill(0);
    const walk = (index: number, depth: number): void => {
      const node = all[index]!;
      if (node.symbol >= 0) {
        lengths[node.symbol] = Math.max(1, depth);
        return;
      }
      walk(node.left, depth + 1);
      walk(node.right, depth + 1);
    };
    walk(heap[0]!, 0);

    if (Math.max(...lengths) <= limit) return lengths;
    weights = weights.map((weight) => 1 + (weight >> 1));
  }
}

function canonicalCodes(lengths: number[]): number[] {
  const codes = new Array<number>(lengths.length).fill(0);
  let code = 0;
  const maxLen = Math.max(...lengths);
  for (let length = Math.min(...lengths); length <= maxLen; length++) {
    for (let symbol = 0; symbol < lengths.length; symbol++) {
      if (lengths[symbol] === length) codes[symbol] = code++;
    }
    code <<= 1;
  }
  return codes;
}

function compress(bytes: Uint8Array, level: number): Uint8Array {
  const writer = new BitWriter();
  writer.bits(0x42, 8);
  writer.bits(0x5a, 8);
  writer.bits(0x68, 8);
  writer.bits(0x30 + level, 8);

  const blockSize = level * 100000;
  let combined = 0;

  for (let start = 0; start < bytes.length; start += blockSize) {
    const raw = bytes.subarray(start, Math.min(start + blockSize, bytes.length));
    const blockCrc = crc32(raw);
    combined = (((combined << 1) | (combined >>> 31)) ^ blockCrc) >>> 0;

    const rle = applyRle(raw);
    const { last, origPtr } = burrowsWheeler(rle);

    const present = new Array<boolean>(256).fill(false);
    for (const byte of last) present[byte] = true;
    const used = present.map((yes, byte) => (yes ? byte : -1)).filter((byte) => byte >= 0);
    const alphaSize = used.length + 2;
    const eob = alphaSize - 1;

    const mtf = used.slice();
    const symbols: number[] = [];
    let zeros = 0;
    const flush = (): void => {
      if (zeros === 0) return;
      let pending = zeros - 1;
      for (;;) {
        symbols.push(pending & 1 ? 1 : 0);
        if (pending < 2) break;
        pending = (pending - 2) >> 1;
      }
      zeros = 0;
    };

    for (const byte of last) {
      const index = mtf.indexOf(byte);
      if (index === 0) {
        zeros++;
        continue;
      }
      flush();
      mtf.splice(index, 1);
      mtf.unshift(byte);
      symbols.push(index + 1);
    }
    flush();
    symbols.push(eob);

    const frequencies = new Array<number>(alphaSize).fill(0);
    for (const symbol of symbols) frequencies[symbol] = frequencies[symbol]! + 1;
    const lengths = codeLengths(frequencies, 20);
    const codes = canonicalCodes(lengths);

    writer.big(BLOCK_MAGIC, 48);
    writer.bits(blockCrc, 32);
    writer.bit(0);
    writer.bits(origPtr, 24);

    let groupMask = 0;
    for (const byte of used) groupMask |= 1 << (15 - (byte >> 4));
    writer.bits(groupMask, 16);
    for (let group = 0; group < 16; group++) {
      if ((groupMask & (1 << (15 - group))) === 0) continue;
      let members = 0;
      for (const byte of used) {
        if (byte >> 4 === group) members |= 1 << (15 - (byte & 15));
      }
      writer.bits(members, 16);
    }

    const selectorCount = Math.ceil(symbols.length / 50);
    writer.bits(2, 3);
    writer.bits(selectorCount, 15);
    for (let i = 0; i < selectorCount; i++) writer.bit(0); 

    for (let table = 0; table < 2; table++) {
      let current = lengths[0]!;
      writer.bits(current, 5);
      for (const length of lengths) {
        while (current < length) {
          writer.bit(1);
          writer.bit(0);
          current++;
        }
        while (current > length) {
          writer.bit(1);
          writer.bit(1);
          current--;
        }
        writer.bit(0);
      }
    }

    for (const symbol of symbols) writer.bits(codes[symbol]!, lengths[symbol]!);
  }

  writer.big(END_MAGIC, 48);
  writer.bits(combined, 32);
  return writer.finish();
}

export const bzip2Operations: Operation[] = [
  {
    id: 'bzip2-decompress',
    name: 'Bzip2 Decompress',
    category: 'Compression',
    description: 'Decompresses a bzip2 stream, checking both the block and stream checksums.',
    aliases: ['bunzip2', 'bz2 decompress', 'unbzip'],
    budgetMs: 30000,
    args: [],
    run: (input) => bytesToLatin1(decompress(asBytes(input))),
    detection: { magic: '425a68', formatName: 'bzip2', minLength: 10 },
  },
  {
    id: 'bzip2-compress',
    name: 'Bzip2 Compress',
    category: 'Compression',
    description: 'Compresses data as a bzip2 stream.',
    aliases: ['bzip2', 'bz2 compress'],
    budgetMs: 30000,
    args: [
      {
        name: 'Block size (100k units)',
        type: 'number',
        value: 9,
        min: 1,
        max: 9,
        hint: 'Larger blocks compress better and sort slower',
      },
    ],
    run: (input, args) => {
      const bytes = asBytes(input);
      if (bytes.length === 0) throw new OperationError('There is nothing to compress.');
      const level = Math.min(9, Math.max(1, Number(arg(args, 'Block size (100k units)', 9))));
      return bytesToLatin1(compress(bytes, level));
    },
  },
];
