import { OperationError } from '../types';
import { asBytes } from '../core/bytes';
import { arg, type Operation } from './types';
import { parseKey, KEY_FORMATS } from './keys';


const MASK64 = (1n << 64n) - 1n;

const SIGMA: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

const MIX = [
  [0, 4, 8, 12],
  [1, 5, 9, 13],
  [2, 6, 10, 14],
  [3, 7, 11, 15],
  [0, 5, 10, 15],
  [1, 6, 11, 12],
  [2, 7, 8, 13],
  [3, 4, 9, 14],
];

const IV64: bigint[] = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];

const IV32: number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];


function rotr64(value: bigint, bits: number): bigint {
  const n = BigInt(bits);
  return ((value >> n) | (value << (64n - n))) & MASK64;
}

function blake2b(message: Uint8Array, key: Uint8Array, outputBytes: number): Uint8Array {
  if (outputBytes < 1 || outputBytes > 64) {
    throw new OperationError('BLAKE2b output must be between 1 and 64 bytes.');
  }
  if (key.length > 64) throw new OperationError('A BLAKE2b key can be at most 64 bytes.');

  const h = [...IV64];
  h[0] = h[0]! ^ 0x01010000n ^ (BigInt(key.length) << 8n) ^ BigInt(outputBytes);

  const blocks: Uint8Array[] = [];
  if (key.length > 0) {
    const keyBlock = new Uint8Array(128);
    keyBlock.set(key);
    blocks.push(keyBlock);
  }
  for (let i = 0; i < message.length; i += 128) blocks.push(message.subarray(i, i + 128));
  if (blocks.length === 0) blocks.push(new Uint8Array(0));

  let counter = 0n;
  for (let index = 0; index < blocks.length; index++) {
    const chunk = blocks[index]!;
    const last = index === blocks.length - 1;
    const block = new Uint8Array(128);
    block.set(chunk);
    counter += key.length > 0 && index === 0 ? 128n : BigInt(chunk.length);

    const m: bigint[] = [];
    for (let i = 0; i < 16; i++) {
      let word = 0n;
      for (let j = 7; j >= 0; j--) word = (word << 8n) | BigInt(block[i * 8 + j]!);
      m.push(word);
    }

    const v = [...h, ...IV64];
    v[12] = v[12]! ^ (counter & MASK64);
    v[13] = v[13]! ^ ((counter >> 64n) & MASK64);
    if (last) v[14] = v[14]! ^ MASK64;

    for (let round = 0; round < 12; round++) {
      const s = SIGMA[round]!;
      for (let i = 0; i < 8; i++) {
        const [a, b, c, d] = MIX[i]! as [number, number, number, number];
        const x = m[s[i * 2]!]!;
        const y = m[s[i * 2 + 1]!]!;

        v[a] = (v[a]! + v[b]! + x) & MASK64;
        v[d] = rotr64(v[d]! ^ v[a]!, 32);
        v[c] = (v[c]! + v[d]!) & MASK64;
        v[b] = rotr64(v[b]! ^ v[c]!, 24);
        v[a] = (v[a]! + v[b]! + y) & MASK64;
        v[d] = rotr64(v[d]! ^ v[a]!, 16);
        v[c] = (v[c]! + v[d]!) & MASK64;
        v[b] = rotr64(v[b]! ^ v[c]!, 63);
      }
    }

    for (let i = 0; i < 8; i++) h[i] = h[i]! ^ v[i]! ^ v[i + 8]!;
  }

  const out = new Uint8Array(outputBytes);
  for (let i = 0; i < outputBytes; i++) {
    out[i] = Number((h[i >> 3]! >> BigInt(8 * (i & 7))) & 0xffn);
  }
  return out;
}


function rotr32(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function blake2s(message: Uint8Array, key: Uint8Array, outputBytes: number): Uint8Array {
  if (outputBytes < 1 || outputBytes > 32) {
    throw new OperationError('BLAKE2s output must be between 1 and 32 bytes.');
  }
  if (key.length > 32) throw new OperationError('A BLAKE2s key can be at most 32 bytes.');

  const h = [...IV32];
  h[0] = (h[0]! ^ 0x01010000 ^ (key.length << 8) ^ outputBytes) >>> 0;

  const blocks: Uint8Array[] = [];
  if (key.length > 0) {
    const keyBlock = new Uint8Array(64);
    keyBlock.set(key);
    blocks.push(keyBlock);
  }
  for (let i = 0; i < message.length; i += 64) blocks.push(message.subarray(i, i + 64));
  if (blocks.length === 0) blocks.push(new Uint8Array(0));

  let counter = 0;
  for (let index = 0; index < blocks.length; index++) {
    const chunk = blocks[index]!;
    const last = index === blocks.length - 1;
    const block = new Uint8Array(64);
    block.set(chunk);
    counter += key.length > 0 && index === 0 ? 64 : chunk.length;

    const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
    const m: number[] = [];
    for (let i = 0; i < 16; i++) m.push(view.getUint32(i * 4, true));

    const v = [...h, ...IV32];
    v[12] = (v[12]! ^ (counter >>> 0)) >>> 0;
    v[13] = (v[13]! ^ Math.floor(counter / 4294967296)) >>> 0;
    if (last) v[14] = (v[14]! ^ 0xffffffff) >>> 0;

    for (let round = 0; round < 10; round++) {
      const s = SIGMA[round]!;
      for (let i = 0; i < 8; i++) {
        const [a, b, c, d] = MIX[i]! as [number, number, number, number];
        const x = m[s[i * 2]!]!;
        const y = m[s[i * 2 + 1]!]!;

        v[a] = (v[a]! + v[b]! + x) >>> 0;
        v[d] = rotr32(v[d]! ^ v[a]!, 16);
        v[c] = (v[c]! + v[d]!) >>> 0;
        v[b] = rotr32(v[b]! ^ v[c]!, 12);
        v[a] = (v[a]! + v[b]! + y) >>> 0;
        v[d] = rotr32(v[d]! ^ v[a]!, 8);
        v[c] = (v[c]! + v[d]!) >>> 0;
        v[b] = rotr32(v[b]! ^ v[c]!, 7);
      }
    }

    for (let i = 0; i < 8; i++) h[i] = (h[i]! ^ v[i]! ^ v[i + 8]!) >>> 0;
  }

  const out = new Uint8Array(outputBytes);
  for (let i = 0; i < outputBytes; i++) out[i] = (h[i >> 2]! >>> (8 * (i & 3))) & 0xff;
  return out;
}


function encodeDigest(bytes: Uint8Array, encoding: string): string {
  if (encoding === 'Base64') {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function keyFrom(args: Parameters<Operation['run']>[1]): Uint8Array {
  const found = args.find((a) => a.name === 'Key');
  const value = String(found?.value ?? '');
  if (value === '') return new Uint8Array(0);
  return parseKey(value, found?.toggleValue ?? 'UTF-8');
}

const KEY_ARG = {
  name: 'Key',
  type: 'toggleString' as const,
  value: '',
  toggleValues: KEY_FORMATS,
  toggleValue: 'UTF-8',
  hint: 'Optional — turns the hash into a MAC',
};

const ENCODING_ARG = {
  name: 'Output encoding',
  type: 'option' as const,
  value: 'Hex',
  options: ['Hex', 'Base64'],
};

export const blakeOperations: Operation[] = [
  {
    id: 'blake2b',
    name: 'BLAKE2b',
    category: 'Hashing',
    description: 'Computes a BLAKE2b digest (RFC 7693), optionally keyed. Faster than SHA-2, and unbroken.',
    aliases: ['blake2', 'blake-2b'],
    args: [
      { name: 'Size', type: 'option', value: '512', options: ['512', '384', '256', '160', '128'] },
      ENCODING_ARG,
      KEY_ARG,
    ],
    run: (input, args) => {
      const size = Number(arg(args, 'Size', '512'));
      const digest = blake2b(asBytes(input), keyFrom(args), size / 8);
      return encodeDigest(digest, String(arg(args, 'Output encoding', 'Hex')));
    },
  },
  {
    id: 'blake2s',
    name: 'BLAKE2s',
    category: 'Hashing',
    description: 'Computes a BLAKE2s digest (RFC 7693), the 32-bit sibling of BLAKE2b.',
    aliases: ['blake-2s'],
    args: [
      { name: 'Size', type: 'option', value: '256', options: ['256', '160', '128'] },
      ENCODING_ARG,
      KEY_ARG,
    ],
    run: (input, args) => {
      const size = Number(arg(args, 'Size', '256'));
      const digest = blake2s(asBytes(input), keyFrom(args), size / 8);
      return encodeDigest(digest, String(arg(args, 'Output encoding', 'Hex')));
    },
  },
];

export { blake2b, blake2s };
