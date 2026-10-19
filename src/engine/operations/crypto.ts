import { OperationError } from '../types';
import { asBytes, bytesToLatin1, latin1ToBytes } from '../core/bytes';
import { arg, type Operation } from './types';
import { parseKey } from './keys';

function rotate(input: string, amount: number): string {
  const shift = ((amount % 26) + 26) % 26;
  return input.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + shift) % 26) + base);
  });
}

interface RotateOptions {
  amount: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
}

function rotateSelective(input: string, options: RotateOptions): string {
  const letters = ((options.amount % 26) + 26) % 26;
  const numbers = ((options.amount % 10) + 10) % 10;

  return input.replace(/[a-zA-Z0-9]/g, (char) => {
    const code = char.charCodeAt(0);

    if (code >= 48 && code <= 57) {
      return options.digits ? String.fromCharCode(((code - 48 + numbers) % 10) + 48) : char;
    }
    const upper = code <= 90;
    if (upper ? !options.upper : !options.lower) return char;

    const base = upper ? 65 : 97;
    return String.fromCharCode(((code - base + letters) % 26) + base);
  });
}

async function digest(algorithm: string, input: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new OperationError('Hashing needs a secure context (HTTPS or localhost).');
  }
  const buffer = await crypto.subtle.digest(algorithm, asBytes(input) as BufferSource);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const cryptoOperations: Operation[] = [
  {
    id: 'rot13',
    name: 'ROT13',
    category: 'Encryption / Encoding',
    description: 'Rotates each letter 13 places through the alphabet.',
    aliases: ['rot', 'caesar 13'],
    args: [
      { name: 'Rotate lower case', type: 'boolean', value: true },
      { name: 'Rotate upper case', type: 'boolean', value: true },
      { name: 'Rotate numbers', type: 'boolean', value: false },
      { name: 'Amount', type: 'number', value: 13, min: -25, max: 25 },
    ],
    run: (input, args) =>
      rotateSelective(input, {
        amount: Number(arg(args, 'Amount', 13)),
        lower: arg(args, 'Rotate lower case', true),
        upper: arg(args, 'Rotate upper case', true),
        digits: arg(args, 'Rotate numbers', false),
      }),
  },
  {
    id: 'rot',
    name: 'ROT',
    category: 'Encryption / Encoding',
    description: 'Rotates each letter by a chosen number of places.',
    aliases: ['caesar', 'shift cipher', 'rotate letters'],
    args: [{ name: 'Amount', type: 'number', value: 13, min: 1, max: 25 }],
    run: (input, args) => rotate(input, Number(args.find((a) => a.name === 'Amount')?.value ?? 13)),
  },
  {
    id: 'rot-n',
    name: 'ROT13 Brute Force',
    category: 'Encryption / Encoding',
    description: 'Shows every rotation from 1 to 25 so the readable one stands out.',
    aliases: ['caesar brute force', 'rot brute'],
    args: [
      {
        name: 'Sample length',
        type: 'number',
        value: 100,
        min: 1,
        hint: 'Twenty-five copies of a long message is unreadable. This prints the first N characters of each.',
      },
      { name: 'Sample offset', type: 'number', value: 0, min: 0 },
      { name: 'Print rotation amount', type: 'boolean', value: true },
    ],
    run: (input, args) => {
      const length = Math.max(1, Number(arg(args, 'Sample length', 100)));
      const offset = Math.max(0, Number(arg(args, 'Sample offset', 0)));
      const label = Boolean(arg(args, 'Print rotation amount', true));
      const sample = input.slice(offset, offset + length);
      return Array.from({ length: 25 }, (_, i) => {
        const rotated = rotate(sample, i + 1);
        return label ? `${String(i + 1).padStart(2, ' ')}: ${rotated}` : rotated;
      }).join('\n');
    },
  },
  {
    id: 'atbash',
    name: 'Atbash Cipher',
    category: 'Encryption / Encoding',
    description: 'Mirrors the alphabet, so A becomes Z and B becomes Y.',
    aliases: ['atbash'],
    args: [],
    run: (input) =>
      input.replace(/[a-zA-Z]/g, (char) => {
        const base = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(base + 25 - (char.charCodeAt(0) - base));
      }),
  },
  {
    id: 'xor',
    name: 'XOR',
    category: 'Encryption / Encoding',
    description: 'XORs the input against a repeating key.',
    aliases: ['xor cipher', 'exclusive or'],
    args: [
      {
        name: 'Key',
        type: 'toggleString',
        value: '',
        toggleValues: ['UTF-8', 'Hex', 'Base64'],
        toggleValue: 'Hex',
        hint: 'Repeated across the input',
      },
    ],
    run: (input, args) => {
      const keyArg = args.find((a) => a.name === 'Key');
      const key = parseKey(String(keyArg?.value ?? ''), keyArg?.toggleValue ?? 'Hex');
      if (key.length === 0) throw new OperationError('XOR needs a key.');
      const data = latin1ToBytes(input);
      const out = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) out[i] = data[i]! ^ key[i % key.length]!;
      return bytesToLatin1(out);
    },
  },
  {
    id: 'sha-1',
    name: 'SHA-1',
    category: 'Hashing',
    description: 'Computes the SHA-1 digest. Broken for security use; still common in the wild.',
    aliases: ['sha1'],
    args: [],
    run: (input) => digest('SHA-1', input),
  },
  {
    id: 'sha-256',
    name: 'SHA-256',
    category: 'Hashing',
    description: 'Computes the SHA-256 digest.',
    aliases: ['sha256'],
    args: [],
    run: (input) => digest('SHA-256', input),
  },
  {
    id: 'sha-384',
    name: 'SHA-384',
    category: 'Hashing',
    description: 'Computes the SHA-384 digest.',
    aliases: ['sha384'],
    args: [],
    run: (input) => digest('SHA-384', input),
  },
  {
    id: 'sha-512',
    name: 'SHA-512',
    category: 'Hashing',
    description: 'Computes the SHA-512 digest.',
    aliases: ['sha512'],
    args: [],
    run: (input) => digest('SHA-512', input),
  },
  {
    id: 'identify-hash',
    name: 'Analyse Hash',
    category: 'Hashing',
    description: 'Identifies which hash algorithms produce a digest of this length.',
    aliases: ['hash identifier', 'what hash', 'hash id'],
    args: [],
    run: (input) => {
      const cleaned = input.trim().replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
        throw new OperationError('A hash digest should be hexadecimal.');
      }
      const candidates: Record<number, string[]> = {
        32: ['MD5', 'MD4', 'NTLM', 'LM'],
        40: ['SHA-1', 'RIPEMD-160', 'MySQL 4.1+'],
        56: ['SHA-224', 'SHA3-224'],
        64: ['SHA-256', 'SHA3-256', 'BLAKE2s-256'],
        96: ['SHA-384', 'SHA3-384'],
        128: ['SHA-512', 'SHA3-512', 'BLAKE2b-512', 'Whirlpool'],
      };
      const matches = candidates[cleaned.length];
      if (!matches) {
        return `${cleaned.length} hex digits (${cleaned.length * 4} bits) — no common hash has this length.`;
      }
      return [
        `${cleaned.length} hex digits (${(cleaned.length * 4).toString()} bits)`,
        '',
        'Possible algorithms:',
        ...matches.map((m) => `  ${m}`),
        '',
        'Length alone cannot distinguish between these. Context decides.',
      ].join('\n');
    },
  },
];
