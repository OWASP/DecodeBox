import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';


const NUMBER_DELIMITERS: Record<string, string> = {
  Space: ' ',
  Comma: ',',
  'Semi-colon': ';',
  Colon: ':',
  'Line feed': '\n',
  CRLF: '\r\n',
};

const NUMBER_DELIM_OPTIONS = Object.keys(NUMBER_DELIMITERS);

function numberDelimiter(name: string): string {
  return NUMBER_DELIMITERS[name] ?? ' ';
}


const FLOAT_SIZES: Record<string, number> = {
  'Float (4 bytes)': 4,
  'Double (8 bytes)': 8,
};

function floatSize(name: string): number {
  return FLOAT_SIZES[name] ?? 4;
}


const RADIX_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

const FRACTION_DIGITS = 20;

function digitValue(char: string, radix: number): number {
  const value = RADIX_DIGITS.indexOf(char.toLowerCase());
  if (value === -1 || value >= radix) {
    throw new OperationError(`'${char}' is not a digit in base ${radix}.`);
  }
  return value;
}

function checkRadix(radix: number): number {
  if (!Number.isInteger(radix) || radix < 2 || radix > 36) {
    throw new OperationError('Radix must be a whole number between 2 and 36.');
  }
  return radix;
}

function fractionToDecimal(numerator: bigint, denominator: bigint): string {
  if (numerator === 0n) return '';
  const scale = 10n ** BigInt(FRACTION_DIGITS);
  const scaled = (numerator * scale) / denominator;
  const digits = scaled.toString().padStart(FRACTION_DIGITS, '0').replace(/0+$/, '');
  return digits.length > 0 ? `.${digits}` : '';
}


const BCD_SCHEMES: Record<string, number[]> = {
  '8 4 2 1': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  '7 4 2 1': [0, 1, 2, 3, 4, 5, 6, 8, 9, 10],
  '4 2 2 1': [0, 1, 4, 5, 8, 9, 12, 13, 14, 15],
  '2 4 2 1': [0, 1, 2, 3, 4, 11, 12, 13, 14, 15],
  '8 4 -2 -1': [0, 7, 6, 5, 4, 11, 10, 9, 8, 15],
  'Excess-3': [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  'IBM 8 4 2 1': [10, 1, 2, 3, 4, 5, 6, 7, 8, 9],
};

const BCD_SCHEME_OPTIONS = Object.keys(BCD_SCHEMES);
const BCD_FORMATS = ['Nibbles', 'Bytes', 'Raw'];

const BCD_POSITIVE = 12;
const BCD_NEGATIVE = 13;

function bcdScheme(name: string): number[] {
  const scheme = BCD_SCHEMES[name];
  if (!scheme) throw new OperationError(`Unknown BCD scheme '${name}'.`);
  return scheme;
}

export const numberOperations: Operation[] = [
  {
    id: 'to-float',
    name: 'To Float',
    category: 'Data format',
    description: 'Reads the input as IEEE 754 floating point numbers.',
    aliases: ['ieee754', 'float decode', 'double'],
    args: [
      {
        name: 'Endianness',
        type: 'option',
        value: 'Big Endian',
        options: ['Big Endian', 'Little Endian'],
      },
      {
        name: 'Size',
        type: 'option',
        value: 'Float (4 bytes)',
        options: Object.keys(FLOAT_SIZES),
      },
      { name: 'Delimiter', type: 'option', value: 'Space', options: NUMBER_DELIM_OPTIONS },
    ],
    run: (input, args) => {
      const bytes = asBytes(input);
      const size = floatSize(String(arg(args, 'Size', 'Float (4 bytes)')));
      const little = String(arg(args, 'Endianness', 'Big Endian')) === 'Little Endian';
      if (bytes.length % size !== 0) {
        throw new OperationError(`Input is ${bytes.length} bytes, not a multiple of ${size}.`);
      }

      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const values: string[] = [];
      for (let i = 0; i < bytes.length; i += size) {
        const value = size === 4 ? view.getFloat32(i, little) : view.getFloat64(i, little);
        values.push(String(value));
      }
      return values.join(numberDelimiter(String(arg(args, 'Delimiter', 'Space'))));
    },
  },
  {
    id: 'from-float',
    name: 'From Float',
    category: 'Data format',
    description: 'Writes a list of numbers as IEEE 754 floating point bytes.',
    aliases: ['ieee754 encode', 'float encode'],
    args: [
      {
        name: 'Endianness',
        type: 'option',
        value: 'Big Endian',
        options: ['Big Endian', 'Little Endian'],
      },
      {
        name: 'Size',
        type: 'option',
        value: 'Float (4 bytes)',
        options: Object.keys(FLOAT_SIZES),
      },
      { name: 'Delimiter', type: 'option', value: 'Space', options: NUMBER_DELIM_OPTIONS },
    ],
    run: (input, args) => {
      if (input.length === 0) return '';
      const size = floatSize(String(arg(args, 'Size', 'Float (4 bytes)')));
      const little = String(arg(args, 'Endianness', 'Big Endian')) === 'Little Endian';
      const parts = input
        .split(numberDelimiter(String(arg(args, 'Delimiter', 'Space'))))
        .map((p) => p.trim())
        .filter((p) => p !== '');

      const bytes = new Uint8Array(parts.length * size);
      const view = new DataView(bytes.buffer);
      parts.forEach((part, i) => {
        const value = Number(part);
        if (Number.isNaN(value) && !/^nan$/i.test(part)) {
          throw new OperationError(`'${part}' is not a number.`);
        }
        if (size === 4) view.setFloat32(i * size, value, little);
        else view.setFloat64(i * size, value, little);
      });
      return bytesToLatin1(bytes);
    },
  },
  {
    id: 'to-base',
    name: 'To Base',
    category: 'Data format',
    description: 'Converts a decimal number into another base between 2 and 36.',
    aliases: ['radix', 'change base', 'to radix'],
    args: [{ name: 'Radix', type: 'number', value: 36, min: 2, max: 36 }],
    run: (input, args) => {
      const radix = checkRadix(Number(arg(args, 'Radix', 36)));
      const trimmed = input.replace(/\s/g, '');
      if (trimmed === '') return '';

      const match = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(trimmed);
      if (!match || (match[2] === '' && match[3] === undefined)) {
        throw new OperationError('Input must be a decimal number.');
      }
      const [, sign = '', whole = '', fraction] = match;

      let digits = BigInt(whole === '' ? '0' : whole).toString(radix);
      if (fraction !== undefined && /[1-9]/.test(fraction)) {
        let numerator = BigInt(fraction);
        const denominator = 10n ** BigInt(fraction.length);
        const base = BigInt(radix);
        let out = '';
        for (let i = 0; i < FRACTION_DIGITS && numerator !== 0n; i++) {
          numerator *= base;
          const digit = numerator / denominator;
          out += RADIX_DIGITS[Number(digit)];
          numerator -= digit * denominator;
        }
        digits += `.${out.replace(/0+$/, '')}`.replace(/\.$/, '');
      }
      return (sign === '-' ? '-' : '') + digits;
    },
  },
  {
    id: 'from-base',
    name: 'From Base',
    category: 'Data format',
    description: 'Converts a number in another base between 2 and 36 into decimal.',
    aliases: ['radix decode', 'from radix', 'parse base'],
    args: [{ name: 'Radix', type: 'number', value: 36, min: 2, max: 36 }],
    run: (input, args) => {
      const radix = checkRadix(Number(arg(args, 'Radix', 36)));
      const trimmed = input.replace(/\s/g, '');
      if (trimmed === '') return '';

      const negative = trimmed.startsWith('-');
      const body = trimmed.replace(/^[+-]/, '');
      const [whole = '', fraction] = body.split('.');
      if (whole === '' && (fraction ?? '') === '') {
        throw new OperationError(`Input is not a number in base ${radix}.`);
      }

      const base = BigInt(radix);
      let value = 0n;
      for (const char of whole) value = value * base + BigInt(digitValue(char, radix));

      let out = value.toString();
      if (fraction !== undefined && fraction !== '') {
        let numerator = 0n;
        for (const char of fraction) numerator = numerator * base + BigInt(digitValue(char, radix));
        out += fractionToDecimal(numerator, base ** BigInt(fraction.length));
      }
      return (negative && /[1-9]/.test(out) ? '-' : '') + out;
    },
  },
  {
    id: 'to-bcd',
    name: 'To BCD',
    category: 'Data format',
    description: 'Encodes a decimal number as binary-coded decimal.',
    aliases: ['binary coded decimal', 'bcd encode'],
    args: [
      { name: 'Scheme', type: 'option', value: '8 4 2 1', options: BCD_SCHEME_OPTIONS },
      { name: 'Packed', type: 'boolean', value: true },
      { name: 'Signed', type: 'boolean', value: false },
      { name: 'Output format', type: 'option', value: 'Nibbles', options: BCD_FORMATS },
    ],
    run: (input, args) => {
      const scheme = bcdScheme(String(arg(args, 'Scheme', '8 4 2 1')));
      const packed = arg(args, 'Packed', true);
      const signed = arg(args, 'Signed', false);
      const format = String(arg(args, 'Output format', 'Nibbles'));

      const trimmed = input.trim();
      if (!/^[+-]?\d+$/.test(trimmed)) {
        throw new OperationError('BCD encodes whole decimal numbers only.');
      }
      const negative = trimmed.startsWith('-');
      const digits = trimmed.replace(/^[+-]/, '');

      let nibbles = Array.from(digits, (d) => scheme[Number(d)] as number);
      if (signed) {
        if (packed && digits.length % 2 === 0) nibbles.unshift(scheme[0] as number);
        nibbles.push(negative ? BCD_NEGATIVE : BCD_POSITIVE);
      }

      let bytes: number[];
      if (packed) {
        bytes = [];
        for (let i = 0; i < nibbles.length; i += 2) {
          bytes.push(((nibbles[i] as number) << 4) | (nibbles[i + 1] ?? 0));
        }
      } else {
        bytes = nibbles;
        nibbles = nibbles.flatMap((n) => [0, n]);
      }

      if (format === 'Nibbles') return nibbles.map((n) => n.toString(2).padStart(4, '0')).join(' ');
      if (format === 'Bytes') return bytes.map((b) => b.toString(2).padStart(8, '0')).join(' ');
      return bytesToLatin1(new Uint8Array(bytes));
    },
  },
  {
    id: 'from-bcd',
    name: 'From BCD',
    category: 'Data format',
    description: 'Decodes binary-coded decimal back into a decimal number.',
    aliases: ['binary coded decimal decode', 'bcd decode'],
    args: [
      { name: 'Scheme', type: 'option', value: '8 4 2 1', options: BCD_SCHEME_OPTIONS },
      { name: 'Packed', type: 'boolean', value: true },
      { name: 'Signed', type: 'boolean', value: false },
      { name: 'Input format', type: 'option', value: 'Nibbles', options: BCD_FORMATS },
    ],
    run: (input, args) => {
      const scheme = bcdScheme(String(arg(args, 'Scheme', '8 4 2 1')));
      const packed = arg(args, 'Packed', true);
      const signed = arg(args, 'Signed', false);
      const format = String(arg(args, 'Input format', 'Nibbles'));

      let nibbles: number[] = [];
      if (format === 'Raw') {
        for (const byte of asBytes(input)) nibbles.push(byte >>> 4, byte & 15);
      } else {
        const bits = input.replace(/\s/g, '');
        if (bits === '') return '';
        if (!/^[01]+$/.test(bits)) throw new OperationError('Expected a string of bits.');
        if (bits.length % 4 !== 0) {
          throw new OperationError('Bit count is not a whole number of nibbles.');
        }
        for (let i = 0; i < bits.length; i += 4) nibbles.push(parseInt(bits.substr(i, 4), 2));
      }
      if (nibbles.length === 0) return '';

      if (!packed) nibbles = nibbles.filter((_, i) => i % 2 === 1);

      let sign = '';
      if (signed) {
        const marker = nibbles.pop();
        if (marker === BCD_NEGATIVE || marker === 11) sign = '-';
      }

      let out = '';
      for (const nibble of nibbles) {
        const digit = scheme.indexOf(nibble);
        if (digit < 0) {
          throw new OperationError(
            `${nibble.toString(2).padStart(4, '0')} is not a digit in this scheme.`,
          );
        }
        out += String(digit);
      }
      const stripped = out.replace(/^0+(?=\d)/, '');
      return stripped === '0' ? stripped : sign + stripped;
    },
  },
  {
    id: 'text-integer',
    name: 'Text-Integer Conversion',
    category: 'Data format',
    description: 'Converts between text and the big integer formed by its bytes.',
    aliases: ['text to integer', 'integer to text', 'bigint'],
    args: [
      {
        name: 'Output format',
        type: 'option',
        value: 'Decimal',
        options: ['String', 'Decimal', 'Hexadecimal'],
      },
    ],
    run: (input, args) => {
      const format = String(arg(args, 'Output format', 'Decimal'));
      const trimmed = input.trim();

      let value: bigint;
      if (trimmed === '') {
        value = 0n;
      } else if (/^0x[0-9a-f]+$/i.test(trimmed) || /^[+-]?\d+$/.test(trimmed)) {
        value = BigInt(trimmed);
      } else {
        const text = /^(["']).*\1$/s.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
        value = 0n;
        for (let i = 0; i < text.length; i++) {
          const code = text.charCodeAt(i);
          if (code > 255) {
            throw new OperationError(
              `Character ${i + 1} is outside Latin-1; only bytes can become an integer.`,
            );
          }
          value = (value << 8n) | BigInt(code);
        }
      }

      if (format === 'Decimal') return value.toString();
      if (format === 'Hexadecimal') return `0x${value.toString(16)}`;

      if (value === 0n) return '';
      if (value < 0n) throw new OperationError('A negative integer has no text form.');
      const bytes: number[] = [];
      for (let n = value; n > 0n; n >>= 8n) bytes.unshift(Number(n & 0xffn));
      return bytesToLatin1(new Uint8Array(bytes));
    },
  },
];
