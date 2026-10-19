import { asBytes } from '../core/bytes';
import { arg, type Operation } from './types';
import { getOperation } from './registryAccess';


function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function rotl32(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}


const HAS160_EXPANSION = [
  [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [8, 9, 10, 11],
    [12, 13, 14, 15],
  ],
  [
    [3, 6, 9, 12],
    [2, 5, 8, 15],
    [1, 4, 11, 14],
    [0, 7, 10, 13],
  ],
  [
    [5, 7, 12, 14],
    [0, 2, 9, 11],
    [4, 6, 13, 15],
    [1, 3, 8, 10],
  ],
  [
    [2, 7, 8, 13],
    [3, 4, 9, 14],
    [0, 5, 10, 15],
    [1, 6, 11, 12],
  ],
];

const HAS160_ORDER = [
  [18, 0, 1, 2, 3, 19, 4, 5, 6, 7, 16, 8, 9, 10, 11, 17, 12, 13, 14, 15],
  [18, 3, 6, 9, 12, 19, 15, 2, 5, 8, 16, 11, 14, 1, 4, 17, 7, 10, 13, 0],
  [18, 12, 5, 14, 7, 19, 0, 9, 2, 11, 16, 4, 13, 6, 15, 17, 8, 1, 10, 3],
  [18, 7, 2, 13, 8, 19, 3, 14, 9, 4, 16, 15, 10, 5, 0, 17, 11, 6, 1, 12],
];

const HAS160_ROTATIONS = [5, 11, 7, 15, 6, 13, 8, 14, 7, 12, 9, 11, 8, 15, 6, 12, 9, 14, 5, 13];
const HAS160_SHIFTS = [10, 17, 25, 30];
const HAS160_CONSTANTS = [0, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc];

function has160(message: Uint8Array): Uint8Array {
  const bitLength = BigInt(message.length) * 8n;
  const totalLength = (((message.length + 8) >> 6) + 1) * 64;
  const padded = new Uint8Array(totalLength);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalLength - 8, Number(bitLength & 0xffffffffn), true);
  view.setUint32(totalLength - 4, Number((bitLength >> 32n) & 0xffffffffn), true);

  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

  for (let at = 0; at < totalLength; at += 64) {
    const x = new Uint32Array(20);
    for (let i = 0; i < 16; i++) x[i] = view.getUint32(at + i * 4, true);

    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let round = 0; round < 4; round++) {
      (HAS160_EXPANSION[round] as number[][]).forEach((indexes, slot) => {
        x[16 + slot] =
          ((x[indexes[0] as number] as number) ^
            (x[indexes[1] as number] as number) ^
            (x[indexes[2] as number] as number) ^
            (x[indexes[3] as number] as number)) >>>
          0;
      });

      const constant = HAS160_CONSTANTS[round] as number;
      for (let step = 0; step < 20; step++) {
        const f =
          round === 0
            ? ((b & c) | (~b & d)) >>> 0
            : round === 1
              ? (b ^ c ^ d) >>> 0
              : round === 2
                ? (c ^ (b | ~d)) >>> 0
                : (b ^ c ^ d) >>> 0;
        const index = (HAS160_ORDER[round] as number[])[step] as number;
        const rotation = HAS160_ROTATIONS[step] as number;
        const temp = (rotl32(a, rotation) + f + e + (x[index] as number) + constant) >>> 0;
        e = d;
        d = c;
        c = rotl32(b, HAS160_SHIFTS[round] as number);
        b = a;
        a = temp;
      }
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const result = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((value, i) => result.setUint32(i * 4, value, true));
  return out;
}


const ALL_HASHES: Array<{ label: string; id: string; args?: Record<string, string> }> = [
  { label: 'MD2', id: 'md2' },
  { label: 'MD4', id: 'md4' },
  { label: 'MD5', id: 'md5' },
  { label: 'SHA0', id: 'sha-0' },
  { label: 'SHA1', id: 'sha-1' },
  { label: 'SHA2 256', id: 'sha-256' },
  { label: 'SHA2 384', id: 'sha-384' },
  { label: 'SHA2 512', id: 'sha-512' },
  { label: 'SHA3 256', id: 'sha3', args: { Size: '256' } },
  { label: 'SHA3 512', id: 'sha3', args: { Size: '512' } },
  { label: 'RIPEMD 160', id: 'ripemd' },
  { label: 'SM3', id: 'sm3' },
  { label: 'HAS-160', id: 'has-160' },
  { label: 'BLAKE2b 256', id: 'blake2b', args: { Size: '256' } },
  { label: 'BLAKE2s 256', id: 'blake2s', args: { Size: '256' } },
  { label: 'NT', id: 'nt-hash' },
  { label: 'LM', id: 'lm-hash' },
  { label: 'CRC-32', id: 'crc-32' },
  { label: 'Adler-32', id: 'adler-32' },
];

export const moreHashOperations: Operation[] = [
  {
    id: 'has-160',
    name: 'HAS-160',
    category: 'Hashing',
    description: 'The Korean HAS-160 digest, used by the KCDSA signature standard.',
    aliases: ['korean hash', 'kcdsa'],
    args: [],
    run: (input) => hex(has160(asBytes(input))),
  },
  {
    id: 'generate-all-hashes',
    name: 'Generate all hashes',
    category: 'Hashing',
    description: 'Runs every digest this build can compute over the same input.',
    aliases: ['all hashes', 'hash survey', 'identify by hash'],
    args: [{ name: 'Include length', type: 'boolean', value: true }],
    run: async (input, args) => {
      const width = Math.max(...ALL_HASHES.map((entry) => entry.label.length));
      const lines: string[] = [];

      if (arg(args, 'Include length', true)) {
        lines.push(`Input length: ${asBytes(input).length} bytes`, '');
      }

      for (const entry of ALL_HASHES) {
        const operation = getOperation(entry.id);
        if (!operation) continue;
        const values = operation.args.map((a) => ({
          ...a,
          value: entry.args?.[a.name] ?? a.value,
        }));
        try {
          lines.push(`${entry.label.padEnd(width)}  ${await operation.run(input, values)}`);
        } catch (error) {
          lines.push(
            `${entry.label.padEnd(width)}  (${error instanceof Error ? error.message : 'failed'})`,
          );
        }
      }
      return lines.join('\n');
    },
  },
];
