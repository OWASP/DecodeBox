import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, toggle, type Operation } from './types';


const MASK = 0xffffffffffffffffn;

const rotr = (value: bigint, bits: bigint): bigint =>
  ((value >> bits) | (value << (64n - bits))) & MASK;

function constantFor(rounds: number, round: number): bigint {
  const start = 12 - rounds;
  const index = start + round;
  return BigInt(0xf0 - index * 0x10 + index * 0x1);
}

function permute(state: bigint[], rounds: number): void {
  for (let round = 0; round < rounds; round++) {
    state[2] = state[2]! ^ constantFor(rounds, round);

    state[0] = state[0]! ^ state[4]!;
    state[4] = state[4]! ^ state[3]!;
    state[2] = state[2]! ^ state[1]!;

    const t = [0n, 0n, 0n, 0n, 0n];
    for (let i = 0; i < 5; i++) {
      t[i] = (~state[i]! & MASK) & state[(i + 1) % 5]!;
    }
    for (let i = 0; i < 5; i++) {
      state[i] = state[i]! ^ t[(i + 1) % 5]!;
    }

    state[1] = state[1]! ^ state[0]!;
    state[0] = state[0]! ^ state[4]!;
    state[3] = state[3]! ^ state[2]!;
    state[2] = ~state[2]! & MASK;

    state[0] = state[0]! ^ rotr(state[0]!, 19n) ^ rotr(state[0]!, 28n);
    state[1] = state[1]! ^ rotr(state[1]!, 61n) ^ rotr(state[1]!, 39n);
    state[2] = state[2]! ^ rotr(state[2]!, 1n) ^ rotr(state[2]!, 6n);
    state[3] = state[3]! ^ rotr(state[3]!, 10n) ^ rotr(state[3]!, 17n);
    state[4] = state[4]! ^ rotr(state[4]!, 7n) ^ rotr(state[4]!, 41n);
  }
}

function wordAt(bytes: Uint8Array, at: number): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(bytes[at + i] ?? 0);
  return value;
}

function wordBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}


const HASH_IV = 0x00400c0000000100n;
const XOF_IV = 0x00400c0000000000n;

function asconHash(message: Uint8Array, length: number, xof: boolean): Uint8Array {
  const state = [xof ? XOF_IV : HASH_IV, 0n, 0n, 0n, 0n];
  permute(state, 12);

  const padded = new Uint8Array(message.length + 8 - (message.length % 8));
  padded.set(message);
  padded[message.length] = 0x80;

  for (let at = 0; at < padded.length; at += 8) {
    state[0] = state[0]! ^ wordAt(padded, at);
    permute(state, 12);
  }

  const out = new Uint8Array(length);
  let written = 0;
  for (;;) {
    const block = wordBytes(state[0]!);
    const take = Math.min(8, length - written);
    out.set(block.subarray(0, take), written);
    written += take;
    if (written >= length) break;
    permute(state, 12);
  }
  return out;
}


const AEAD_IV = 0x80400c0600000000n;

interface Aead {
  key: Uint8Array;
  nonce: Uint8Array;
  associated: Uint8Array;
}

function initialise({ key, nonce }: Aead): { state: bigint[]; k0: bigint; k1: bigint } {
  const k0 = wordAt(key, 0);
  const k1 = wordAt(key, 8);
  const state = [AEAD_IV, k0, k1, wordAt(nonce, 0), wordAt(nonce, 8)];
  permute(state, 12);
  state[3] = state[3]! ^ k0;
  state[4] = state[4]! ^ k1;
  return { state, k0, k1 };
}

function absorbAssociated(state: bigint[], associated: Uint8Array): void {
  if (associated.length > 0) {
    const padded = new Uint8Array(associated.length + 8 - (associated.length % 8));
    padded.set(associated);
    padded[associated.length] = 0x80;
    for (let at = 0; at < padded.length; at += 8) {
      state[0] = state[0]! ^ wordAt(padded, at);
      permute(state, 6);
    }
  }
  state[4] = state[4]! ^ 1n;
}

function finalise(state: bigint[], k0: bigint, k1: bigint): Uint8Array {
  state[1] = state[1]! ^ k0;
  state[2] = state[2]! ^ k1;
  permute(state, 12);

  const tag = new Uint8Array(16);
  tag.set(wordBytes(state[3]! ^ k0), 0);
  tag.set(wordBytes(state[4]! ^ k1), 8);
  return tag;
}

function asconEncrypt(plain: Uint8Array, options: Aead): { cipher: Uint8Array; tag: Uint8Array } {
  const { state, k0, k1 } = initialise(options);
  absorbAssociated(state, options.associated);

  const padded = new Uint8Array(plain.length + 8 - (plain.length % 8));
  padded.set(plain);
  padded[plain.length] = 0x80;

  const cipher = new Uint8Array(plain.length);
  const blocks = padded.length / 8;

  for (let block = 0; block < blocks; block++) {
    const at = block * 8;
    state[0] = state[0]! ^ wordAt(padded, at);
    const out = wordBytes(state[0]!);
    const take = Math.min(8, plain.length - at);
    if (take > 0) cipher.set(out.subarray(0, take), at);
    if (block < blocks - 1) permute(state, 6);
  }

  return { cipher, tag: finalise(state, k0, k1) };
}

function asconDecrypt(cipher: Uint8Array, tag: Uint8Array, options: Aead): Uint8Array {
  const { state, k0, k1 } = initialise(options);
  absorbAssociated(state, options.associated);

  const plain = new Uint8Array(cipher.length);
  const blocks = Math.floor(cipher.length / 8);

  for (let block = 0; block < blocks; block++) {
    const at = block * 8;
    const c = wordAt(cipher, at);
    const p = state[0]! ^ c;
    plain.set(wordBytes(p), at);
    state[0] = c;
    permute(state, 6);
  }

  const remaining = cipher.length - blocks * 8;
  const last = new Uint8Array(8);
  last.set(cipher.subarray(blocks * 8));
  const c = wordAt(last, 0);
  const p = state[0]! ^ c;
  const recovered = wordBytes(p);
  plain.set(recovered.subarray(0, remaining), blocks * 8);

  let mask = 0n;
  for (let i = 0; i < remaining; i++) mask |= 0xffn << BigInt(56 - 8 * i);
  state[0] = (state[0]! & ~mask & MASK) ^ (c & mask) ^ (0x80n << BigInt(56 - 8 * remaining));

  const expected = finalise(state, k0, k1);
  const same = tag.length === 16 && expected.every((byte, i) => byte === tag[i]);
  if (!same) {
    throw new OperationError(
      'The tag does not match: the key, the nonce, the associated data or the ciphertext is not the right one.',
    );
  }
  return plain;
}


function readBytes(value: string, format: string, name: string, size?: number): Uint8Array {
  const bytes =
    format === 'Hex'
      ? Uint8Array.from(value.replace(/[^0-9a-fA-F]/g, '').match(/../g) ?? [], (p) =>
          Number.parseInt(p, 16),
        )
      : asBytes(value);
  if (size !== undefined && bytes.length !== size) {
    throw new OperationError(`The ${name} is ${size} bytes; this one is ${bytes.length}.`);
  }
  return bytes;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const KEY_ARGS = [
  {
    name: 'Key',
    type: 'toggleString' as const,
    value: '',
    toggleValues: ['Hex', 'UTF-8'],
    toggleValue: 'Hex',
    hint: '16 bytes',
  },
  {
    name: 'Nonce',
    type: 'toggleString' as const,
    value: '',
    toggleValues: ['Hex', 'UTF-8'],
    toggleValue: 'Hex',
    hint: '16 bytes, never reused with the same key',
  },
  {
    name: 'Associated data',
    type: 'toggleString' as const,
    value: '',
    toggleValues: ['UTF-8', 'Hex'],
    toggleValue: 'UTF-8',
  },
];

export const asconOperations: Operation[] = [
  {
    id: 'ascon-hash',
    name: 'Ascon Hash',
    category: 'Hashing',
    description: 'The Ascon hash: a 256-bit digest from the lightweight cryptography winner.',
    aliases: ['ascon', 'lightweight hash', 'ascon-hash'],
    budgetMs: 30000,
    args: [
      { name: 'Mode', type: 'option', value: 'Hash', options: ['Hash', 'XOF'] },
      { name: 'Length', type: 'number', value: 32, min: 1, max: 256 },
    ],
    run: (input, args) => {
      const xof = arg(args, 'Mode', 'Hash') === 'XOF';
      const length = xof ? Math.max(1, Number(arg(args, 'Length', 32))) : 32;
      return hex(asconHash(asBytes(input), length, xof));
    },
  },
  {
    id: 'ascon-mac',
    name: 'Ascon MAC',
    category: 'Hashing',
    description: 'A message authentication code built on Ascon by hashing the key with the message.',
    aliases: ['ascon prf', 'lightweight mac'],
    budgetMs: 30000,
    args: [
      {
        name: 'Key',
        type: 'toggleString',
        value: '',
        toggleValues: ['Hex', 'UTF-8'],
        toggleValue: 'Hex',
        hint: '16 bytes',
      },
      { name: 'Length', type: 'number', value: 16, min: 4, max: 64 },
    ],
    run: (input, args) => {
      const key = readBytes(String(arg(args, 'Key', '')), toggle(args, 'Key', 'Hex'), 'key', 16);
      const message = asBytes(input);

      const joined = new Uint8Array(key.length + message.length);
      joined.set(key);
      joined.set(message, key.length);
      return hex(asconHash(joined, Number(arg(args, 'Length', 16)), true));
    },
  },
  {
    id: 'ascon-encrypt',
    name: 'Ascon Encrypt',
    category: 'Encryption / Encoding',
    description: 'Ascon-128 authenticated encryption: ciphertext plus a 16-byte tag.',
    aliases: ['ascon aead', 'lightweight encryption', 'ascon-128'],
    budgetMs: 30000,
    args: [
      ...KEY_ARGS,
      { name: 'Output', type: 'option', value: 'Hex', options: ['Hex', 'Raw bytes'] },
    ],
    run: (input, args) => {
      const key = readBytes(String(arg(args, 'Key', '')), toggle(args, 'Key', 'Hex'), 'key', 16);
      const nonce = readBytes(String(arg(args, 'Nonce', '')), toggle(args, 'Nonce', 'Hex'), 'nonce', 16);
      const associated = readBytes(
        String(arg(args, 'Associated data', '')),
        toggle(args, 'Associated data', 'UTF-8'),
        'associated data',
      );

      const { cipher, tag } = asconEncrypt(asBytes(input), { key, nonce, associated });
      const joined = new Uint8Array(cipher.length + tag.length);
      joined.set(cipher);
      joined.set(tag, cipher.length);

      return arg(args, 'Output', 'Hex') === 'Hex' ? hex(joined) : bytesToLatin1(joined);
    },
  },
  {
    id: 'ascon-decrypt',
    name: 'Ascon Decrypt',
    category: 'Encryption / Encoding',
    description: 'Checks the tag on an Ascon-128 message and decrypts it, refusing it if it fails.',
    aliases: ['ascon aead decrypt', 'lightweight decryption'],
    budgetMs: 30000,
    args: [
      ...KEY_ARGS,
      { name: 'Input', type: 'option', value: 'Hex', options: ['Hex', 'Raw bytes'] },
    ],
    run: (input, args) => {
      const key = readBytes(String(arg(args, 'Key', '')), toggle(args, 'Key', 'Hex'), 'key', 16);
      const nonce = readBytes(String(arg(args, 'Nonce', '')), toggle(args, 'Nonce', 'Hex'), 'nonce', 16);
      const associated = readBytes(
        String(arg(args, 'Associated data', '')),
        toggle(args, 'Associated data', 'UTF-8'),
        'associated data',
      );

      const joined = readBytes(input, String(arg(args, 'Input', 'Hex')), 'message');
      if (joined.length < 16) {
        throw new OperationError('An Ascon message ends with a 16-byte tag, and this is shorter than that.');
      }

      const cipher = joined.subarray(0, joined.length - 16);
      const tag = joined.subarray(joined.length - 16);
      return bytesToLatin1(asconDecrypt(cipher, tag, { key, nonce, associated }));
    },
  },
];

export { asconHash, permute };
