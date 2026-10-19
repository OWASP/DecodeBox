import { OperationError } from '../types';
import { asBytes } from '../core/bytes';
import { arg, type Operation } from './types';



function rotl32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function toHexBytes(bytes: Uint8Array | number[]): string {
  return Array.from(bytes)
    .map((b) => (b & 0xff).toString(16).padStart(2, '0'))
    .join('');
}

function hexLE32(value: number): string {
  const v = value >>> 0;
  return toHexBytes([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}

function hexBE32(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

function padMessage(bytes: Uint8Array, littleEndian: boolean, blockSize = 64): Uint8Array {
  const lengthBytes = blockSize === 128 ? 16 : 8;
  const total = Math.ceil((bytes.length + 1 + lengthBytes) / blockSize) * blockSize;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const bits = BigInt(bytes.length) * 8n;
  for (let i = 0; i < lengthBytes; i++) {
    const byte = Number((bits >> BigInt(8 * i)) & 0xffn);
    padded[littleEndian ? total - lengthBytes + i : total - 1 - i] = byte;
  }
  return padded;
}


const MD2_S = [
  41, 46, 67, 201, 162, 216, 124, 1, 61, 54, 84, 161, 236, 240, 6, 19,
  98, 167, 5, 243, 192, 199, 115, 140, 152, 147, 43, 217, 188, 76, 130, 202,
  30, 155, 87, 60, 253, 212, 224, 22, 103, 66, 111, 24, 138, 23, 229, 18,
  190, 78, 196, 214, 218, 158, 222, 73, 160, 251, 245, 142, 187, 47, 238, 122,
  169, 104, 121, 145, 21, 178, 7, 63, 148, 194, 16, 137, 11, 34, 95, 33,
  128, 127, 93, 154, 90, 144, 50, 39, 53, 62, 204, 231, 191, 247, 151, 3,
  255, 25, 48, 179, 72, 165, 181, 209, 215, 94, 146, 42, 172, 86, 170, 198,
  79, 184, 56, 210, 150, 164, 125, 182, 118, 252, 107, 226, 156, 116, 4, 241,
  69, 157, 112, 89, 100, 113, 135, 32, 134, 91, 207, 101, 230, 45, 168, 2,
  27, 96, 37, 173, 174, 176, 185, 246, 28, 70, 97, 105, 52, 64, 126, 15,
  85, 71, 163, 35, 221, 81, 175, 58, 195, 92, 249, 206, 186, 197, 234, 38,
  44, 83, 13, 110, 133, 40, 132, 9, 211, 223, 205, 244, 65, 129, 77, 82,
  106, 220, 55, 200, 108, 193, 171, 250, 36, 225, 123, 8, 12, 189, 177, 74,
  120, 136, 149, 139, 227, 99, 232, 109, 233, 203, 213, 254, 59, 0, 29, 57,
  242, 239, 183, 14, 102, 88, 208, 228, 166, 119, 114, 248, 235, 117, 75, 10,
  49, 68, 80, 180, 143, 237, 31, 26, 219, 153, 141, 51, 159, 17, 131, 20,
];

function md2(bytes: Uint8Array): string {
  const padLength = 16 - (bytes.length % 16);
  const message = new Uint8Array(bytes.length + padLength);
  message.set(bytes);
  message.fill(padLength, bytes.length);

  const checksum = new Uint8Array(16);
  let last = 0;
  for (let i = 0; i < message.length; i += 16) {
    for (let j = 0; j < 16; j++) {
      last = checksum[j]! ^ MD2_S[message[i + j]! ^ last]!;
      checksum[j] = last;
    }
  }

  const full = new Uint8Array(message.length + 16);
  full.set(message);
  full.set(checksum, message.length);

  const state = new Uint8Array(48);
  for (let i = 0; i < full.length; i += 16) {
    for (let j = 0; j < 16; j++) {
      state[16 + j] = full[i + j]!;
      state[32 + j] = state[16 + j]! ^ state[j]!;
    }

    let t = 0;
    for (let round = 0; round < 18; round++) {
      for (let k = 0; k < 48; k++) {
        t = state[k]! ^ MD2_S[t]!;
        state[k] = t;
      }
      t = (t + round) % 256;
    }
  }

  return toHexBytes(state.subarray(0, 16));
}


const MD4_R2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
const MD4_R3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
const MD4_S1 = [3, 7, 11, 19];
const MD4_S2 = [3, 5, 9, 13];
const MD4_S3 = [3, 9, 11, 15];

function md4(bytes: Uint8Array): string {
  const padded = padMessage(bytes, true);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);

  let [h0, h1, h2, h3] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const x: number[] = [];
    for (let i = 0; i < 16; i++) x.push(view.getUint32(chunk + i * 4, true));

    let [a, b, c, d] = [h0, h1, h2, h3];

    for (let i = 0; i < 16; i++) {
      const f = (b & c) | (~b & d);
      const value = (a + f + x[i]!) >>> 0;
      [a, b, c, d] = [d, rotl32(value, MD4_S1[i % 4]!), b, c];
    }
    for (let i = 0; i < 16; i++) {
      const g = (b & c) | (b & d) | (c & d);
      const value = (a + g + x[MD4_R2[i]!]! + 0x5a827999) >>> 0;
      [a, b, c, d] = [d, rotl32(value, MD4_S2[i % 4]!), b, c];
    }
    for (let i = 0; i < 16; i++) {
      const h = b ^ c ^ d;
      const value = (a + h + x[MD4_R3[i]!]! + 0x6ed9eba1) >>> 0;
      [a, b, c, d] = [d, rotl32(value, MD4_S3[i % 4]!), b, c];
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
  }

  return hexLE32(h0) + hexLE32(h1) + hexLE32(h2) + hexLE32(h3);
}


function sha0(bytes: Uint8Array): string {
  const padded = padMessage(bytes, false);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);

  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const w = new Array<number>(80);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(chunk + i * 4, false);
    for (let i = 16; i < 80; i++) {
      w[i] = (w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!) >>> 0;
    }

    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl32(a, 5) + f + e + k + w[i]!) >>> 0;
      [a, b, c, d, e] = [temp, a, rotl32(b, 30), c, d];
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map(hexBE32).join('');
}


const RMD_LEFT_ORDER = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
];
const RMD_RIGHT_ORDER = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
];
const RMD_LEFT_SHIFT = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
];
const RMD_RIGHT_SHIFT = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
];
const RMD_LEFT_K = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const RMD_RIGHT_K = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];
const RMD_LEFT_K128 = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc];
const RMD_RIGHT_K128 = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x00000000];

function rmdF(round: number, x: number, y: number, z: number): number {
  switch (round) {
    case 0:
      return x ^ y ^ z;
    case 1:
      return (x & y) | (~x & z);
    case 2:
      return (x | ~y) ^ z;
    case 3:
      return (x & z) | (y & ~z);
    default:
      return x ^ (y | ~z);
  }
}

type RipemdSize = 128 | 160 | 256 | 320;

function ripemd(bytes: Uint8Array, size: RipemdSize): string {
  const wide = size === 256 || size === 320;
  const rounds = size === 160 || size === 320 ? 5 : 4;
  const leftK = rounds === 5 ? RMD_LEFT_K : RMD_LEFT_K128;
  const rightK = rounds === 5 ? RMD_RIGHT_K : RMD_RIGHT_K128;
  const steps = rounds * 16;

  const base = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const mirror = [0x76543210, 0xfedcba98, 0x89abcdef, 0x01234567, 0x3c2d1e0f];
  const words = rounds === 5 ? 5 : 4;

  const h = wide ? [...base.slice(0, words), ...mirror.slice(0, words)] : base.slice(0, words);

  const padded = padMessage(bytes, true);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const x: number[] = [];
    for (let i = 0; i < 16; i++) x.push(view.getUint32(chunk + i * 4, true));

    const left = h.slice(0, words);
    const right = wide ? h.slice(words) : h.slice(0, words);

    for (let step = 0; step < steps; step++) {
      const round = Math.floor(step / 16);

      {
        const [a, b, c, d, e = 0] = left;
        const f = rmdF(round, b!, c!, d!);
        let value = (a! + f + x[RMD_LEFT_ORDER[step]!]! + leftK[round]!) >>> 0;
        value = rotl32(value, RMD_LEFT_SHIFT[step]!);
        if (words === 5) {
          left[0] = e;
          left[1] = (value + e) >>> 0;
          left[2] = b!;
          left[3] = rotl32(c!, 10);
          left[4] = d!;
        } else {
          left[0] = d!;
          left[1] = value;
          left[2] = b!;
          left[3] = c!;
        }
      }

      {
        const mirrored = rounds - 1 - round;
        const [a, b, c, d, e = 0] = right;
        const f = rmdF(mirrored, b!, c!, d!);
        let value = (a! + f + x[RMD_RIGHT_ORDER[step]!]! + rightK[round]!) >>> 0;
        value = rotl32(value, RMD_RIGHT_SHIFT[step]!);
        if (words === 5) {
          right[0] = e;
          right[1] = (value + e) >>> 0;
          right[2] = b!;
          right[3] = rotl32(c!, 10);
          right[4] = d!;
        } else {
          right[0] = d!;
          right[1] = value;
          right[2] = b!;
          right[3] = c!;
        }
      }

      if (wide && step % 16 === 15) {
        const swap = size === 256 ? [0, 1, 2, 3][round]! : [1, 3, 0, 2, 4][round]!;
        const carry = left[swap]!;
        left[swap] = right[swap]!;
        right[swap] = carry;
      }
    }

    if (wide) {
      for (let i = 0; i < words; i++) h[i] = (h[i]! + left[i]!) >>> 0;
      for (let i = 0; i < words; i++) h[words + i] = (h[words + i]! + right[i]!) >>> 0;
    } else if (words === 5) {
      const folded = [
        (h[1]! + left[2]! + right[3]!) >>> 0,
        (h[2]! + left[3]! + right[4]!) >>> 0,
        (h[3]! + left[4]! + right[0]!) >>> 0,
        (h[4]! + left[0]! + right[1]!) >>> 0,
        (h[0]! + left[1]! + right[2]!) >>> 0,
      ];
      for (let i = 0; i < 5; i++) h[i] = folded[i]!;
    } else {
      const folded = [
        (h[1]! + left[2]! + right[3]!) >>> 0,
        (h[2]! + left[3]! + right[0]!) >>> 0,
        (h[3]! + left[0]! + right[1]!) >>> 0,
        (h[0]! + left[1]! + right[2]!) >>> 0,
      ];
      for (let i = 0; i < 4; i++) h[i] = folded[i]!;
    }
  }

  return h.map(hexLE32).join('');
}


const SM3_IV = [
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
];

function sm3(bytes: Uint8Array): string {
  const padded = padMessage(bytes, false);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  const v = [...SM3_IV];

  const p0 = (x: number) => (x ^ rotl32(x, 9) ^ rotl32(x, 17)) >>> 0;
  const p1 = (x: number) => (x ^ rotl32(x, 15) ^ rotl32(x, 23)) >>> 0;

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const w = new Array<number>(68);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(chunk + i * 4, false);
    for (let i = 16; i < 68; i++) {
      w[i] = (p1((w[i - 16]! ^ w[i - 9]! ^ rotl32(w[i - 3]!, 15)) >>> 0) ^ rotl32(w[i - 13]!, 7) ^ w[i - 6]!) >>> 0;
    }
    const w1 = new Array<number>(64);
    for (let i = 0; i < 64; i++) w1[i] = (w[i]! ^ w[i + 4]!) >>> 0;

    let [a, b, c, d, e, f, g, hh] = v as [
      number, number, number, number, number, number, number, number,
    ];

    for (let j = 0; j < 64; j++) {
      const t = j < 16 ? 0x79cc4519 : 0x7a879d8a;
      const rotA = rotl32(a, 12);
      const ss1 = rotl32((rotA + e + rotl32(t, j % 32)) >>> 0, 7);
      const ss2 = (ss1 ^ rotA) >>> 0;
      const ff = j < 16 ? a ^ b ^ c : (a & b) | (a & c) | (b & c);
      const gg = j < 16 ? e ^ f ^ g : (e & f) | (~e & g);
      const tt1 = (ff + d + ss2 + w1[j]!) >>> 0;
      const tt2 = (gg + hh + ss1 + w[j]!) >>> 0;

      d = c;
      c = rotl32(b, 9);
      b = a;
      a = tt1;
      hh = g;
      g = rotl32(f, 19);
      f = e;
      e = p0(tt2);
    }

    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) v[i] = (v[i]! ^ next[i]!) >>> 0;
  }

  return v.map(hexBE32).join('');
}


function murmur3(bytes: Uint8Array, seed: number): number {
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const remainder = bytes.length & 3;
  const blocks = bytes.length - remainder;

  let h1 = seed | 0;
  const mul = (a: number, b: number) =>
    (((a & 0xffff) * b + ((((a >>> 16) * b) & 0xffff) << 16)) & 0xffffffff) >>> 0;

  for (let i = 0; i < blocks; i += 4) {
    let k1 = bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24);
    k1 = mul(k1, c1);
    k1 = rotl32(k1, 15);
    k1 = mul(k1, c2);

    h1 = (h1 ^ k1) >>> 0;
    h1 = rotl32(h1, 13);
    h1 = (mul(h1, 5) + 0xe6546b64) >>> 0;
  }

  let k1 = 0;
  if (remainder === 3) k1 ^= bytes[blocks + 2]! << 16;
  if (remainder >= 2) k1 ^= bytes[blocks + 1]! << 8;
  if (remainder >= 1) {
    k1 ^= bytes[blocks]!;
    k1 = mul(k1, c1);
    k1 = rotl32(k1, 15);
    k1 = mul(k1, c2);
    h1 = (h1 ^ k1) >>> 0;
  }

  h1 = (h1 ^ bytes.length) >>> 0;
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h1 = mul(h1, 0x85ebca6b);
  h1 = (h1 ^ (h1 >>> 13)) >>> 0;
  h1 = mul(h1, 0xc2b2ae35);
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  return h1 >>> 0;
}


export const digestOperations: Operation[] = [
  {
    id: 'md2',
    name: 'MD2',
    category: 'Hashing',
    description: 'Computes the MD2 digest (RFC 1319). Obsolete, but still found in old certificates.',
    aliases: ['message digest 2'],
    args: [],
    run: (input) => md2(asBytes(input)),
  },
  {
    id: 'md4',
    name: 'MD4',
    category: 'Hashing',
    description: 'Computes the MD4 digest (RFC 1320). Badly broken; the basis of the NT hash.',
    aliases: ['message digest 4'],
    args: [],
    run: (input) => md4(asBytes(input)),
  },
  {
    id: 'sha-0',
    name: 'SHA0',
    category: 'Hashing',
    description: 'Computes the withdrawn 1993 SHA-0 digest, SHA-1 without the schedule rotation.',
    aliases: ['sha0', 'sha-0'],
    args: [],
    run: (input) => sha0(asBytes(input)),
  },
  {
    id: 'ripemd',
    name: 'RIPEMD',
    category: 'Hashing',
    description: 'Computes a RIPEMD digest. The 160-bit size is the one used by Bitcoin and PGP.',
    aliases: ['ripemd-160', 'ripemd160', 'rmd160'],
    args: [{ name: 'Size', type: 'option', value: '160', options: ['320', '256', '160', '128'] }],
    run: (input, args) => {
      const size = Number(arg(args, 'Size', '160')) as RipemdSize;
      return ripemd(asBytes(input), size);
    },
  },
  {
    id: 'sm3',
    name: 'SM3',
    category: 'Hashing',
    description: 'Computes the SM3 digest, the Chinese national standard hash.',
    aliases: ['sm-3', 'gb/t 32905'],
    args: [],
    run: (input) => sm3(asBytes(input)),
  },
  {
    id: 'nt-hash',
    name: 'NT Hash',
    category: 'Hashing',
    description:
      'Computes the NT hash of a password: MD4 of the UTF-16LE bytes, unsalted, as stored by Windows.',
    aliases: ['ntlm', 'ntlm hash', 'nthash', 'windows password hash'],
    args: [],
    run: (input) => {
      const utf16 = new Uint8Array(input.length * 2);
      for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        utf16[i * 2] = code & 0xff;
        utf16[i * 2 + 1] = (code >> 8) & 0xff;
      }
      return md4(utf16);
    },
  },
  {
    id: 'murmurhash3',
    name: 'MurmurHash3',
    category: 'Hashing',
    description: 'Computes the 32-bit MurmurHash v3. A fast non-cryptographic hash, for lookups.',
    aliases: ['murmur', 'mmh3', 'murmur3'],
    args: [
      { name: 'Seed', type: 'number', value: 0 },
      { name: 'Convert to signed', type: 'boolean', value: false },
      {
        name: 'Output',
        type: 'option',
        value: 'Decimal',
        options: ['Decimal', 'Hexadecimal'],
        hint: 'Hex is eight characters and recognisable as a hash; decimal is just a number.',
      },
    ],
    run: (input, args) => {
      const seed = Number(arg(args, 'Seed', 0));
      if (!Number.isFinite(seed)) throw new OperationError('The seed must be a number.');
      const value = murmur3(asBytes(input), seed);
      const signed = Boolean(arg(args, 'Convert to signed', false));

      if (arg(args, 'Output', 'Decimal') === 'Hexadecimal') {
        return (value >>> 0).toString(16).padStart(8, '0');
      }
      return String(signed ? value | 0 : value);
    },
  },
];

export { md2, md4, sha0, ripemd, sm3, murmur3 };
