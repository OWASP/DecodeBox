import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';
import { parseKey } from './keys';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function vigenere(input: string, key: string, decode: boolean): string {
  const cleanKey = key.toUpperCase().replace(/[^A-Z]/g, '');
  if (cleanKey.length === 0) throw new OperationError('Vigenère needs an alphabetic key.');

  let keyIndex = 0;
  return input.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    const shift = cleanKey.charCodeAt(keyIndex % cleanKey.length) - 65;
    keyIndex++;
    const offset = char.charCodeAt(0) - base;
    const moved = decode ? (offset - shift + 26) % 26 : (offset + shift) % 26;
    return String.fromCharCode(base + moved);
  });
}

function modInverse(a: number, m: number): number {
  for (let x = 1; x < m; x++) if ((a * x) % m === 1) return x;
  throw new OperationError(`${a} has no inverse modulo ${m}; pick a value coprime with 26.`);
}

function affine(input: string, a: number, b: number, decode: boolean): string {
  const inverse = decode ? modInverse(((a % 26) + 26) % 26, 26) : 0;
  return input.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    const x = char.charCodeAt(0) - base;
    const y = decode ? (inverse * (x - b + 26 * 26)) % 26 : (a * x + b) % 26;
    return String.fromCharCode(base + ((y % 26) + 26) % 26);
  });
}

function railFence(input: string, rails: number, decode: boolean): string {
  if (rails < 2) throw new OperationError('A rail fence needs at least two rails.');
  const pattern: number[] = [];
  let rail = 0;
  let direction = 1;
  for (let i = 0; i < input.length; i++) {
    pattern.push(rail);
    if (rail === 0) direction = 1;
    else if (rail === rails - 1) direction = -1;
    rail += direction;
  }

  if (!decode) {
    let out = '';
    for (let r = 0; r < rails; r++) {
      for (let i = 0; i < input.length; i++) if (pattern[i] === r) out += input[i];
    }
    return out;
  }

  const result = new Array<string>(input.length);
  let cursor = 0;
  for (let r = 0; r < rails; r++) {
    for (let i = 0; i < input.length; i++) {
      if (pattern[i] === r) result[i] = input[cursor++] ?? '';
    }
  }
  return result.join('');
}

function rc4(data: Uint8Array, key: Uint8Array): Uint8Array {
  if (key.length === 0) throw new OperationError('RC4 needs a key.');
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;

  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }

  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}


export const cipherOperations: Operation[] = [
  {
    id: 'vigenere-encode',
    name: 'Vigenère Encode',
    category: 'Encryption / Encoding',
    description: 'Applies a Vigenère cipher using a repeating alphabetic key.',
    aliases: ['vigenere', 'polyalphabetic'],
    args: [{ name: 'Key', type: 'string', value: '', hint: 'Letters only' }],
    run: (input, args) => vigenere(input, String(arg(args, 'Key', '')), false),
  },
  {
    id: 'vigenere-decode',
    name: 'Vigenère Decode',
    category: 'Encryption / Encoding',
    description: 'Reverses a Vigenère cipher.',
    aliases: ['vigenere decode'],
    args: [{ name: 'Key', type: 'string', value: '', hint: 'Letters only' }],
    run: (input, args) => vigenere(input, String(arg(args, 'Key', '')), true),
  },
  {
    id: 'affine-encode',
    name: 'Affine Encode',
    category: 'Encryption / Encoding',
    description: 'Applies the affine cipher, where each letter maps to (ax + b) mod 26.',
    aliases: ['affine'],
    args: [
      { name: 'a', type: 'number', value: 5, min: 1, max: 25 },
      { name: 'b', type: 'number', value: 8, min: 0, max: 25 },
    ],
    run: (input, args) =>
      affine(input, Number(arg(args, 'a', 5)), Number(arg(args, 'b', 8)), false),
  },
  {
    id: 'affine-decode',
    name: 'Affine Decode',
    category: 'Encryption / Encoding',
    description: 'Reverses the affine cipher.',
    aliases: ['affine decode'],
    args: [
      { name: 'a', type: 'number', value: 5, min: 1, max: 25 },
      { name: 'b', type: 'number', value: 8, min: 0, max: 25 },
    ],
    run: (input, args) => affine(input, Number(arg(args, 'a', 5)), Number(arg(args, 'b', 8)), true),
  },
  {
    id: 'rail-fence-encode',
    name: 'Rail Fence Encode',
    category: 'Encryption / Encoding',
    description: 'Writes the text in a zig-zag across rails, then reads it row by row.',
    aliases: ['zigzag cipher', 'rail fence'],
    args: [{ name: 'Rails', type: 'number', value: 3, min: 2, max: 20 }],
    run: (input, args) => railFence(input, Number(arg(args, 'Rails', 3)), false),
  },
  {
    id: 'rail-fence-decode',
    name: 'Rail Fence Decode',
    category: 'Encryption / Encoding',
    description: 'Reverses a rail fence transposition.',
    aliases: ['zigzag decode'],
    args: [{ name: 'Rails', type: 'number', value: 3, min: 2, max: 20 }],
    run: (input, args) => railFence(input, Number(arg(args, 'Rails', 3)), true),
  },
  {
    id: 'a1z26-encode',
    name: 'A1Z26 Encode',
    category: 'Encryption / Encoding',
    description: 'Replaces each letter with its position in the alphabet.',
    aliases: ['letter numbers', 'a1z26'],
    args: [
      {
        name: 'Delimiter',
        type: 'option',
        value: 'Space',
        options: ['Space', 'Comma', 'Hyphen', 'Line feed'],
        hint: 'Puzzles write these four about equally often. Decoding accepts all of them.',
      },
    ],
    run: (input, args) => {
      const between =
        { Space: ' ', Comma: ',', Hyphen: '-', 'Line feed': '\n' }[
          String(arg(args, 'Delimiter', 'Space'))
        ] ?? ' ';
      return input
        .toUpperCase()
        .split(/\s+/)
        .map((word) =>
          Array.from(word)
            .map((char) => {
              const index = ALPHA.indexOf(char);
              return index === -1 ? '' : String(index + 1);
            })
            .filter(Boolean)
            .join(between),
        )
        .filter(Boolean)
        .join(' / ');
    },
  },
  {
    id: 'a1z26-decode',
    name: 'A1Z26 Decode',
    category: 'Encryption / Encoding',
    description: 'Turns alphabet positions back into letters.',
    aliases: ['letter numbers decode'],
    args: [],
    run: (input) =>
      input
        .split(/\s*\/\s*/)
        .map((word) =>
          word
            .split(/[\s,-]+/)
            .filter(Boolean)
            .map((part) => {
              const index = Number(part);
              if (!Number.isInteger(index) || index < 1 || index > 26) {
                throw new OperationError(`'${part}' is not a letter position between 1 and 26.`);
              }
              return ALPHA[index - 1]!;
            })
            .join(''),
        )
        .join(' '),
  },
  {
    id: 'substitution',
    name: 'Substitution Cipher',
    category: 'Encryption / Encoding',
    description: 'Maps each letter of the plaintext alphabet to one of a custom alphabet.',
    aliases: ['monoalphabetic', 'simple substitution'],
    args: [
      { name: 'Plaintext alphabet', type: 'string', value: 'abcdefghijklmnopqrstuvwxyz' },
      { name: 'Ciphertext alphabet', type: 'string', value: 'zyxwvutsrqponmlkjihgfedcba' },
    ],
    run: (input, args) => {
      const from = String(arg(args, 'Plaintext alphabet', ''));
      const to = String(arg(args, 'Ciphertext alphabet', ''));
      if (from.length !== to.length) {
        throw new OperationError('Both alphabets must be the same length.');
      }
      const map = new Map<string, string>();
      for (let i = 0; i < from.length; i++) {
        map.set(from[i]!, to[i]!);
        map.set(from[i]!.toUpperCase(), to[i]!.toUpperCase());
      }
      return Array.from(input, (char) => map.get(char) ?? char).join('');
    },
  },
  {
    id: 'rc4',
    name: 'RC4',
    category: 'Encryption / Encoding',
    description: 'The RC4 stream cipher. Its own inverse; broken, but still found in the wild.',
    aliases: ['arcfour', 'rc4 encrypt', 'rc4 decrypt'],
    args: [
      {
        name: 'Key',
        type: 'toggleString',
        value: '',
        toggleValues: ['UTF-8', 'Hex', 'Base64'],
        toggleValue: 'UTF-8',
      },
    ],
    run: (input, args) => {
      const keyArg = args.find((a) => a.name === 'Key');
      const key = parseKey(String(keyArg?.value ?? ''), keyArg?.toggleValue ?? 'UTF-8');
      return bytesToLatin1(rc4(asBytes(input), key));
    },
  },
  {
    id: 'bit-rotate',
    name: 'Rotate bits',
    category: 'Arithmetic / Logic',
    description: 'Rotates the bits of every byte left or right.',
    aliases: ['rol', 'ror', 'bit rotation', 'rotate left', 'rotate right'],
    args: [
      { name: 'Amount', type: 'number', value: 1, min: 1, max: 7 },
      { name: 'Direction', type: 'option', value: 'Left', options: ['Left', 'Right'] },
      {
        name: 'Carry through',
        type: 'boolean',
        value: false,
        hint: 'Rotate the whole input, not each byte',
      },
    ],
    run: (input, args) => {
      const amount = Number(arg(args, 'Amount', 1)) % 8;
      const left = arg(args, 'Direction', 'Left') === 'Left';
      const bytes = asBytes(input);
      if (amount === 0) return bytesToLatin1(bytes);

      const out = new Uint8Array(bytes.length);
      if (!arg(args, 'Carry through', false)) {
        for (let i = 0; i < bytes.length; i++) {
          const b = bytes[i]!;
          out[i] = left
            ? ((b << amount) | (b >>> (8 - amount))) & 0xff
            : ((b >>> amount) | (b << (8 - amount))) & 0xff;
        }
        return bytesToLatin1(out);
      }

      let carry = 0;
      if (left) {
        for (let i = bytes.length - 1; i >= 0; i--) {
          const b = bytes[i]!;
          out[i] = ((b << amount) | carry) & 0xff;
          carry = (b >>> (8 - amount)) & ((1 << amount) - 1);
        }
        if (bytes.length > 0) out[bytes.length - 1] = out[bytes.length - 1]! | carry;
      } else {
        for (let i = 0; i < bytes.length; i++) {
          const b = bytes[i]!;
          out[i] = (b >>> amount) | carry;
          carry = (b & ((1 << amount) - 1)) << (8 - amount);
        }
        if (bytes.length > 0) out[0] = out[0]! | carry;
      }
      return bytesToLatin1(out);
    },
  },
  {
    id: 'bit-shift',
    name: 'Shift bits',
    category: 'Arithmetic / Logic',
    description: 'Shifts the bits of every byte, discarding what falls off the end.',
    aliases: ['shl', 'shr', 'bit shift', 'bit shift left', 'bit shift right'],
    args: [
      { name: 'Amount', type: 'number', value: 1, min: 1, max: 7 },
      { name: 'Direction', type: 'option', value: 'Left', options: ['Left', 'Right'] },
      {
        name: 'Type',
        type: 'option',
        value: 'Logical shift',
        options: ['Logical shift', 'Arithmetic shift'],
        hint: 'Arithmetic keeps the sign bit when shifting right',
      },
    ],
    run: (input, args) => {
      const amount = Number(arg(args, 'Amount', 1));
      const left = arg(args, 'Direction', 'Left') === 'Left';
      const mask = arg(args, 'Type', 'Logical shift') === 'Logical shift' ? 0 : 0x80;
      const bytes = asBytes(input);
      const out = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        out[i] = left ? (bytes[i]! << amount) & 0xff : (bytes[i]! >>> amount) ^ (bytes[i]! & mask);
      }
      return bytesToLatin1(out);
    },
  },
  {
    id: 'not',
    name: 'NOT',
    category: 'Arithmetic / Logic',
    description: 'Inverts every bit.',
    aliases: ['invert bits', 'complement'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input);
      const out = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) out[i] = ~bytes[i]! & 0xff;
      return bytesToLatin1(out);
    },
  },
  {
    id: 'xor-brute-force',
    name: 'XOR Brute Force',
    category: 'Encryption / Encoding',
    description: 'Shows the result of every single-byte XOR key, most readable first.',
    aliases: ['xor brute', 'try all keys'],
    args: [{ name: 'Show', type: 'number', value: 20, min: 1, max: 255 }],
    run: (input, args) => {
      const limit = Math.min(255, Math.max(1, Number(arg(args, 'Show', 20))));
      const bytes = asBytes(input.slice(0, 512));

      const results: Array<{ key: number; text: string; score: number }> = [];
      for (let key = 1; key < 256; key++) {
        const out = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! ^ key;
        const text = bytesToLatin1(out);
        const printable = (text.match(/[\x20-\x7e]/g) ?? []).length / Math.max(text.length, 1);
        results.push({ key, text, score: printable });
      }

      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((r) => `0x${r.key.toString(16).padStart(2, '0')}  ${r.text.slice(0, 120)}`)
        .join('\n');
    },
  },
];
