import { OperationError, type OperationArg } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { decodeBaseN, encodeBaseN } from '../core/alphabet';
import { DELIMITER_OPTIONS, delimiterFor, splitOnAnyDelimiter } from '../core/delimiters';
import { BASE32_ALPHABETS, BASE64_ALPHABETS, optionsFor } from '../core/alphabets64';
import { arg, type Operation } from './types';

function percentEncode(input: string, everything: boolean): string {
  const kept = everything ? /[A-Za-z0-9]/ : /[A-Za-z0-9\-_.!~*'()]/;
  let out = '';
  for (const byte of asBytes(input)) {
    const char = String.fromCharCode(byte);
    out += byte < 0x80 && kept.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

const HEX_DELIMITERS: Record<string, string> = {
  Space: ' ',
  None: '',
  Comma: ',',
  'Semi-colon': ';',
  Colon: ':',
  'Line feed': '\n',
  '0x': ' ',
  '\\x': '',
};

const B64_STANDARD = BASE64_ALPHABETS[0]!.spec;
const B32_STANDARD = BASE32_ALPHABETS[0]!.spec;

function decodeSettings(args: Parameters<typeof arg>[0]) {
  return {
    removeNonAlphabet: arg(args, 'Remove non-alphabet chars', true),
    strict: arg(args, 'Strict mode', false),
  };
}

const B58_ALPHABETS: Record<string, string> = {
  'Bitcoin (and IPFS)': '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
  Ripple: 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz',
  Flickr: '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ',
};

const B58_DEFAULT = 'Bitcoin (and IPFS)';
const B58_OPTIONS = Object.keys(B58_ALPHABETS);

function base58Alphabet(args: OperationArg[]): string {
  return B58_ALPHABETS[String(arg(args, 'Alphabet', B58_DEFAULT))] ?? B58_ALPHABETS[B58_DEFAULT]!;
}

function encodeBase58(bytes: Uint8Array, B58_ALPHABET: string): string {
  if (bytes.length === 0) return '';
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += B58_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]!];
  return out;
}

function decodeBase58(text: string, B58_ALPHABET: string): Uint8Array {
  const cleaned = text.trim();
  const bytes: number[] = [0];
  for (const char of cleaned) {
    const index = B58_ALPHABET.indexOf(char);
    if (index === -1) throw new OperationError(`'${char}' is not a Base58 character.`);
    let carry = index;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of cleaned) {
    if (char !== B58_ALPHABET[0]) break;
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

export function utf16leRatio(bytes: Uint8Array): number {
  if (bytes.length < 4) return 0;
  let pairs = 0;
  const limit = bytes.length - (bytes.length % 2);
  for (let i = 0; i < limit; i += 2) {
    if (bytes[i + 1] === 0 && bytes[i]! >= 0x09 && bytes[i]! <= 0x7e) pairs++;
  }
  return pairs / (limit / 2);
}

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const dataFormatOperations: Operation[] = [
  {
    id: 'from-base64',
    name: 'From Base64',
    category: 'Data format',
    description: 'Decodes Base64-encoded data back to its original form.',
    aliases: ['b64', 'base64 decode', 'atob', 'unbase64'],
    args: [
      { name: 'Alphabet', type: 'option', value: B64_STANDARD, ...optionsFor(BASE64_ALPHABETS) },
      { name: 'Remove non-alphabet chars', type: 'boolean', value: true },
      { name: 'Strict mode', type: 'boolean', value: false },
    ],
    run: (input, args) =>
      bytesToLatin1(
        decodeBaseN(input, arg(args, 'Alphabet', B64_STANDARD), 64, decodeSettings(args)),
      ),
    detection: {
      pattern: /^[A-Za-z0-9+/\-_\s]+={0,2}$/,
      entropy: [2.0, 6.2],
      minLength: 8,
    },
  },
  {
    id: 'to-base64',
    name: 'To Base64',
    category: 'Data format',
    description: 'Encodes data as Base64.',
    aliases: ['base64 encode', 'btoa'],
    args: [
      { name: 'Alphabet', type: 'option', value: B64_STANDARD, ...optionsFor(BASE64_ALPHABETS) },
    ],
    run: (input, args) => encodeBaseN(asBytes(input), arg(args, 'Alphabet', B64_STANDARD), 64),
  },
  {
    id: 'from-base32',
    name: 'From Base32',
    category: 'Data format',
    description: 'Decodes Base32-encoded data (RFC 4648).',
    aliases: ['base32 decode', 'b32'],
    args: [
      { name: 'Alphabet', type: 'option', value: B32_STANDARD, ...optionsFor(BASE32_ALPHABETS) },
      { name: 'Remove non-alphabet chars', type: 'boolean', value: true },
      { name: 'Strict mode', type: 'boolean', value: false },
    ],
    run: (input, args) =>
      bytesToLatin1(
        decodeBaseN(input, arg(args, 'Alphabet', B32_STANDARD), 32, decodeSettings(args)),
      ),
    detection: {
      pattern: /^[A-Z2-7\s]{8,}={0,6}$/,
      entropy: [2.0, 5.2],
      minLength: 8,
    },
  },
  {
    id: 'to-base32',
    name: 'To Base32',
    category: 'Data format',
    description: 'Encodes data as Base32 (RFC 4648).',
    aliases: ['base32 encode'],
    args: [
      { name: 'Alphabet', type: 'option', value: B32_STANDARD, ...optionsFor(BASE32_ALPHABETS) },
    ],
    run: (input, args) => encodeBaseN(asBytes(input), arg(args, 'Alphabet', B32_STANDARD), 32),
  },
  {
    id: 'from-base58',
    name: 'From Base58',
    category: 'Data format',
    description: 'Decodes Base58, the alphabet used by Bitcoin and IPFS.',
    aliases: ['base58 decode', 'b58'],
    args: [{ name: 'Alphabet', type: 'option', value: B58_DEFAULT, options: B58_OPTIONS }],
    run: (input, args) => bytesToLatin1(decodeBase58(input, base58Alphabet(args))),
    detection: {
      pattern: /^[1-9A-HJ-NP-Za-km-z]{16,}$/,
      entropy: [3.0, 6.0],
      minLength: 16,
    },
  },
  {
    id: 'to-base58',
    name: 'To Base58',
    category: 'Data format',
    description: 'Encodes data as Base58.',
    aliases: ['base58 encode'],
    args: [{ name: 'Alphabet', type: 'option', value: B58_DEFAULT, options: B58_OPTIONS }],
    run: (input, args) => encodeBase58(asBytes(input), base58Alphabet(args)),
  },
  {
    id: 'from-hex',
    name: 'From Hex',
    category: 'Data format',
    description: 'Converts a hexadecimal string back to raw data.',
    aliases: ['hex decode', 'unhex', 'hex2str'],
    args: [
      {
        name: 'Delimiter',
        type: 'option',
        value: 'Auto',
        options: ['Auto', 'None', 'Space', 'Comma', '0x'],
      },
    ],
    run: (input) => {
      const cleaned = input.replace(/0x/gi, '').replace(/[\s,:;-]/g, '');
      if (cleaned.length === 0) throw new OperationError('No hex digits found.');
      if (cleaned.length % 2 !== 0) {
        throw new OperationError('Hex input has an odd number of digits.');
      }
      if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
        throw new OperationError('Input contains characters that are not hex digits.');
      }
      const bytes = new Uint8Array(cleaned.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
      }
      return bytesToLatin1(bytes);
    },
    detection: {
      pattern: /^(0x)?[0-9a-fA-F\s,:-]{8,}$/,
      lengthMultiple: 2,
      minLength: 8,
    },
  },
  {
    id: 'to-hex',
    name: 'To Hex',
    category: 'Data format',
    description: 'Converts data to its hexadecimal representation.',
    aliases: ['hex encode', 'str2hex'],
    args: [
      {
        name: 'Delimiter',
        type: 'option',
        value: 'Space',
        options: ['Space', 'None', 'Comma', 'Semi-colon', 'Colon', 'Line feed', '0x', '\\x'],
      },
      {
        name: 'Bytes per line',
        type: 'number',
        value: 0,
        min: 0,
        max: 1024,
        hint: '0 for one unbroken line',
      },
    ],
    run: (input, args) => {
      const name = String(arg(args, 'Delimiter', 'Space'));
      const between = HEX_DELIMITERS[name] ?? ' ';
      const prefix = name === '0x' ? '0x' : name === '\\x' ? '\\x' : '';
      const perLine = Math.max(0, Math.trunc(Number(arg(args, 'Bytes per line', 0))));

      const cells = Array.from(asBytes(input), (b) => prefix + b.toString(16).padStart(2, '0'));
      if (perLine === 0) return cells.join(between);

      const lines: string[] = [];
      for (let i = 0; i < cells.length; i += perLine) {
        lines.push(cells.slice(i, i + perLine).join(between));
      }
      return lines.join('\n');
    },
  },
  {
    id: 'url-decode',
    name: 'URL Decode',
    category: 'Data format',
    description: 'Converts percent-encoded characters back to their original form.',
    aliases: ['percent decode', 'unescape url', 'urldecode'],
    args: [{ name: 'Treat + as space', type: 'boolean', value: true }],
    run: (input, args) => {
      const prepared = arg(args, 'Treat + as space', true) ? input.replace(/\+/g, ' ') : input;
      try {
        return decodeURIComponent(prepared);
      } catch {
        throw new OperationError('Input contains an invalid percent-escape sequence.');
      }
    },
    detection: {
      formatName: 'URL encoding',
      pattern: /%[0-9a-fA-F]{2}/,
      minLength: 3,
    },
  },
  {
    id: 'url-encode',
    name: 'URL Encode',
    category: 'Data format',
    description: 'Percent-encodes characters that are unsafe in a URL.',
    aliases: ['percent encode', 'urlencode'],
    args: [{ name: 'Encode all special chars', type: 'boolean', value: false }],
    run: (input, args) => percentEncode(input, arg(args, 'Encode all special chars', false)),
  },
  {
    id: 'from-html-entity',
    name: 'From HTML Entity',
    category: 'Data format',
    description: 'Converts HTML entities back to the characters they represent.',
    aliases: ['html decode', 'unescape html'],
    args: [],
    run: (input) =>
      input
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
          String.fromCodePoint(parseInt(hex, 16)),
        )
        .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => {
          const map: Record<string, string> = {
            amp: '&',
            lt: '<',
            gt: '>',
            quot: '"',
            apos: "'",
            nbsp: ' ',
          };
          return map[name] ?? _;
        }),
    detection: {
      formatName: 'HTML entities',
      pattern: /&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/,
      minLength: 4,
    },
  },
  {
    id: 'to-html-entity',
    name: 'To HTML Entity',
    category: 'Data format',
    description: 'Escapes characters that have special meaning in HTML.',
    aliases: ['html encode', 'escape html'],
    args: [
      {
        name: 'Convert all characters',
        type: 'boolean',
        value: false,
        hint: 'Escapes everything, not only the five that break HTML. Defeats naive filters.',
      },
      {
        name: 'Format',
        type: 'option',
        value: 'Named where possible',
        options: ['Named where possible', 'Numeric', 'Hex'],
      },
    ],
    run: (input, args) => {
      const all = Boolean(arg(args, 'Convert all characters', false));
      const format = String(arg(args, 'Format', 'Named where possible'));

      const entity = (char: string): string => {
        const named = HTML_ENTITIES[char];
        if (format === 'Named where possible' && named) return named;
        const code = char.codePointAt(0) ?? 0;
        return format === 'Hex' ? `&#x${code.toString(16)};` : `&#${code};`;
      };

      if (!all) return input.replace(/[&<>"']/g, entity);
      return Array.from(input).map(entity).join('');
    },
  },
  {
    id: 'from-binary',
    name: 'From Binary',
    category: 'Data format',
    description: 'Converts a string of 1s and 0s back to data.',
    aliases: ['binary decode', 'bin2str'],
    args: [
      {
        name: 'Byte length',
        type: 'number',
        value: 8,
        min: 1,
        max: 64,
        hint: 'How many digits make one value. Seven-bit ASCII listings are common.',
      },
    ],
    run: (input, args) => {
      const width = Math.max(1, Math.min(64, Number(arg(args, 'Byte length', 8))));
      const bits = input.replace(/[^01]/g, '');
      if (bits.length === 0) throw new OperationError('No binary digits found.');
      if (bits.length % width !== 0) {
        throw new OperationError(
          `Binary input is not a whole number of ${width}-digit values.`,
        );
      }
      const bytes = new Uint8Array(bits.length / width);
      for (let i = 0; i < bytes.length; i++) {
        const value = parseInt(bits.substr(i * width, width), 2);
        if (value > 255) {
          throw new OperationError(
            `${bits.substr(i * width, width)} is larger than a byte at this width.`,
          );
        }
        bytes[i] = value;
      }
      return bytesToLatin1(bytes);
    },
    detection: {
      formatName: 'Binary',
      pattern: /^[01\s]{16,}$/,
      minLength: 16,
    },
  },
  {
    id: 'to-binary',
    name: 'To Binary',
    category: 'Data format',
    description: 'Converts data to a string of 1s and 0s.',
    aliases: ['binary encode', 'str2bin'],
    args: [
      { name: 'Delimiter', type: 'option', value: 'Space', options: DELIMITER_OPTIONS },
      {
        name: 'Byte length',
        type: 'number',
        value: 8,
        min: 1,
        max: 64,
        hint: 'Width to pad each value to. 8 is a byte; 7 is enough for ASCII.',
      },
    ],
    run: (input, args) => {
      const width = Math.max(1, Math.min(64, Number(arg(args, 'Byte length', 8))));
      return Array.from(asBytes(input))
        .map((b) => b.toString(2).padStart(width, '0'))
        .join(delimiterFor(String(arg(args, 'Delimiter', 'Space'))));
    },
  },
  {
    id: 'from-decimal',
    name: 'From Decimal',
    category: 'Data format',
    description: 'Converts a list of decimal byte values back to data.',
    aliases: ['decimal decode', 'dec2str'],
    args: [
      {
        name: 'Support signed values',
        type: 'boolean',
        value: false,
        hint: 'Accepts -128..127 as well as 0..255, for listings dumped from Java or C#.',
      },
    ],
    run: (input, args) => {
      const signed = Boolean(arg(args, 'Support signed values', false));
      const parts = splitOnAnyDelimiter(input);
      const bytes = new Uint8Array(parts.length);
      parts.forEach((part, i) => {
        const value = Number(part);
        const low = signed ? -128 : 0;
        if (!Number.isInteger(value) || value < low || value > 255) {
          throw new OperationError(
            `'${part}' is not a byte value between ${low} and 255.`,
          );
        }
        bytes[i] = value < 0 ? value + 256 : value;
      });
      return bytesToLatin1(bytes);
    },
    detection: {
      formatName: 'Decimal bytes',
      pattern: /^\s*\d{1,3}(?:[\s,;:]+\d{1,3})+\s*$/,
      minLength: 8,
      test: (text) => {
        /*
         * A list of numbers is only an encoding if every one of them is a
         * byte, and it is only worth suggesting if most of those bytes are
         * printable — otherwise this is a column of measurements and reading
         * it as text would be an invention.
         */
        const parts = text.trim().split(/[\s,;:]+/);
        if (parts.length < 4) return null;

        let printable = 0;
        for (const part of parts) {
          const value = Number(part);
          if (!Number.isInteger(value) || value < 0 || value > 255) return null;
          if ((value >= 0x20 && value <= 0x7e) || value === 9 || value === 10 || value === 13) {
            printable++;
          }
        }

        if (printable / parts.length < 0.9) return null;
        return {
          label: `${parts.length} numbers, every one a printable byte`,
          detail:
            `Each value is between 0 and 255, and ${printable} of ${parts.length} of them land in ` +
            'the printable range. A column of ordinary numbers does not do that.',
        };
      },
    },
  },
  {
    id: 'to-decimal',
    name: 'To Decimal',
    category: 'Data format',
    description: 'Converts data to a list of decimal byte values.',
    aliases: ['decimal encode', 'str2dec'],
    args: [
      { name: 'Delimiter', type: 'option', value: 'Space', options: DELIMITER_OPTIONS },
      {
        name: 'Support signed values',
        type: 'boolean',
        value: false,
        hint: 'Writes bytes above 127 as negative, the way a signed byte array reads.',
      },
    ],
    run: (input, args) => {
      const signed = Boolean(arg(args, 'Support signed values', false));
      return Array.from(asBytes(input))
        .map((b) => (signed && b > 127 ? b - 256 : b))
        .join(delimiterFor(String(arg(args, 'Delimiter', 'Space'))));
    },
  },
  {
    id: 'unescape-unicode',
    name: 'Unescape Unicode Characters',
    category: 'Data format',
    description: 'Converts \\u-escaped sequences back to characters.',
    aliases: ['unicode decode', 'unescape'],
    args: [
      {
        name: 'Prefix',
        type: 'option',
        value: 'Any',
        options: ['Any', '\\u', '%u', 'U+', '\\x'],
        hint: 'Any accepts all of them at once, which is what a mixed dump needs.',
      },
    ],
    run: (input, args) => {
      const prefix = String(arg(args, 'Prefix', 'Any'));
      const any = prefix === 'Any';
      let out = input;

      if (any || prefix === '\\u') {
        out = out
          .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex: string) =>
            String.fromCodePoint(parseInt(hex, 16)),
          )
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
      }
      if (any || prefix === '%u') {
        out = out.replace(/%u([0-9a-fA-F]{4})/g, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        );
      }
      if (any || prefix === 'U+') {
        out = out.replace(/U\+([0-9a-fA-F]{4,6})/g, (_, hex: string) =>
          String.fromCodePoint(parseInt(hex, 16)),
        );
      }
      if (any || prefix === '\\x') {
        out = out.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16)),
        );
      }
      return out;
    },
    detection: {
      pattern: /\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}/,
      minLength: 6,
    },
  },
  {
    id: 'escape-unicode',
    name: 'Escape Unicode Characters',
    category: 'Data format',
    description: 'Converts non-ASCII characters to \\u-escaped sequences.',
    aliases: ['unicode encode', 'escape'],
    args: [
      {
        name: 'Prefix',
        type: 'option',
        value: '\\u',
        options: ['\\u', '%u', 'U+', '\\x', '&#x'],
        hint: 'Which escape syntax to write. JavaScript uses \\u; URLs use %u.',
      },
      {
        name: 'Encode all characters',
        type: 'boolean',
        value: false,
        hint: 'Escapes ASCII too, not just what is above 127.',
      },
      { name: 'Uppercase hex', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const prefix = String(arg(args, 'Prefix', '\\u'));
      const all = Boolean(arg(args, 'Encode all characters', false));
      const upper = Boolean(arg(args, 'Uppercase hex', false));
      const suffix = prefix === '&#x' ? ';' : '';
      const narrow = prefix === '\\x' ? 2 : 4;

      return Array.from(input)
        .map((char) => {
          const code = char.codePointAt(0) ?? 0;
          if (!all && code <= 127) return char;
          const hex = code.toString(16).padStart(code > 0xff ? 4 : narrow, '0');
          return prefix + (upper ? hex.toUpperCase() : hex) + suffix;
        })
        .join('');
    },
  },
  {
    id: 'from-utf16le',
    name: 'From UTF-16LE',
    category: 'Data format',
    description: 'Decodes UTF-16 little-endian text, the encoding Windows tooling emits.',
    aliases: ['utf16', 'utf-16le', 'unicode decode', 'widechar', 'powershell encodedcommand'],
    args: [
      {
        name: 'Byte order',
        type: 'option',
        value: 'Little-endian',
        options: ['Little-endian', 'Big-endian'],
        hint: 'Windows and PowerShell write little-endian; Java and most network formats write big-endian.',
      },
      {
        name: 'Remove the byte order mark',
        type: 'boolean',
        value: true,
        hint: 'A leading U+FEFF is a marker, not text, and it is invisible in the output.',
      },
    ],
    run: (input, args) => {
      const bytes = asBytes(input);
      const trimmed = bytes.length % 2 === 0 ? bytes : bytes.subarray(0, bytes.length - 1);
      const encoding =
        arg(args, 'Byte order', 'Little-endian') === 'Big-endian' ? 'utf-16be' : 'utf-16le';
      let decoded = new TextDecoder(encoding).decode(trimmed as BufferSource);
      if (arg(args, 'Remove the byte order mark', true) && decoded.charCodeAt(0) === 0xfeff) {
        decoded = decoded.slice(1);
      }
      if (decoded.length === 0) throw new OperationError('No UTF-16 text found.');
      return decoded;
    },
    detection: {
      formatName: 'UTF-16LE',
      minLength: 8,
      test: (_text, bytes) => {
        const ratio = utf16leRatio(bytes);
        if (ratio < 0.8) return null;
        return {
          label: `${Math.round(ratio * 100)}% UTF-16LE pairs`,
          detail:
            'Almost every other byte is a null, which is what ASCII text looks like when it is ' +
            'stored as UTF-16 little-endian — the encoding PowerShell uses for -EncodedCommand.',
        };
      },
    },
  },
  {
    id: 'to-hexdump',
    name: 'To Hexdump',
    category: 'Data format',
    description: 'Formats data as a classic offset / hex / ASCII dump.',
    aliases: ['hexdump', 'xxd', 'hex view'],
    args: [
      {
        name: 'Bytes per line',
        type: 'number',
        value: 16,
        min: 1,
        max: 64,
        hint: 'Eight is easier to read for structures; thirty-two fits a wide window.',
      },
      { name: 'Uppercase hex', type: 'boolean', value: false },
      {
        name: 'Include final length',
        type: 'boolean',
        value: false,
        hint: 'The trailing offset line xxd prints, which says how long the data was.',
      },
    ],
    run: (input, args) => {
      const perLine = Math.max(1, Math.min(64, Number(arg(args, 'Bytes per line', 16))));
      const upper = Boolean(arg(args, 'Uppercase hex', false));
      const bytes = asBytes(input);
      const lines: string[] = [];
      const hexWidth = perLine * 3 - 1;

      for (let offset = 0; offset < bytes.length; offset += perLine) {
        const slice = bytes.subarray(offset, offset + perLine);
        const hex = Array.from(slice)
          .map((b) => {
            const pair = b.toString(16).padStart(2, '0');
            return upper ? pair.toUpperCase() : pair;
          })
          .join(' ')
          .padEnd(hexWidth, ' ');
        const ascii = Array.from(slice)
          .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
          .join('');
        const at = offset.toString(16).padStart(8, '0');
        lines.push(`${upper ? at.toUpperCase() : at}  ${hex}  |${ascii}|`);
      }

      if (arg(args, 'Include final length', false)) {
        const end = bytes.length.toString(16).padStart(8, '0');
        lines.push(upper ? end.toUpperCase() : end);
      }
      return lines.join('\n');
    },
  },
  {
    id: 'from-hexdump',
    name: 'From Hexdump',
    category: 'Data format',
    description: 'Extracts the data from a hexdump, ignoring offsets and the ASCII column.',
    aliases: ['parse hexdump', 'undump'],
    args: [],
    run: (input) => {
      const hex = input
        .split('\n')
        .map((line) => {
          const withoutAscii = line.replace(/\|.*\|?\s*$/, '');
          return withoutAscii.replace(/^\s*[0-9a-fA-F]{4,}:?\s/, '');
        })
        .join(' ')
        .replace(/[^0-9a-fA-F]/g, '');
      if (hex.length % 2 !== 0) throw new OperationError('Hexdump body has an odd digit count.');
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      return bytesToLatin1(bytes);
    },
    detection: {
      formatName: 'Hexdump',
      pattern: /^[0-9a-fA-F]{8}\s{2}([0-9a-fA-F]{2}\s)+/m,
      minLength: 24,
    },
  },
];
