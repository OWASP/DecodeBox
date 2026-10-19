import { OperationError } from '../types';
import { asBytes, bytesToLatin1, latin1ToBytes } from '../core/bytes';
import { aes } from '../core/aes';
import type { BlockCipher } from '../core/blockModes';
import { des } from './blockCiphers';
import { parseKey, KEY_FORMATS } from './keys';
import { arg, toggle, type Operation } from './types';


const HASHES = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseHexOrText(value: string, format: string): Uint8Array {
  return parseKey(value, format, true);
}

function subtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new OperationError('This browser does not expose Web Crypto.');
  }
  return crypto.subtle;
}

async function hmac(hash: string, key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await subtle().importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash },
    false,
    ['sign'],
  );
  return new Uint8Array(await subtle().sign('HMAC', imported, data as BufferSource));
}

async function digest(hash: string, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest(hash, data as BufferSource));
}


async function hkdf(
  hash: string,
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
  skipExtract: boolean,
): Promise<Uint8Array> {
  const hashLength = { 'SHA-1': 20, 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64 }[hash] ?? 32;
  if (length > 255 * hashLength) {
    throw new OperationError(`HKDF with ${hash} can produce at most ${255 * hashLength} bytes.`);
  }

  const prk = skipExtract ? ikm : await hmac(hash, salt.length > 0 ? salt : new Uint8Array(hashLength), ikm);
  const out = new Uint8Array(length);
  let previous: Uint8Array = new Uint8Array(0);
  let at = 0;

  for (let counter = 1; at < length; counter++) {
    const block = new Uint8Array(previous.length + info.length + 1);
    block.set(previous);
    block.set(info, previous.length);
    block[block.length - 1] = counter;
    previous = await hmac(hash, prk, block);
    out.set(previous.subarray(0, Math.min(previous.length, length - at)), at);
    at += previous.length;
  }
  return out;
}


async function evpBytesToKey(
  hash: string,
  password: Uint8Array,
  salt: Uint8Array,
  keyLength: number,
  ivLength: number,
  iterations: number,
): Promise<{ key: Uint8Array; iv: Uint8Array }> {
  const material: number[] = [];
  let previous: Uint8Array = new Uint8Array(0);

  while (material.length < keyLength + ivLength) {
    const block = new Uint8Array(previous.length + password.length + salt.length);
    block.set(previous);
    block.set(password, previous.length);
    block.set(salt, previous.length + password.length);

    previous = await digest(hash, block);
    for (let i = 1; i < iterations; i++) previous = await digest(hash, previous);
    material.push(...previous);
  }
  return {
    key: new Uint8Array(material.slice(0, keyLength)),
    iv: new Uint8Array(material.slice(keyLength, keyLength + ivLength)),
  };
}


const KEY_WRAP_IV = new Uint8Array([0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6]);

function xorCounter(a: Uint8Array, counter: number): void {
  for (let j = 0; j < 4; j++) {
    a[7 - j] = (a[7 - j] as number) ^ ((counter >>> (8 * j)) & 0xff);
  }
}

function keyWrap(cipher: BlockCipher, data: Uint8Array, iv: Uint8Array): Uint8Array {
  if (data.length % 8 !== 0 || data.length < 16) {
    throw new OperationError('The key to wrap must be a multiple of 8 bytes, and at least 16.');
  }
  const n = data.length / 8;
  const a = new Uint8Array(iv);
  const r = Array.from({ length: n }, (_, i) => new Uint8Array(data.subarray(i * 8, i * 8 + 8)));

  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < n; i++) {
      const block = new Uint8Array(16);
      block.set(a);
      block.set(r[i] as Uint8Array, 8);
      const encrypted = cipher.encryptBlock(block);

      a.set(encrypted.subarray(0, 8));
      xorCounter(a, n * round + i + 1);
      r[i] = new Uint8Array(encrypted.subarray(8, 16));
    }
  }

  const out = new Uint8Array(data.length + 8);
  out.set(a);
  r.forEach((block, i) => out.set(block, 8 + i * 8));
  return out;
}

function keyUnwrap(cipher: BlockCipher, data: Uint8Array, iv: Uint8Array): Uint8Array {
  if (data.length % 8 !== 0 || data.length < 24) {
    throw new OperationError('A wrapped key is a multiple of 8 bytes, and at least 24.');
  }
  const n = data.length / 8 - 1;
  const a = new Uint8Array(data.subarray(0, 8));
  const r = Array.from({ length: n }, (_, i) => new Uint8Array(data.subarray(8 + i * 8, 16 + i * 8)));

  for (let round = 5; round >= 0; round--) {
    for (let i = n - 1; i >= 0; i--) {
      xorCounter(a, n * round + i + 1);
      const block = new Uint8Array(16);
      block.set(a);
      block.set(r[i] as Uint8Array, 8);
      const decrypted = cipher.decryptBlock(block);
      a.set(decrypted.subarray(0, 8));
      r[i] = new Uint8Array(decrypted.subarray(8, 16));
    }
  }

  if (!a.every((byte, i) => byte === iv[i])) {
    throw new OperationError('The wrapped key did not verify — the wrong key, or damaged data.');
  }
  const out = new Uint8Array(n * 8);
  r.forEach((block, i) => out.set(block, i * 8));
  return out;
}


function cmac(cipher: BlockCipher, data: Uint8Array): Uint8Array {
  const size = cipher.blockSize;
  const rb = size === 16 ? 0x87 : 0x1b;

  const double = (block: Uint8Array) => {
    const out = new Uint8Array(size);
    let carry = 0;
    for (let i = size - 1; i >= 0; i--) {
      const value = ((block[i] as number) << 1) | carry;
      out[i] = value & 0xff;
      carry = value >> 8;
    }
    if ((block[0] as number) & 0x80) out[size - 1] = (out[size - 1] as number) ^ rb;
    return out;
  };

  const l = cipher.encryptBlock(new Uint8Array(size));
  const k1 = double(l);
  const k2 = double(k1);

  const blocks = Math.max(1, Math.ceil(data.length / size));
  const last = new Uint8Array(size);
  const complete = data.length > 0 && data.length % size === 0;

  if (complete) {
    last.set(data.subarray((blocks - 1) * size));
    for (let i = 0; i < size; i++) last[i] = (last[i] as number) ^ (k1[i] as number);
  } else {
    const tail = data.subarray((blocks - 1) * size);
    last.set(tail);
    last[tail.length] = 0x80;
    for (let i = 0; i < size; i++) last[i] = (last[i] as number) ^ (k2[i] as number);
  }

  let x: Uint8Array = new Uint8Array(size);
  for (let i = 0; i < blocks - 1; i++) {
    const block = data.subarray(i * size, i * size + size);
    for (let j = 0; j < size; j++) x[j] = (x[j] as number) ^ (block[j] as number);
    x = cipher.encryptBlock(x);
  }
  for (let j = 0; j < size; j++) x[j] = (x[j] as number) ^ (last[j] as number);
  return cipher.encryptBlock(x);
}


function lmKey(seven: Uint8Array): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = (seven[0] as number) & 0xfe;
  out[1] = (((seven[0] as number) << 7) | ((seven[1] as number) >> 1)) & 0xfe;
  out[2] = (((seven[1] as number) << 6) | ((seven[2] as number) >> 2)) & 0xfe;
  out[3] = (((seven[2] as number) << 5) | ((seven[3] as number) >> 3)) & 0xfe;
  out[4] = (((seven[3] as number) << 4) | ((seven[4] as number) >> 4)) & 0xfe;
  out[5] = (((seven[4] as number) << 3) | ((seven[5] as number) >> 5)) & 0xfe;
  out[6] = (((seven[5] as number) << 2) | ((seven[6] as number) >> 6)) & 0xfe;
  out[7] = ((seven[6] as number) << 1) & 0xfe;
  return out;
}


const JWT_ALGORITHMS = ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384'];

function base64Url(bytes: Uint8Array): string {
  return btoa(bytesToLatin1(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return latin1ToBytes(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));
  } catch {
    throw new OperationError('A token segment is not valid base64url.');
  }
}

function pemToDer(pem: string): Uint8Array {
  const match = /-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/.exec(pem);
  if (!match) throw new OperationError('Expected a PEM key.');
  try {
    return latin1ToBytes(atob((match[1] as string).replace(/[^A-Za-z0-9+/=]/g, '')));
  } catch {
    throw new OperationError('The PEM block does not hold valid base64.');
  }
}

function jwtHash(algorithm: string): string {
  return `SHA-${algorithm.slice(2)}`;
}

async function jwtKey(algorithm: string, key: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  if (algorithm.startsWith('HS')) {
    return subtle().importKey(
      'raw',
      asBytes(key) as BufferSource,
      { name: 'HMAC', hash: jwtHash(algorithm) },
      false,
      [usage],
    );
  }

  const der = pemToDer(key);
  const format = usage === 'sign' ? 'pkcs8' : 'spki';
  const parameters: RsaHashedImportParams | EcKeyImportParams = algorithm.startsWith('RS')
    ? { name: 'RSASSA-PKCS1-v1_5', hash: jwtHash(algorithm) }
    : { name: 'ECDSA', namedCurve: algorithm === 'ES256' ? 'P-256' : 'P-384' };

  try {
    return await subtle().importKey(format, der as BufferSource, parameters, false, [usage]);
  } catch {
    throw new OperationError(
      `That key could not be read as ${format === 'pkcs8' ? 'a private' : 'a public'} key for ${algorithm}.`,
    );
  }
}

function jwtAlgorithmParams(algorithm: string): AlgorithmIdentifier | EcdsaParams {
  if (algorithm.startsWith('HS')) return { name: 'HMAC' };
  if (algorithm.startsWith('RS')) return { name: 'RSASSA-PKCS1-v1_5' };
  return { name: 'ECDSA', hash: jwtHash(algorithm) };
}

export const kdfOperations: Operation[] = [
  {
    id: 'derive-hkdf-key',
    name: 'Derive HKDF key',
    category: 'Encryption / Encoding',
    description: 'Derives key material from a secret with HKDF, as RFC 5869 defines it.',
    aliases: ['hkdf', 'key derivation', 'expand'],
    args: [
      { name: 'Salt', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
      { name: 'Info', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
      { name: 'Hashing function', type: 'option', value: 'SHA-256', options: HASHES },
      { name: 'Extract mode', type: 'option', value: 'with salt', options: ['with salt', 'no salt', 'skip'] },
      { name: 'L (number of output octets)', type: 'number', value: 32, min: 1, max: 16320 },
    ],
    run: async (input, args) => {
      const mode = String(arg(args, 'Extract mode', 'with salt'));
      const out = await hkdf(
        String(arg(args, 'Hashing function', 'SHA-256')),
        asBytes(input),
        mode === 'with salt'
          ? parseHexOrText(String(arg(args, 'Salt', '')), toggle(args, 'Salt', 'Hex'))
          : new Uint8Array(0),
        parseHexOrText(String(arg(args, 'Info', '')), toggle(args, 'Info', 'Hex')),
        Math.max(1, Number(arg(args, 'L (number of output octets)', 32))),
        mode === 'skip',
      );
      return hex(out);
    },
  },
  {
    id: 'derive-evp-key',
    name: 'Derive EVP key',
    category: 'Encryption / Encoding',
    description: "Derives a key and IV from a password the way OpenSSL's EVP_BytesToKey does.",
    aliases: ['evp', 'openssl key', 'bytestokey'],
    args: [
      { name: 'Passphrase', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'UTF-8' },
      { name: 'Key size (bits)', type: 'number', value: 128, min: 8, max: 512 },
      { name: 'IV size (bits)', type: 'number', value: 128, min: 0, max: 512 },
      { name: 'Iterations', type: 'number', value: 1, min: 1, max: 100000 },
      { name: 'Hashing function', type: 'option', value: 'SHA-256', options: HASHES },
      { name: 'Salt', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
    ],
    run: async (_input, args) => {
      const { key, iv } = await evpBytesToKey(
        String(arg(args, 'Hashing function', 'SHA-256')),
        parseHexOrText(String(arg(args, 'Passphrase', '')), toggle(args, 'Passphrase', 'UTF-8')),
        parseHexOrText(String(arg(args, 'Salt', '')), toggle(args, 'Salt', 'Hex')),
        Math.ceil(Number(arg(args, 'Key size (bits)', 128)) / 8),
        Math.ceil(Number(arg(args, 'IV size (bits)', 128)) / 8),
        Math.max(1, Number(arg(args, 'Iterations', 1))),
      );
      return iv.length > 0 ? `Key: ${hex(key)}\nIV:  ${hex(iv)}` : `Key: ${hex(key)}`;
    },
  },
  {
    id: 'aes-key-wrap',
    name: 'AES Key Wrap',
    category: 'Encryption / Encoding',
    description: 'Wraps a key with another key, as RFC 3394 specifies.',
    aliases: ['key wrap', 'rfc3394', 'kek'],
    args: [
      { name: 'Key (KEK)', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
      { name: 'IV', type: 'toggleString', value: 'a6a6a6a6a6a6a6a6', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
      { name: 'Input', type: 'option', value: 'Hex', options: ['Hex', 'Raw'] },
      { name: 'Output', type: 'option', value: 'Hex', options: ['Hex', 'Raw'] },
    ],
    run: (input, args) => {
      const kek = parseKey(String(arg(args, 'Key (KEK)', '')), toggle(args, 'Key (KEK)', 'Hex'), false);
      const iv = parseHexOrText(String(arg(args, 'IV', 'a6a6a6a6a6a6a6a6')), toggle(args, 'IV', 'Hex'));
      const data =
        String(arg(args, 'Input', 'Hex')) === 'Hex'
          ? parseKey(input, 'Hex', true)
          : asBytes(input);

      const wrapped = keyWrap(aes(kek), data, iv.length === 8 ? iv : KEY_WRAP_IV);
      return String(arg(args, 'Output', 'Hex')) === 'Hex' ? hex(wrapped) : bytesToLatin1(wrapped);
    },
  },
  {
    id: 'aes-key-unwrap',
    name: 'AES Key Unwrap',
    category: 'Encryption / Encoding',
    description: 'Unwraps a key wrapped with RFC 3394, checking the integrity value.',
    aliases: ['key unwrap', 'rfc3394 unwrap'],
    args: [
      { name: 'Key (KEK)', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
      { name: 'IV', type: 'toggleString', value: 'a6a6a6a6a6a6a6a6', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
      { name: 'Input', type: 'option', value: 'Hex', options: ['Hex', 'Raw'] },
      { name: 'Output', type: 'option', value: 'Hex', options: ['Hex', 'Raw'] },
    ],
    run: (input, args) => {
      const kek = parseKey(String(arg(args, 'Key (KEK)', '')), toggle(args, 'Key (KEK)', 'Hex'), false);
      const iv = parseHexOrText(String(arg(args, 'IV', 'a6a6a6a6a6a6a6a6')), toggle(args, 'IV', 'Hex'));
      const data =
        String(arg(args, 'Input', 'Hex')) === 'Hex'
          ? parseKey(input, 'Hex', true)
          : asBytes(input);

      const unwrapped = keyUnwrap(aes(kek), data, iv.length === 8 ? iv : KEY_WRAP_IV);
      return String(arg(args, 'Output', 'Hex')) === 'Hex' ? hex(unwrapped) : bytesToLatin1(unwrapped);
    },
  },
  {
    id: 'cmac',
    name: 'CMAC',
    category: 'Hashing',
    description: 'The cipher-based message authentication code of RFC 4493.',
    aliases: ['aes-cmac', 'omac1'],
    args: [
      { name: 'Key', type: 'toggleString', value: '', toggleValues: KEY_FORMATS, toggleValue: 'Hex' },
      { name: 'Encryption algorithm', type: 'option', value: 'AES', options: ['AES', 'Triple DES'] },
    ],
    run: (input, args) => {
      const key = parseKey(String(arg(args, 'Key', '')), toggle(args, 'Key', 'Hex'), false);
      const algorithm = String(arg(args, 'Encryption algorithm', 'AES'));

      let cipher: BlockCipher;
      if (algorithm === 'AES') {
        cipher = aes(key);
      } else {
        if (key.length !== 24) {
          throw new OperationError(`Triple DES CMAC needs a 24-byte key; this one is ${key.length}.`);
        }
        const first = des(key.subarray(0, 8));
        const second = des(key.subarray(8, 16));
        const third = des(key.subarray(16, 24));
        cipher = {
          blockSize: 8,
          encryptBlock: (b) => third.encryptBlock(second.decryptBlock(first.encryptBlock(b))),
          decryptBlock: (b) => first.decryptBlock(second.encryptBlock(third.decryptBlock(b))),
        };
      }
      return hex(cmac(cipher, asBytes(input)));
    },
  },
  {
    id: 'lm-hash',
    name: 'LM Hash',
    category: 'Hashing',
    description: 'The LAN Manager hash, which is two DES operations and no salt.',
    aliases: ['lanman', 'lm', 'windows password'],
    args: [],
    run: (input) => {
      const password = input.toUpperCase().slice(0, 14);
      const bytes = new Uint8Array(14);
      bytes.set(asBytes(password).subarray(0, 14));

      const constant = asBytes('KGS!@#$%');
      const halves = [bytes.subarray(0, 7), bytes.subarray(7, 14)].map((half) =>
        des(lmKey(half)).encryptBlock(constant),
      );
      return hex(halves[0] as Uint8Array) + hex(halves[1] as Uint8Array);
    },
  },
  {
    id: 'jwt-sign',
    name: 'JWT Sign',
    category: 'Encryption / Encoding',
    description: 'Signs a JSON payload as a JSON Web Token.',
    aliases: ['jwt', 'json web token', 'sign token'],
    args: [
      { name: 'Private/Secret key', type: 'textarea', value: '' },
      { name: 'Signing algorithm', type: 'option', value: 'HS256', options: JWT_ALGORITHMS },
      { name: 'Header', type: 'textarea', value: '{}' },
    ],
    run: async (input, args) => {
      let payload: unknown;
      try {
        payload = JSON.parse(input);
      } catch {
        throw new OperationError('The payload must be JSON.');
      }
      let header: Record<string, unknown>;
      try {
        header = JSON.parse(String(arg(args, 'Header', '{}')) || '{}') as Record<string, unknown>;
      } catch {
        throw new OperationError('The header must be JSON.');
      }

      const algorithm = String(arg(args, 'Signing algorithm', 'HS256'));
      if (String(arg(args, 'Private/Secret key', '')).length === 0) {
        throw new OperationError('A signing key is required.');
      }
      const encoder = new TextEncoder();
      const parts = [
        base64Url(encoder.encode(JSON.stringify({ alg: algorithm, typ: 'JWT', ...header }))),
        base64Url(encoder.encode(JSON.stringify(payload))),
      ];

      const key = await jwtKey(algorithm, String(arg(args, 'Private/Secret key', '')), 'sign');
      const signature = new Uint8Array(
        await subtle().sign(jwtAlgorithmParams(algorithm), key, encoder.encode(parts.join('.'))),
      );
      return `${parts.join('.')}.${base64Url(signature)}`;
    },
  },
  {
    id: 'jwt-verify',
    name: 'JWT Verify',
    category: 'Encryption / Encoding',
    description: 'Checks a JSON Web Token signature and returns the payload if it holds.',
    aliases: ['jwt verify', 'validate token'],
    args: [{ name: 'Public/Secret key', type: 'textarea', value: '' }],
    run: async (input, args) => {
      const parts = input.trim().split('.');
      if (parts.length !== 3) throw new OperationError('A JWT has three dot-separated parts.');

      let header: { alg?: string };
      try {
        header = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0] as string))) as {
          alg?: string;
        };
      } catch {
        throw new OperationError('The header is not JSON.');
      }
      const algorithm = header.alg ?? '';
      if (algorithm === 'none' || algorithm === '') {
        throw new OperationError(
          "This token says alg 'none', so it carries no signature at all. Decode it rather than verifying it.",
        );
      }
      if (!JWT_ALGORITHMS.includes(algorithm)) {
        throw new OperationError(`'${algorithm}' is not an algorithm this can verify.`);
      }

      const key = await jwtKey(algorithm, String(arg(args, 'Public/Secret key', '')), 'verify');
      const valid = await subtle().verify(
        jwtAlgorithmParams(algorithm),
        key,
        fromBase64Url(parts[2] as string) as BufferSource,
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
      );
      if (!valid) throw new OperationError('The signature does not verify with that key.');

      return new TextDecoder().decode(fromBase64Url(parts[1] as string));
    },
  },
];
