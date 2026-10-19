import { OperationError, type OperationArg } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import {
  BLOCK_MODES,
  PADDING_OPTIONS,
  decryptBlocks,
  encryptBlocks,
  type BlockCipher,
} from '../core/blockModes';
import { parseKey, KEY_FORMATS } from './keys';
import { arg, toggle, type Operation } from './types';



const IO_FORMATS = ['Raw', 'Hex'];

export function cipherArgs(ivName = 'IV'): OperationArg[] {
  return [
    { name: 'Key', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
    { name: ivName, type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
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

function keyFrom(args: OperationArg[], name = 'Key'): Uint8Array {
  return parseKey(String(arg(args, name, '')), toggle(args, name, 'Hex'), false);
}

function ivFrom(args: OperationArg[], name = 'IV'): Uint8Array {
  return parseKey(String(arg(args, name, '')), toggle(args, name, 'Hex'), true);
}

export function runCipher(
  input: string,
  args: OperationArg[],
  encrypt: boolean,
  build: (key: Uint8Array) => BlockCipher,
): string {
  const cipher = build(keyFrom(args));
  const mode = String(arg(args, 'Mode', 'CBC'));
  const padding = String(arg(args, 'Padding', 'PKCS#7'));
  const data = readData(input, String(arg(args, 'Input', 'Raw')));
  const iv = ivFrom(args);

  const out = encrypt
    ? encryptBlocks(cipher, data, mode, iv, padding)
    : decryptBlocks(cipher, data, mode, iv, padding);
  return writeData(out, String(arg(args, 'Output', 'Hex')));
}


const TEA_DELTA = 0x9e3779b9;

function readWords(key: Uint8Array, count: number, name: string): Uint32Array {
  if (key.length !== count * 4) {
    throw new OperationError(`${name} needs a ${count * 4}-byte key; this one is ${key.length}.`);
  }
  const words = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    words[i] =
      ((key[i * 4] as number) << 24) |
      ((key[i * 4 + 1] as number) << 16) |
      ((key[i * 4 + 2] as number) << 8) |
      (key[i * 4 + 3] as number);
  }
  return words;
}

function blockToWords(block: Uint8Array): [number, number] {
  return [
    (((block[0] as number) << 24) | ((block[1] as number) << 16) | ((block[2] as number) << 8) | (block[3] as number)) >>> 0,
    (((block[4] as number) << 24) | ((block[5] as number) << 16) | ((block[6] as number) << 8) | (block[7] as number)) >>> 0,
  ];
}

function wordsToBlock(v0: number, v1: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = (v0 >>> 24) & 0xff;
  out[1] = (v0 >>> 16) & 0xff;
  out[2] = (v0 >>> 8) & 0xff;
  out[3] = v0 & 0xff;
  out[4] = (v1 >>> 24) & 0xff;
  out[5] = (v1 >>> 16) & 0xff;
  out[6] = (v1 >>> 8) & 0xff;
  out[7] = v1 & 0xff;
  return out;
}

function tea(key: Uint8Array): BlockCipher {
  const k = readWords(key, 4, 'TEA');
  return {
    blockSize: 8,
    encryptBlock(block) {
      let [v0, v1] = blockToWords(block);
      let sum = 0;
      for (let i = 0; i < 32; i++) {
        sum = (sum + TEA_DELTA) >>> 0;
        v0 = (v0 + ((((v1 << 4) >>> 0) + (k[0] as number)) ^ ((v1 + sum) >>> 0) ^ (((v1 >>> 5) + (k[1] as number)) >>> 0))) >>> 0;
        v1 = (v1 + ((((v0 << 4) >>> 0) + (k[2] as number)) ^ ((v0 + sum) >>> 0) ^ (((v0 >>> 5) + (k[3] as number)) >>> 0))) >>> 0;
      }
      return wordsToBlock(v0, v1);
    },
    decryptBlock(block) {
      let [v0, v1] = blockToWords(block);
      let sum = (TEA_DELTA * 32) >>> 0;
      for (let i = 0; i < 32; i++) {
        v1 = (v1 - ((((v0 << 4) >>> 0) + (k[2] as number)) ^ ((v0 + sum) >>> 0) ^ (((v0 >>> 5) + (k[3] as number)) >>> 0))) >>> 0;
        v0 = (v0 - ((((v1 << 4) >>> 0) + (k[0] as number)) ^ ((v1 + sum) >>> 0) ^ (((v1 >>> 5) + (k[1] as number)) >>> 0))) >>> 0;
        sum = (sum - TEA_DELTA) >>> 0;
      }
      return wordsToBlock(v0, v1);
    },
  };
}

function xtea(key: Uint8Array): BlockCipher {
  const k = readWords(key, 4, 'XTEA');
  return {
    blockSize: 8,
    encryptBlock(block) {
      let [v0, v1] = blockToWords(block);
      let sum = 0;
      for (let i = 0; i < 32; i++) {
        v0 = (v0 + (((((v1 << 4) >>> 0) ^ (v1 >>> 5)) + v1) ^ (sum + (k[sum & 3] as number)))) >>> 0;
        sum = (sum + TEA_DELTA) >>> 0;
        v1 = (v1 + (((((v0 << 4) >>> 0) ^ (v0 >>> 5)) + v0) ^ (sum + (k[(sum >>> 11) & 3] as number)))) >>> 0;
      }
      return wordsToBlock(v0, v1);
    },
    decryptBlock(block) {
      let [v0, v1] = blockToWords(block);
      let sum = (TEA_DELTA * 32) >>> 0;
      for (let i = 0; i < 32; i++) {
        v1 = (v1 - (((((v0 << 4) >>> 0) ^ (v0 >>> 5)) + v0) ^ (sum + (k[(sum >>> 11) & 3] as number)))) >>> 0;
        sum = (sum - TEA_DELTA) >>> 0;
        v0 = (v0 - (((((v1 << 4) >>> 0) ^ (v1 >>> 5)) + v1) ^ (sum + (k[sum & 3] as number)))) >>> 0;
      }
      return wordsToBlock(v0, v1);
    },
  };
}

function xxtea(data: Uint32Array, key: Uint32Array, encrypt: boolean): Uint32Array {
  const n = data.length;
  if (n < 2) return data;

  const mx = (sum: number, y: number, z: number, p: number, e: number) =>
    ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + ((key[(p & 3) ^ e] as number) ^ z))) >>> 0;

  const rounds = 6 + Math.floor(52 / n);
  let sum = 0;

  if (encrypt) {
    let z = data[n - 1] as number;
    for (let round = 0; round < rounds; round++) {
      sum = (sum + TEA_DELTA) >>> 0;
      const e = (sum >>> 2) & 3;
      let p = 0;
      for (; p < n - 1; p++) {
        const y = data[p + 1] as number;
        z = data[p] = ((data[p] as number) + mx(sum, y, z, p, e)) >>> 0;
      }
      const y = data[0] as number;
      z = data[n - 1] = ((data[n - 1] as number) + mx(sum, y, z, p, e)) >>> 0;
    }
    return data;
  }

  sum = (rounds * TEA_DELTA) >>> 0;
  let y = data[0] as number;
  for (let round = 0; round < rounds; round++) {
    const e = (sum >>> 2) & 3;
    let p = n - 1;
    for (; p > 0; p--) {
      const z = data[p - 1] as number;
      y = data[p] = ((data[p] as number) - mx(sum, y, z, p, e)) >>> 0;
    }
    const z = data[n - 1] as number;
    y = data[0] = ((data[0] as number) - mx(sum, y, z, 0, e)) >>> 0;
    sum = (sum - TEA_DELTA) >>> 0;
  }
  return data;
}

function toUint32Array(bytes: Uint8Array, includeLength: boolean): Uint32Array {
  const n = Math.ceil(bytes.length / 4);
  const words = new Uint32Array(includeLength ? n + 1 : n);
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] = ((words[i >> 2] as number) | ((bytes[i] as number) << ((i & 3) << 3))) >>> 0;
  }
  if (includeLength) words[n] = bytes.length;
  return words;
}

function fromUint32Array(words: Uint32Array, includeLength: boolean): Uint8Array {
  let length = words.length << 2;
  if (includeLength) {
    const claimed = words[words.length - 1] as number;
    length -= 4;
    if (claimed < length - 3 || claimed > length) {
      throw new OperationError('The length XXTEA recorded does not match the data.');
    }
    length = claimed;
  }
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = ((words[i >> 2] as number) >>> ((i & 3) << 3)) & 0xff;
  return out;
}


const DES_PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60,
  52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21,
  13, 5, 28, 20, 12, 4,
];

const DES_PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2, 41, 52,
  31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];

const DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

const DES_IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6, 64,
  56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53,
  45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];

const DES_FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37,
  5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2,
  42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];

const DES_E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18,
  19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];

const DES_P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19, 13,
  30, 6, 22, 11, 4, 25,
];

const DES_S = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

function bitsFromBytes(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (const byte of bytes) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  return bits;
}

function bytesFromBits(bits: number[]): Uint8Array {
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bits.length; i++) {
    out[i >> 3] = ((out[i >> 3] as number) << 1) | (bits[i] as number);
  }
  return out;
}

function permute(bits: number[], table: number[]): number[] {
  return table.map((position) => bits[position - 1] as number);
}

function desSubkeys(key: Uint8Array): number[][] {
  if (key.length !== 8) {
    throw new OperationError(`DES needs an 8-byte key; this one is ${key.length}.`);
  }
  const permuted = permute(bitsFromBytes(key), DES_PC1);
  let left = permuted.slice(0, 28);
  let right = permuted.slice(28);

  return DES_SHIFTS.map((shift) => {
    left = [...left.slice(shift), ...left.slice(0, shift)];
    right = [...right.slice(shift), ...right.slice(0, shift)];
    return permute([...left, ...right], DES_PC2);
  });
}

function desBlock(bits: number[], subkeys: number[][]): number[] {
  const permuted = permute(bits, DES_IP);
  let left = permuted.slice(0, 32);
  let right = permuted.slice(32);

  for (const subkey of subkeys) {
    const expanded = permute(right, DES_E).map((bit, i) => bit ^ (subkey[i] as number));
    const substituted: number[] = [];
    for (let box = 0; box < 8; box++) {
      const chunk = expanded.slice(box * 6, box * 6 + 6);
      const row = ((chunk[0] as number) << 1) | (chunk[5] as number);
      const column =
        ((chunk[1] as number) << 3) | ((chunk[2] as number) << 2) | ((chunk[3] as number) << 1) | (chunk[4] as number);
      const value = (DES_S[box] as number[])[row * 16 + column] as number;
      for (let i = 3; i >= 0; i--) substituted.push((value >> i) & 1);
    }
    const mixed = permute(substituted, DES_P).map((bit, i) => bit ^ (left[i] as number));
    left = right;
    right = mixed;
  }
  return permute([...right, ...left], DES_FP);
}

export function des(key: Uint8Array): BlockCipher {
  const subkeys = desSubkeys(key);
  const reversed = [...subkeys].reverse();
  return {
    blockSize: 8,
    encryptBlock: (block) => bytesFromBits(desBlock(bitsFromBytes(block), subkeys)),
    decryptBlock: (block) => bytesFromBits(desBlock(bitsFromBytes(block), reversed)),
  };
}

function tripleDes(key: Uint8Array): BlockCipher {
  if (key.length !== 24 && key.length !== 16) {
    throw new OperationError(`Triple DES needs a 16 or 24-byte key; this one is ${key.length}.`);
  }
  const first = des(key.subarray(0, 8));
  const second = des(key.subarray(8, 16));
  const third = des(key.length === 24 ? key.subarray(16, 24) : key.subarray(0, 8));

  return {
    blockSize: 8,
    encryptBlock: (block) => third.encryptBlock(second.decryptBlock(first.encryptBlock(block))),
    decryptBlock: (block) => first.decryptBlock(second.encryptBlock(third.decryptBlock(block))),
  };
}


const SM4_SBOX = new Uint8Array([
  0xd6, 0x90, 0xe9, 0xfe, 0xcc, 0xe1, 0x3d, 0xb7, 0x16, 0xb6, 0x14, 0xc2, 0x28, 0xfb, 0x2c, 0x05,
  0x2b, 0x67, 0x9a, 0x76, 0x2a, 0xbe, 0x04, 0xc3, 0xaa, 0x44, 0x13, 0x26, 0x49, 0x86, 0x06, 0x99,
  0x9c, 0x42, 0x50, 0xf4, 0x91, 0xef, 0x98, 0x7a, 0x33, 0x54, 0x0b, 0x43, 0xed, 0xcf, 0xac, 0x62,
  0xe4, 0xb3, 0x1c, 0xa9, 0xc9, 0x08, 0xe8, 0x95, 0x80, 0xdf, 0x94, 0xfa, 0x75, 0x8f, 0x3f, 0xa6,
  0x47, 0x07, 0xa7, 0xfc, 0xf3, 0x73, 0x17, 0xba, 0x83, 0x59, 0x3c, 0x19, 0xe6, 0x85, 0x4f, 0xa8,
  0x68, 0x6b, 0x81, 0xb2, 0x71, 0x64, 0xda, 0x8b, 0xf8, 0xeb, 0x0f, 0x4b, 0x70, 0x56, 0x9d, 0x35,
  0x1e, 0x24, 0x0e, 0x5e, 0x63, 0x58, 0xd1, 0xa2, 0x25, 0x22, 0x7c, 0x3b, 0x01, 0x21, 0x78, 0x87,
  0xd4, 0x00, 0x46, 0x57, 0x9f, 0xd3, 0x27, 0x52, 0x4c, 0x36, 0x02, 0xe7, 0xa0, 0xc4, 0xc8, 0x9e,
  0xea, 0xbf, 0x8a, 0xd2, 0x40, 0xc7, 0x38, 0xb5, 0xa3, 0xf7, 0xf2, 0xce, 0xf9, 0x61, 0x15, 0xa1,
  0xe0, 0xae, 0x5d, 0xa4, 0x9b, 0x34, 0x1a, 0x55, 0xad, 0x93, 0x32, 0x30, 0xf5, 0x8c, 0xb1, 0xe3,
  0x1d, 0xf6, 0xe2, 0x2e, 0x82, 0x66, 0xca, 0x60, 0xc0, 0x29, 0x23, 0xab, 0x0d, 0x53, 0x4e, 0x6f,
  0xd5, 0xdb, 0x37, 0x45, 0xde, 0xfd, 0x8e, 0x2f, 0x03, 0xff, 0x6a, 0x72, 0x6d, 0x6c, 0x5b, 0x51,
  0x8d, 0x1b, 0xaf, 0x92, 0xbb, 0xdd, 0xbc, 0x7f, 0x11, 0xd9, 0x5c, 0x41, 0x1f, 0x10, 0x5a, 0xd8,
  0x0a, 0xc1, 0x31, 0x88, 0xa5, 0xcd, 0x7b, 0xbd, 0x2d, 0x74, 0xd0, 0x12, 0xb8, 0xe5, 0xb4, 0xb0,
  0x89, 0x69, 0x97, 0x4a, 0x0c, 0x96, 0x77, 0x7e, 0x65, 0xb9, 0xf1, 0x09, 0xc5, 0x6e, 0xc6, 0x84,
  0x18, 0xf0, 0x7d, 0xec, 0x3a, 0xdc, 0x4d, 0x20, 0x79, 0xee, 0x5f, 0x3e, 0xd7, 0xcb, 0x39, 0x48,
]);

const SM4_FK = [0xa3b1bac6, 0x56aa3350, 0x677d9197, 0xb27022dc];

const SM4_CK = (() => {
  const ck = new Uint32Array(32);
  for (let i = 0; i < 32; i++) {
    let value = 0;
    for (let j = 0; j < 4; j++) value = ((value << 8) | ((4 * i + j) * 7) % 256) >>> 0;
    ck[i] = value;
  }
  return ck;
})();

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function sm4Substitute(word: number): number {
  return (
    (((SM4_SBOX[(word >>> 24) & 0xff] as number) << 24) |
      ((SM4_SBOX[(word >>> 16) & 0xff] as number) << 16) |
      ((SM4_SBOX[(word >>> 8) & 0xff] as number) << 8) |
      (SM4_SBOX[word & 0xff] as number)) >>>
    0
  );
}

function sm4(key: Uint8Array): BlockCipher {
  if (key.length !== 16) {
    throw new OperationError(`SM4 needs a 16-byte key; this one is ${key.length}.`);
  }
  const mk = readWords(key, 4, 'SM4');
  const k = new Uint32Array(36);
  for (let i = 0; i < 4; i++) k[i] = ((mk[i] as number) ^ (SM4_FK[i] as number)) >>> 0;

  const roundKeys = new Uint32Array(32);
  for (let i = 0; i < 32; i++) {
    const t = sm4Substitute(
      ((k[i + 1] as number) ^ (k[i + 2] as number) ^ (k[i + 3] as number) ^ (SM4_CK[i] as number)) >>> 0,
    );
    k[i + 4] = ((k[i] as number) ^ t ^ rotl(t, 13) ^ rotl(t, 23)) >>> 0;
    roundKeys[i] = k[i + 4] as number;
  }

  const round = (block: Uint8Array, keys: Uint32Array | number[]) => {
    const x = new Uint32Array(36);
    for (let i = 0; i < 4; i++) {
      x[i] =
        (((block[i * 4] as number) << 24) |
          ((block[i * 4 + 1] as number) << 16) |
          ((block[i * 4 + 2] as number) << 8) |
          (block[i * 4 + 3] as number)) >>>
        0;
    }
    for (let i = 0; i < 32; i++) {
      const t = sm4Substitute(
        ((x[i + 1] as number) ^ (x[i + 2] as number) ^ (x[i + 3] as number) ^ (keys[i] as number)) >>> 0,
      );
      x[i + 4] = ((x[i] as number) ^ t ^ rotl(t, 2) ^ rotl(t, 10) ^ rotl(t, 18) ^ rotl(t, 24)) >>> 0;
    }
    const out = new Uint8Array(16);
    for (let i = 0; i < 4; i++) {
      const word = x[35 - i] as number;
      out[i * 4] = (word >>> 24) & 0xff;
      out[i * 4 + 1] = (word >>> 16) & 0xff;
      out[i * 4 + 2] = (word >>> 8) & 0xff;
      out[i * 4 + 3] = word & 0xff;
    }
    return out;
  };

  return {
    blockSize: 16,
    encryptBlock: (block) => round(block, roundKeys),
    decryptBlock: (block) => round(block, [...roundKeys].reverse()),
  };
}

export const blockCipherOperations: Operation[] = [
  {
    id: 'des-encrypt',
    name: 'DES Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with DES, the 56-bit block cipher of 1977.',
    aliases: ['des'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, true, des),
  },
  {
    id: 'des-decrypt',
    name: 'DES Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts DES ciphertext.',
    aliases: ['des decrypt'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, false, des),
  },
  {
    id: 'triple-des-encrypt',
    name: 'Triple DES Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with Triple DES in encrypt-decrypt-encrypt order.',
    aliases: ['3des', 'tdea', 'des3'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, true, tripleDes),
  },
  {
    id: 'triple-des-decrypt',
    name: 'Triple DES Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts Triple DES ciphertext.',
    aliases: ['3des decrypt', 'tdea decrypt'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, false, tripleDes),
  },
  {
    id: 'tea-encrypt',
    name: 'TEA Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with the Tiny Encryption Algorithm.',
    aliases: ['tea'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, true, tea),
  },
  {
    id: 'tea-decrypt',
    name: 'TEA Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts TEA ciphertext.',
    aliases: ['tea decrypt'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, false, tea),
  },
  {
    id: 'xtea-encrypt',
    name: 'XTEA Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with XTEA, the corrected form of TEA.',
    aliases: ['xtea'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, true, xtea),
  },
  {
    id: 'xtea-decrypt',
    name: 'XTEA Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts XTEA ciphertext.',
    aliases: ['xtea decrypt'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, false, xtea),
  },
  {
    id: 'xxtea-encrypt',
    name: 'XXTEA Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts the whole message at once with XXTEA.',
    aliases: ['xxtea', 'corrected block tea'],
    args: [
      { name: 'Key', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
    ],
    run: (input, args) => {
      const key = readWords(keyFrom(args), 4, 'XXTEA');
      const data = toUint32Array(asBytes(input), true);
      return bytesToLatin1(fromUint32Array(xxtea(data, key, true), false));
    },
  },
  {
    id: 'xxtea-decrypt',
    name: 'XXTEA Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts an XXTEA message.',
    aliases: ['xxtea decrypt'],
    args: [
      { name: 'Key', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
    ],
    run: (input, args) => {
      const key = readWords(keyFrom(args), 4, 'XXTEA');
      const data = toUint32Array(asBytes(input), false);
      return bytesToLatin1(fromUint32Array(xxtea(data, key, false), true));
    },
  },
  {
    id: 'sm4-encrypt',
    name: 'SM4 Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with SM4, the Chinese national block cipher.',
    aliases: ['sm4', 'gb/t 32907'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, true, sm4),
  },
  {
    id: 'sm4-decrypt',
    name: 'SM4 Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts SM4 ciphertext.',
    aliases: ['sm4 decrypt'],
    args: cipherArgs(),
    run: (input, args) => runCipher(input, args, false, sm4),
  },
];
