import { OperationError, type OperationArg } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { parseKey, KEY_FORMATS } from './keys';
import { arg, toggle, type Operation } from './types';


const IO_FORMATS = ['Raw', 'Hex'];

function streamArgs(nonceName: string, extra: OperationArg[] = []): OperationArg[] {
  return [
    { name: 'Key', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
    {
      name: nonceName,
      type: 'toggleString',
      value: '',
      toggleValues: KEY_FORMATS,
      toggleValue: 'Hex',
    },
    ...extra,
    { name: 'Input', type: 'option', value: 'Raw', options: IO_FORMATS },
    { name: 'Output', type: 'option', value: 'Hex', options: IO_FORMATS },
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

function keyBytes(args: OperationArg[], name: string, required: boolean): Uint8Array {
  return parseKey(String(arg(args, name, '')), toggle(args, name, 'Hex'), !required);
}

function le32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] as number) |
      ((bytes[at + 1] as number) << 8) |
      ((bytes[at + 2] as number) << 16) |
      ((bytes[at + 3] as number) << 24)) >>>
    0
  );
}

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}


const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
const TAU = [0x61707865, 0x3120646e, 0x79622d36, 0x6b206574];

function salsaRounds(state: Uint32Array, rounds: number): Uint32Array {
  const x = new Uint32Array(state);
  const quarter = (a: number, b: number, c: number, d: number) => {
    x[b] = ((x[b] as number) ^ rotl(((x[a] as number) + (x[d] as number)) >>> 0, 7)) >>> 0;
    x[c] = ((x[c] as number) ^ rotl(((x[b] as number) + (x[a] as number)) >>> 0, 9)) >>> 0;
    x[d] = ((x[d] as number) ^ rotl(((x[c] as number) + (x[b] as number)) >>> 0, 13)) >>> 0;
    x[a] = ((x[a] as number) ^ rotl(((x[d] as number) + (x[c] as number)) >>> 0, 18)) >>> 0;
  };

  for (let i = 0; i < rounds; i += 2) {
    quarter(0, 4, 8, 12);
    quarter(5, 9, 13, 1);
    quarter(10, 14, 2, 6);
    quarter(15, 3, 7, 11);
    quarter(0, 1, 2, 3);
    quarter(5, 6, 7, 4);
    quarter(10, 11, 8, 9);
    quarter(15, 12, 13, 14);
  }
  return x;
}

function salsaState(key: Uint8Array, nonce: Uint8Array, counter: bigint): Uint32Array {
  const constants = key.length === 32 ? SIGMA : TAU;
  const k = key.length === 32 ? key : key;
  const state = new Uint32Array(16);

  state[0] = constants[0] as number;
  state[5] = constants[1] as number;
  state[10] = constants[2] as number;
  state[15] = constants[3] as number;

  for (let i = 0; i < 4; i++) {
    state[1 + i] = le32(k, i * 4);
    state[11 + i] = le32(k, (key.length === 32 ? 16 : 0) + i * 4);
  }
  state[6] = le32(nonce, 0);
  state[7] = le32(nonce, 4);
  state[8] = Number(counter & 0xffffffffn);
  state[9] = Number((counter >> 32n) & 0xffffffffn);
  return state;
}

function salsaBlock(state: Uint32Array, rounds: number): Uint8Array {
  const mixed = salsaRounds(state, rounds);
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const word = ((mixed[i] as number) + (state[i] as number)) >>> 0;
    out[i * 4] = word & 0xff;
    out[i * 4 + 1] = (word >>> 8) & 0xff;
    out[i * 4 + 2] = (word >>> 16) & 0xff;
    out[i * 4 + 3] = (word >>> 24) & 0xff;
  }
  return out;
}

function salsa20(key: Uint8Array, nonce: Uint8Array, counter: bigint, rounds: number, data: Uint8Array): Uint8Array {
  if (key.length !== 16 && key.length !== 32) {
    throw new OperationError(`Salsa20 needs a 16 or 32-byte key; this one is ${key.length}.`);
  }
  if (nonce.length !== 8) {
    throw new OperationError(`Salsa20 needs an 8-byte nonce; this one is ${nonce.length}.`);
  }

  const out = new Uint8Array(data.length);
  let block = counter;
  for (let at = 0; at < data.length; at += 64) {
    const keystream = salsaBlock(salsaState(key, nonce, block), rounds);
    for (let i = 0; i < 64 && at + i < data.length; i++) {
      out[at + i] = (data[at + i] as number) ^ (keystream[i] as number);
    }
    block++;
  }
  return out;
}

function hsalsa20(key: Uint8Array, nonce: Uint8Array): Uint8Array {
  const state = new Uint32Array(16);
  state[0] = SIGMA[0] as number;
  state[5] = SIGMA[1] as number;
  state[10] = SIGMA[2] as number;
  state[15] = SIGMA[3] as number;
  for (let i = 0; i < 4; i++) {
    state[1 + i] = le32(key, i * 4);
    state[11 + i] = le32(key, 16 + i * 4);
  }
  for (let i = 0; i < 4; i++) state[6 + i] = le32(nonce, i * 4);

  const mixed = salsaRounds(state, 20);
  const out = new Uint8Array(32);
  const picks = [0, 5, 10, 15, 6, 7, 8, 9];
  picks.forEach((index, i) => {
    const word = mixed[index] as number;
    out[i * 4] = word & 0xff;
    out[i * 4 + 1] = (word >>> 8) & 0xff;
    out[i * 4 + 2] = (word >>> 16) & 0xff;
    out[i * 4 + 3] = (word >>> 24) & 0xff;
  });
  return out;
}


function chachaBlock(key: Uint8Array, nonce: Uint8Array, counter: bigint, rounds: number): Uint8Array {
  const state = new Uint32Array(16);
  state[0] = SIGMA[0] as number;
  state[1] = SIGMA[1] as number;
  state[2] = SIGMA[2] as number;
  state[3] = SIGMA[3] as number;
  for (let i = 0; i < 8; i++) state[4 + i] = le32(key, i * 4);

  if (nonce.length === 12) {
    state[12] = Number(counter & 0xffffffffn);
    for (let i = 0; i < 3; i++) state[13 + i] = le32(nonce, i * 4);
  } else {
    state[12] = Number(counter & 0xffffffffn);
    state[13] = Number((counter >> 32n) & 0xffffffffn);
    state[14] = le32(nonce, 0);
    state[15] = le32(nonce, 4);
  }

  const x = new Uint32Array(state);
  const quarter = (a: number, b: number, c: number, d: number) => {
    x[a] = ((x[a] as number) + (x[b] as number)) >>> 0;
    x[d] = rotl((x[d] as number) ^ (x[a] as number), 16);
    x[c] = ((x[c] as number) + (x[d] as number)) >>> 0;
    x[b] = rotl((x[b] as number) ^ (x[c] as number), 12);
    x[a] = ((x[a] as number) + (x[b] as number)) >>> 0;
    x[d] = rotl((x[d] as number) ^ (x[a] as number), 8);
    x[c] = ((x[c] as number) + (x[d] as number)) >>> 0;
    x[b] = rotl((x[b] as number) ^ (x[c] as number), 7);
  };

  for (let i = 0; i < rounds; i += 2) {
    quarter(0, 4, 8, 12);
    quarter(1, 5, 9, 13);
    quarter(2, 6, 10, 14);
    quarter(3, 7, 11, 15);
    quarter(0, 5, 10, 15);
    quarter(1, 6, 11, 12);
    quarter(2, 7, 8, 13);
    quarter(3, 4, 9, 14);
  }

  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const word = ((x[i] as number) + (state[i] as number)) >>> 0;
    out[i * 4] = word & 0xff;
    out[i * 4 + 1] = (word >>> 8) & 0xff;
    out[i * 4 + 2] = (word >>> 16) & 0xff;
    out[i * 4 + 3] = (word >>> 24) & 0xff;
  }
  return out;
}

function chacha(key: Uint8Array, nonce: Uint8Array, counter: bigint, rounds: number, data: Uint8Array): Uint8Array {
  if (key.length !== 32) {
    throw new OperationError(`ChaCha needs a 32-byte key; this one is ${key.length}.`);
  }
  if (nonce.length !== 8 && nonce.length !== 12) {
    throw new OperationError(`ChaCha needs an 8 or 12-byte nonce; this one is ${nonce.length}.`);
  }

  const out = new Uint8Array(data.length);
  let block = counter;
  for (let at = 0; at < data.length; at += 64) {
    const keystream = chachaBlock(key, nonce, block, rounds);
    for (let i = 0; i < 64 && at + i < data.length; i++) {
      out[at + i] = (data[at + i] as number) ^ (keystream[i] as number);
    }
    block++;
  }
  return out;
}


function rabbitG(value: number): number {
  const square = BigInt(value >>> 0) * BigInt(value >>> 0);
  return Number(((square & 0xffffffffn) ^ (square >> 32n)) & 0xffffffffn) >>> 0;
}

function rabbitNext(x: Uint32Array, c: Uint32Array, carry: { b: number }): void {
  const constants = [0x4d34d34d, 0xd34d34d3, 0x34d34d34, 0x4d34d34d, 0xd34d34d3, 0x34d34d34, 0x4d34d34d, 0xd34d34d3];
  const g = new Uint32Array(8);

  for (let i = 0; i < 8; i++) {
    const sum = ((c[i] as number) >>> 0) + (constants[i] as number) + carry.b;
    carry.b = sum > 0xffffffff ? 1 : 0;
    c[i] = sum >>> 0;
    g[i] = rabbitG(((x[i] as number) + (c[i] as number)) >>> 0);
  }

  for (let i = 0; i < 8; i += 2) {
    x[i] = ((g[i] as number) + rotl(g[(i + 7) % 8] as number, 16) + rotl(g[(i + 6) % 8] as number, 16)) >>> 0;
    x[i + 1] = ((g[i + 1] as number) + rotl(g[i] as number, 8) + (g[(i + 7) % 8] as number)) >>> 0;
  }
}

function rabbit(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  if (key.length !== 16) {
    throw new OperationError(`Rabbit needs a 16-byte key; this one is ${key.length}.`);
  }
  if (iv.length !== 0 && iv.length !== 8) {
    throw new OperationError(`Rabbit takes no IV or an 8-byte one; this is ${iv.length}.`);
  }

  const k = new Uint16Array(8);
  for (let i = 0; i < 8; i++) k[i] = (key[i * 2] as number) | ((key[i * 2 + 1] as number) << 8);

  const x = new Uint32Array(8);
  const c = new Uint32Array(8);
  const carry = { b: 0 };

  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) {
      x[i] = (((k[(i + 1) % 8] as number) << 16) | (k[i] as number)) >>> 0;
      c[i] = (((k[(i + 4) % 8] as number) << 16) | (k[(i + 5) % 8] as number)) >>> 0;
    } else {
      x[i] = (((k[(i + 5) % 8] as number) << 16) | (k[(i + 4) % 8] as number)) >>> 0;
      c[i] = (((k[i] as number) << 16) | (k[(i + 1) % 8] as number)) >>> 0;
    }
  }
  for (let i = 0; i < 4; i++) rabbitNext(x, c, carry);
  for (let i = 0; i < 8; i++) c[i] = ((c[i] as number) ^ (x[(i + 4) % 8] as number)) >>> 0;

  if (iv.length === 8) {
    const i0 = le32(iv, 0);
    const i2 = le32(iv, 4);
    const i1 = ((i0 >>> 16) | (i2 & 0xffff0000)) >>> 0;
    const i3 = (((i2 << 16) >>> 0) | (i0 & 0x0000ffff)) >>> 0;
    c[0] = ((c[0] as number) ^ i0) >>> 0;
    c[1] = ((c[1] as number) ^ i1) >>> 0;
    c[2] = ((c[2] as number) ^ i2) >>> 0;
    c[3] = ((c[3] as number) ^ i3) >>> 0;
    c[4] = ((c[4] as number) ^ i0) >>> 0;
    c[5] = ((c[5] as number) ^ i1) >>> 0;
    c[6] = ((c[6] as number) ^ i2) >>> 0;
    c[7] = ((c[7] as number) ^ i3) >>> 0;
    for (let i = 0; i < 4; i++) rabbitNext(x, c, carry);
  }

  const out = new Uint8Array(data.length);
  for (let at = 0; at < data.length; at += 16) {
    rabbitNext(x, c, carry);
    const s = new Uint32Array(4);
    s[0] = ((x[0] as number) ^ ((x[5] as number) >>> 16) ^ (((x[3] as number) << 16) >>> 0)) >>> 0;
    s[1] = ((x[2] as number) ^ ((x[7] as number) >>> 16) ^ (((x[5] as number) << 16) >>> 0)) >>> 0;
    s[2] = ((x[4] as number) ^ ((x[1] as number) >>> 16) ^ (((x[7] as number) << 16) >>> 0)) >>> 0;
    s[3] = ((x[6] as number) ^ ((x[3] as number) >>> 16) ^ (((x[1] as number) << 16) >>> 0)) >>> 0;

    const block = new Uint8Array(16);
    for (let word = 0; word < 4; word++) {
      const value = s[3 - word] as number;
      block[word * 4] = (value >>> 24) & 0xff;
      block[word * 4 + 1] = (value >>> 16) & 0xff;
      block[word * 4 + 2] = (value >>> 8) & 0xff;
      block[word * 4 + 3] = value & 0xff;
    }
    const remaining = Math.min(16, data.length - at);
    const keystream = block.subarray(16 - remaining);
    for (let i = 0; i < remaining; i++) {
      out[at + i] = (data[at + i] as number) ^ (keystream[i] as number);
    }
  }
  return out;
}


function rc4Keystream(key: Uint8Array, length: number, drop: number, rounds = 1): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;

  let j = 0;
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < 256; i++) {
      j = (j + (s[i] as number) + (key[i % key.length] as number)) & 0xff;
      [s[i], s[j]] = [s[j] as number, s[i] as number];
    }
  }

  const out = new Uint8Array(length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < drop + length; i++) {
    x = (x + 1) & 0xff;
    y = (y + (s[x] as number)) & 0xff;
    [s[x], s[y]] = [s[y] as number, s[x] as number];
    if (i >= drop) out[i - drop] = s[((s[x] as number) + (s[y] as number)) & 0xff] as number;
  }
  return out;
}

export const streamCipherOperations: Operation[] = [
  {
    id: 'salsa20',
    name: 'Salsa20',
    category: 'Encryption / Encoding',
    description: 'Encrypts or decrypts with the Salsa20 stream cipher.',
    aliases: ['salsa'],
    args: streamArgs('Nonce', [
      { name: 'Counter', type: 'number', value: 0, min: 0 },
      { name: 'Rounds', type: 'option', value: '20', options: ['20', '12', '8'] },
    ]),
    run: (input, args) => {
      const out = salsa20(
        keyBytes(args, 'Key', true),
        keyBytes(args, 'Nonce', true),
        BigInt(Math.max(0, Number(arg(args, 'Counter', 0)))),
        Number(arg(args, 'Rounds', '20')),
        readData(input, String(arg(args, 'Input', 'Raw'))),
      );
      return writeData(out, String(arg(args, 'Output', 'Hex')));
    },
  },
  {
    id: 'xsalsa20',
    name: 'XSalsa20',
    category: 'Encryption / Encoding',
    description: 'Salsa20 with a 24-byte nonce, so a random nonce is safe to use.',
    aliases: ['xsalsa'],
    args: streamArgs('Nonce', [
      { name: 'Counter', type: 'number', value: 0, min: 0 },
      { name: 'Rounds', type: 'option', value: '20', options: ['20', '12', '8'] },
    ]),
    run: (input, args) => {
      const key = keyBytes(args, 'Key', true);
      const nonce = keyBytes(args, 'Nonce', true);
      if (key.length !== 32) {
        throw new OperationError(`XSalsa20 needs a 32-byte key; this one is ${key.length}.`);
      }
      if (nonce.length !== 24) {
        throw new OperationError(`XSalsa20 needs a 24-byte nonce; this one is ${nonce.length}.`);
      }

      const subkey = hsalsa20(key, nonce.subarray(0, 16));
      const out = salsa20(
        subkey,
        nonce.subarray(16, 24),
        BigInt(Math.max(0, Number(arg(args, 'Counter', 0)))),
        Number(arg(args, 'Rounds', '20')),
        readData(input, String(arg(args, 'Input', 'Raw'))),
      );
      return writeData(out, String(arg(args, 'Output', 'Hex')));
    },
  },
  {
    id: 'chacha',
    name: 'ChaCha',
    category: 'Encryption / Encoding',
    description: 'Encrypts or decrypts with the ChaCha stream cipher.',
    aliases: ['chacha20', 'rfc8439'],
    args: streamArgs('Nonce', [
      { name: 'Counter', type: 'number', value: 0, min: 0 },
      { name: 'Rounds', type: 'option', value: '20', options: ['20', '12', '8'] },
    ]),
    run: (input, args) => {
      const out = chacha(
        keyBytes(args, 'Key', true),
        keyBytes(args, 'Nonce', true),
        BigInt(Math.max(0, Number(arg(args, 'Counter', 0)))),
        Number(arg(args, 'Rounds', '20')),
        readData(input, String(arg(args, 'Input', 'Raw'))),
      );
      return writeData(out, String(arg(args, 'Output', 'Hex')));
    },
  },
  {
    id: 'rabbit',
    name: 'Rabbit',
    category: 'Encryption / Encoding',
    description: 'Encrypts or decrypts with the Rabbit stream cipher of RFC 4503.',
    aliases: ['rfc4503'],
    args: streamArgs('IV'),
    run: (input, args) => {
      const out = rabbit(
        keyBytes(args, 'Key', true),
        keyBytes(args, 'IV', false),
        readData(input, String(arg(args, 'Input', 'Raw'))),
      );
      return writeData(out, String(arg(args, 'Output', 'Hex')));
    },
  },
  {
    id: 'rc4-drop',
    name: 'RC4 Drop',
    category: 'Encryption / Encoding',
    description: 'RC4 with the first bytes of keystream discarded, as RC4-drop advises.',
    aliases: ['rc4drop', 'arcfour drop'],
    args: [
      {
        name: 'Passphrase',
        type: 'toggleString',
        value: '',
        toggleValues: KEY_FORMATS,
        toggleValue: 'UTF-8',
      },
      { name: 'Number of dwords to drop', type: 'number', value: 192, min: 0, max: 4096 },
      { name: 'Input', type: 'option', value: 'Raw', options: IO_FORMATS },
      { name: 'Output', type: 'option', value: 'Hex', options: IO_FORMATS },
    ],
    run: (input, args) => {
      const key = keyBytes(args, 'Passphrase', true);
      const data = readData(input, String(arg(args, 'Input', 'Raw')));
      const drop = Math.max(0, Number(arg(args, 'Number of dwords to drop', 192))) * 4;

      const keystream = rc4Keystream(key, data.length, drop);
      const out = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) out[i] = (data[i] as number) ^ (keystream[i] as number);
      return writeData(out, String(arg(args, 'Output', 'Hex')));
    },
  },
  {
    id: 'ciphersaber2-encrypt',
    name: 'CipherSaber2 Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with CipherSaber-2, which is RC4 with a random ten-byte IV.',
    aliases: ['ciphersaber'],
    args: [
      {
        name: 'Key',
        type: 'toggleString',
        value: '',
        toggleValues: KEY_FORMATS,
        toggleValue: 'UTF-8',
      },
      { name: 'Rounds', type: 'number', value: 20, min: 1, max: 255 },
    ],
    run: (input, args) => {
      const key = keyBytes(args, 'Key', true);
      const rounds = Math.max(1, Number(arg(args, 'Rounds', 20)));
      const data = asBytes(input);

      const iv = new Uint8Array(10);
      crypto.getRandomValues(iv);
      const schedule = new Uint8Array(key.length + 10);
      schedule.set(key);
      schedule.set(iv, key.length);

      const keystream = rc4Keystream(schedule, data.length, 0, rounds);
      const out = new Uint8Array(data.length + 10);
      out.set(iv);
      for (let i = 0; i < data.length; i++) {
        out[i + 10] = (data[i] as number) ^ (keystream[i] as number);
      }
      return bytesToLatin1(out);
    },
  },
  {
    id: 'ciphersaber2-decrypt',
    name: 'CipherSaber2 Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts CipherSaber-2, reading the ten-byte IV from the front.',
    aliases: ['ciphersaber decrypt'],
    args: [
      {
        name: 'Key',
        type: 'toggleString',
        value: '',
        toggleValues: KEY_FORMATS,
        toggleValue: 'UTF-8',
      },
      { name: 'Rounds', type: 'number', value: 20, min: 1, max: 255 },
    ],
    run: (input, args) => {
      const key = keyBytes(args, 'Key', true);
      const rounds = Math.max(1, Number(arg(args, 'Rounds', 20)));
      const data = asBytes(input);
      if (data.length < 10) throw new OperationError('The message is shorter than its own IV.');

      const schedule = new Uint8Array(key.length + 10);
      schedule.set(key);
      schedule.set(data.subarray(0, 10), key.length);

      const body = data.subarray(10);
      const keystream = rc4Keystream(schedule, body.length, 0, rounds);
      const out = new Uint8Array(body.length);
      for (let i = 0; i < body.length; i++) out[i] = (body[i] as number) ^ (keystream[i] as number);
      return bytesToLatin1(out);
    },
  },
];
