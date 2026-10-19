import { OperationError } from '../types';
import { asBytes } from '../core/bytes';
import { arg, type Operation } from './types';


const MASK64 = (1n << 64n) - 1n;

const ROUND_CONSTANTS: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROTATIONS: number[] = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];

function rotl64(value: bigint, bits: number): bigint {
  if (bits === 0) return value;
  const n = BigInt(bits);
  return ((value << n) | (value >> (64n - n))) & MASK64;
}

function permute(lanes: bigint[]): void {
  for (let round = 0; round < 24; round++) {
    const c = new Array<bigint>(5);
    for (let x = 0; x < 5; x++) {
      c[x] = lanes[x]! ^ lanes[x + 5]! ^ lanes[x + 10]! ^ lanes[x + 15]! ^ lanes[x + 20]!;
    }
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotl64(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 5; y++) lanes[x + 5 * y] = lanes[x + 5 * y]! ^ d;
    }

    const b = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(lanes[x + 5 * y]!, ROTATIONS[x + 5 * y]!);
      }
    }

    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        lanes[x + 5 * y] =
          b[x + 5 * y]! ^ (~b[((x + 1) % 5) + 5 * y]! & MASK64 & b[((x + 2) % 5) + 5 * y]!);
      }
    }

    lanes[0] = lanes[0]! ^ ROUND_CONSTANTS[round]!;
  }
}

function sponge(bytes: Uint8Array, rate: number, suffix: number, outputBytes: number): Uint8Array {
  const lanes = new Array<bigint>(25).fill(0n);
  const block = new Uint8Array(rate);
  let offset = 0;

  const absorb = () => {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(block[i * 8 + j]!);
      lanes[i] = lanes[i]! ^ lane;
    }
    permute(lanes);
  };

  while (offset + rate <= bytes.length) {
    block.set(bytes.subarray(offset, offset + rate));
    absorb();
    offset += rate;
  }

  const tail = bytes.length - offset;
  block.fill(0);
  block.set(bytes.subarray(offset));
  block[tail] = suffix;
  block[rate - 1] = block[rate - 1]! | 0x80;
  absorb();

  const out = new Uint8Array(outputBytes);
  let produced = 0;
  while (produced < outputBytes) {
    for (let i = 0; i < rate / 8 && produced < outputBytes; i++) {
      const lane = lanes[i]!;
      for (let j = 0; j < 8 && produced < outputBytes; j++) {
        out[produced++] = Number((lane >> BigInt(8 * j)) & 0xffn);
      }
    }
    if (produced < outputBytes) permute(lanes);
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function digestSize(value: string, allowed: number[]): number {
  const size = Number(value);
  if (!allowed.includes(size)) {
    throw new OperationError(`Size must be one of ${allowed.join(', ')} bits.`);
  }
  return size;
}

export const keccakOperations: Operation[] = [
  {
    id: 'sha3',
    name: 'SHA3',
    category: 'Hashing',
    description: 'Computes a SHA-3 digest, the standardised Keccak sponge (FIPS 202).',
    aliases: ['sha-3', 'sha3-256', 'sha3-512'],
    args: [{ name: 'Size', type: 'option', value: '512', options: ['512', '384', '256', '224'] }],
    run: (input, args) => {
      const size = digestSize(String(arg(args, 'Size', '512')), [224, 256, 384, 512]);
      const bits = size / 8;
      return toHex(sponge(asBytes(input), 200 - 2 * bits, 0x06, bits));
    },
  },
  {
    id: 'keccak',
    name: 'Keccak',
    category: 'Hashing',
    description:
      'Computes the original Keccak digest, as submitted to the SHA-3 competition. Differs from SHA-3 in its padding, so the two never agree.',
    aliases: ['keccak-256', 'ethereum hash', 'original keccak'],
    args: [{ name: 'Size', type: 'option', value: '512', options: ['512', '384', '256', '224'] }],
    run: (input, args) => {
      const size = digestSize(String(arg(args, 'Size', '512')), [224, 256, 384, 512]);
      const bits = size / 8;
      return toHex(sponge(asBytes(input), 200 - 2 * bits, 0x01, bits));
    },
  },
  {
    id: 'shake',
    name: 'Shake',
    category: 'Hashing',
    description: 'Computes a SHAKE extendable-output digest of any length you ask for.',
    aliases: ['shake128', 'shake256', 'xof'],
    args: [
      { name: 'Capacity', type: 'option', value: '256', options: ['256', '128'] },
      { name: 'Size', type: 'number', value: 512, min: 8, max: 8192, hint: 'Output bits' },
    ],
    run: (input, args) => {
      const capacity = digestSize(String(arg(args, 'Capacity', '256')), [128, 256]);
      const size = Number(arg(args, 'Size', 512));
      if (!Number.isInteger(size) || size < 8 || size % 8 !== 0) {
        throw new OperationError('Output size must be a whole number of bytes, in bits.');
      }
      return toHex(sponge(asBytes(input), 200 - capacity / 4, 0x1f, size / 8));
    },
  },
];

export { sponge };
