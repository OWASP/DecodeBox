import { asBytes, bytesToLatin1, renderText, toBytes, truncate } from '../core/bytes';
import {
  CHARSET_NAMES,
  ENCODABLE_CHARSET_NAMES,
  decodeCharset,
  encodeCharsetLossy,
} from '../core/charsets';
import { arg, type Operation } from './types';

const BRUTE_SAMPLE = 120;

export const charsetOperations: Operation[] = [
  {
    id: 'encode-text',
    name: 'Encode text',
    category: 'Data format',
    description: 'Writes the input as bytes in another character set.',
    aliases: ['charset encode', 'code page', 'iconv'],
    args: [
      { name: 'Encoding', type: 'option', value: 'UTF-8', options: ENCODABLE_CHARSET_NAMES },
    ],
    run: (input, args) => {
      const name = String(arg(args, 'Encoding', 'UTF-8'));
      return bytesToLatin1(encodeCharsetLossy(name, renderText(input)));
    },
  },
  {
    id: 'decode-text',
    name: 'Decode text',
    category: 'Data format',
    description: 'Reads the input bytes as text in another character set.',
    aliases: ['charset decode', 'code page decode', 'mojibake'],
    args: [{ name: 'Encoding', type: 'option', value: 'UTF-8', options: CHARSET_NAMES }],
    run: (input, args) => {
      const name = String(arg(args, 'Encoding', 'UTF-8'));
      return bytesToLatin1(toBytes(decodeCharset(name, asBytes(input))));
    },
  },
  {
    id: 'text-encoding-brute-force',
    name: 'Text Encoding Brute Force',
    category: 'Data format',
    description: 'Shows what the input would say in every character set available.',
    aliases: ['charset brute force', 'try all encodings', 'mojibake fix'],
    args: [{ name: 'Mode', type: 'option', value: 'Decode', options: ['Decode', 'Encode'] }],
    run: (input, args) => {
      const decoding = String(arg(args, 'Mode', 'Decode')) === 'Decode';
      const names = decoding ? CHARSET_NAMES : ENCODABLE_CHARSET_NAMES;
      const width = Math.max(...names.map((n) => n.length));

      const lines = names.map((name) => {
        let result: string;
        try {
          result = decoding
            ? decodeCharset(name, asBytes(input))
            : bytesToLatin1(encodeCharsetLossy(name, renderText(input)));
        } catch (error) {
          result = `(${error instanceof Error ? error.message : 'could not convert'})`;
        }
        return `${name.padEnd(width)}  ${truncate(result, BRUTE_SAMPLE)}`;
      });
      return lines.join('\n');
    },
  },
];
