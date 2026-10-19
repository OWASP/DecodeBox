import { OperationError } from '../types';
import { asBytes, bytesToLatin1, toBytes } from '../core/bytes';
import { arg, type Operation } from './types';


function requireSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new OperationError('AES needs a secure context (HTTPS or localhost).');
  }
  return crypto.subtle;
}

function parseBytes(value: string, format: string, label: string): Uint8Array {
  if (value.length === 0) throw new OperationError(`${label} is required.`);

  if (format === 'Hex') {
    const cleaned = value.replace(/[^0-9a-fA-F]/g, '');
    if (cleaned.length === 0 || cleaned.length % 2 !== 0) {
      throw new OperationError(`${label} must have an even number of hex digits.`);
    }
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
    return bytes;
  }

  if (format === 'Base64') {
    try {
      const binary = atob(value.replace(/\s/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch {
      throw new OperationError(`${label} is not valid Base64.`);
    }
  }

  return toBytes(value);
}

function readArg(
  args: Parameters<Operation['run']>[1],
  name: string,
  label: string,
): Uint8Array {
  const found = args.find((a) => a.name === name);
  return parseBytes(String(found?.value ?? ''), found?.toggleValue ?? 'Hex', label);
}

const KEY_SIZES = [16, 24, 32];

async function importKey(raw: Uint8Array, mode: string, usage: KeyUsage[]) {
  if (!KEY_SIZES.includes(raw.length)) {
    throw new OperationError(
      `AES needs a 128, 192 or 256-bit key. This one is ${raw.length * 8} bits.`,
    );
  }
  return requireSubtle().importKey('raw', raw as BufferSource, { name: mode }, false, usage);
}

function algorithm(mode: string, iv: Uint8Array): AesCbcParams | AesCtrParams | AesGcmParams {
  if (mode === 'AES-CBC') {
    if (iv.length !== 16) throw new OperationError('CBC needs a 16-byte IV.');
    return { name: 'AES-CBC', iv: iv as BufferSource };
  }
  if (mode === 'AES-CTR') {
    if (iv.length !== 16) throw new OperationError('CTR needs a 16-byte counter block.');
    return { name: 'AES-CTR', counter: iv as BufferSource, length: 64 };
  }
  if (iv.length !== 12 && iv.length !== 16) {
    throw new OperationError('GCM needs a 12-byte nonce (16 is also accepted).');
  }
  return { name: 'AES-GCM', iv: iv as BufferSource };
}

const MODE_OPTIONS = ['AES-GCM', 'AES-CBC', 'AES-CTR'];

function keyArgs() {
  return [
    {
      name: 'Key',
      type: 'toggleString' as const,
      value: '',
      toggleValues: ['Hex', 'UTF-8', 'Base64'],
      toggleValue: 'Hex',
      hint: '128, 192 or 256 bits',
    },
    {
      name: 'IV',
      type: 'toggleString' as const,
      value: '',
      toggleValues: ['Hex', 'UTF-8', 'Base64'],
      toggleValue: 'Hex',
      hint: '12 bytes for GCM, 16 for CBC and CTR',
    },
    { name: 'Mode', type: 'option' as const, value: 'AES-GCM', options: MODE_OPTIONS },
  ];
}

export const symmetricOperations: Operation[] = [
  {
    id: 'aes-encrypt',
    name: 'AES Encrypt',
    category: 'Encryption / Encoding',
    description: 'Encrypts with AES in GCM, CBC or CTR mode. Output is hex.',
    aliases: ['aes', 'rijndael', 'encrypt'],
    args: keyArgs(),
    run: async (input, args) => {
      const mode = String(arg(args, 'Mode', 'AES-GCM'));
      const key = await importKey(readArg(args, 'Key', 'Key'), mode, ['encrypt']);
      const iv = readArg(args, 'IV', 'IV');
      const result = await requireSubtle().encrypt(
        algorithm(mode, iv),
        key,
        asBytes(input) as BufferSource,
      );
      return Array.from(new Uint8Array(result))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    },
  },
  {
    id: 'aes-decrypt',
    name: 'AES Decrypt',
    category: 'Encryption / Encoding',
    description: 'Decrypts AES in GCM, CBC or CTR mode. Input may be hex or raw bytes.',
    aliases: ['aes decrypt', 'decrypt'],
    args: [
      ...keyArgs(),
      { name: 'Input is hex', type: 'boolean', value: true },
    ],
    run: async (input, args) => {
      const mode = String(arg(args, 'Mode', 'AES-GCM'));
      const key = await importKey(readArg(args, 'Key', 'Key'), mode, ['decrypt']);
      const iv = readArg(args, 'IV', 'IV');

      const data = arg(args, 'Input is hex', true)
        ? parseBytes(input.trim(), 'Hex', 'Ciphertext')
        : asBytes(input);

      try {
        const result = await requireSubtle().decrypt(algorithm(mode, iv), key, data as BufferSource);
        return bytesToLatin1(new Uint8Array(result));
      } catch {
        throw new OperationError(
          mode === 'AES-GCM'
            ? 'Decryption failed: wrong key, wrong nonce, or the ciphertext has been altered. GCM verifies integrity, so it refuses rather than returning garbage.'
            : 'Decryption failed: wrong key or IV.',
        );
      }
    },
  },
  {
    id: 'generate-key',
    name: 'Generate AES key',
    category: 'Encryption / Encoding',
    description: 'Generates a random AES key using the browser cryptographic RNG.',
    aliases: ['random key', 'new key'],
    args: [{ name: 'Bits', type: 'option', value: '256', options: ['128', '192', '256'] }],
    run: (_input, args) => {
      const bytes = new Uint8Array(Number(arg(args, 'Bits', '256')) / 8);
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    },
  },
  {
    id: 'generate-iv',
    name: 'Generate IV',
    category: 'Encryption / Encoding',
    description: 'Generates a random initialisation vector or nonce.',
    aliases: ['random iv', 'nonce'],
    args: [{ name: 'Bytes', type: 'number', value: 12, min: 8, max: 32 }],
    run: (_input, args) => {
      const bytes = new Uint8Array(Number(arg(args, 'Bytes', 12)));
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    },
  },
  {
    id: 'random-bytes',
    name: 'Generate random bytes',
    category: 'Utils',
    description: 'Generates cryptographically random bytes.',
    aliases: ['random', 'entropy', 'urandom'],
    args: [
      { name: 'Bytes', type: 'number', value: 32, min: 1, max: 4096 },
      { name: 'Output', type: 'option', value: 'Hex', options: ['Hex', 'Base64', 'Raw'] },
    ],
    run: (_input, args) => {
      const bytes = new Uint8Array(Number(arg(args, 'Bytes', 32)));
      crypto.getRandomValues(bytes);
      const format = String(arg(args, 'Output', 'Hex'));
      if (format === 'Base64') return btoa(bytesToLatin1(bytes));
      if (format === 'Raw') return bytesToLatin1(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    },
  },
  {
    id: 'generate-uuid',
    name: 'Generate UUID',
    category: 'Utils',
    description: 'Generates a random version 4 UUID.',
    aliases: ['uuid', 'guid', 'new uuid'],
    args: [{ name: 'Count', type: 'number', value: 1, min: 1, max: 500 }],
    run: (_input, args) =>
      Array.from({ length: Number(arg(args, 'Count', 1)) }, () => crypto.randomUUID()).join('\n'),
  },
  {
    id: 'generate-password',
    name: 'Generate password',
    category: 'Utils',
    description: 'Generates a random password from a chosen character set.',
    aliases: ['password', 'passphrase', 'random string'],
    args: [
      { name: 'Length', type: 'number', value: 24, min: 4, max: 256 },
      { name: 'Symbols', type: 'boolean', value: true },
      { name: 'Count', type: 'number', value: 1, min: 1, max: 100 },
    ],
    run: (_input, args) => {
      const length = Number(arg(args, 'Length', 24));
      const alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
        (arg(args, 'Symbols', true) ? '!@#$%^&*()-_=+[]{};:,.?' : '');

      return Array.from({ length: Number(arg(args, 'Count', 1)) }, () => {
        const values = new Uint32Array(length);
        crypto.getRandomValues(values);
        return Array.from(values, (v) => alphabet[v % alphabet.length]!).join('');
      }).join('\n');
    },
  },
];
