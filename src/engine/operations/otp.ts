import { OperationError } from '../types';
import { asBytes, toBytes } from '../core/bytes';
import { arg, type Operation } from './types';


const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function fromBase32(text: string): Uint8Array {
  const cleaned = text.toUpperCase().replace(/[=\s-]/g, '');
  if (cleaned.length === 0) throw new OperationError('The secret is empty.');

  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of cleaned) {
    const value = BASE32.indexOf(character);
    if (value === -1) {
      throw new OperationError(`'${character}' is not a Base32 character (A-Z and 2-7).`);
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function fromHex(text: string): Uint8Array {
  const cleaned = text.replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length % 2 !== 0) throw new OperationError('A hex secret needs an even digit count.');
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function secretBytes(input: string, encoding: string): Uint8Array {
  const trimmed = input.trim();
  if (encoding === 'Base32') return fromBase32(trimmed);
  if (encoding === 'Hex') return fromHex(trimmed);
  if (encoding === 'UTF-8') return toBytes(trimmed);
  return asBytes(input);
}

function requireSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new OperationError('One-time passwords need Web Crypto, which this browser has not exposed.');
  }
  return subtle;
}

function counterBytes(counter: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

async function hotp(
  secret: Uint8Array,
  counter: bigint,
  digits: number,
  hash: string,
): Promise<string> {
  const subtle = requireSubtle();
  const key = await subtle.importKey(
    'raw',
    secret as BufferSource,
    { name: 'HMAC', hash },
    false,
    ['sign'],
  );
  const tag = new Uint8Array(
    await subtle.sign('HMAC', key, counterBytes(counter) as BufferSource),
  );

  const offset = tag[tag.length - 1]! & 0x0f;
  const binary =
    ((tag[offset]! & 0x7f) << 24) |
    (tag[offset + 1]! << 16) |
    (tag[offset + 2]! << 8) |
    tag[offset + 3]!;

  return String(binary % 10 ** digits).padStart(digits, '0');
}

const SECRET_ARG = {
  name: 'Secret encoding',
  type: 'option' as const,
  value: 'Base32',
  options: ['Base32', 'Hex', 'UTF-8', 'Raw bytes'],
};

const HASH_ARG = {
  name: 'Hash',
  type: 'option' as const,
  value: 'SHA-1',
  options: ['SHA-1', 'SHA-256', 'SHA-512'],
};

function digitsOf(args: Parameters<Operation['run']>[1]): number {
  const digits = Number(arg(args, 'Digits', 6));
  if (!Number.isInteger(digits) || digits < 4 || digits > 10) {
    throw new OperationError('A one-time password has between 4 and 10 digits.');
  }
  return digits;
}

export const otpOperations: Operation[] = [
  {
    id: 'generate-hotp',
    name: 'Generate HOTP',
    category: 'Other',
    description: 'The counter-based one-time password of RFC 4226, from a shared secret.',
    aliases: ['hotp', 'counter otp', 'rfc 4226'],
    args: [
      SECRET_ARG,
      { name: 'Counter', type: 'number', value: 0, min: 0 },
      { name: 'Digits', type: 'number', value: 6, min: 4, max: 10 },
      HASH_ARG,
    ],
    run: async (input, args) => {
      const secret = secretBytes(input, String(arg(args, 'Secret encoding', 'Base32')));
      const counter = BigInt(Math.trunc(Number(arg(args, 'Counter', 0))));
      if (counter < 0n) throw new OperationError('The counter cannot be negative.');
      return hotp(secret, counter, digitsOf(args), String(arg(args, 'Hash', 'SHA-1')));
    },
  },
  {
    id: 'generate-totp',
    name: 'Generate TOTP',
    category: 'Other',
    description: 'The time-based one-time password of RFC 6238: what an authenticator app shows.',
    aliases: ['totp', '2fa', 'authenticator', 'rfc 6238', 'google authenticator'],
    args: [
      SECRET_ARG,
      { name: 'Time step (seconds)', type: 'number', value: 30, min: 1, max: 3600 },
      { name: 'Digits', type: 'number', value: 6, min: 4, max: 10 },
      HASH_ARG,
      {
        name: 'Timestamp',
        type: 'number',
        value: 0,
        min: 0,
        hint: 'Unix seconds; 0 means now',
      },
      { name: 'Show the window', type: 'boolean', value: false },
    ],
    run: async (input, args) => {
      const secret = secretBytes(input, String(arg(args, 'Secret encoding', 'Base32')));
      const digits = digitsOf(args);
      const hash = String(arg(args, 'Hash', 'SHA-1'));
      const period = Number(arg(args, 'Time step (seconds)', 30));

      const given = Number(arg(args, 'Timestamp', 0));
      const seconds = given > 0 ? Math.trunc(given) : Math.floor(Date.now() / 1000);
      const counter = BigInt(Math.floor(seconds / period));
      const code = await hotp(secret, counter, digits, hash);

      if (!arg(args, 'Show the window', false)) return code;

      const before = await hotp(secret, counter - 1n, digits, hash);
      const after = await hotp(secret, counter + 1n, digits, hash);
      const remaining = period - (seconds % period);
      return [
        `Code:      ${code}`,
        `Valid for: ${remaining}s (step ${counter})`,
        `Previous:  ${before}`,
        `Next:      ${after}`,
      ].join('\n');
    },
  },
];

export { fromBase32 };
