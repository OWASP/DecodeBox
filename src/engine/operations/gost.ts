import { OperationError, type OperationArg } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { type BlockCipher } from '../core/blockModes';
import { cipherArgs, runCipher } from './blockCiphers';
import { arg, toggle, type Operation } from './types';


const ENCRYPT_ORDER = [
  0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0,
];
const DECRYPT_ORDER = [...ENCRYPT_ORDER].reverse();

function parseSboxes(text: string): Uint8Array[] {
  const lines = text
    .split(/[\r\n;]+/)
    .map((line) => line.replace(/[^0-9a-fA-F]/g, ''))
    .filter((line) => line.length > 0);

  if (lines.length !== 8) {
    throw new OperationError(
      `GOST needs eight S-boxes, one per line of sixteen hexadecimal digits, and ${lines.length} were given.`,
    );
  }

  return lines.map((line, i) => {
    if (line.length !== 16) {
      throw new OperationError(`S-box ${i + 1} needs sixteen digits, and ${line.length} were given.`);
    }
    const box = Uint8Array.from(line, (c) => Number.parseInt(c, 16));
    if (new Set(box).size !== 16) {
      throw new OperationError(`S-box ${i + 1} repeats a value, so it is not a permutation.`);
    }
    return box;
  });
}

function readKey(key: Uint8Array): Uint32Array {
  if (key.length !== 32) {
    throw new OperationError(`A GOST key is 32 bytes; this one is ${key.length}.`);
  }
  const words = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    words[i] =
      (key[i * 4]! | (key[i * 4 + 1]! << 8) | (key[i * 4 + 2]! << 16) | (key[i * 4 + 3]! << 24)) >>> 0;
  }
  return words;
}

function makeRound(boxes: Uint8Array[]): (value: number, key: number) => number {
  return (value, key) => {
    const sum = (value + key) >>> 0;
    let out = 0;
    for (let nibble = 0; nibble < 8; nibble++) {
      out |= boxes[nibble]![(sum >>> (nibble * 4)) & 0x0f]! << (nibble * 4);
    }
    out >>>= 0;
    return ((out << 11) | (out >>> 21)) >>> 0;
  };
}

function readWord(bytes: Uint8Array, at: number): number {
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
}

function writeWord(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
  bytes[at + 2] = (value >>> 16) & 0xff;
  bytes[at + 3] = (value >>> 24) & 0xff;
}

export function gost(key: Uint8Array, boxes: Uint8Array[]): BlockCipher {
  const words = readKey(key);
  const f = makeRound(boxes);

  const transform = (block: Uint8Array, order: number[]): Uint8Array => {
    let n1 = readWord(block, 0);
    let n2 = readWord(block, 4);

    for (let round = 0; round < 32; round++) {
      const mixed = (n2 ^ f(n1, words[order[round]!]!)) >>> 0;
      if (round === 31) n2 = mixed;
      else {
        n2 = n1;
        n1 = mixed;
      }
    }

    const out = new Uint8Array(8);
    writeWord(out, 0, n1);
    writeWord(out, 4, n2);
    return out;
  };

  return {
    blockSize: 8,
    encryptBlock: (block) => transform(block, ENCRYPT_ORDER),
    decryptBlock: (block) => transform(block, DECRYPT_ORDER),
  };
}

function mac(key: Uint8Array, boxes: Uint8Array[], data: Uint8Array, iv: Uint8Array): Uint8Array {
  const words = readKey(key);
  const f = makeRound(boxes);

  let n1 = readWord(iv, 0);
  let n2 = readWord(iv, 4);

  const padded = new Uint8Array(Math.ceil(Math.max(data.length, 8) / 8) * 8);
  padded.set(data);

  for (let at = 0; at < padded.length; at += 8) {
    n1 = (n1 ^ readWord(padded, at)) >>> 0;
    n2 = (n2 ^ readWord(padded, at + 4)) >>> 0;

    for (let round = 0; round < 16; round++) {
      const mixed = (n2 ^ f(n1, words[round % 8]!)) >>> 0;
      n2 = n1;
      n1 = mixed;
    }
  }

  const out = new Uint8Array(8);
  writeWord(out, 0, n1);
  writeWord(out, 4, n2);
  return out.subarray(0, 4);
}


const SBOX_ARG = {
  name: 'S-boxes',
  type: 'textarea' as const,
  value: '',
  hint: 'Eight lines of sixteen hexadecimal digits, one line per S-box',
};

function boxesFrom(args: OperationArg[]): Uint8Array[] {
  return parseSboxes(String(arg(args, 'S-boxes', '')));
}

function keyBytes(value: string, format: string, name: string, size: number): Uint8Array {
  const bytes =
    format === 'Hex'
      ? Uint8Array.from(value.replace(/[^0-9a-fA-F]/g, '').match(/../g) ?? [], (p) =>
          Number.parseInt(p, 16),
        )
      : asBytes(value);
  if (bytes.length !== size) {
    throw new OperationError(`The ${name} is ${size} bytes; this one is ${bytes.length}.`);
  }
  return bytes;
}

export const gostOperations: Operation[] = [
  {
    id: 'gost-encrypt',
    name: 'GOST Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with GOST 28147-89, whose S-boxes are a parameter rather than a constant.',
    aliases: ['gost', 'magma', 'russian cipher', '28147'],
    args: [SBOX_ARG, ...cipherArgs()],
    run: (input, args) => {
      const boxes = boxesFrom(args);
      return runCipher(input, args, true, (key) => gost(key, boxes));
    },
  },
  {
    id: 'gost-decrypt',
    name: 'GOST Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts GOST 28147-89 ciphertext.',
    aliases: ['gost decrypt', 'magma decrypt'],
    args: [SBOX_ARG, ...cipherArgs()],
    run: (input, args) => {
      const boxes = boxesFrom(args);
      return runCipher(input, args, false, (key) => gost(key, boxes));
    },
  },
  {
    id: 'gost-key-wrap',
    name: 'GOST Key Wrap',
    category: 'Encryption / Encoding',
    description: 'Wraps a 32-byte key under another with GOST, as RFC 4357 describes.',
    aliases: ['gost kek', 'wrap gost key', 'rfc 4357'],
    args: [
      SBOX_ARG,
      {
        name: 'Key encryption key',
        type: 'toggleString',
        value: '',
        toggleValues: ['Hex', 'UTF-8'],
        toggleValue: 'Hex',
        hint: '32 bytes',
      },
      {
        name: 'UKM',
        type: 'toggleString',
        value: '',
        toggleValues: ['Hex', 'UTF-8'],
        toggleValue: 'Hex',
        hint: '8 bytes of user keying material',
      },
      { name: 'Input', type: 'option', value: 'Hex', options: ['Hex', 'Raw'] },
      { name: 'Output', type: 'option', value: 'Hex', options: ['Hex', 'Raw'] },
    ],
    run: (input, args) => {
      const boxes = boxesFrom(args);
      const kek = keyBytes(
        String(arg(args, 'Key encryption key', '')),
        toggle(args, 'Key encryption key', 'Hex'),
        'key encryption key',
        32,
      );
      const ukm = keyBytes(String(arg(args, 'UKM', '')), toggle(args, 'UKM', 'Hex'), 'UKM', 8);
      const cek = keyBytes(input, String(arg(args, 'Input', 'Hex')), 'key to wrap', 32);

      const cipher = gost(kek, boxes);
      const encrypted = new Uint8Array(32);
      for (let at = 0; at < 32; at += 8) {
        encrypted.set(cipher.encryptBlock(cek.subarray(at, at + 8)), at);
      }
      const tag = mac(kek, boxes, cek, ukm);

      const out = new Uint8Array(44);
      out.set(ukm, 0);
      out.set(encrypted, 8);
      out.set(tag, 40);
      return arg(args, 'Output', 'Hex') === 'Hex'
        ? Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('')
        : bytesToLatin1(out);
    },
  },
  {
    id: 'gost-key-unwrap',
    name: 'GOST Key Unwrap',
    category: 'Encryption / Encoding',
    description: 'Unwraps a GOST-wrapped key and checks the MAC that binds it.',
    aliases: ['gost unwrap', 'unwrap gost key'],
    args: [
      SBOX_ARG,
      {
        name: 'Key encryption key',
        type: 'toggleString',
        value: '',
        toggleValues: ['Hex', 'UTF-8'],
        toggleValue: 'Hex',
        hint: '32 bytes',
      },
      { name: 'Input', type: 'option', value: 'Hex', options: ['Hex', 'Raw'] },
      { name: 'Output', type: 'option', value: 'Hex', options: ['Hex', 'Raw'] },
    ],
    run: (input, args) => {
      const boxes = boxesFrom(args);
      const kek = keyBytes(
        String(arg(args, 'Key encryption key', '')),
        toggle(args, 'Key encryption key', 'Hex'),
        'key encryption key',
        32,
      );
      const wrapped = keyBytes(input, String(arg(args, 'Input', 'Hex')), 'wrapped key', 44);

      const ukm = wrapped.subarray(0, 8);
      const encrypted = wrapped.subarray(8, 40);
      const tag = wrapped.subarray(40, 44);

      const cipher = gost(kek, boxes);
      const cek = new Uint8Array(32);
      for (let at = 0; at < 32; at += 8) {
        cek.set(cipher.decryptBlock(encrypted.subarray(at, at + 8)), at);
      }

      const expected = mac(kek, boxes, cek, ukm);
      if (!expected.every((byte, i) => byte === tag[i])) {
        throw new OperationError(
          'The MAC does not match: the key encryption key is wrong, or the wrapped key has been altered.',
        );
      }
      return arg(args, 'Output', 'Hex') === 'Hex'
        ? Array.from(cek, (b) => b.toString(16).padStart(2, '0')).join('')
        : bytesToLatin1(cek);
    },
  },
];
