import { OperationError } from '../types';
import { asBytes } from '../core/bytes';
import { PI_HEX_DIGITS } from '../core/piDigits';
import { arg, type Operation } from './types';


const utf8 = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function subtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new OperationError('This browser does not expose Web Crypto.');
  }
  return crypto.subtle;
}


const BCRYPT_ALPHABET = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function bcryptBase64Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BCRYPT_ALPHABET[a >> 2];
    out += BCRYPT_ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += BCRYPT_ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += BCRYPT_ALPHABET[c & 0x3f];
  }
  return out;
}

function bcryptBase64Decode(text: string): Uint8Array {
  const values = Array.from(text, (char) => {
    const index = BCRYPT_ALPHABET.indexOf(char);
    if (index < 0) throw new OperationError(`'${char}' is not in bcrypt's alphabet.`);
    return index;
  });

  const out: number[] = [];
  for (let i = 0; i < values.length; i += 4) {
    const [a, b, c, d] = [values[i], values[i + 1], values[i + 2], values[i + 3]];
    if (b === undefined) break;
    out.push((((a as number) << 2) | (b >> 4)) & 0xff);
    if (c === undefined) break;
    out.push((((b & 0x0f) << 4) | (c >> 2)) & 0xff);
    if (d === undefined) break;
    out.push((((c & 0x03) << 6) | d) & 0xff);
  }
  return new Uint8Array(out);
}

function eksBlowfish(password: Uint8Array, salt: Uint8Array, cost: number) {
  const word = (index: number) => parseInt(PI_HEX_DIGITS.substr(index * 8, 8), 16) >>> 0;
  const p = new Uint32Array(18);
  for (let i = 0; i < 18; i++) p[i] = word(i);
  const s = [0, 1, 2, 3].map((box) => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) table[i] = word(18 + box * 256 + i);
    return table;
  });

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

  const expand = (key: Uint8Array, data: Uint8Array | null) => {
    for (let i = 0; i < 18; i++) {
      let value = 0;
      for (let j = 0; j < 4; j++) {
        value = ((value << 8) | (key[(i * 4 + j) % key.length] as number)) >>> 0;
      }
      p[i] = ((p[i] as number) ^ value) >>> 0;
    }

    let block: [number, number] = [0, 0];
    let at = 0;
    const next = (): [number, number] => {
      if (!data) return block;
      const read = () => {
        let value = 0;
        for (let j = 0; j < 4; j++) {
          value = ((value << 8) | (data[at++ % data.length] as number)) >>> 0;
        }
        return value;
      };
      return [(block[0] ^ read()) >>> 0, (block[1] ^ read()) >>> 0];
    };

    for (let i = 0; i < 18; i += 2) {
      block = encryptPair(next());
      p[i] = block[0];
      p[i + 1] = block[1];
    }
    for (const box of s) {
      for (let i = 0; i < 256; i += 2) {
        block = encryptPair(next());
        box[i] = block[0];
        box[i + 1] = block[1];
      }
    }
  };

  expand(password, salt);
  const rounds = 2 ** cost;
  for (let i = 0; i < rounds; i++) {
    expand(password, null);
    expand(salt, null);
  }

  const magic = utf8.encode('OrpheanBeholderScryDoubt');
  const words: number[] = [];
  for (let i = 0; i < 6; i++) {
    words.push(
      (((magic[i * 4] as number) << 24) |
        ((magic[i * 4 + 1] as number) << 16) |
        ((magic[i * 4 + 2] as number) << 8) |
        (magic[i * 4 + 3] as number)) >>>
        0,
    );
  }
  for (let round = 0; round < 64; round++) {
    for (let i = 0; i < 6; i += 2) {
      const [left, right] = encryptPair([words[i] as number, words[i + 1] as number]);
      words[i] = left;
      words[i + 1] = right;
    }
  }

  const out = new Uint8Array(24);
  words.forEach((value, i) => {
    out[i * 4] = (value >>> 24) & 0xff;
    out[i * 4 + 1] = (value >>> 16) & 0xff;
    out[i * 4 + 2] = (value >>> 8) & 0xff;
    out[i * 4 + 3] = value & 0xff;
  });
  return out.subarray(0, 23);
}

interface BcryptParts {
  version: string;
  cost: number;
  salt: Uint8Array;
  hash: string;
}

function parseBcrypt(text: string): BcryptParts {
  const match = /^\$(2[abxy]?)\$(\d{2})\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})?$/.exec(text.trim());
  if (!match) throw new OperationError('That is not a bcrypt hash.');
  return {
    version: match[1] as string,
    cost: Number(match[2]),
    salt: bcryptBase64Decode(match[3] as string),
    hash: match[4] ?? '',
  };
}

function bcrypt(password: string, salt: Uint8Array, cost: number, version: string): string {
  if (cost < 4 || cost > 16) {
    throw new OperationError('The cost must be between 4 and 16 here; 31 would never finish.');
  }
  if (salt.length !== 16) throw new OperationError('A bcrypt salt is 16 bytes.');

  const bytes = utf8.encode(password).subarray(0, 72);
  const keyed = new Uint8Array(bytes.length + 1);
  keyed.set(bytes);

  const digest = eksBlowfish(keyed, salt, cost);
  return `$${version}$${String(cost).padStart(2, '0')}$${bcryptBase64Encode(salt)}${bcryptBase64Encode(digest)}`;
}


function salsa8(block: Uint32Array): void {
  const x = new Uint32Array(block);
  const rotl = (value: number, bits: number) => ((value << bits) | (value >>> (32 - bits))) >>> 0;
  const quarter = (a: number, b: number, c: number, d: number) => {
    x[b] = ((x[b] as number) ^ rotl(((x[a] as number) + (x[d] as number)) >>> 0, 7)) >>> 0;
    x[c] = ((x[c] as number) ^ rotl(((x[b] as number) + (x[a] as number)) >>> 0, 9)) >>> 0;
    x[d] = ((x[d] as number) ^ rotl(((x[c] as number) + (x[b] as number)) >>> 0, 13)) >>> 0;
    x[a] = ((x[a] as number) ^ rotl(((x[d] as number) + (x[c] as number)) >>> 0, 18)) >>> 0;
  };

  for (let i = 0; i < 8; i += 2) {
    quarter(0, 4, 8, 12);
    quarter(5, 9, 13, 1);
    quarter(10, 14, 2, 6);
    quarter(15, 3, 7, 11);
    quarter(0, 1, 2, 3);
    quarter(5, 6, 7, 4);
    quarter(10, 11, 8, 9);
    quarter(15, 12, 13, 14);
  }
  for (let i = 0; i < 16; i++) block[i] = ((block[i] as number) + (x[i] as number)) >>> 0;
}

function blockMix(input: Uint32Array, output: Uint32Array, r: number): void {
  const x = new Uint32Array(input.subarray((2 * r - 1) * 16, 2 * r * 16));
  for (let i = 0; i < 2 * r; i++) {
    for (let j = 0; j < 16; j++) x[j] = ((x[j] as number) ^ (input[i * 16 + j] as number)) >>> 0;
    salsa8(x);
    const target = (i % 2 === 0 ? i / 2 : r + (i - 1) / 2) * 16;
    output.set(x, target);
  }
}

async function pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length: number,
): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', password as BufferSource, 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

const MAX_SCRYPT_BYTES = 128 * 1024 * 1024;

async function scrypt(
  password: Uint8Array,
  salt: Uint8Array,
  n: number,
  r: number,
  p: number,
  length: number,
): Promise<Uint8Array> {
  if (n < 2 || (n & (n - 1)) !== 0) throw new OperationError('N must be a power of two above 1.');
  if (r < 1 || p < 1) throw new OperationError('r and p must be at least 1.');
  if (128 * r * n > MAX_SCRYPT_BYTES) {
    throw new OperationError(`128 * r * N is ${128 * r * n} bytes; the limit here is ${MAX_SCRYPT_BYTES}.`);
  }

  const b = await pbkdf2(password, salt, 1, p * 128 * r);
  const words = new Uint32Array(b.buffer, b.byteOffset, b.byteLength / 4);

  for (let i = 0; i < p; i++) {
    const block = words.subarray(i * 32 * r, (i + 1) * 32 * r);
    const v = new Uint32Array(32 * r * n);
    const scratch = new Uint32Array(32 * r);

    for (let j = 0; j < n; j++) {
      v.set(block, j * 32 * r);
      blockMix(block, scratch, r);
      block.set(scratch);
    }
    for (let j = 0; j < n; j++) {
      const index = (block[(2 * r - 1) * 16] as number) & (n - 1);
      for (let k = 0; k < 32 * r; k++) {
        block[k] = ((block[k] as number) ^ (v[index * 32 * r + k] as number)) >>> 0;
      }
      blockMix(block, scratch, r);
      block.set(scratch);
    }
  }

  return pbkdf2(password, new Uint8Array(b.buffer, b.byteOffset, b.byteLength), 1, length);
}

export const passwordHashOperations: Operation[] = [
  {
    id: 'bcrypt',
    name: 'Bcrypt',
    category: 'Hashing',
    description: 'Hashes a password with bcrypt, at a cost you choose.',
    aliases: ['blowfish hash', 'password hash'],
    args: [
      { name: 'Rounds', type: 'number', value: 10, min: 4, max: 16 },
      {
        name: 'Salt',
        type: 'string',
        value: '',
        hint: 'Blank generates one; otherwise 22 bcrypt-base64 characters',
      },
      { name: 'Version', type: 'option', value: '2b', options: ['2b', '2a', '2y'] },
    ],
    run: (input, args) => {
      const saltText = String(arg(args, 'Salt', '')).trim();
      let salt: Uint8Array;
      if (saltText === '') {
        salt = new Uint8Array(16);
        crypto.getRandomValues(salt);
      } else {
        salt = bcryptBase64Decode(saltText.slice(0, 22));
        if (salt.length !== 16) throw new OperationError('A bcrypt salt is 22 characters.');
      }
      return bcrypt(
        input,
        salt,
        Number(arg(args, 'Rounds', 10)),
        String(arg(args, 'Version', '2b')),
      );
    },
  },
  {
    id: 'bcrypt-compare',
    name: 'Bcrypt compare',
    category: 'Hashing',
    description: 'Says whether a password matches a bcrypt hash.',
    aliases: ['check password', 'verify bcrypt'],
    args: [{ name: 'Hash', type: 'string', value: '' }],
    run: (input, args) => {
      const parts = parseBcrypt(String(arg(args, 'Hash', '')));
      if (parts.hash === '') throw new OperationError('That hash has no digest to compare against.');
      const computed = bcrypt(input, parts.salt, parts.cost, parts.version);
      return computed.endsWith(parts.hash)
        ? 'Match: the password produces this hash.'
        : 'No match.';
    },
  },
  {
    id: 'bcrypt-parse',
    name: 'Bcrypt parse',
    category: 'Hashing',
    description: 'Splits a bcrypt hash into its version, cost, salt and digest.',
    aliases: ['inspect bcrypt'],
    args: [],
    run: (input) => {
      const parts = parseBcrypt(input);
      return [
        `Version: ${parts.version}`,
        `Rounds: ${parts.cost} (${2 ** parts.cost} iterations)`,
        `Salt: ${bcryptBase64Encode(parts.salt)}`,
        `Salt bytes: ${hex(parts.salt)}`,
        parts.hash === '' ? 'Digest: none — this is a salt only.' : `Digest: ${parts.hash}`,
      ].join('\n');
    },
  },
  {
    id: 'scrypt',
    name: 'Scrypt',
    category: 'Hashing',
    description: 'Derives a key with scrypt, which is deliberately memory-hungry.',
    aliases: ['memory hard', 'password kdf'],
    args: [
      { name: 'Salt', type: 'toggleString', value: '', toggleValues: ['Hex', 'UTF-8'], toggleValue: 'Hex' },
      { name: 'Iterations (N)', type: 'number', value: 16384, min: 2 },
      { name: 'Memory factor (r)', type: 'number', value: 8, min: 1, max: 64 },
      { name: 'Parallelisation factor (p)', type: 'number', value: 1, min: 1, max: 16 },
      { name: 'Key length', type: 'number', value: 64, min: 1, max: 1024 },
    ],
    run: async (input, args) => {
      const saltText = String(arg(args, 'Salt', ''));
      const salt =
        args.find((a) => a.name === 'Salt')?.toggleValue === 'UTF-8'
          ? utf8.encode(saltText)
          : new Uint8Array((saltText.replace(/[^0-9a-fA-F]/g, '').match(/../g) ?? []).map((p) => parseInt(p, 16)));

      const out = await scrypt(
        asBytes(input),
        salt,
        Number(arg(args, 'Iterations (N)', 16384)),
        Number(arg(args, 'Memory factor (r)', 8)),
        Number(arg(args, 'Parallelisation factor (p)', 1)),
        Number(arg(args, 'Key length', 64)),
      );
      return hex(out);
    },
  },
];
