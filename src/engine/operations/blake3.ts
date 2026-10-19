import { OperationError } from '../types';
import { asBytes, toBytes } from '../core/bytes';
import { arg, toggle, type Operation } from './types';


const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];

const CHUNK_START = 1;
const CHUNK_END = 2;
const PARENT = 4;
const ROOT = 8;
const KEYED_HASH = 16;
const DERIVE_KEY_CONTEXT = 32;
const DERIVE_KEY_MATERIAL = 64;

const BLOCK_BYTES = 64;
const CHUNK_BYTES = 1024;

const rotr = (value: number, bits: number): number =>
  ((value >>> bits) | (value << (32 - bits))) >>> 0;

function g(state: Uint32Array, a: number, b: number, c: number, d: number, mx: number, my: number): void {
  state[a] = (state[a]! + state[b]! + mx) >>> 0;
  state[d] = rotr(state[d]! ^ state[a]!, 16);
  state[c] = (state[c]! + state[d]!) >>> 0;
  state[b] = rotr(state[b]! ^ state[c]!, 12);
  state[a] = (state[a]! + state[b]! + my) >>> 0;
  state[d] = rotr(state[d]! ^ state[a]!, 8);
  state[c] = (state[c]! + state[d]!) >>> 0;
  state[b] = rotr(state[b]! ^ state[c]!, 7);
}

function round(state: Uint32Array, m: Uint32Array): void {
  g(state, 0, 4, 8, 12, m[0]!, m[1]!);
  g(state, 1, 5, 9, 13, m[2]!, m[3]!);
  g(state, 2, 6, 10, 14, m[4]!, m[5]!);
  g(state, 3, 7, 11, 15, m[6]!, m[7]!);
  g(state, 0, 5, 10, 15, m[8]!, m[9]!);
  g(state, 1, 6, 11, 12, m[10]!, m[11]!);
  g(state, 2, 7, 8, 13, m[12]!, m[13]!);
  g(state, 3, 4, 9, 14, m[14]!, m[15]!);
}

function compress(
  cv: Uint32Array,
  block: Uint32Array,
  counter: bigint,
  blockLength: number,
  flags: number,
): Uint32Array {
  const state = new Uint32Array(16);
  state.set(cv.subarray(0, 8), 0);
  state.set(IV.slice(0, 4), 8);
  state[12] = Number(counter & 0xffffffffn);
  state[13] = Number((counter >> 32n) & 0xffffffffn);
  state[14] = blockLength;
  state[15] = flags;

  const m = new Uint32Array(block);
  for (let i = 0; i < 7; i++) {
    round(state, m);
    if (i === 6) break;
    const permuted = new Uint32Array(16);
    for (let k = 0; k < 16; k++) permuted[k] = m[PERMUTATION[k]!]!;
    m.set(permuted);
  }

  for (let i = 0; i < 8; i++) {
    state[i] = state[i]! ^ state[i + 8]!;
    state[i + 8] = state[i + 8]! ^ cv[i]!;
  }
  return state;
}

function wordsFrom(bytes: Uint8Array): Uint32Array {
  const block = new Uint32Array(16);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 16; i++) block[i] = view.getUint32(i * 4, true);
  return block;
}

interface Output {
  cv: Uint32Array;
  block: Uint32Array;
  counter: bigint;
  blockLength: number;
  flags: number;
}

function chainingValue(output: Output): Uint32Array {
  return compress(output.cv, output.block, output.counter, output.blockLength, output.flags).slice(0, 8);
}

function rootBytes(output: Output, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  let counter = 0n;

  while (at < length) {
    const words = compress(output.cv, output.block, counter, output.blockLength, output.flags | ROOT);
    const chunk = new Uint8Array(64);
    const view = new DataView(chunk.buffer);
    for (let i = 0; i < 16; i++) view.setUint32(i * 4, words[i]!, true);

    const take = Math.min(64, length - at);
    out.set(chunk.subarray(0, take), at);
    at += take;
    counter += 1n;
  }
  return out;
}

class ChunkState {
  cv: Uint32Array;
  readonly block = new Uint8Array(BLOCK_BYTES);
  blockLength = 0;
  blocksCompressed = 0;

  constructor(
    key: Uint32Array,
    readonly counter: bigint,
    readonly flags: number,
  ) {
    this.cv = key.slice();
  }

  get length(): number {
    return BLOCK_BYTES * this.blocksCompressed + this.blockLength;
  }

  private get startFlag(): number {
    return this.blocksCompressed === 0 ? CHUNK_START : 0;
  }

  update(input: Uint8Array): void {
    let at = 0;
    while (at < input.length) {
      if (this.blockLength === BLOCK_BYTES) {
        this.cv = compress(
          this.cv,
          wordsFrom(this.block),
          this.counter,
          BLOCK_BYTES,
          this.flags | this.startFlag,
        ).slice(0, 8);
        this.blocksCompressed++;
        this.block.fill(0);
        this.blockLength = 0;
      }
      const take = Math.min(BLOCK_BYTES - this.blockLength, input.length - at);
      this.block.set(input.subarray(at, at + take), this.blockLength);
      this.blockLength += take;
      at += take;
    }
  }

  output(): Output {
    return {
      cv: this.cv,
      block: wordsFrom(this.block),
      counter: this.counter,
      blockLength: this.blockLength,
      flags: this.flags | this.startFlag | CHUNK_END,
    };
  }
}

function parentOutput(left: Uint32Array, right: Uint32Array, key: Uint32Array, flags: number): Output {
  const block = new Uint32Array(16);
  block.set(left, 0);
  block.set(right, 8);
  return { cv: key.slice(), block, counter: 0n, blockLength: BLOCK_BYTES, flags: flags | PARENT };
}

class Hasher {
  private chunk: ChunkState;
  private readonly stack: Uint32Array[] = [];

  constructor(
    private readonly key: Uint32Array,
    private readonly flags: number,
  ) {
    this.chunk = new ChunkState(key, 0n, flags);
  }

  private addChunk(cv: Uint32Array, total: bigint): void {
    let value = cv;
    let count = total;
    while ((count & 1n) === 0n) {
      const left = this.stack.pop();
      if (!left) break;
      value = chainingValue(parentOutput(left, value, this.key, this.flags));
      count >>= 1n;
    }
    this.stack.push(value);
  }

  update(input: Uint8Array): void {
    let at = 0;
    while (at < input.length) {
      if (this.chunk.length === CHUNK_BYTES) {
        const cv = chainingValue(this.chunk.output());
        const total = this.chunk.counter + 1n;
        this.addChunk(cv, total);
        this.chunk = new ChunkState(this.key, total, this.flags);
      }
      const take = Math.min(CHUNK_BYTES - this.chunk.length, input.length - at);
      this.chunk.update(input.subarray(at, at + take));
      at += take;
    }
  }

  finish(length: number): Uint8Array {
    let output = this.chunk.output();
    for (let i = this.stack.length - 1; i >= 0; i--) {
      output = parentOutput(this.stack[i]!, chainingValue(output), this.key, this.flags);
    }
    return rootBytes(output, length);
  }
}

export function blake3(input: Uint8Array, length = 32, key?: Uint32Array, flags = 0): Uint8Array {
  const hasher = new Hasher(key ?? new Uint32Array(IV), flags);
  hasher.update(input);
  return hasher.finish(length);
}

function deriveKey(context: string, material: Uint8Array, length: number): Uint8Array {
  const contextKey = blake3(toBytes(context), 32, new Uint32Array(IV), DERIVE_KEY_CONTEXT);
  const view = new DataView(contextKey.buffer, contextKey.byteOffset, contextKey.byteLength);
  const key = new Uint32Array(8);
  for (let i = 0; i < 8; i++) key[i] = view.getUint32(i * 4, true);
  return blake3(material, length, key, DERIVE_KEY_MATERIAL);
}

function keyWords(bytes: Uint8Array): Uint32Array {
  if (bytes.length !== 32) {
    throw new OperationError(`A keyed BLAKE3 needs a 32-byte key; this one is ${bytes.length}.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const key = new Uint32Array(8);
  for (let i = 0; i < 8; i++) key[i] = view.getUint32(i * 4, true);
  return key;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const blake3Operations: Operation[] = [
  {
    id: 'blake3',
    name: 'BLAKE3',
    category: 'Hashing',
    description: 'The BLAKE3 hash, with an output of any length, a keyed mode and key derivation.',
    aliases: ['b3', 'blake3sum', 'tree hash'],
    budgetMs: 30000,
    args: [
      { name: 'Length', type: 'number', value: 32, min: 1, max: 1024 },
      {
        name: 'Mode',
        type: 'option',
        value: 'Hash',
        options: ['Hash', 'Keyed', 'Derive key'],
      },
      {
        name: 'Key',
        type: 'toggleString',
        value: '',
        toggleValues: ['Hex', 'UTF-8'],
        toggleValue: 'Hex',
        hint: '32 bytes for the keyed mode',
      },
      { name: 'Context', type: 'string', value: '', hint: 'For key derivation' },
    ],
    run: (input, args) => {
      const length = Math.min(1024, Math.max(1, Number(arg(args, 'Length', 32))));
      const mode = String(arg(args, 'Mode', 'Hash'));
      const data = asBytes(input);

      if (mode === 'Derive key') {
        const context = String(arg(args, 'Context', ''));
        if (context.length === 0) {
          throw new OperationError('Key derivation needs a context string, which must be unique to its use.');
        }
        return hex(deriveKey(context, data, length));
      }

      if (mode === 'Keyed') {
        const raw = String(arg(args, 'Key', ''));
        const bytes =
          toggle(args, 'Key', 'Hex') === 'Hex'
            ? Uint8Array.from(raw.replace(/[^0-9a-fA-F]/g, '').match(/../g) ?? [], (p) =>
                Number.parseInt(p, 16),
              )
            : toBytes(raw);
        return hex(blake3(data, length, keyWords(bytes), KEYED_HASH));
      }

      return hex(blake3(data, length));
    },
  },
];
