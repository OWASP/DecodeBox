import { OperationError } from '../types';
import { type BlockCipher } from '../core/blockModes';
import { type Operation } from './types';
import { cipherArgs, runCipher } from './blockCiphers';



const Q0_BOXES = [
  [0x8, 0x1, 0x7, 0xd, 0x6, 0xf, 0x3, 0x2, 0x0, 0xb, 0x5, 0x9, 0xe, 0xc, 0xa, 0x4],
  [0xe, 0xc, 0xb, 0x8, 0x1, 0x2, 0x3, 0x5, 0xf, 0x4, 0xa, 0x6, 0x7, 0x0, 0x9, 0xd],
  [0xb, 0xa, 0x5, 0xe, 0x6, 0xd, 0x9, 0x0, 0xc, 0x8, 0xf, 0x3, 0x2, 0x4, 0x7, 0x1],
  [0xd, 0x7, 0xf, 0x4, 0x1, 0x2, 0x6, 0xe, 0x9, 0xb, 0x3, 0x0, 0x8, 0x5, 0xc, 0xa],
];

const Q1_BOXES = [
  [0x2, 0x8, 0xb, 0xd, 0xf, 0x7, 0x6, 0xe, 0x3, 0x1, 0x9, 0x4, 0x0, 0xa, 0xc, 0x5],
  [0x1, 0xe, 0x2, 0xb, 0x4, 0xc, 0x3, 0x7, 0x6, 0xd, 0xa, 0x5, 0xf, 0x9, 0x0, 0x8],
  [0x4, 0xc, 0x7, 0x5, 0x1, 0x6, 0x9, 0xa, 0x0, 0xe, 0xd, 0x8, 0x2, 0xb, 0x3, 0xf],
  [0xb, 0x9, 0x5, 0x1, 0xc, 0x3, 0xd, 0xe, 0x6, 0x4, 0x7, 0xf, 0x2, 0x0, 0x8, 0xa],
];

function buildQ(boxes: number[][]): Uint8Array {
  const q = new Uint8Array(256);
  const ror4 = (value: number): number => ((value >> 1) | (value << 3)) & 0x0f;

  for (let x = 0; x < 256; x++) {
    let a = x >> 4;
    let b = x & 0x0f;
    let a2 = a ^ b;
    let b2 = (a ^ ror4(b) ^ ((8 * a) & 0x0f)) & 0x0f;

    a = boxes[0]![a2]!;
    b = boxes[1]![b2]!;
    a2 = a ^ b;
    b2 = (a ^ ror4(b) ^ ((8 * a) & 0x0f)) & 0x0f;

    a = boxes[2]![a2]!;
    b = boxes[3]![b2]!;
    q[x] = ((b << 4) | a) & 0xff;
  }
  return q;
}

const Q0 = buildQ(Q0_BOXES);
const Q1 = buildQ(Q1_BOXES);


function multiply(a: number, b: number, modulus: number): number {
  let result = 0;
  let x = a;
  let y = b;
  while (y > 0) {
    if ((y & 1) !== 0) result ^= x;
    y >>= 1;
    x <<= 1;
    if ((x & 0x100) !== 0) x ^= modulus;
  }
  return result & 0xff;
}

const MDS = [
  [0x01, 0xef, 0x5b, 0x5b],
  [0x5b, 0xef, 0xef, 0x01],
  [0xef, 0x5b, 0x01, 0xef],
  [0xef, 0x01, 0xef, 0x5b],
];

const RS = [
  [0x01, 0xa4, 0x55, 0x87, 0x5a, 0x58, 0xdb, 0x9e],
  [0xa4, 0x56, 0x82, 0xf3, 0x1e, 0xc6, 0x68, 0xe5],
  [0x02, 0xa1, 0xfc, 0xc1, 0x47, 0xae, 0x3d, 0x19],
  [0xa4, 0x55, 0x87, 0x5a, 0x58, 0xdb, 0x9e, 0x03],
];

const MDS_MODULUS = 0x169;
const RS_MODULUS = 0x14d;

function mdsMultiply(bytes: number[]): number {
  let word = 0;
  for (let row = 0; row < 4; row++) {
    let value = 0;
    for (let column = 0; column < 4; column++) {
      value ^= multiply(MDS[row]![column]!, bytes[column]!, MDS_MODULUS);
    }
    word |= value << (8 * row);
  }
  return word >>> 0;
}

function rsMultiply(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let row = 0; row < 4; row++) {
    let value = 0;
    for (let column = 0; column < 8; column++) {
      value ^= multiply(RS[row]![column]!, bytes[column]!, RS_MODULUS);
    }
    out.push(value);
  }
  return out;
}


const byteOf = (word: number, index: number): number => (word >>> (8 * index)) & 0xff;

function h(x: number, list: number[], k: number): number {
  const y = [byteOf(x, 0), byteOf(x, 1), byteOf(x, 2), byteOf(x, 3)];

  if (k === 4) {
    y[0] = Q1[y[0]!]! ^ byteOf(list[3]!, 0);
    y[1] = Q0[y[1]!]! ^ byteOf(list[3]!, 1);
    y[2] = Q0[y[2]!]! ^ byteOf(list[3]!, 2);
    y[3] = Q1[y[3]!]! ^ byteOf(list[3]!, 3);
  }
  if (k >= 3) {
    y[0] = Q1[y[0]!]! ^ byteOf(list[2]!, 0);
    y[1] = Q1[y[1]!]! ^ byteOf(list[2]!, 1);
    y[2] = Q0[y[2]!]! ^ byteOf(list[2]!, 2);
    y[3] = Q0[y[3]!]! ^ byteOf(list[2]!, 3);
  }

  y[0] = Q1[Q0[Q0[y[0]!]! ^ byteOf(list[1]!, 0)]! ^ byteOf(list[0]!, 0)]!;
  y[1] = Q0[Q0[Q1[y[1]!]! ^ byteOf(list[1]!, 1)]! ^ byteOf(list[0]!, 1)]!;
  y[2] = Q1[Q1[Q0[y[2]!]! ^ byteOf(list[1]!, 2)]! ^ byteOf(list[0]!, 2)]!;
  y[3] = Q0[Q1[Q1[y[3]!]! ^ byteOf(list[1]!, 3)]! ^ byteOf(list[0]!, 3)]!;

  return mdsMultiply(y);
}


const rol = (value: number, bits: number): number =>
  ((value << bits) | (value >>> (32 - bits))) >>> 0;
const ror = (value: number, bits: number): number =>
  ((value >>> bits) | (value << (32 - bits))) >>> 0;

function readWord(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
  );
}

function writeWord(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
  bytes[at + 2] = (value >>> 16) & 0xff;
  bytes[at + 3] = (value >>> 24) & 0xff;
}

export function twofish(key: Uint8Array): BlockCipher {
  if (![16, 24, 32].includes(key.length)) {
    throw new OperationError(
      `A Twofish key is 16, 24 or 32 bytes; this one is ${key.length}.`,
    );
  }

  const k = key.length / 8;
  const even: number[] = [];
  const odd: number[] = [];
  for (let i = 0; i < k; i++) {
    even.push(readWord(key, i * 8));
    odd.push(readWord(key, i * 8 + 4));
  }

  const s: number[] = [];
  for (let i = 0; i < k; i++) {
    const bytes = rsMultiply(key.subarray(i * 8, i * 8 + 8));
    s.unshift((bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24)) >>> 0);
  }

  const subKeys = new Uint32Array(40);
  const step = 0x02020202;
  for (let i = 0; i < 20; i++) {
    const a = h((i * step) >>> 0, even, k);
    const b = rol(h((i * step + 0x01010101) >>> 0, odd, k), 8);
    subKeys[i * 2] = (a + b) >>> 0;
    subKeys[i * 2 + 1] = rol((a + 2 * b) >>> 0, 9);
  }

  const g = (x: number): number => h(x, s, k);

  const mix = (a: number, b: number, index: number): [number, number] => {
    const t0 = g(a);
    const t1 = g(rol(b, 8));
    return [
      (t0 + t1 + subKeys[2 * index + 8]!) >>> 0,
      (t0 + 2 * t1 + subKeys[2 * index + 9]!) >>> 0,
    ];
  };

  const encryptBlock = (block: Uint8Array): Uint8Array => {
    const r = [0, 1, 2, 3].map((i) => (readWord(block, i * 4) ^ subKeys[i]!) >>> 0);

    for (let round = 0; round < 16; round++) {
      const [f0, f1] = mix(r[0]!, r[1]!, round);
      const carried0 = r[0]!;
      const carried1 = r[1]!;
      r[0] = ror((r[2]! ^ f0) >>> 0, 1);
      r[1] = (rol(r[3]!, 1) ^ f1) >>> 0;
      r[2] = carried0;
      r[3] = carried1;
    }

    const out = new Uint8Array(16);
    for (let i = 0; i < 4; i++) writeWord(out, i * 4, (r[(i + 2) % 4]! ^ subKeys[i + 4]!) >>> 0);
    return out;
  };

  const decryptBlock = (block: Uint8Array): Uint8Array => {
    const r = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) r[(i + 2) % 4] = (readWord(block, i * 4) ^ subKeys[i + 4]!) >>> 0;

    for (let round = 15; round >= 0; round--) {
      const [f0, f1] = mix(r[2]!, r[3]!, round);
      const carried2 = r[2]!;
      const carried3 = r[3]!;
      r[2] = (rol(r[0]!, 1) ^ f0) >>> 0;
      r[3] = ror((r[1]! ^ f1) >>> 0, 1);
      r[0] = carried2;
      r[1] = carried3;
    }

    const out = new Uint8Array(16);
    for (let i = 0; i < 4; i++) writeWord(out, i * 4, (r[i]! ^ subKeys[i]!) >>> 0);
    return out;
  };

  return { blockSize: 16, encryptBlock, decryptBlock };
}

export const twofishOperations: Operation[] = [
  {
    id: 'twofish-encrypt',
    name: 'Twofish Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with Twofish, the 128-bit block cipher that was an AES finalist.',
    aliases: ['twofish', 'schneier cipher'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, true, twofish),
  },
  {
    id: 'twofish-decrypt',
    name: 'Twofish Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts Twofish ciphertext.',
    aliases: ['twofish decrypt'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, false, twofish),
  },
];
