import { OperationError } from '../types';
import { asBytes, bytesToLatin1, toBytes } from '../core/bytes';
import { arg, type Operation } from './types';



function base64UrlToBytes(text: string): Uint8Array {
  const normalised = text.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    throw new OperationError('That is not valid URL-safe Base64.');
  }
}

function bytesToBase64Url(bytes: Uint8Array, padded = false): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
  return padded ? encoded : encoded.replace(/=+$/, '');
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new OperationError('This needs Web Crypto, which the browser has not exposed here.');
  return api;
}

async function hmac(key: Uint8Array, message: Uint8Array, hash: string): Promise<Uint8Array> {
  const imported = await subtle().importKey('raw', key as BufferSource, { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', imported, message as BufferSource));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function isoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || Math.abs(seconds) > 8.64e12) return `(out of range: ${seconds})`;
  return new Date(seconds * 1000).toISOString();
}


const FERNET_VERSION = 0x80;

function fernetKey(text: string): { signing: Uint8Array; encryption: Uint8Array } {
  const bytes = base64UrlToBytes(text);
  if (bytes.length !== 32) {
    throw new OperationError(`A Fernet key is 32 bytes of URL-safe Base64; this one is ${bytes.length}.`);
  }
  return { signing: bytes.subarray(0, 16), encryption: bytes.subarray(16, 32) };
}

async function aesCbc(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
  encrypt: boolean,
): Promise<Uint8Array> {
  const imported = await subtle().importKey('raw', key as BufferSource, { name: 'AES-CBC' }, false, [
    encrypt ? 'encrypt' : 'decrypt',
  ]);
  const parameters = { name: 'AES-CBC', iv: iv as BufferSource };
  const result = encrypt
    ? await subtle().encrypt(parameters, imported, data as BufferSource)
    : await subtle().decrypt(parameters, imported, data as BufferSource);
  return new Uint8Array(result);
}


async function flaskKey(secret: string, salt: string): Promise<Uint8Array> {
  return hmac(toBytes(secret), toBytes(salt), 'SHA-1');
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function encodeTimestamp(seconds: number): Uint8Array {
  const bytes: number[] = [];
  let value = Math.floor(seconds);
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return new Uint8Array(bytes.length > 0 ? bytes : [0]);
}

function decodeTimestamp(bytes: Uint8Array): number {
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
}

async function flaskPayload(text: string): Promise<string> {
  const compressed = text.startsWith('.');
  const body = base64UrlToBytes(compressed ? text.slice(1) : text);
  if (!compressed) return bytesToLatin1(body);
  try {
    return bytesToLatin1(await inflate(body));
  } catch {
    throw new OperationError('The session payload says it is compressed, but it does not decompress.');
  }
}

const SALT_ARG = {
  name: 'Salt',
  type: 'string' as const,
  value: 'cookie-session',
  hint: "Flask's own salt; a different application may use another",
};

export const tokenOperations: Operation[] = [
  {
    id: 'fernet-encrypt',
    name: 'Fernet Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts the input into a Fernet token: AES-128-CBC with an HMAC over the whole thing.',
    aliases: ['fernet', 'symmetric token', 'encrypt token'],
    budgetMs: 20000,
    args: [
      { name: 'Key', type: 'string', value: '', hint: '32 bytes of URL-safe Base64' },
      {
        name: 'Timestamp',
        type: 'number',
        value: 0,
        min: 0,
        hint: 'Unix seconds; 0 means now',
      },
    ],
    run: async (input, args) => {
      const { signing, encryption } = fernetKey(String(arg(args, 'Key', '')));
      const given = Number(arg(args, 'Timestamp', 0));
      const seconds = given > 0 ? Math.trunc(given) : Math.floor(Date.now() / 1000);

      const iv = new Uint8Array(16);
      globalThis.crypto.getRandomValues(iv);

      const header = new Uint8Array(9);
      header[0] = FERNET_VERSION;
      new DataView(header.buffer).setBigUint64(1, BigInt(seconds));

      const cipher = await aesCbc(encryption, iv, asBytes(input), true);
      const signed = concat([header, iv, cipher]);
      const tag = await hmac(signing, signed, 'SHA-256');
      return bytesToBase64Url(concat([signed, tag]), true);
    },
  },
  {
    id: 'fernet-decrypt',
    name: 'Fernet Decrypt',
    category: 'Encryption / Encoding',
    description: 'Checks a Fernet token and decrypts it, refusing one whose HMAC does not match.',
    aliases: ['fernet decode', 'decrypt token'],
    budgetMs: 20000,
    args: [
      { name: 'Key', type: 'string', value: '', hint: '32 bytes of URL-safe Base64' },
      { name: 'Show the header', type: 'boolean', value: false },
    ],
    run: async (input, args) => {
      const { signing, encryption } = fernetKey(String(arg(args, 'Key', '')));
      const token = base64UrlToBytes(input);

      if (token.length < 57) throw new OperationError('That is too short to be a Fernet token.');
      if (token[0] !== FERNET_VERSION) {
        throw new OperationError(
          `A Fernet token starts with 0x80; this one starts with 0x${token[0]!.toString(16)}.`,
        );
      }
      if ((token.length - 57) % 16 !== 0) {
        throw new OperationError('The ciphertext is not a whole number of AES blocks.');
      }

      const signed = token.subarray(0, token.length - 32);
      const tag = token.subarray(token.length - 32);
      const expected = await hmac(signing, signed, 'SHA-256');
      if (!sameBytes(tag, expected)) {
        throw new OperationError(
          'The HMAC does not match: the key is wrong, or the token has been altered.',
        );
      }

      const timestamp = Number(new DataView(token.buffer, token.byteOffset, token.byteLength).getBigUint64(1));
      const iv = token.subarray(9, 25);
      const cipher = token.subarray(25, token.length - 32);

      let plain: Uint8Array;
      try {
        plain = await aesCbc(encryption, iv, cipher, false);
      } catch {
        throw new OperationError('The token authenticated but did not decrypt: its padding is wrong.');
      }

      if (!arg(args, 'Show the header', false)) return bytesToLatin1(plain);
      return [
        `Version:   0x80`,
        `Issued:    ${isoTime(timestamp)}`,
        `IV:        ${Array.from(iv, (b) => b.toString(16).padStart(2, '0')).join('')}`,
        '',
        bytesToLatin1(plain),
      ].join('\n');
    },
  },
  {
    id: 'flask-session-decode',
    name: 'Flask Session Decode',
    category: 'Encryption / Encoding',
    description: 'Reads a Flask session cookie. It is signed, not encrypted, so no key is needed.',
    aliases: ['flask cookie', 'itsdangerous decode', 'session cookie'],
    budgetMs: 20000,
    args: [{ name: 'Show the signature', type: 'boolean', value: true }],
    run: async (input, args) => {
      const parts = input.trim().split('.');
      const compressed = parts[0] === '';
      const fields = compressed ? parts.slice(1) : parts;
      if (fields.length < 3) {
        throw new OperationError(
          'A Flask session cookie has three parts separated by dots: payload, timestamp and signature.',
        );
      }

      const payload = await flaskPayload((compressed ? '.' : '') + fields[0]!);
      const timestamp = decodeTimestamp(base64UrlToBytes(fields[1]!));

      let pretty = payload;
      try {
        pretty = JSON.stringify(JSON.parse(payload), null, 2);
      } catch {
      }

      if (!arg(args, 'Show the signature', true)) return pretty;
      return [
        `Signed at:  ${isoTime(timestamp)}`,
        `Compressed: ${compressed ? 'yes' : 'no'}`,
        `Signature:  ${fields[2]!}`,
        '',
        pretty,
      ].join('\n');
    },
  },
  {
    id: 'flask-session-sign',
    name: 'Flask Session Sign',
    category: 'Encryption / Encoding',
    description: 'Signs JSON into a Flask session cookie with a known secret key.',
    aliases: ['flask cookie sign', 'itsdangerous sign', 'forge session'],
    budgetMs: 20000,
    args: [
      { name: 'Secret key', type: 'string', value: '' },
      SALT_ARG,
      { name: 'Timestamp', type: 'number', value: 0, min: 0, hint: 'Unix seconds; 0 means now' },
      { name: 'Compress', type: 'boolean', value: false },
    ],
    run: async (input, args) => {
      const secret = String(arg(args, 'Secret key', ''));
      if (secret.length === 0) throw new OperationError('Signing needs the secret key.');

      const raw = asBytes(input);
      let body = bytesToBase64Url(raw);
      if (arg(args, 'Compress', false)) {
        const squeezed = await deflate(raw);
        if (squeezed.length < raw.length) body = '.' + bytesToBase64Url(squeezed);
      }

      const given = Number(arg(args, 'Timestamp', 0));
      const seconds = given > 0 ? Math.trunc(given) : Math.floor(Date.now() / 1000);
      const stamp = bytesToBase64Url(encodeTimestamp(seconds));

      const key = await flaskKey(secret, String(arg(args, 'Salt', 'cookie-session')));
      const signature = await hmac(key, toBytes(`${body}.${stamp}`), 'SHA-1');
      return `${body}.${stamp}.${bytesToBase64Url(signature)}`;
    },
  },
  {
    id: 'flask-session-verify',
    name: 'Flask Session Verify',
    category: 'Encryption / Encoding',
    description: 'Checks a Flask session cookie against a secret key, which is how a key guess is confirmed.',
    aliases: ['flask cookie verify', 'itsdangerous verify', 'check secret key'],
    budgetMs: 20000,
    args: [{ name: 'Secret key', type: 'string', value: '' }, SALT_ARG],
    run: async (input, args) => {
      const secret = String(arg(args, 'Secret key', ''));
      if (secret.length === 0) throw new OperationError('Verifying needs the secret key.');

      const cookie = input.trim();
      const at = cookie.lastIndexOf('.');
      if (at < 1) throw new OperationError('That does not look like a signed cookie.');

      const signed = cookie.slice(0, at);
      const given = base64UrlToBytes(cookie.slice(at + 1));
      const key = await flaskKey(secret, String(arg(args, 'Salt', 'cookie-session')));
      const expected = await hmac(key, toBytes(signed), 'SHA-1');

      return sameBytes(given, expected)
        ? `Verified: this cookie was signed with that key.`
        : 'Not verified. That is not the key this cookie was signed with.';
    },
  },
];
