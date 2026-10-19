import { OperationError } from '../types';
import { asBytes, toBytes } from '../core/bytes';
import { arg, type Operation } from './types';

const MD5_K = new Int32Array(
  Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)),
);
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

export function md5(bytes: Uint8Array): string {
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const m = new Int32Array(16);
    for (let i = 0; i < 16; i++) m[i] = view.getInt32(chunk + i * 4, true);

    let [a, b, c, d] = [a0, b0, c0, d0];

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      f = (f + a + MD5_K[i]! + m[g]!) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << MD5_S[i]!) | (f >>> (32 - MD5_S[i]!)))) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return [a0, b0, c0, d0]
    .map((word) =>
      Array.from({ length: 4 }, (_, i) =>
        ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0'),
      ).join(''),
    )
    .join('');
}


const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

export function adler32(bytes: Uint8Array): string {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) | a) >>> 0).toString(16).padStart(8, '0');
}

export function fletcher16(bytes: Uint8Array): string {
  let sum1 = 0;
  let sum2 = 0;
  for (const byte of bytes) {
    sum1 = (sum1 + byte) % 255;
    sum2 = (sum2 + sum1) % 255;
  }
  return (((sum2 << 8) | sum1) >>> 0).toString(16).padStart(4, '0');
}

function hex(value: number, digits: number): string {
  return (value >>> 0).toString(16).padStart(digits, '0');
}


function requireSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new OperationError('This needs a secure context (HTTPS or localhost).');
  }
  return crypto.subtle;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const HASH_NAMES = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

export const hashingOperations: Operation[] = [
  {
    id: 'md5',
    name: 'MD5',
    category: 'Hashing',
    description: 'Computes the MD5 digest. Broken for security use; ubiquitous everywhere else.',
    aliases: ['md5sum', 'message digest 5'],
    args: [],
    run: (input) => md5(asBytes(input)),
  },
  {
    id: 'hmac',
    name: 'HMAC',
    category: 'Hashing',
    description: 'Computes a keyed hash message authentication code.',
    aliases: ['keyed hash', 'hmac-sha256', 'message authentication'],
    args: [
      {
        name: 'Key',
        type: 'toggleString',
        value: '',
        toggleValues: ['UTF-8', 'Hex'],
        toggleValue: 'UTF-8',
      },
      { name: 'Hash', type: 'option', value: 'SHA-256', options: HASH_NAMES },
    ],
    run: async (input, args) => {
      const subtle = requireSubtle();
      const keyArg = args.find((a) => a.name === 'Key');
      const raw = String(keyArg?.value ?? '');
      if (raw.length === 0) throw new OperationError('HMAC needs a key.');

      let keyData: Uint8Array;
      if (keyArg?.toggleValue === 'Hex') {
        const cleaned = raw.replace(/[^0-9a-fA-F]/g, '');
        if (cleaned.length % 2 !== 0) throw new OperationError('Hex key needs an even digit count.');
        keyData = new Uint8Array(cleaned.length / 2);
        for (let i = 0; i < keyData.length; i++) keyData[i] = parseInt(cleaned.substr(i * 2, 2), 16);
      } else {
        keyData = toBytes(raw);
      }

      const hash = String(arg(args, 'Hash', 'SHA-256'));
      const key = await subtle.importKey(
        'raw',
        keyData as BufferSource,
        { name: 'HMAC', hash },
        false,
        ['sign'],
      );
      return toHex(await subtle.sign('HMAC', key, asBytes(input) as BufferSource));
    },
  },
  {
    id: 'pbkdf2',
    name: 'Derive PBKDF2 key',
    category: 'Hashing',
    description: 'Stretches a password into a key using PBKDF2.',
    aliases: ['key derivation', 'password based key', 'kdf'],
    args: [
      { name: 'Salt', type: 'string', value: '', hint: 'UTF-8' },
      { name: 'Iterations', type: 'number', value: 100000, min: 1, max: 5000000 },
      { name: 'Key length (bits)', type: 'number', value: 256, min: 8, max: 2048 },
      { name: 'Hash', type: 'option', value: 'SHA-256', options: HASH_NAMES },
    ],
    run: async (input, args) => {
      const subtle = requireSubtle();
      const material = await subtle.importKey('raw', asBytes(input) as BufferSource, 'PBKDF2', false, [
        'deriveBits',
      ]);
      const bits = await subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: toBytes(String(arg(args, 'Salt', ''))) as BufferSource,
          iterations: Number(arg(args, 'Iterations', 100000)),
          hash: String(arg(args, 'Hash', 'SHA-256')),
        },
        material,
        Number(arg(args, 'Key length (bits)', 256)),
      );
      return toHex(bits);
    },
  },
  {
    id: 'crc-32',
    name: 'CRC-32 Checksum',
    category: 'Hashing',
    description: 'Computes the CRC-32 checksum used by zip, gzip and PNG.',
    aliases: ['crc32', 'checksum'],
    args: [],
    run: (input) => hex(crc32(asBytes(input)), 8),
  },
  {
    id: 'crc-16',
    name: 'CRC-16 Checksum',
    category: 'Hashing',
    description: 'Computes the CRC-16 (Modbus) checksum.',
    aliases: ['crc16', 'modbus checksum'],
    args: [],
    run: (input) => hex(crc16(asBytes(input)), 4),
  },
  {
    id: 'adler-32',
    name: 'Adler-32 Checksum',
    category: 'Hashing',
    description: 'Computes the Adler-32 checksum used by zlib.',
    aliases: ['adler32'],
    args: [],
    run: (input) => adler32(asBytes(input)),
  },
  {
    id: 'fletcher-16',
    name: 'Fletcher-16 Checksum',
    category: 'Hashing',
    description: 'Computes the Fletcher-16 checksum.',
    aliases: ['fletcher16'],
    args: [],
    run: (input) => fletcher16(asBytes(input)),
  },
  {
    id: 'compare-hash',
    name: 'Compare to hash',
    category: 'Hashing',
    description: 'Hashes the input and says whether it matches a digest you paste in.',
    aliases: ['verify hash', 'check hash', 'match digest'],
    args: [
      { name: 'Expected digest', type: 'string', value: '' },
      { name: 'Hash', type: 'option', value: 'SHA-256', options: ['MD5', ...HASH_NAMES] },
    ],
    run: async (input, args) => {
      const expected = String(arg(args, 'Expected digest', '')).trim().toLowerCase();
      if (expected.length === 0) throw new OperationError('Paste the digest to compare against.');

      const algorithm = String(arg(args, 'Hash', 'SHA-256'));
      const actual =
        algorithm === 'MD5'
          ? md5(asBytes(input))
          : toHex(await requireSubtle().digest(algorithm, asBytes(input) as BufferSource));

      const match = actual === expected.replace(/^0x/, '');
      return [
        `${algorithm} of the input:`,
        `  ${actual}`,
        '',
        'Expected:',
        `  ${expected}`,
        '',
        match ? 'MATCH' : 'NO MATCH',
      ].join('\n');
    },
  },
];
