import { OperationError, type OperationArg } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import {
  BLOCK_MODES,
  PADDING_OPTIONS,
  decryptBlocks,
  encryptBlocks,
  type BlockCipher,
} from '../core/blockModes';
import { PI_HEX_DIGITS } from '../core/piDigits';
import { parseKey, KEY_FORMATS } from './keys';
import { arg, toggle, type Operation } from './types';


const IO_FORMATS = ['Raw', 'Hex'];

function cipherArgs(extra: OperationArg[] = []): OperationArg[] {
  return [
    { name: 'Key', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
    { name: 'IV', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
    ...extra,
    { name: 'Mode', type: 'option', value: 'CBC', options: BLOCK_MODES },
    { name: 'Input', type: 'option', value: 'Raw', options: IO_FORMATS },
    { name: 'Output', type: 'option', value: 'Hex', options: IO_FORMATS },
    { name: 'Padding', type: 'option', value: 'PKCS#7', options: PADDING_OPTIONS },
  ];
}

function readData(input: string, format: string): Uint8Array {
  if (format !== 'Hex') return asBytes(input);
  const cleaned = input.replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length % 2 !== 0) throw new OperationError('Hex input has an odd number of digits.');
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  return out;
}

function writeData(bytes: Uint8Array, format: string): string {
  return format === 'Hex'
    ? Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    : bytesToLatin1(bytes);
}

function runCipher(
  input: string,
  args: OperationArg[],
  encrypt: boolean,
  build: (key: Uint8Array, args: OperationArg[]) => BlockCipher,
): string {
  const key = parseKey(String(arg(args, 'Key', '')), toggle(args, 'Key', 'Hex'), false);
  const iv = parseKey(String(arg(args, 'IV', '')), toggle(args, 'IV', 'Hex'), true);
  const cipher = build(key, args);
  const data = readData(input, String(arg(args, 'Input', 'Raw')));
  const mode = String(arg(args, 'Mode', 'CBC'));
  const padding = String(arg(args, 'Padding', 'PKCS#7'));

  const out = encrypt
    ? encryptBlocks(cipher, data, mode, iv, padding)
    : decryptBlocks(cipher, data, mode, iv, padding);
  return writeData(out, String(arg(args, 'Output', 'Hex')));
}


const BLOWFISH_TABLES = (() => {
  const word = (index: number) => parseInt(PI_HEX_DIGITS.substr(index * 8, 8), 16) >>> 0;
  const p = new Uint32Array(18);
  for (let i = 0; i < 18; i++) p[i] = word(i);
  const s = [0, 1, 2, 3].map((box) => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) table[i] = word(18 + box * 256 + i);
    return table;
  });
  return { p, s };
})();

function blowfish(key: Uint8Array): BlockCipher {
  if (key.length < 4 || key.length > 56) {
    throw new OperationError(`Blowfish takes a 4 to 56-byte key; this one is ${key.length}.`);
  }

  const p = new Uint32Array(BLOWFISH_TABLES.p);
  const s = BLOWFISH_TABLES.s.map((box) => new Uint32Array(box));

  for (let i = 0; i < 18; i++) {
    let value = 0;
    for (let j = 0; j < 4; j++) value = ((value << 8) | (key[(i * 4 + j) % key.length] as number)) >>> 0;
    p[i] = ((p[i] as number) ^ value) >>> 0;
  }

  const f = (x: number) =>
    ((((((s[0] as Uint32Array)[(x >>> 24) & 0xff] as number) +
      ((s[1] as Uint32Array)[(x >>> 16) & 0xff] as number)) >>>
      0) ^
      ((s[2] as Uint32Array)[(x >>> 8) & 0xff] as number)) +
      ((s[3] as Uint32Array)[x & 0xff] as number)) >>>
    0;

  const encryptPair = (pair: [number, number]): [number, number] => {
    let [left, right] = pair;
    for (let i = 0; i < 16; i++) {
      left = (left ^ (p[i] as number)) >>> 0;
      right = (right ^ f(left)) >>> 0;
      [left, right] = [right, left];
    }
    [left, right] = [right, left];
    right = (right ^ (p[16] as number)) >>> 0;
    left = (left ^ (p[17] as number)) >>> 0;
    return [left, right];
  };

  let block: [number, number] = [0, 0];
  for (let i = 0; i < 18; i += 2) {
    block = encryptPair(block);
    p[i] = block[0];
    p[i + 1] = block[1];
  }
  for (const box of s) {
    for (let i = 0; i < 256; i += 2) {
      block = encryptPair(block);
      box[i] = block[0];
      box[i + 1] = block[1];
    }
  }

  const decryptPair = (pair: [number, number]): [number, number] => {
    let [left, right] = pair;
    for (let i = 17; i > 1; i--) {
      left = (left ^ (p[i] as number)) >>> 0;
      right = (right ^ f(left)) >>> 0;
      [left, right] = [right, left];
    }
    [left, right] = [right, left];
    right = (right ^ (p[1] as number)) >>> 0;
    left = (left ^ (p[0] as number)) >>> 0;
    return [left, right];
  };

  const toPair = (bytes: Uint8Array): [number, number] => [
    (((bytes[0] as number) << 24) | ((bytes[1] as number) << 16) | ((bytes[2] as number) << 8) | (bytes[3] as number)) >>> 0,
    (((bytes[4] as number) << 24) | ((bytes[5] as number) << 16) | ((bytes[6] as number) << 8) | (bytes[7] as number)) >>> 0,
  ];
  const fromPair = ([left, right]: [number, number]) => {
    const out = new Uint8Array(8);
    out[0] = (left >>> 24) & 0xff;
    out[1] = (left >>> 16) & 0xff;
    out[2] = (left >>> 8) & 0xff;
    out[3] = left & 0xff;
    out[4] = (right >>> 24) & 0xff;
    out[5] = (right >>> 16) & 0xff;
    out[6] = (right >>> 8) & 0xff;
    out[7] = right & 0xff;
    return out;
  };

  return {
    blockSize: 8,
    encryptBlock: (b) => fromPair(encryptPair(toPair(b))),
    decryptBlock: (b) => fromPair(decryptPair(toPair(b))),
  };
}


const RC2_PITABLE = new Uint8Array([
  0xd9, 0x78, 0xf9, 0xc4, 0x19, 0xdd, 0xb5, 0xed, 0x28, 0xe9, 0xfd, 0x79, 0x4a, 0xa0, 0xd8, 0x9d,
  0xc6, 0x7e, 0x37, 0x83, 0x2b, 0x76, 0x53, 0x8e, 0x62, 0x4c, 0x64, 0x88, 0x44, 0x8b, 0xfb, 0xa2,
  0x17, 0x9a, 0x59, 0xf5, 0x87, 0xb3, 0x4f, 0x13, 0x61, 0x45, 0x6d, 0x8d, 0x09, 0x81, 0x7d, 0x32,
  0xbd, 0x8f, 0x40, 0xeb, 0x86, 0xb7, 0x7b, 0x0b, 0xf0, 0x95, 0x21, 0x22, 0x5c, 0x6b, 0x4e, 0x82,
  0x54, 0xd6, 0x65, 0x93, 0xce, 0x60, 0xb2, 0x1c, 0x73, 0x56, 0xc0, 0x14, 0xa7, 0x8c, 0xf1, 0xdc,
  0x12, 0x75, 0xca, 0x1f, 0x3b, 0xbe, 0xe4, 0xd1, 0x42, 0x3d, 0xd4, 0x30, 0xa3, 0x3c, 0xb6, 0x26,
  0x6f, 0xbf, 0x0e, 0xda, 0x46, 0x69, 0x07, 0x57, 0x27, 0xf2, 0x1d, 0x9b, 0xbc, 0x94, 0x43, 0x03,
  0xf8, 0x11, 0xc7, 0xf6, 0x90, 0xef, 0x3e, 0xe7, 0x06, 0xc3, 0xd5, 0x2f, 0xc8, 0x66, 0x1e, 0xd7,
  0x08, 0xe8, 0xea, 0xde, 0x80, 0x52, 0xee, 0xf7, 0x84, 0xaa, 0x72, 0xac, 0x35, 0x4d, 0x6a, 0x2a,
  0x96, 0x1a, 0xd2, 0x71, 0x5a, 0x15, 0x49, 0x74, 0x4b, 0x9f, 0xd0, 0x5e, 0x04, 0x18, 0xa4, 0xec,
  0xc2, 0xe0, 0x41, 0x6e, 0x0f, 0x51, 0xcb, 0xcc, 0x24, 0x91, 0xaf, 0x50, 0xa1, 0xf4, 0x70, 0x39,
  0x99, 0x7c, 0x3a, 0x85, 0x23, 0xb8, 0xb4, 0x7a, 0xfc, 0x02, 0x36, 0x5b, 0x25, 0x55, 0x97, 0x31,
  0x2d, 0x5d, 0xfa, 0x98, 0xe3, 0x8a, 0x92, 0xae, 0x05, 0xdf, 0x29, 0x10, 0x67, 0x6c, 0xba, 0xc9,
  0xd3, 0x00, 0xe6, 0xcf, 0xe1, 0x9e, 0xa8, 0x2c, 0x63, 0x16, 0x01, 0x3f, 0x58, 0xe2, 0x89, 0xa9,
  0x0d, 0x38, 0x34, 0x1b, 0xab, 0x33, 0xff, 0xb0, 0xbb, 0x48, 0x0c, 0x5f, 0xb9, 0xb1, 0xcd, 0x2e,
  0xc5, 0xf3, 0xdb, 0x47, 0xe5, 0xa5, 0x9c, 0x77, 0x0a, 0xa6, 0x20, 0x68, 0xfe, 0x7f, 0xc1, 0xad,
]);

function rc2(key: Uint8Array, effectiveBits: number): BlockCipher {
  if (key.length < 1 || key.length > 128) {
    throw new OperationError(`RC2 takes a 1 to 128-byte key; this one is ${key.length}.`);
  }
  const bits = effectiveBits > 0 ? effectiveBits : key.length * 8;

  const l = new Uint8Array(128);
  l.set(key);
  for (let i = key.length; i < 128; i++) {
    l[i] = RC2_PITABLE[((l[i - 1] as number) + (l[i - key.length] as number)) & 0xff] as number;
  }

  const t8 = Math.ceil(bits / 8);
  const tm = 255 % 2 ** (8 + bits - 8 * t8);
  l[128 - t8] = RC2_PITABLE[(l[128 - t8] as number) & tm] as number;
  for (let i = 127 - t8; i >= 0; i--) {
    l[i] = RC2_PITABLE[(l[i + 1] as number) ^ (l[i + t8] as number)] as number;
  }

  const k = new Uint16Array(64);
  for (let i = 0; i < 64; i++) k[i] = (l[i * 2] as number) | ((l[i * 2 + 1] as number) << 8);

  const toWords = (block: Uint8Array) =>
    [0, 1, 2, 3].map((i) => (block[i * 2] as number) | ((block[i * 2 + 1] as number) << 8));
  const fromWords = (words: number[]) => {
    const out = new Uint8Array(8);
    for (let i = 0; i < 4; i++) {
      out[i * 2] = (words[i] as number) & 0xff;
      out[i * 2 + 1] = ((words[i] as number) >>> 8) & 0xff;
    }
    return out;
  };

  const rotate = [1, 2, 3, 5];

  return {
    blockSize: 8,
    encryptBlock(block) {
      const r = toWords(block);
      let j = 0;
      for (let round = 0; round < 16; round++) {
        for (let i = 0; i < 4; i++) {
          const value =
            ((r[i] as number) +
              (k[j++] as number) +
              ((r[(i + 3) % 4] as number) & (r[(i + 2) % 4] as number)) +
              (~(r[(i + 3) % 4] as number) & (r[(i + 1) % 4] as number))) &
            0xffff;
          const shift = rotate[i] as number;
          r[i] = ((value << shift) | (value >>> (16 - shift))) & 0xffff;
        }
        if (round === 4 || round === 10) {
          for (let i = 0; i < 4; i++) {
            r[i] = ((r[i] as number) + (k[(r[(i + 3) % 4] as number) & 63] as number)) & 0xffff;
          }
        }
      }
      return fromWords(r);
    },
    decryptBlock(block) {
      const r = toWords(block);
      let j = 63;
      for (let round = 15; round >= 0; round--) {
        if (round === 4 || round === 10) {
          for (let i = 3; i >= 0; i--) {
            r[i] = ((r[i] as number) - (k[(r[(i + 3) % 4] as number) & 63] as number)) & 0xffff;
          }
        }
        for (let i = 3; i >= 0; i--) {
          const shift = rotate[i] as number;
          const rotated = (((r[i] as number) >>> shift) | ((r[i] as number) << (16 - shift))) & 0xffff;
          r[i] =
            (rotated -
              (k[j--] as number) -
              ((r[(i + 3) % 4] as number) & (r[(i + 2) % 4] as number)) -
              (~(r[(i + 3) % 4] as number) & (r[(i + 1) % 4] as number))) &
            0xffff;
        }
      }
      return fromWords(r);
    },
  };
}


const PRESENT_SBOX = [0xc, 0x5, 0x6, 0xb, 0x9, 0x0, 0xa, 0xd, 0x3, 0xe, 0xf, 0x8, 0x4, 0x7, 0x1, 0x2];
const PRESENT_INVERSE = (() => {
  const inverse = new Array<number>(16);
  PRESENT_SBOX.forEach((value, index) => (inverse[value] = index));
  return inverse;
})();

function presentPermute(state: bigint, inverse: boolean): bigint {
  let out = 0n;
  for (let i = 0; i < 64; i++) {
    const target = i === 63 ? 63 : (16 * i) % 63;
    const bit = (state >> BigInt(inverse ? target : i)) & 1n;
    out |= bit << BigInt(inverse ? i : target);
  }
  return out;
}

function presentSubstitute(state: bigint, box: number[]): bigint {
  let out = 0n;
  for (let i = 0; i < 16; i++) {
    const nibble = Number((state >> BigInt(i * 4)) & 0xfn);
    out |= BigInt(box[nibble] as number) << BigInt(i * 4);
  }
  return out;
}

function present(key: Uint8Array): BlockCipher {
  if (key.length !== 10 && key.length !== 16) {
    throw new OperationError(`PRESENT takes a 10 or 16-byte key; this one is ${key.length}.`);
  }
  const wide = key.length === 16;
  const bits = BigInt(key.length * 8);
  let register = 0n;
  for (const byte of key) register = (register << 8n) | BigInt(byte);

  const roundKeys: bigint[] = [];
  for (let round = 1; round <= 32; round++) {
    roundKeys.push(register >> (bits - 64n));
    register = ((register << 61n) | (register >> (bits - 61n))) & ((1n << bits) - 1n);
    const top = Number((register >> (bits - 4n)) & 0xfn);
    register = (register & ~(0xfn << (bits - 4n))) | (BigInt(PRESENT_SBOX[top] as number) << (bits - 4n));
    if (wide) {
      const second = Number((register >> (bits - 8n)) & 0xfn);
      register =
        (register & ~(0xfn << (bits - 8n))) | (BigInt(PRESENT_SBOX[second] as number) << (bits - 8n));
    }
    const counterShift = wide ? 62n : 15n;
    register ^= BigInt(round) << counterShift;
  }
  roundKeys.push(register >> (bits - 64n));

  const toState = (block: Uint8Array) => {
    let value = 0n;
    for (const byte of block) value = (value << 8n) | BigInt(byte);
    return value;
  };
  const fromState = (value: bigint) => {
    const out = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) out[i] = Number((value >> BigInt((7 - i) * 8)) & 0xffn);
    return out;
  };

  return {
    blockSize: 8,
    encryptBlock(block) {
      let state = toState(block);
      for (let round = 0; round < 31; round++) {
        state ^= roundKeys[round] as bigint;
        state = presentSubstitute(state, PRESENT_SBOX);
        state = presentPermute(state, false);
      }
      return fromState(state ^ (roundKeys[31] as bigint));
    },
    decryptBlock(block) {
      let state = toState(block) ^ (roundKeys[31] as bigint);
      for (let round = 30; round >= 0; round--) {
        state = presentPermute(state, true);
        state = presentSubstitute(state, PRESENT_INVERSE);
        state ^= roundKeys[round] as bigint;
      }
      return fromState(state);
    },
  };
}


const RC6_P = 0xb7e15163;
const RC6_Q = 0x9e3779b9;

function rotl32(value: number, bits: number): number {
  const n = bits & 31;
  return ((value << n) | (value >>> (32 - n))) >>> 0;
}

function rotr32(value: number, bits: number): number {
  const n = bits & 31;
  return ((value >>> n) | (value << (32 - n))) >>> 0;
}

function rc6(key: Uint8Array): BlockCipher {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new OperationError(`RC6 takes a 16, 24 or 32-byte key; this one is ${key.length}.`);
  }
  const rounds = 20;
  const words = Math.ceil(key.length / 4);
  const l = new Uint32Array(words);
  for (let i = key.length - 1; i >= 0; i--) {
    l[Math.floor(i / 4)] = ((rotl32(l[Math.floor(i / 4)] as number, 8) | (key[i] as number)) >>> 0);
  }

  const size = 2 * rounds + 4;
  const s = new Uint32Array(size);
  s[0] = RC6_P;
  for (let i = 1; i < size; i++) s[i] = ((s[i - 1] as number) + RC6_Q) >>> 0;

  let a = 0;
  let b = 0;
  let i = 0;
  let j = 0;
  for (let k = 0; k < 3 * Math.max(size, words); k++) {
    a = s[i] = rotl32((((s[i] as number) + a + b) >>> 0), 3);
    b = l[j] = rotl32((((l[j] as number) + a + b) >>> 0), (a + b) >>> 0);
    i = (i + 1) % size;
    j = (j + 1) % words;
  }

  const toWords = (block: Uint8Array) =>
    [0, 1, 2, 3].map(
      (n) =>
        (((block[n * 4] as number) |
          ((block[n * 4 + 1] as number) << 8) |
          ((block[n * 4 + 2] as number) << 16) |
          ((block[n * 4 + 3] as number) << 24)) >>>
        0),
    );
  const fromWords = (values: number[]) => {
    const out = new Uint8Array(16);
    values.forEach((value, n) => {
      out[n * 4] = value & 0xff;
      out[n * 4 + 1] = (value >>> 8) & 0xff;
      out[n * 4 + 2] = (value >>> 16) & 0xff;
      out[n * 4 + 3] = (value >>> 24) & 0xff;
    });
    return out;
  };

  return {
    blockSize: 16,
    encryptBlock(block) {
      let [w, x, y, z] = toWords(block) as [number, number, number, number];
      x = (x + (s[0] as number)) >>> 0;
      z = (z + (s[1] as number)) >>> 0;
      for (let round = 1; round <= rounds; round++) {
        const t = rotl32(Math.imul(x, (2 * x + 1) >>> 0) >>> 0, 5);
        const u = rotl32(Math.imul(z, (2 * z + 1) >>> 0) >>> 0, 5);
        w = (rotl32((w ^ t) >>> 0, u) + (s[2 * round] as number)) >>> 0;
        y = (rotl32((y ^ u) >>> 0, t) + (s[2 * round + 1] as number)) >>> 0;
        [w, x, y, z] = [x, y, z, w];
      }
      w = (w + (s[2 * rounds + 2] as number)) >>> 0;
      y = (y + (s[2 * rounds + 3] as number)) >>> 0;
      return fromWords([w, x, y, z]);
    },
    decryptBlock(block) {
      let [w, x, y, z] = toWords(block) as [number, number, number, number];
      y = (y - (s[2 * rounds + 3] as number)) >>> 0;
      w = (w - (s[2 * rounds + 2] as number)) >>> 0;
      for (let round = rounds; round >= 1; round--) {
        [w, x, y, z] = [z, w, x, y];
        const u = rotl32(Math.imul(z, (2 * z + 1) >>> 0) >>> 0, 5);
        const t = rotl32(Math.imul(x, (2 * x + 1) >>> 0) >>> 0, 5);
        y = (rotr32((y - (s[2 * round + 1] as number)) >>> 0, t) ^ u) >>> 0;
        w = (rotr32((w - (s[2 * round] as number)) >>> 0, u) ^ t) >>> 0;
      }
      z = (z - (s[1] as number)) >>> 0;
      x = (x - (s[0] as number)) >>> 0;
      return fromWords([w, x, y, z]);
    },
  };
}

export const legacyCipherOperations: Operation[] = [
  {
    id: 'blowfish-encrypt',
    name: 'Blowfish Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with Blowfish, the cipher bcrypt is built on.',
    aliases: ['blowfish'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, true, (key) => blowfish(key)),
  },
  {
    id: 'blowfish-decrypt',
    name: 'Blowfish Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts Blowfish ciphertext.',
    aliases: ['blowfish decrypt'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, false, (key) => blowfish(key)),
  },
  {
    id: 'rc2-encrypt',
    name: 'RC2 Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with RC2, still found inside old PKCS#12 files.',
    aliases: ['rc2', 'arc2'],
    args: cipherArgs([
      { name: 'Effective key bits', type: 'number', value: 0, min: 0, max: 1024, hint: '0 uses the whole key' },
    ]),
    run: (input, args) =>
      runCipher(input, args, true, (key) => rc2(key, Number(arg(args, 'Effective key bits', 0)))),
  },
  {
    id: 'rc2-decrypt',
    name: 'RC2 Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts RC2 ciphertext.',
    aliases: ['rc2 decrypt', 'arc2 decrypt'],
    args: cipherArgs([
      { name: 'Effective key bits', type: 'number', value: 0, min: 0, max: 1024, hint: '0 uses the whole key' },
    ]),
    run: (input, args) =>
      runCipher(input, args, false, (key) => rc2(key, Number(arg(args, 'Effective key bits', 0)))),
  },
  {
    id: 'rc6-encrypt',
    name: 'RC6 Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with RC6, one of the five AES finalists.',
    aliases: ['rc6'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, true, (key) => rc6(key)),
  },
  {
    id: 'rc6-decrypt',
    name: 'RC6 Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts RC6 ciphertext.',
    aliases: ['rc6 decrypt'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, false, (key) => rc6(key)),
  },
  {
    id: 'present-encrypt',
    name: 'PRESENT Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with PRESENT, a block cipher small enough for a smart card.',
    aliases: ['present', 'lightweight cipher'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, true, (key) => present(key)),
  },
  {
    id: 'present-decrypt',
    name: 'PRESENT Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts PRESENT ciphertext.',
    aliases: ['present decrypt'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, false, (key) => present(key)),
  },
];
