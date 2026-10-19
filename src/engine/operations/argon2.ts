import { OperationError } from '../types';
import { asBytes, toBytes } from '../core/bytes';
import { arg, toggle, type Operation } from './types';
import { blake2b } from './blake';


const BLOCK_BYTES = 1024;
const QWORDS = BLOCK_BYTES / 8;
const SYNC_POINTS = 4;
const VERSION = 0x13;
const MASK = 0xffffffffffffffffn;

type Block = BigUint64Array;

function le32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function longHash(input: Uint8Array, outputLength: number): Uint8Array {
  const prefixed = concat([le32(outputLength), input]);
  if (outputLength <= 64) return blake2b(prefixed, new Uint8Array(0), outputLength);

  const out = new Uint8Array(outputLength);
  let block = blake2b(prefixed, new Uint8Array(0), 64);
  out.set(block.subarray(0, 32), 0);

  let at = 32;
  const rounds = Math.ceil(outputLength / 32) - 3;
  for (let i = 0; i < rounds; i++) {
    block = blake2b(block, new Uint8Array(0), 64);
    out.set(block.subarray(0, 32), at);
    at += 32;
  }
  const last = blake2b(block, new Uint8Array(0), outputLength - at);
  out.set(last, at);
  return out;
}

const rotr = (value: bigint, bits: bigint): bigint =>
  ((value >> bits) | (value << (64n - bits))) & MASK;

function mix(v: BigUint64Array, a: number, b: number, c: number, d: number): void {
  const fma = (x: bigint, y: bigint): bigint =>
    (x + y + 2n * (x & 0xffffffffn) * (y & 0xffffffffn)) & MASK;

  v[a] = fma(v[a]!, v[b]!);
  v[d] = rotr(v[d]! ^ v[a]!, 32n);
  v[c] = fma(v[c]!, v[d]!);
  v[b] = rotr(v[b]! ^ v[c]!, 24n);
  v[a] = fma(v[a]!, v[b]!);
  v[d] = rotr(v[d]! ^ v[a]!, 16n);
  v[c] = fma(v[c]!, v[d]!);
  v[b] = rotr(v[b]! ^ v[c]!, 63n);
}

function permute(v: BigUint64Array): void {
  mix(v, 0, 4, 8, 12);
  mix(v, 1, 5, 9, 13);
  mix(v, 2, 6, 10, 14);
  mix(v, 3, 7, 11, 15);
  mix(v, 0, 5, 10, 15);
  mix(v, 1, 6, 11, 12);
  mix(v, 2, 7, 8, 13);
  mix(v, 3, 4, 9, 14);
}

function compress(out: Block, x: Block, y: Block, xorInto: boolean): void {
  const r = new BigUint64Array(QWORDS);
  for (let i = 0; i < QWORDS; i++) r[i] = x[i]! ^ y[i]!;

  const z = r.slice();
  const row = new BigUint64Array(16);

  for (let i = 0; i < 8; i++) {
    for (let k = 0; k < 16; k++) row[k] = z[i * 16 + k]!;
    permute(row);
    for (let k = 0; k < 16; k++) z[i * 16 + k] = row[k]!;
  }

  for (let i = 0; i < 8; i++) {
    for (let k = 0; k < 8; k++) {
      row[k * 2] = z[k * 16 + i * 2]!;
      row[k * 2 + 1] = z[k * 16 + i * 2 + 1]!;
    }
    permute(row);
    for (let k = 0; k < 8; k++) {
      z[k * 16 + i * 2] = row[k * 2]!;
      z[k * 16 + i * 2 + 1] = row[k * 2 + 1]!;
    }
  }

  for (let i = 0; i < QWORDS; i++) {
    const value = (z[i]! ^ r[i]!) & MASK;
    out[i] = xorInto ? out[i]! ^ value : value;
  }
}

function blockFromBytes(bytes: Uint8Array): Block {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const block = new BigUint64Array(QWORDS);
  for (let i = 0; i < QWORDS; i++) block[i] = view.getBigUint64(i * 8, true);
  return block;
}

function blockToBytes(block: Block): Uint8Array {
  const out = new Uint8Array(BLOCK_BYTES);
  const view = new DataView(out.buffer);
  for (let i = 0; i < QWORDS; i++) view.setBigUint64(i * 8, block[i]!, true);
  return out;
}

export interface Argon2Options {
  password: Uint8Array;
  salt: Uint8Array;
  secret?: Uint8Array;
  associated?: Uint8Array;
  type: number;
  passes: number;
  memoryKiB: number;
  parallelism: number;
  tagLength: number;
}

export function argon2(options: Argon2Options): Uint8Array {
  const { password, salt, type, passes, parallelism, tagLength } = options;
  const secret = options.secret ?? new Uint8Array(0);
  const associated = options.associated ?? new Uint8Array(0);

  if (parallelism < 1) throw new OperationError('Argon2 needs at least one lane.');
  if (passes < 1) throw new OperationError('Argon2 needs at least one pass.');
  if (tagLength < 4) throw new OperationError('An Argon2 tag is at least four bytes.');
  if (salt.length < 8) throw new OperationError('An Argon2 salt is at least eight bytes.');

  const blocks = Math.floor(Math.max(options.memoryKiB, 8 * parallelism) / (SYNC_POINTS * parallelism)) *
    (SYNC_POINTS * parallelism);
  const laneLength = blocks / parallelism;
  const segmentLength = laneLength / SYNC_POINTS;

  const h0 = blake2b(
    concat([
      le32(parallelism),
      le32(tagLength),
      le32(options.memoryKiB),
      le32(passes),
      le32(VERSION),
      le32(type),
      le32(password.length),
      password,
      le32(salt.length),
      salt,
      le32(secret.length),
      secret,
      le32(associated.length),
      associated,
    ]),
    new Uint8Array(0),
    64,
  );

  const memory: Block[] = new Array<Block>(blocks);
  for (let lane = 0; lane < parallelism; lane++) {
    for (let column = 0; column < 2; column++) {
      memory[lane * laneLength + column] = blockFromBytes(
        longHash(concat([h0, le32(column), le32(lane)]), BLOCK_BYTES),
      );
    }
  }

  const dataIndependent = (pass: number, slice: number): boolean =>
    type === 1 || (type === 2 && pass === 0 && slice < 2);

  for (let pass = 0; pass < passes; pass++) {
    for (let slice = 0; slice < SYNC_POINTS; slice++) {
      for (let lane = 0; lane < parallelism; lane++) {
        let addresses: Block | null = null;
        let addressCounter = 0n;
        const zero = new BigUint64Array(QWORDS);
        const input = new BigUint64Array(QWORDS);

        const nextAddresses = (): void => {
          input[6] = ++addressCounter;
          const temporary = new BigUint64Array(QWORDS);
          compress(temporary, zero, input, false);
          compress(addresses!, zero, temporary, false);
        };

        if (dataIndependent(pass, slice)) {
          input[0] = BigInt(pass);
          input[1] = BigInt(lane);
          input[2] = BigInt(slice);
          input[3] = BigInt(blocks);
          input[4] = BigInt(passes);
          input[5] = BigInt(type);
          addresses = new BigUint64Array(QWORDS);
        }

        const start = pass === 0 && slice === 0 ? 2 : 0;
        if (addresses && start === 2) nextAddresses();
        for (let index = start; index < segmentLength; index++) {
          const position = slice * segmentLength + index;
          const current = lane * laneLength + position;
          const previous =
            lane * laneLength + ((position + laneLength - 1) % laneLength);

          let j1: bigint;
          let j2: bigint;
          if (addresses) {
            if (index % QWORDS === 0) nextAddresses();
            const word = addresses[index % QWORDS]!;
            j1 = word & 0xffffffffn;
            j2 = (word >> 32n) & 0xffffffffn;
          } else {
            const word = memory[previous]![0]!;
            j1 = word & 0xffffffffn;
            j2 = (word >> 32n) & 0xffffffffn;
          }

          const referenceLane =
            pass === 0 && slice === 0 ? lane : Number(j2 % BigInt(parallelism));

          let referenceArea: number;
          if (pass === 0) {
            referenceArea =
              referenceLane === lane
                ? position - 1
                : slice * segmentLength - (index === 0 ? 1 : 0);
          } else {
            referenceArea =
              referenceLane === lane
                ? laneLength - segmentLength + index - 1
                : laneLength - segmentLength - (index === 0 ? 1 : 0);
          }

          const relative = j1;
          const skewed =
            BigInt(referenceArea) -
            1n -
            ((BigInt(referenceArea) * ((relative * relative) >> 32n)) >> 32n);

          const startPosition =
            pass !== 0 && slice !== SYNC_POINTS - 1 ? (slice + 1) * segmentLength : 0;
          const referenceIndex = Number((BigInt(startPosition) + skewed) % BigInt(laneLength));

          const reference = memory[referenceLane * laneLength + referenceIndex]!;
          if (!memory[current]) memory[current] = new BigUint64Array(QWORDS);
          compress(memory[current]!, memory[previous]!, reference, pass !== 0);
        }
      }
    }
  }

  const final = new BigUint64Array(QWORDS);
  for (let lane = 0; lane < parallelism; lane++) {
    const last = memory[lane * laneLength + laneLength - 1]!;
    for (let i = 0; i < QWORDS; i++) final[i] = final[i]! ^ last[i]!;
  }
  return longHash(blockToBytes(final), tagLength);
}


const TYPES: Record<string, number> = { Argon2d: 0, Argon2i: 1, Argon2id: 2 };

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/, '');
}

function fromBase64(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function saltBytes(args: Parameters<Operation['run']>[1]): Uint8Array {
  const raw = String(arg(args, 'Salt', ''));
  if (toggle(args, 'Salt', 'UTF-8') === 'Hex') {
    const cleaned = raw.replace(/[^0-9a-fA-F]/g, '');
    if (cleaned.length % 2 !== 0) throw new OperationError('A hex salt needs an even digit count.');
    return Uint8Array.from(cleaned.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  }
  return toBytes(raw);
}

const SHARED_ARGS = [
  {
    name: 'Salt',
    type: 'toggleString' as const,
    value: 'somesalt',
    toggleValues: ['UTF-8', 'Hex'],
    toggleValue: 'UTF-8',
  },
  {
    name: 'Type',
    type: 'option' as const,
    value: 'Argon2id',
    options: ['Argon2id', 'Argon2i', 'Argon2d'],
  },
  { name: 'Iterations', type: 'number' as const, value: 3, min: 1, max: 20 },
  { name: 'Memory (KiB)', type: 'number' as const, value: 4096, min: 8, max: 262144 },
  { name: 'Parallelism', type: 'number' as const, value: 1, min: 1, max: 16 },
  { name: 'Tag length', type: 'number' as const, value: 32, min: 4, max: 512 },
];

export const argon2Operations: Operation[] = [
  {
    id: 'argon2',
    name: 'Argon2',
    category: 'Hashing',
    description: 'The memory-hard password hash of RFC 9106, in all three of its variants.',
    aliases: ['argon2id', 'argon2i', 'argon2d', 'password hashing competition'],
    budgetMs: 60000,
    args: [
      ...SHARED_ARGS,
      {
        name: 'Output',
        type: 'option',
        value: 'Encoded',
        options: ['Encoded', 'Hex'],
      },
    ],
    run: (input, args) => {
      const type = TYPES[String(arg(args, 'Type', 'Argon2id'))] ?? 2;
      const memoryKiB = Number(arg(args, 'Memory (KiB)', 4096));
      const passes = Number(arg(args, 'Iterations', 3));
      const parallelism = Number(arg(args, 'Parallelism', 1));
      const tagLength = Number(arg(args, 'Tag length', 32));
      const salt = saltBytes(args);

      const tag = argon2({
        password: asBytes(input),
        salt,
        type,
        passes,
        memoryKiB,
        parallelism,
        tagLength,
      });

      if (arg(args, 'Output', 'Encoded') === 'Hex') return hex(tag);
      const name = String(arg(args, 'Type', 'Argon2id')).toLowerCase();
      return `$${name}$v=19$m=${memoryKiB},t=${passes},p=${parallelism}$${base64(salt)}$${base64(tag)}`;
    },
  },
  {
    id: 'argon2-compare',
    name: 'Argon2 compare',
    category: 'Hashing',
    description: 'Checks a password against an encoded Argon2 hash, reading its parameters from it.',
    aliases: ['verify argon2', 'check argon2 password'],
    budgetMs: 60000,
    args: [{ name: 'Hash', type: 'string', value: '', hint: '$argon2id$v=19$m=...' }],
    run: (input, args) => {
      const encoded = String(arg(args, 'Hash', '')).trim();
      const parts = encoded.split('$');
      if (parts.length !== 6 || parts[0] !== '') {
        throw new OperationError(
          'That is not an encoded Argon2 hash: it should look like $argon2id$v=19$m=4096,t=3,p=1$salt$tag.',
        );
      }

      const variant = parts[1]!;
      const typeNumber =
        variant === 'argon2d' ? 0 : variant === 'argon2i' ? 1 : variant === 'argon2id' ? 2 : -1;
      if (typeNumber < 0) throw new OperationError(`'${variant}' is not an Argon2 variant.`);

      const version = /^v=(\d+)$/.exec(parts[2]!);
      if (version && Number(version[1]) !== VERSION) {
        throw new OperationError(`This hash is version ${version[1]}; only version 19 is supported.`);
      }

      const settings = new Map(
        parts[3]!.split(',').map((pair) => {
          const [key, value] = pair.split('=');
          return [key ?? '', Number(value)];
        }),
      );
      const memoryKiB = settings.get('m');
      const passes = settings.get('t');
      const parallelism = settings.get('p');
      if (!memoryKiB || !passes || !parallelism) {
        throw new OperationError("The hash does not carry all of 'm', 't' and 'p'.");
      }

      const salt = fromBase64(parts[4]!);
      const expected = fromBase64(parts[5]!);

      const tag = argon2({
        password: asBytes(input),
        salt,
        type: typeNumber,
        passes,
        memoryKiB,
        parallelism,
        tagLength: expected.length,
      });

      const same =
        tag.length === expected.length && tag.every((byte, i) => byte === expected[i]);
      return same ? `Match: this password produces that hash.` : 'No match.';
    },
  },
];
