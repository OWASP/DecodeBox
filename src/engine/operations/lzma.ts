import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';


const PROB_BITS = 11;
const PROB_INIT = 1 << (PROB_BITS - 1);
const MOVE_BITS = 5;
const TOP = 1 << 24;

const STATES = 12;
const MATCH_MIN_LEN = 2;
const END_POS_MODEL_INDEX = 14;
const FULL_DISTANCES = 1 << (END_POS_MODEL_INDEX >> 1);
const ALIGN_BITS = 4;


interface Model {
  lc: number;
  lp: number;
  pb: number;
  literal: Uint16Array;
  isMatch: Uint16Array;
  isRep: Uint16Array;
  isRepG0: Uint16Array;
  isRepG1: Uint16Array;
  isRepG2: Uint16Array;
  isRep0Long: Uint16Array;
  posSlot: Uint16Array;
  specPos: Uint16Array;
  align: Uint16Array;
  len: LengthModel;
  repLen: LengthModel;
}

interface LengthModel {
  choice: Uint16Array;
  low: Uint16Array;
  mid: Uint16Array;
  high: Uint16Array;
}

function lengthModel(): LengthModel {
  return {
    choice: new Uint16Array(2).fill(PROB_INIT),
    low: new Uint16Array(16 * 8).fill(PROB_INIT),
    mid: new Uint16Array(16 * 8).fill(PROB_INIT),
    high: new Uint16Array(256).fill(PROB_INIT),
  };
}

function makeModel(lc: number, lp: number, pb: number): Model {
  return {
    lc,
    lp,
    pb,
    literal: new Uint16Array(0x300 << (lc + lp)).fill(PROB_INIT),
    isMatch: new Uint16Array(STATES << 4).fill(PROB_INIT),
    isRep: new Uint16Array(STATES).fill(PROB_INIT),
    isRepG0: new Uint16Array(STATES).fill(PROB_INIT),
    isRepG1: new Uint16Array(STATES).fill(PROB_INIT),
    isRepG2: new Uint16Array(STATES).fill(PROB_INIT),
    isRep0Long: new Uint16Array(STATES << 4).fill(PROB_INIT),
    posSlot: new Uint16Array(4 * 64).fill(PROB_INIT),
    specPos: new Uint16Array(FULL_DISTANCES - END_POS_MODEL_INDEX).fill(PROB_INIT),
    align: new Uint16Array(1 << ALIGN_BITS).fill(PROB_INIT),
    len: lengthModel(),
    repLen: lengthModel(),
  };
}

const literalState = (state: number): number => (state < 4 ? 0 : state < 10 ? state - 3 : state - 6);
const matchState = (state: number): number => (state < 7 ? 7 : 10);
const repState = (state: number): number => (state < 7 ? 8 : 11);
const shortRepState = (state: number): number => (state < 7 ? 9 : 11);
const lenToPosState = (len: number): number => (len - 2 < 4 ? len - 2 : 3);


class RangeDecoder {
  range = 0xffffffff;
  code = 0;
  at = 0;

  constructor(private readonly bytes: Uint8Array) {
    if (bytes.length < 5) throw new OperationError('The compressed stream is too short to start.');
    if (bytes[0] !== 0) {
      throw new OperationError('The range coder does not start with the required zero byte.');
    }
    this.at = 1;
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.next()) >>> 0;
  }

  private next(): number {
    return this.at < this.bytes.length ? this.bytes[this.at++]! : 0;
  }

  private normalize(): void {
    if (this.range < TOP) {
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | this.next()) >>> 0;
    }
  }

  bit(probs: Uint16Array, index: number): number {
    const probability = probs[index]!;
    const bound = (this.range >>> PROB_BITS) * probability;

    if ((this.code >>> 0) < bound) {
      this.range = bound;
      probs[index] = probability + (((1 << PROB_BITS) - probability) >>> MOVE_BITS);
      this.normalize();
      return 0;
    }
    this.range = this.range - bound;
    this.code = (this.code - bound) >>> 0;
    probs[index] = probability - (probability >>> MOVE_BITS);
    this.normalize();
    return 1;
  }

  direct(count: number): number {
    let result = 0;
    for (let i = 0; i < count; i++) {
      this.range = this.range >>> 1;
      this.code = (this.code - this.range) >>> 0;
      const t = 0 - (this.code >>> 31);
      this.code = (this.code + (this.range & t)) >>> 0;
      this.normalize();
      result = ((result << 1) + t + 1) >>> 0;
    }
    return result;
  }

  tree(probs: Uint16Array, offset: number, bits: number): number {
    let value = 1;
    for (let i = 0; i < bits; i++) value = (value << 1) | this.bit(probs, offset + value);
    return value - (1 << bits);
  }

  reverseTree(probs: Uint16Array, offset: number, bits: number): number {
    let value = 1;
    let result = 0;
    for (let i = 0; i < bits; i++) {
      const bit = this.bit(probs, offset + value);
      value = (value << 1) | bit;
      result |= bit << i;
    }
    return result;
  }
}

class RangeEncoder {
  private readonly out: number[] = [];
  private low = 0n;
  private range = 0xffffffff;
  private cache = 0;
  private cacheSize = 1n;

  private shiftLow(): void {
    if (this.low < 0xff000000n || this.low > 0xffffffffn) {
      let carry = Number(this.low >> 32n);
      let byte = this.cache;
      do {
        this.out.push((byte + carry) & 0xff);
        byte = 0xff;
      } while (--this.cacheSize);
      this.cache = Number((this.low >> 24n) & 0xffn);
      carry = 0;
    }
    this.cacheSize++;
    this.low = (this.low << 8n) & 0xffffffffn;
  }

  bit(probs: Uint16Array, index: number, value: number): void {
    const probability = probs[index]!;
    const bound = (this.range >>> PROB_BITS) * probability;

    if (value === 0) {
      this.range = bound;
      probs[index] = probability + (((1 << PROB_BITS) - probability) >>> MOVE_BITS);
    } else {
      this.low += BigInt(bound);
      this.range = this.range - bound;
      probs[index] = probability - (probability >>> MOVE_BITS);
    }
    while (this.range < TOP) {
      this.range = (this.range << 8) >>> 0;
      this.shiftLow();
    }
  }

  direct(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      this.range = this.range >>> 1;
      if (((value >>> i) & 1) !== 0) this.low += BigInt(this.range);
      while (this.range < TOP) {
        this.range = (this.range << 8) >>> 0;
        this.shiftLow();
      }
    }
  }

  tree(probs: Uint16Array, offset: number, bits: number, value: number): void {
    let context = 1;
    for (let i = bits - 1; i >= 0; i--) {
      const bit = (value >>> i) & 1;
      this.bit(probs, offset + context, bit);
      context = (context << 1) | bit;
    }
  }

  reverseTree(probs: Uint16Array, offset: number, bits: number, value: number): void {
    let context = 1;
    for (let i = 0; i < bits; i++) {
      const bit = (value >>> i) & 1;
      this.bit(probs, offset + context, bit);
      context = (context << 1) | bit;
    }
  }

  finish(): Uint8Array {
    for (let i = 0; i < 5; i++) this.shiftLow();
    return new Uint8Array(this.out);
  }
}


function decodeLength(decoder: RangeDecoder, model: LengthModel, posState: number): number {
  if (decoder.bit(model.choice, 0) === 0) {
    return decoder.tree(model.low, posState * 8, 3) + MATCH_MIN_LEN;
  }
  if (decoder.bit(model.choice, 1) === 0) {
    return decoder.tree(model.mid, posState * 8, 3) + MATCH_MIN_LEN + 8;
  }
  return decoder.tree(model.high, 0, 8) + MATCH_MIN_LEN + 16;
}

function readProperties(byte: number): { lc: number; lp: number; pb: number } {
  if (byte >= 9 * 5 * 5) throw new OperationError(`${byte} is not a valid LZMA properties byte.`);
  const lc = byte % 9;
  const rest = Math.floor(byte / 9);
  return { lc, lp: rest % 5, pb: Math.floor(rest / 5) };
}

function decompress(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 13) throw new OperationError('An LZMA file starts with a 13-byte header.');

  const { lc, lp, pb } = readProperties(bytes[0]!);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dictSize = view.getUint32(1, true);
  const declared = view.getBigUint64(5, true);

  const unknownSize = declared === 0xffffffffffffffffn;
  if (!unknownSize && declared > 1n << 31n) {
    throw new OperationError(
      `This file declares ${declared} bytes, which is more than a browser tab can hold.`,
    );
  }
  void dictSize;

  const decoder = new RangeDecoder(bytes.subarray(13));
  const model = makeModel(lc, lp, pb);
  const posMask = (1 << pb) - 1;
  const literalMask = (1 << lp) - 1;

  const target = unknownSize ? Number.MAX_SAFE_INTEGER : Number(declared);
  const out: number[] = [];
  const reps = [0, 0, 0, 0];
  let state = 0;

  while (out.length < target) {
    const position = out.length;
    const posState = position & posMask;

    if (decoder.bit(model.isMatch, (state << 4) + posState) === 0) {
      const previous = position > 0 ? out[position - 1]! : 0;
      const offset =
        0x300 * (((position & literalMask) << lc) + (previous >> (8 - lc)));

      let symbol = 1;
      if (state >= 7) {
        let matched = out[position - reps[0]! - 1] ?? 0;
        do {
          const matchBit = (matched >> 7) & 1;
          matched = (matched << 1) & 0xff;
          const bit = decoder.bit(model.literal, offset + ((1 + matchBit) << 8) + symbol);
          symbol = (symbol << 1) | bit;
          if (matchBit !== bit) break;
        } while (symbol < 0x100);
      }
      while (symbol < 0x100) {
        symbol = (symbol << 1) | decoder.bit(model.literal, offset + symbol);
      }

      out.push(symbol & 0xff);
      state = literalState(state);
      continue;
    }

    let length: number;
    if (decoder.bit(model.isRep, state) !== 0) {
      if (position === 0) throw new OperationError('The stream repeats a match before there is one.');
      if (decoder.bit(model.isRepG0, state) === 0) {
        if (decoder.bit(model.isRep0Long, (state << 4) + posState) === 0) {
          state = shortRepState(state);
          out.push(out[position - reps[0]! - 1] ?? 0);
          continue;
        }
      } else {
        let distance: number;
        if (decoder.bit(model.isRepG1, state) === 0) {
          distance = reps[1]!;
        } else {
          if (decoder.bit(model.isRepG2, state) === 0) {
            distance = reps[2]!;
          } else {
            distance = reps[3]!;
            reps[3] = reps[2]!;
          }
          reps[2] = reps[1]!;
        }
        reps[1] = reps[0]!;
        reps[0] = distance;
      }
      length = decodeLength(decoder, model.repLen, posState);
      state = repState(state);
    } else {
      reps[3] = reps[2]!;
      reps[2] = reps[1]!;
      reps[1] = reps[0]!;
      length = decodeLength(decoder, model.len, posState);
      state = matchState(state);

      const slot = decoder.tree(model.posSlot, lenToPosState(length) * 64, 6);
      if (slot < 4) {
        reps[0] = slot;
      } else {
        const directBits = (slot >> 1) - 1;
        let distance = (2 | (slot & 1)) << directBits;
        if (slot < END_POS_MODEL_INDEX) {
          distance += decoder.reverseTree(model.specPos, distance - slot, directBits);
        } else {
          distance += decoder.direct(directBits - ALIGN_BITS) * (1 << ALIGN_BITS);
          distance += decoder.reverseTree(model.align, 0, ALIGN_BITS);
        }
        reps[0] = distance >>> 0;
      }

      if (reps[0] === 0xffffffff) break; 
      if (reps[0]! >= position + 1) {
        throw new OperationError('A match points before the start of the data.');
      }
    }

    for (let i = 0; i < length && out.length < target; i++) {
      out.push(out[out.length - reps[0]! - 1]!);
    }
  }

  if (!unknownSize && out.length !== Number(declared)) {
    throw new OperationError(
      `The header declares ${declared} bytes but the stream produced ${out.length}: it is truncated.`,
    );
  }
  return new Uint8Array(out);
}


const posSlotOf = (distance: number): number => {
  if (distance < 4) return distance;
  let bits = 31;
  while (bits > 0 && (distance & (1 << bits)) === 0) bits--;
  return (bits << 1) | ((distance >>> (bits - 1)) & 1);
};

function encodeLength(
  encoder: RangeEncoder,
  model: LengthModel,
  length: number,
  posState: number,
): void {
  const value = length - MATCH_MIN_LEN;
  if (value < 8) {
    encoder.bit(model.choice, 0, 0);
    encoder.tree(model.low, posState * 8, 3, value);
  } else if (value < 16) {
    encoder.bit(model.choice, 0, 1);
    encoder.bit(model.choice, 1, 0);
    encoder.tree(model.mid, posState * 8, 3, value - 8);
  } else {
    encoder.bit(model.choice, 0, 1);
    encoder.bit(model.choice, 1, 1);
    encoder.tree(model.high, 0, 8, value - 16);
  }
}

const HASH_BITS = 16;
const MAX_MATCH_LEN = 273;
const MAX_CHAIN = 32;

function findMatch(
  data: Uint8Array,
  position: number,
  head: Int32Array,
  chain: Int32Array,
): { length: number; distance: number } {
  let bestLength = 0;
  let bestDistance = 0;
  if (position + 2 >= data.length) return { length: 0, distance: 0 };

  const hash =
    ((data[position]! << 10) ^ (data[position + 1]! << 5) ^ data[position + 2]!) &
    ((1 << HASH_BITS) - 1);
  let candidate = head[hash]!;
  let steps = 0;

  while (candidate >= 0 && steps++ < MAX_CHAIN) {
    const distance = position - candidate;
    if (distance <= 0 || distance > (1 << 24)) break;

    let length = 0;
    const limit = Math.min(MAX_MATCH_LEN, data.length - position);
    while (length < limit && data[candidate + length] === data[position + length]) length++;

    if (length > bestLength) {
      bestLength = length;
      bestDistance = distance;
      if (length >= limit) break;
    }
    candidate = chain[candidate & 0xffff]!;
  }

  chain[position & 0xffff] = head[hash]!;
  head[hash] = position;
  return { length: bestLength, distance: bestDistance };
}

function compress(data: Uint8Array, lc: number, lp: number, pb: number): Uint8Array {
  const encoder = new RangeEncoder();
  const model = makeModel(lc, lp, pb);
  const posMask = (1 << pb) - 1;
  const literalMask = (1 << lp) - 1;

  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const chain = new Int32Array(0x10000).fill(-1);

  const reps = [0, 0, 0, 0];
  let state = 0;
  let position = 0;

  while (position < data.length) {
    const posState = position & posMask;
    const found = findMatch(data, position, head, chain);

    const useMatch = found.length >= 3 && found.distance > 0;

    if (!useMatch) {
      encoder.bit(model.isMatch, (state << 4) + posState, 0);

      const previous = position > 0 ? data[position - 1]! : 0;
      const offset = 0x300 * (((position & literalMask) << lc) + (previous >> (8 - lc)));
      const byte = data[position]!;

      let context = 1;
      if (state >= 7) {
        const matched = data[position - reps[0]! - 1] ?? 0;
        let i = 7;
        for (; i >= 0; i--) {
          const matchBit = (matched >> i) & 1;
          const bit = (byte >> i) & 1;
          encoder.bit(model.literal, offset + ((1 + matchBit) << 8) + context, bit);
          context = (context << 1) | bit;
          if (matchBit !== bit) {
            i--;
            break;
          }
        }
        for (; i >= 0; i--) {
          const bit = (byte >> i) & 1;
          encoder.bit(model.literal, offset + context, bit);
          context = (context << 1) | bit;
        }
      } else {
        for (let i = 7; i >= 0; i--) {
          const bit = (byte >> i) & 1;
          encoder.bit(model.literal, offset + context, bit);
          context = (context << 1) | bit;
        }
      }

      state = literalState(state);
      position++;
      continue;
    }

    encoder.bit(model.isMatch, (state << 4) + posState, 1);
    encoder.bit(model.isRep, state, 0);

    const length = found.length;
    const distance = found.distance - 1;

    encodeLength(encoder, model.len, length, posState);
    state = matchState(state);

    const slot = posSlotOf(distance);
    encoder.tree(model.posSlot, lenToPosState(length) * 64, 6, slot);

    if (slot >= 4) {
      const directBits = (slot >> 1) - 1;
      const base = (2 | (slot & 1)) << directBits;
      if (slot < END_POS_MODEL_INDEX) {
        encoder.reverseTree(model.specPos, base - slot, directBits, distance - base);
      } else {
        encoder.direct((distance - base) >>> ALIGN_BITS, directBits - ALIGN_BITS);
        encoder.reverseTree(model.align, 0, ALIGN_BITS, (distance - base) & ((1 << ALIGN_BITS) - 1));
      }
    }

    reps[3] = reps[2]!;
    reps[2] = reps[1]!;
    reps[1] = reps[0]!;
    reps[0] = distance;

    for (let i = 1; i < length; i++) {
      if (position + i + 2 < data.length) findMatch(data, position + i, head, chain);
    }
    position += length;
  }

  return encoder.finish();
}

export const lzmaOperations: Operation[] = [
  {
    id: 'lzma-decompress',
    name: 'LZMA Decompress',
    category: 'Compression',
    description: 'Decompresses a plain .lzma stream, the format 7-Zip writes without a container.',
    aliases: ['unlzma', 'lzma decode', '7z lzma'],
    budgetMs: 30000,
    args: [],
    run: (input) => bytesToLatin1(decompress(asBytes(input))),
    detection: { magic: '5d00', formatName: 'LZMA', minLength: 13 },
  },
  {
    id: 'lzma-compress',
    name: 'LZMA Compress',
    category: 'Compression',
    description: 'Compresses data as a plain .lzma stream with a 13-byte header.',
    aliases: ['lzma', 'lzma encode'],
    budgetMs: 30000,
    args: [
      { name: 'Literal context bits (lc)', type: 'number', value: 3, min: 0, max: 8 },
      { name: 'Literal position bits (lp)', type: 'number', value: 0, min: 0, max: 4 },
      { name: 'Position bits (pb)', type: 'number', value: 2, min: 0, max: 4 },
      { name: 'Dictionary size', type: 'number', value: 1 << 23, min: 4096 },
    ],
    run: (input, args) => {
      const data = asBytes(input);
      const lc = Number(arg(args, 'Literal context bits (lc)', 3));
      const lp = Number(arg(args, 'Literal position bits (lp)', 0));
      const pb = Number(arg(args, 'Position bits (pb)', 2));
      if (lc + lp > 4) {
        throw new OperationError('lc + lp must be 4 or less, or the literal model does not fit.');
      }

      const body = compress(data, lc, lp, pb);
      const out = new Uint8Array(13 + body.length);
      out[0] = (pb * 5 + lp) * 9 + lc;

      const view = new DataView(out.buffer);
      view.setUint32(1, Number(arg(args, 'Dictionary size', 1 << 23)), true);
      view.setBigUint64(5, BigInt(data.length), true);
      out.set(body, 13);
      return bytesToLatin1(out);
    },
  },
];
