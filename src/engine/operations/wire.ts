import { OperationError } from '../types';
import { asBytes, bytesToLatin1, latin1ToBytes } from '../core/bytes';
import { arg, type Operation } from './types';

function hexOf(bytes: Uint8Array | number[]): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseHex(text: string): Uint8Array {
  const cleaned = text.replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length % 2 !== 0) {
    throw new OperationError('Hex input has an odd number of digits.');
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  return out;
}


const PEM_LINE_LENGTH = 64;


function isPlainContentByte(byte: number, convertSpaces: boolean): boolean {
  if (byte === 32) return !convertSpaces;
  if (byte < 48) return false;
  if (byte > 57 && byte < 65) return false;
  if (byte > 90 && byte < 97) return false;
  return byte <= 122;
}


function decodeCharset(charset: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    throw new OperationError(`'${charset}' is not a character set this browser knows.`);
  }
}

function decodeQEncoded(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (char === '_') {
      out.push(32);
    } else if (char === '=') {
      const pair = text.substr(i + 1, 2);
      if (!/^[0-9a-fA-F]{2}$/.test(pair)) {
        throw new OperationError('A Q-encoded word ends in an incomplete escape.');
      }
      out.push(parseInt(pair, 16));
      i += 2;
    } else {
      const code = char.charCodeAt(0);
      if (code > 126 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
        throw new OperationError('A Q-encoded word contains a character it cannot contain.');
      }
      out.push(code);
    }
  }
  return new Uint8Array(out);
}


const MAX_TLV_RECORDS = 10000;

interface TlvRecord {
  key?: string;
  length: number;
  value: string;
}

export const wireOperations: Operation[] = [
  {
    id: 'to-hex-content',
    name: 'To Hex Content',
    category: 'Data format',
    description: 'Writes non-alphanumeric bytes as pipe-delimited hex, the notation Snort uses.',
    aliases: ['snort', 'hex content encode', 'pipe hex'],
    args: [
      {
        name: 'Convert',
        type: 'option',
        value: 'Only special chars',
        options: ['Only special chars', 'Only special chars including spaces', 'All chars'],
      },
      { name: 'Print spaces between bytes', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const bytes = asBytes(input);
      const convert = String(arg(args, 'Convert', 'Only special chars'));
      const spaces = arg(args, 'Print spaces between bytes', false);

      if (convert === 'All chars') {
        const body = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
        return `|${body.join(spaces ? ' ' : '')}|`;
      }

      const convertSpaces = convert === 'Only special chars including spaces';
      let out = '';
      let inHex = false;
      for (const byte of bytes) {
        if (isPlainContentByte(byte, convertSpaces)) {
          if (inHex) {
            out += '|';
            inHex = false;
          }
          out += String.fromCharCode(byte);
        } else {
          if (!inHex) {
            out += '|';
            inHex = true;
          } else if (spaces) {
            out += ' ';
          }
          out += byte.toString(16).padStart(2, '0');
        }
      }
      return inHex ? `${out}|` : out;
    },
  },
  {
    id: 'from-hex-content',
    name: 'From Hex Content',
    category: 'Data format',
    description: 'Expands pipe-delimited hex back into raw bytes.',
    aliases: ['snort decode', 'hex content decode'],
    args: [],
    run: (input) => {
      const out: number[] = [];
      const pattern = /\|([a-f\d ]{2,})\|/gi;
      let match: RegExpExecArray | null;
      let cursor = 0;

      while ((match = pattern.exec(input)) !== null) {
        for (; cursor < match.index; cursor++) out.push(input.charCodeAt(cursor) & 0xff);
        const body = (match[1] as string).replace(/ /g, '');
        if (body.length % 2 === 0) {
          for (let i = 0; i < body.length; i += 2) out.push(parseInt(body.substr(i, 2), 16));
        } else {
          for (; cursor < pattern.lastIndex; cursor++) out.push(input.charCodeAt(cursor) & 0xff);
        }
        cursor = pattern.lastIndex;
      }
      for (; cursor < input.length; cursor++) out.push(input.charCodeAt(cursor) & 0xff);
      return bytesToLatin1(new Uint8Array(out));
    },
    detection: {
      pattern: /\|(?:[\da-f]{2} ?)+\|/i,
      minLength: 6,
      formatName: 'Snort hex content',
    },
  },
  {
    id: 'pem-to-hex',
    name: 'PEM to Hex',
    category: 'Data format',
    description: 'Extracts the DER bytes from every PEM block and prints them as hex.',
    aliases: ['pem decode', 'certificate to hex', 'der'],
    args: [],
    run: (input) => {
      if (input.trim() === '') return '';
      const pattern = /-----BEGIN ([A-Z][A-Z0-9 ]*[A-Z0-9])-----/g;
      const blocks: string[] = [];
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(input)) !== null) {
        const label = match[1] as string;
        const bodyStart = match.index + match[0].length;
        const footer = `-----END ${label}-----`;
        const bodyEnd = input.indexOf(footer, bodyStart);
        if (bodyEnd === -1) throw new OperationError(`No matching '${footer}'.`);

        const base64 = input.slice(bodyStart, bodyEnd).replace(/[^A-Za-z0-9+/=]/g, '');
        try {
          blocks.push(hexOf(latin1ToBytes(atob(base64))));
        } catch {
          throw new OperationError(`The ${label} block does not hold valid Base64.`);
        }
      }
      if (blocks.length === 0) throw new OperationError('No PEM block found.');
      return blocks.join('\n');
    },
    detection: {
      pattern: /-----BEGIN [A-Z][A-Z0-9 ]*-----/,
      minLength: 30,
      formatName: 'PEM',
    },
  },
  {
    id: 'hex-to-pem',
    name: 'Hex to PEM',
    category: 'Data format',
    description: 'Wraps hex-encoded DER bytes in a PEM header and footer.',
    aliases: ['pem encode', 'der to pem'],
    args: [{ name: 'Header string', type: 'string', value: 'CERTIFICATE' }],
    run: (input, args) => {
      const label = String(arg(args, 'Header string', 'CERTIFICATE')).toUpperCase().trim();
      if (!/^[A-Z][A-Z0-9 ]*$/.test(label)) {
        throw new OperationError('A PEM label is upper-case letters, digits and spaces.');
      }
      const base64 = btoa(bytesToLatin1(parseHex(input)));
      const lines = base64.match(new RegExp(`.{1,${PEM_LINE_LENGTH}}`, 'g')) ?? [];
      return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`, ''].join('\n');
    },
  },
  {
    id: 'parse-tlv',
    name: 'Parse TLV',
    category: 'Data format',
    description: 'Splits type-length-value or key-length-value data into records.',
    aliases: ['klv', 'tag length value', 'ber'],
    args: [
      { name: 'Type/Key size', type: 'number', value: 1, min: 0, max: 8 },
      { name: 'Length size', type: 'number', value: 1, min: 0, max: 8 },
      { name: 'Use BER', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const keySize = Math.max(0, Number(arg(args, 'Type/Key size', 1)));
      const lengthSize = Math.max(0, Number(arg(args, 'Length size', 1)));
      const ber = arg(args, 'Use BER', false);
      if (keySize === 0 && lengthSize === 0 && !ber) {
        throw new OperationError('The type size or the length size must be greater than 0.');
      }

      const bytes = asBytes(input);
      const records: TlvRecord[] = [];
      let at = 0;

      const take = (count: number): Uint8Array => {
        const slice = bytes.subarray(at, at + count);
        at += count;
        return slice;
      };

      while (at < bytes.length) {
        const key = keySize > 0 ? hexOf(take(keySize)) : undefined;

        let length = 0;
        if (ber) {
          const first = bytes[at++] ?? 0;
          if (first & 0x80) {
            for (let i = 0; i < (first & 0x7f); i++) length = (length << 8) + (bytes[at++] ?? 0);
          } else {
            length = first;
          }
        } else {
          for (let i = 0; i < lengthSize; i++) length += (bytes[at++] ?? 0) * 256 ** i;
        }

        if (length < 0 || at + length > bytes.length) {
          throw new OperationError(`A record claims ${length} bytes but the data ends first.`);
        }
        records.push({ key, length, value: hexOf(take(length)) });
        if (records.length > MAX_TLV_RECORDS) {
          throw new OperationError(`More than ${MAX_TLV_RECORDS} records; this is probably not TLV.`);
        }
      }
      return JSON.stringify(records, null, 2);
    },
  },
  {
    id: 'mime-decoding',
    name: 'MIME Decoding',
    category: 'Data format',
    description: 'Decodes RFC 2047 encoded words in mail headers back into text.',
    aliases: ['encoded word', 'rfc2047', 'email header'],
    args: [],
    run: (input) => {
      const text = input.replace(/\r\n/g, '\n');
      const pattern = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;
      let out = '';
      let cursor = 0;
      let previousWasWord = false;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        const between = text.slice(cursor, match.index);
        if (!previousWasWord || /\S/.test(between)) out += between;

        const [, charset = 'utf-8', encoding = 'q', body = ''] = match;
        let bytes: Uint8Array;
        if (encoding.toLowerCase() === 'b') {
          try {
            bytes = latin1ToBytes(atob(body.replace(/[^A-Za-z0-9+/=]/g, '')));
          } catch {
            throw new OperationError('An encoded word does not hold valid Base64.');
          }
        } else {
          bytes = decodeQEncoded(body);
        }
        out += decodeCharset(charset, bytes);

        cursor = pattern.lastIndex;
        previousWasWord = true;
      }
      return out + text.slice(cursor);
    },
    detection: {
      pattern: /=\?[^?]+\?[BbQq]\?[^?]*\?=/,
      minLength: 10,
      formatName: 'MIME encoded word',
    },
  },
  {
    id: 'caret-m-decode',
    name: 'Caret/M-decode',
    category: 'Data format',
    description: 'Decodes the caret and M- notation cat -v and sendmail use for control bytes.',
    aliases: ['cat -v', 'm-notation', 'control characters'],
    args: [],
    run: (input) => {
      const out: number[] = [];
      let prefix = '';

      for (const char of input) {
        const code = char.charCodeAt(0);
        if (prefix === 'M-^') {
          if (code > 63 && code <= 95) out.push(code + 64);
          else if (code === 63) out.push(255);
          else out.push(77, 45, 94, code);
          prefix = '';
        } else if (prefix === 'M-') {
          if (char === '^') {
            prefix = 'M-^';
          } else {
            if (code >= 32 && code <= 126) out.push(code + 128);
            else out.push(77, 45, code);
            prefix = '';
          }
        } else if (prefix === 'M') {
          if (char === '-') {
            prefix = 'M-';
          } else {
            out.push(77, code);
            prefix = '';
          }
        } else if (prefix === '^') {
          if (code > 63 && code <= 126) out.push(code - 64);
          else if (code === 63) out.push(127);
          else out.push(94, code);
          prefix = '';
        } else if (char === 'M') {
          prefix = 'M';
        } else if (char === '^') {
          prefix = '^';
        } else {
          out.push(code);
        }
      }
      for (const char of prefix) out.push(char.charCodeAt(0));
      return bytesToLatin1(new Uint8Array(out));
    },
  },
  {
    id: 'show-base64-offsets',
    name: 'Show Base64 offsets',
    category: 'Data format',
    description: 'Shows the three alignments this data can take inside a larger Base64 string.',
    aliases: ['base64 offsets', 'base64 search', 'alignment'],
    args: [
      { name: 'Input format', type: 'option', value: 'Raw', options: ['Raw', 'Base64'] },
    ],
    run: (input, args) => {
      let bytes: Uint8Array;
      if (String(arg(args, 'Input format', 'Raw')) === 'Base64') {
        try {
          bytes = latin1ToBytes(atob(input.replace(/[^A-Za-z0-9+/=]/g, '')));
        } catch {
          throw new OperationError('Input is not valid Base64.');
        }
      } else {
        bytes = asBytes(input);
      }
      if (bytes.length === 0) throw new OperationError('Input is empty.');

      const lines: string[] = [
        'Encoded at each byte alignment. Only the stable run survives being',
        'embedded at an unknown offset — search a larger blob for that.',
        '',
      ];

      for (let offset = 0; offset < 3; offset++) {
        const padded = new Uint8Array(offset + bytes.length);
        padded.set(bytes, offset);
        const encoded = btoa(bytesToLatin1(padded));

        const head = offset === 0 ? 0 : offset + 1;
        const unpadded = encoded.indexOf('=') === -1 ? encoded.length : encoded.indexOf('=');
        const tail = unpadded % 4 === 2 ? 3 : unpadded % 4 === 3 ? 2 : 0;
        const stable = encoded.slice(head, encoded.length - tail);

        lines.push(`offset ${offset}`);
        lines.push(`  encoded  ${encoded}`);
        lines.push(`  stable   ${' '.repeat(head)}${stable}`);
        lines.push('');
      }
      return lines.join('\n').trimEnd();
    },
  },
];
