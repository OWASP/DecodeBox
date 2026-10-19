import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { DELIMITER_OPTIONS, delimiterFor, splitOnAnyDelimiter } from '../core/delimiters';
import { arg, type Operation } from './types';



const B85_ALPHABETS: Record<string, string> = {
  'Ascii85 (standard)':
    '!"#$%&' + String.fromCharCode(39) +
    '()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[' +
    String.fromCharCode(92) + ']^_`abcdefghijklmnopqrstu',
  Z85: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#',
  'RFC 1924 (IPv6)':
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~',
};

const B85_DEFAULT = 'Ascii85 (standard)';
const B85_OPTIONS = Object.keys(B85_ALPHABETS);

function base85Alphabet(name: string): string {
  return B85_ALPHABETS[name] ?? B85_ALPHABETS[B85_DEFAULT]!;
}

function toBase85(bytes: Uint8Array, delimited: boolean, alphabet: string): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = bytes.subarray(i, i + 4);
    const padding = 4 - chunk.length;
    let value = 0;
    for (let j = 0; j < 4; j++) value = value * 256 + (chunk[j] ?? 0);

    if (value === 0 && padding === 0 && alphabet === B85_ALPHABETS[B85_DEFAULT]) {
      out += 'z';
      continue;
    }

    const group: string[] = [];
    for (let j = 0; j < 5; j++) {
      group.unshift(alphabet[value % 85] as string);
      value = Math.floor(value / 85);
    }
    out += group.join('').slice(0, 5 - padding);
  }
  return delimited ? `<~${out}~>` : out;
}

function fromBase85(text: string, alphabet: string): Uint8Array {
  const cleaned = text.replace(/^<~/, '').replace(/~>$/, '').replace(/\s/g, '');
  const out: number[] = [];
  let group: number[] = [];
  const standard = alphabet === B85_ALPHABETS[B85_DEFAULT];

  for (const char of cleaned) {
    if (standard && char === 'z' && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const code = alphabet.indexOf(char);
    if (code < 0) throw new OperationError(`'${char}' is not a Base85 character.`);
    group.push(code);

    if (group.length === 5) {
      let value = 0;
      for (const digit of group) value = value * 85 + digit;
      out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
      group = [];
    }
  }

  if (group.length > 0) {
    const padding = 5 - group.length;
    for (let i = 0; i < padding; i++) group.push(84);
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    out.push(...bytes.slice(0, 4 - padding));
  }

  return new Uint8Array(out);
}


const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

function toBase45(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let value = bytes[i]! * 256 + bytes[i + 1]!;
      const c = value % 45;
      value = (value - c) / 45;
      const d = value % 45;
      const e = (value - d) / 45;
      out += B45[c]! + B45[d]! + B45[e]!;
    } else {
      const value = bytes[i]!;
      out += B45[value % 45]! + B45[Math.floor(value / 45)]!;
    }
  }
  return out;
}

function fromBase45(text: string): Uint8Array {
  const cleaned = text.trim().toUpperCase();
  const digits = Array.from(cleaned, (char) => {
    const index = B45.indexOf(char);
    if (index === -1) throw new OperationError(`'${char}' is not a Base45 character.`);
    return index;
  });

  const out: number[] = [];
  for (let i = 0; i < digits.length; i += 3) {
    if (i + 2 < digits.length) {
      const value = digits[i]! + digits[i + 1]! * 45 + digits[i + 2]! * 45 * 45;
      if (value > 0xffff) throw new OperationError('Base45 group is out of range.');
      out.push(value >> 8, value & 0xff);
    } else if (i + 1 < digits.length) {
      out.push(digits[i]! + digits[i + 1]! * 45);
    } else {
      throw new OperationError('Base45 input has a trailing incomplete group.');
    }
  }
  return new Uint8Array(out);
}


const B62_ALPHABETS: Record<string, string> = {
  '0-9A-Za-z': '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  '0-9a-zA-Z': '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'A-Za-z0-9': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  'a-zA-Z0-9': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
};

const B62_DEFAULT = '0-9A-Za-z';
const B62_OPTIONS = Object.keys(B62_ALPHABETS);

function base62Alphabet(name: string): string {
  return B62_ALPHABETS[name] ?? B62_ALPHABETS[B62_DEFAULT]!;
}

function changeBase(digits: number[], from: number, to: number): number[] {
  let source = digits;
  const out: number[] = [];
  while (source.length > 0) {
    const quotient: number[] = [];
    let remainder = 0;
    for (const digit of source) {
      const accumulator = remainder * from + digit;
      const q = Math.floor(accumulator / to);
      remainder = accumulator % to;
      if (quotient.length > 0 || q > 0) quotient.push(q);
    }
    out.unshift(remainder);
    source = quotient;
  }
  return out;
}


const MORSE_SEPARATORS: Record<string, string> = {
  Space: ' ',
  Comma: ',',
  'Semi-colon': ';',
  'Line feed': '\n',
  'New line': '\n',
  'Forward slash': ' / ',
  Backslash: ' \\ ',
};

const MORSE_SYMBOLS: Record<string, [string, string]> = {
  'Dash/Dot': ['-', '.'],
  'Dot/Dash': ['.', '-'],
  'Underscore/Full stop': ['_', '.'],
  'Long/Short': ['Long', 'Short'],
};

const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
  I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
  Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
  Y: '-.--', Z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
  '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--',
  '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...',
  ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-',
  '"': '.-..-.', '@': '.--.-.',
};

const MORSE_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE).map(([letter, code]) => [code, letter]),
);


function toQuotedPrintable(text: string, width = 76): string {
  const bytes = asBytes(text);
  let out = '';
  let lineLength = 0;
  const usable = Math.max(4, width) - 1;

  for (const byte of bytes) {
    const literal =
      (byte >= 33 && byte <= 60) || (byte >= 62 && byte <= 126) || byte === 32 || byte === 9;
    const encoded = literal ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;

    if (lineLength + encoded.length > usable) {
      out += '=\r\n';
      lineLength = 0;
    }
    out += encoded;
    lineLength += encoded.length;
  }
  return out;
}

function fromQuotedPrintable(text: string): Uint8Array {
  const joined = text.replace(/=(\r\n|\n|\r)/g, '');
  const out: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=' && i + 2 < joined.length) {
      const hex = joined.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new OperationError(`'=${hex}' is not a valid quoted-printable escape.`);
      }
      out.push(parseInt(hex, 16));
      i += 2;
    } else {
      out.push(joined.charCodeAt(i) & 0xff);
    }
  }
  return new Uint8Array(out);
}


function toUuencode(bytes: Uint8Array, name: string): string {
  const lines: string[] = [`begin 644 ${name}`];
  for (let i = 0; i < bytes.length; i += 45) {
    const chunk = bytes.subarray(i, i + 45);
    let line = String.fromCharCode(chunk.length + 32);
    for (let j = 0; j < chunk.length; j += 3) {
      const a = chunk[j] ?? 0;
      const b = chunk[j + 1] ?? 0;
      const c = chunk[j + 2] ?? 0;
      const triple = (a << 16) | (b << 8) | c;
      for (let k = 3; k >= 0; k--) {
        const value = (triple >> (k * 6)) & 0x3f;
        line += String.fromCharCode(value === 0 ? 96 : value + 32);
      }
    }
    lines.push(line);
  }
  lines.push('`', 'end');
  return lines.join('\n');
}

function fromUuencode(text: string): Uint8Array {
  const out: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0 || /^(begin|end)\b/.test(line) || line === '`') continue;
    const length = (line.charCodeAt(0) - 32) & 0x3f;
    if (length === 0) continue;

    const decoded: number[] = [];
    for (let i = 1; i + 3 < line.length + 1; i += 4) {
      const values = [0, 1, 2, 3].map((k) => ((line.charCodeAt(i + k) || 96) - 32) & 0x3f);
      const triple = (values[0]! << 18) | (values[1]! << 12) | (values[2]! << 6) | values[3]!;
      decoded.push((triple >> 16) & 0xff, (triple >> 8) & 0xff, triple & 0xff);
    }
    out.push(...decoded.slice(0, length));
  }
  return new Uint8Array(out);
}


const PUNY_BASE = 36;
const PUNY_TMIN = 1;
const PUNY_TMAX = 26;
const PUNY_SKEW = 38;
const PUNY_DAMP = 700;
const PUNY_INITIAL_BIAS = 72;
const PUNY_INITIAL_N = 128;

function adaptBias(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / PUNY_DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((PUNY_BASE - PUNY_TMIN) * PUNY_TMAX) >> 1) {
    d = Math.floor(d / (PUNY_BASE - PUNY_TMIN));
    k += PUNY_BASE;
  }
  return k + Math.floor(((PUNY_BASE - PUNY_TMIN + 1) * d) / (d + PUNY_SKEW));
}

function decodePunycodeLabel(label: string): string {
  const delimiter = label.lastIndexOf('-');
  const basic = delimiter > 0 ? label.slice(0, delimiter) : '';
  const encoded = delimiter > 0 ? label.slice(delimiter + 1) : label;

  const output = Array.from(basic);
  let n = PUNY_INITIAL_N;
  let bias = PUNY_INITIAL_BIAS;
  let i = 0;
  let index = 0;

  while (index < encoded.length) {
    const previous = i;
    let w = 1;

    for (let k = PUNY_BASE; ; k += PUNY_BASE) {
      if (index >= encoded.length) throw new OperationError('Punycode input ends mid-sequence.');
      const char = encoded.charCodeAt(index++);
      const digit =
        char - 48 < 10 ? char - 22 : char - 65 < 26 ? char - 65 : char - 97 < 26 ? char - 97 : PUNY_BASE;
      if (digit >= PUNY_BASE) throw new OperationError('Punycode contains a non-basic digit.');

      i += digit * w;
      const t = k <= bias ? PUNY_TMIN : k >= bias + PUNY_TMAX ? PUNY_TMAX : k - bias;
      if (digit < t) break;
      w *= PUNY_BASE - t;
    }

    bias = adaptBias(i - previous, output.length + 1, previous === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i, 0, String.fromCodePoint(n));
    i++;
  }

  return output.join('');
}

function decodePunycode(domain: string): string {
  return domain
    .split('.')
    .map((label) =>
      label.toLowerCase().startsWith('xn--') ? decodePunycodeLabel(label.slice(4)) : label,
    )
    .join('.');
}


const NATO: Record<string, string> = {
  a: 'Alfa', b: 'Bravo', c: 'Charlie', d: 'Delta', e: 'Echo', f: 'Foxtrot', g: 'Golf',
  h: 'Hotel', i: 'India', j: 'Juliett', k: 'Kilo', l: 'Lima', m: 'Mike', n: 'November',
  o: 'Oscar', p: 'Papa', q: 'Quebec', r: 'Romeo', s: 'Sierra', t: 'Tango', u: 'Uniform',
  v: 'Victor', w: 'Whiskey', x: 'X-ray', y: 'Yankee', z: 'Zulu',
  '0': 'Zero', '1': 'One', '2': 'Two', '3': 'Three', '4': 'Four',
  '5': 'Five', '6': 'Six', '7': 'Seven', '8': 'Eight', '9': 'Nine',
};

export const encodingOperations: Operation[] = [
  {
    id: 'to-base85',
    name: 'To Base85',
    category: 'Data format',
    description: 'Encodes data as Ascii85, the alphabet used by PostScript and PDF.',
    aliases: ['ascii85', 'base85 encode', 'a85'],
    args: [
      { name: 'Alphabet', type: 'option', value: B85_DEFAULT, options: B85_OPTIONS },
      { name: 'Include delimiters', type: 'boolean', value: false },
    ],
    run: (input, args) =>
      toBase85(
        asBytes(input),
        arg(args, 'Include delimiters', false),
        base85Alphabet(String(arg(args, 'Alphabet', B85_DEFAULT))),
      ),
  },
  {
    id: 'from-base85',
    name: 'From Base85',
    category: 'Data format',
    description: 'Decodes Ascii85-encoded data.',
    aliases: ['ascii85 decode', 'base85 decode', 'a85 decode'],
    args: [{ name: 'Alphabet', type: 'option', value: B85_DEFAULT, options: B85_OPTIONS }],
    run: (input, args) =>
      bytesToLatin1(fromBase85(input, base85Alphabet(String(arg(args, 'Alphabet', B85_DEFAULT))))),
    detection: {
      formatName: 'Base85',
      pattern: /^(<~)?[\x21-\x75\s]{16,}(~>)?$/,
      entropy: [3.5, 6.4],
      minLength: 16,
    },
  },
  {
    id: 'to-base45',
    name: 'To Base45',
    category: 'Data format',
    description: 'Encodes data as Base45 (RFC 9285), used by EU digital COVID certificates.',
    aliases: ['base45 encode', 'b45'],
    args: [],
    run: (input) => toBase45(asBytes(input)),
  },
  {
    id: 'from-base45',
    name: 'From Base45',
    category: 'Data format',
    description: 'Decodes Base45-encoded data (RFC 9285).',
    aliases: ['base45 decode'],
    args: [],
    run: (input) => bytesToLatin1(fromBase45(input)),
    detection: {
      formatName: 'Base45',
      pattern: /^[0-9A-Z $%*+\-./:]+$/,
      minLength: 8,
      test: (text) => {
        /*
         * Base45 packs two bytes into three characters and a leftover byte
         * into two, so the length modulo three is never one. That is a real
         * constraint rather than a guess, and it is most of what separates
         * this from an upper-case sentence.
         */
        const cleaned = text.trim();
        if (cleaned.length % 3 === 1) return null;
        return {
          label: `${cleaned.length} characters, a length Base45 can produce`,
          detail:
            'Base45 writes two bytes as three characters and a final odd byte as two, so its ' +
            'length is never one more than a multiple of three. This one is not.',
        };
      },
    },
  },
  {
    id: 'to-base62',
    name: 'To Base62',
    category: 'Data format',
    description: 'Encodes data as Base62, common in short identifiers and URL shorteners.',
    aliases: ['base62 encode', 'b62'],
    args: [{ name: 'Alphabet', type: 'option', value: B62_DEFAULT, options: B62_OPTIONS }],
    run: (input, args) => {
      const alphabet = base62Alphabet(String(arg(args, 'Alphabet', B62_DEFAULT)));
      const bytes = Array.from(asBytes(input));
      if (bytes.length === 0) return '';
      return changeBase(bytes, 256, 62)
        .map((d) => alphabet[d]!)
        .join('');
    },
  },
  {
    id: 'from-base62',
    name: 'From Base62',
    category: 'Data format',
    description: 'Decodes Base62-encoded data.',
    aliases: ['base62 decode'],
    args: [{ name: 'Alphabet', type: 'option', value: B62_DEFAULT, options: B62_OPTIONS }],
    run: (input, args) => {
      const alphabet = base62Alphabet(String(arg(args, 'Alphabet', B62_DEFAULT)));
      const cleaned = input.trim();
      if (cleaned.length === 0) return '';
      const digits = Array.from(cleaned, (char) => {
        const index = alphabet.indexOf(char);
        if (index === -1) throw new OperationError(`'${char}' is not a Base62 character.`);
        return index;
      });
      return bytesToLatin1(new Uint8Array(changeBase(digits, 62, 256)));
    },
  },
  {
    id: 'to-octal',
    name: 'To Octal',
    category: 'Data format',
    description: 'Converts data to octal byte values.',
    aliases: ['octal encode', 'base 8'],
    args: [
      { name: 'Delimiter', type: 'option', value: 'Space', options: DELIMITER_OPTIONS },
      {
        name: 'Pad to three digits',
        type: 'boolean',
        value: false,
        hint: 'Writes 007 rather than 7, which is what \nnn escapes in C need.',
      },
    ],
    run: (input, args) => {
      const pad = Boolean(arg(args, 'Pad to three digits', false));
      return Array.from(asBytes(input))
        .map((b) => (pad ? b.toString(8).padStart(3, '0') : b.toString(8)))
        .join(delimiterFor(String(arg(args, 'Delimiter', 'Space'))));
    },
  },
  {
    id: 'from-octal',
    name: 'From Octal',
    category: 'Data format',
    description: 'Converts octal byte values back to data.',
    aliases: ['octal decode'],
    args: [],
    run: (input) => {
      const parts = splitOnAnyDelimiter(input);
      const bytes = parts.map((part) => {
        if (!/^[0-7]+$/.test(part)) throw new OperationError(`'${part}' is not octal.`);
        const value = parseInt(part, 8);
        if (value > 255) throw new OperationError(`'${part}' is larger than one byte.`);
        return value;
      });
      return bytesToLatin1(new Uint8Array(bytes));
    },
    detection: {
      formatName: 'Octal',
      pattern: /^[0-7]{1,3}([\s,]+[0-7]{1,3}){3,}$/,
      minLength: 8,
    },
  },
  {
    id: 'to-charcode',
    name: 'To Charcode',
    category: 'Data format',
    description: 'Converts each character to its numeric code point.',
    aliases: ['charcode encode', 'ord', 'code points'],
    args: [{ name: 'Base', type: 'option', value: '16', options: ['16', '10', '8', '2'] }],
    run: (input, args) => {
      const base = Number(arg(args, 'Base', '16'));
      return Array.from(input)
        .map((char) => (char.codePointAt(0) ?? 0).toString(base))
        .join(' ');
    },
  },
  {
    id: 'from-charcode',
    name: 'From Charcode',
    category: 'Data format',
    description: 'Converts numeric code points back to characters.',
    aliases: ['charcode decode', 'chr'],
    args: [{ name: 'Base', type: 'option', value: '16', options: ['16', '10', '8', '2'] }],
    run: (input, args) => {
      const base = Number(arg(args, 'Base', '16'));
      return input
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((part) => {
          const code = parseInt(part, base);
          if (Number.isNaN(code)) throw new OperationError(`'${part}' is not base-${base}.`);
          if (code < 0 || code > 0x10ffff) {
            throw new OperationError(
              `'${part}' is ${code} in base-${base}, past the highest code point (0x10FFFF).`,
            );
          }
          return String.fromCodePoint(code);
        })
        .join('');
    },
  },
  {
    id: 'to-quoted-printable',
    name: 'To Quoted Printable',
    category: 'Data format',
    description: 'Encodes data as quoted-printable, the MIME transfer encoding for mostly-text.',
    aliases: ['qp encode', 'quoted printable encode', 'mime'],
    args: [
      {
        name: 'Line length',
        type: 'number',
        value: 76,
        min: 4,
        max: 998,
        hint: 'RFC 2045 says 76. Some mail gateways want shorter; 998 is the hard limit for a line.',
      },
    ],
    run: (input, args) => toQuotedPrintable(input, Number(arg(args, 'Line length', 76))),
  },
  {
    id: 'from-quoted-printable',
    name: 'From Quoted Printable',
    category: 'Data format',
    description: 'Decodes quoted-printable data.',
    aliases: ['qp decode', 'quoted printable decode'],
    args: [],
    run: (input) => bytesToLatin1(fromQuotedPrintable(input)),
    detection: {
      formatName: 'Quoted printable',
      pattern: /=[0-9A-F]{2}/,
      minLength: 6,
    },
  },
  {
    id: 'to-punycode',
    name: 'To Punycode',
    category: 'Data format',
    description: 'Converts an internationalised domain name to its ASCII (xn--) form.',
    aliases: ['punycode encode', 'idn', 'idna'],
    args: [],
    run: (input) => {
      try {
        return new URL(`http://${input.trim()}`).hostname;
      } catch {
        throw new OperationError('Input is not a domain name.');
      }
    },
  },
  {
    id: 'from-punycode',
    name: 'From Punycode',
    category: 'Data format',
    description: 'Converts an xn-- domain name back to Unicode.',
    aliases: ['punycode decode', 'idn decode'],
    args: [],
    run: (input) => {
      const trimmed = input.trim();
      if (!/xn--/i.test(trimmed)) throw new OperationError('No punycode labels found.');
      return decodePunycode(trimmed);
    },
    detection: {
      formatName: 'Punycode',
      pattern: /(^|\.)xn--[a-z0-9-]+/i,
      minLength: 8,
    },
  },
  {
    id: 'to-morse',
    name: 'To Morse Code',
    category: 'Data format',
    description: 'Converts text to Morse code.',
    aliases: ['morse encode', 'morse code'],
    args: [
      {
        name: 'Letter delimiter',
        type: 'option',
        value: 'Space',
        options: ['Space', 'Comma', 'Semi-colon'],
      },
      {
        name: 'Word delimiter',
        type: 'option',
        value: 'Forward slash',
        options: ['Forward slash', 'Line feed', 'Backslash'],
      },
      {
        name: 'Format',
        type: 'option',
        value: 'Dash/Dot',
        options: ['Dash/Dot', 'Dot/Dash', 'Underscore/Full stop', 'Long/Short'],
        hint: 'Which characters stand for the two symbols. Puzzles use all four.',
      },
    ],
    run: (input, args) => {
      const letter = MORSE_SEPARATORS[String(arg(args, 'Letter delimiter', 'Space'))] ?? ' ';
      const word = MORSE_SEPARATORS[String(arg(args, 'Word delimiter', 'Forward slash'))] ?? ' / ';
      const [dash, dot] = MORSE_SYMBOLS[String(arg(args, 'Format', 'Dash/Dot'))] ?? ['-', '.'];

      return input
        .toUpperCase()
        .split(/\s+/)
        .map((token) =>
          Array.from(token)
            .map((char) => MORSE[char] ?? '')
            .filter(Boolean)
            .map((code) =>
              Array.from(code, (symbol) => (symbol === '-' ? dash! : dot!)).join(''),
            )
            .join(letter),
        )
        .filter(Boolean)
        .join(word);
    },
  },
  {
    id: 'from-morse',
    name: 'From Morse Code',
    category: 'Data format',
    description: 'Converts Morse code back to text.',
    aliases: ['morse decode'],
    args: [
      {
        name: 'Symbols',
        type: 'option',
        value: 'Dash is long',
        options: ['Dash is long', 'Dot is long'],
        hint: 'Standard Morse has the dash as the long symbol. Some puzzles invert it.',
      },
    ],
    run: (input, args) => {
      const inverted = arg(args, 'Symbols', 'Dash is long') === 'Dot is long';
      const normalised = input
        .trim()
        .replace(/Long/g, '-')
        .replace(/Short/g, '.')
        .replace(/[_]/g, '-')
        .replace(/[,;]/g, ' ')
        .replace(/\s*\\\s*/g, ' / ')
        .replace(/\s*\/\s*/g, ' / ')
        .replace(/\n+/g, ' / ')
        .replace(/[-.]/g, (symbol) => (inverted ? (symbol === '-' ? '.' : '-') : symbol));
      return normalised
        .split(' / ')
        .map((word) =>
          word
            .split(/\s+/)
            .filter(Boolean)
            .map((code) => {
              const letter = MORSE_REVERSE[code];
              if (!letter) throw new OperationError(`'${code}' is not a Morse sequence.`);
              return letter;
            })
            .join(''),
        )
        .join(' ');
    },
    detection: {
      formatName: 'Morse code',
      pattern: /^[.\-_/\s]{8,}$/,
      minLength: 8,
    },
  },
  {
    id: 'rot47',
    name: 'ROT47',
    category: 'Encryption / Encoding',
    description: 'Rotates every printable ASCII character 47 places. Its own inverse.',
    aliases: ['rot 47'],
    args: [],
    run: (input) =>
      Array.from(input)
        .map((char) => {
          const code = char.charCodeAt(0);
          return code >= 33 && code <= 126
            ? String.fromCharCode(33 + ((code - 33 + 47) % 94))
            : char;
        })
        .join(''),
  },
  {
    id: 'to-uuencode',
    name: 'To UUEncode',
    category: 'Data format',
    description: 'Encodes data with the classic Unix uuencode format.',
    aliases: ['uuencode', 'uue'],
    args: [{ name: 'Filename', type: 'string', value: 'file' }],
    run: (input, args) => toUuencode(asBytes(input), String(arg(args, 'Filename', 'file'))),
  },
  {
    id: 'from-uuencode',
    name: 'From UUEncode',
    category: 'Data format',
    description: 'Decodes uuencoded data.',
    aliases: ['uudecode', 'uue decode'],
    args: [],
    run: (input) => bytesToLatin1(fromUuencode(input)),
    detection: {
      formatName: 'UUEncode',
      pattern: /^begin \d{3} \S+/m,
      minLength: 16,
    },
  },
  {
    id: 'normalise-unicode',
    name: 'Normalise Unicode',
    category: 'Data format',
    description: 'Applies a Unicode normalisation form, which can unmask homoglyph tricks.',
    aliases: ['nfc', 'nfd', 'nfkc', 'nfkd', 'unicode normalise'],
    args: [{ name: 'Form', type: 'option', value: 'NFC', options: ['NFC', 'NFD', 'NFKC', 'NFKD'] }],
    run: (input, args) =>
      input.normalize(String(arg(args, 'Form', 'NFC')) as 'NFC' | 'NFD' | 'NFKC' | 'NFKD'),
  },
  {
    id: 'remove-diacritics',
    name: 'Remove diacritics',
    category: 'Utils',
    description: 'Strips accents, leaving the base letters.',
    aliases: ['strip accents', 'deaccent', 'unaccent'],
    args: [],
    run: (input) => input.normalize('NFD').replace(/[̀-ͯ]/g, ''),
  },
  {
    id: 'to-nato',
    name: 'To NATO alphabet',
    category: 'Data format',
    description: 'Spells the input out in the NATO phonetic alphabet.',
    aliases: ['phonetic alphabet', 'nato'],
    args: [
      {
        name: 'Delimiter',
        type: 'option',
        value: 'Space',
        options: ['Space', 'Line feed', 'Comma', 'Hyphen'],
      },
      {
        name: 'Case',
        type: 'option',
        value: 'Capitalised',
        options: ['Capitalised', 'Upper case', 'Lower case'],
        hint: 'Radio procedure writes them capitalised; a phonetic spelling read aloud often uses caps.',
      },
    ],
    run: (input, args) => {
      const between =
        { Space: ' ', 'Line feed': '\n', Comma: ', ', Hyphen: '-' }[
          String(arg(args, 'Delimiter', 'Space'))
        ] ?? ' ';
      const casing = String(arg(args, 'Case', 'Capitalised'));
      const cased = (word: string) =>
        casing === 'Upper case'
          ? word.toUpperCase()
          : casing === 'Lower case'
            ? word.toLowerCase()
            : word;
      return Array.from(input.toLowerCase())
        .map((char) => NATO[char] ?? (char === ' ' ? '' : char))
        .filter(Boolean)
        .map(cased)
        .join(between);
    },
  },
  {
    id: 'to-html-entity-all',
    name: 'To HTML Entity (all)',
    category: 'Data format',
    description: 'Escapes every character as a numeric HTML entity, not only the special ones.',
    aliases: ['html encode all', 'entity encode everything'],
    args: [{ name: 'Hexadecimal', type: 'boolean', value: false }],
    run: (input, args) => {
      const hex = arg(args, 'Hexadecimal', false);
      return Array.from(input)
        .map((char) => {
          const code = char.codePointAt(0) ?? 0;
          return hex ? `&#x${code.toString(16)};` : `&#${code};`;
        })
        .join('');
    },
  },
  {
    id: 'to-hex-latin1',
    name: 'To Hex (bytes)',
    category: 'Data format',
    description: 'Hex of the raw bytes, without re-encoding them as UTF-8 first.',
    aliases: ['raw hex', 'byte hex'],
    args: [
      { name: 'Delimiter', type: 'option', value: 'None', options: DELIMITER_OPTIONS },
      { name: 'Uppercase', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const upper = Boolean(arg(args, 'Uppercase', false));
      return Array.from(asBytes(input))
        .map((b) => {
          const pair = b.toString(16).padStart(2, '0');
          return upper ? pair.toUpperCase() : pair;
        })
        .join(delimiterFor(String(arg(args, 'Delimiter', 'None'))));
    },
  },
  {
    id: 'swap-endianness',
    name: 'Swap endianness',
    category: 'Data format',
    description: 'Reverses the byte order within fixed-size words.',
    aliases: ['byte swap', 'endian'],
    args: [{ name: 'Word length', type: 'number', value: 4, min: 2, max: 16 }],
    run: (input, args) => {
      const width = Math.max(2, Number(arg(args, 'Word length', 4)));
      const bytes = asBytes(input);
      const out = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i += width) {
        const chunk = bytes.subarray(i, i + width);
        for (let j = 0; j < chunk.length; j++) out[i + j] = chunk[chunk.length - 1 - j]!;
      }
      return bytesToLatin1(out);
    },
  },
];
