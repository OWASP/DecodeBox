import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';



const BACON_ALPHABETS: Record<string, { alphabet: string; codes?: number[] }> = {
  'Standard (I=J and U=V)': {
    alphabet: 'ABCDEFGHIKLMNOPQRSTUWXYZ',
    codes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 23],
  },
  Complete: { alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
};

const BACON_TRANSLATIONS = ['0/1', 'A/B', 'Case', 'A-M/N-Z first letter'];


function polybiusSquare(keyword: string): string[][] {
  const alphabet = 'ABCDEFGHIKLMNOPQRSTUVWXYZ';
  const seen = new Set<string>();
  const letters: string[] = [];
  for (const char of (keyword + alphabet).toUpperCase().replace(/J/g, 'I')) {
    if (!/[A-Z]/.test(char) || seen.has(char)) continue;
    seen.add(char);
    letters.push(char);
  }
  return Array.from({ length: 5 }, (_, row) => letters.slice(row * 5, row * 5 + 5));
}

function checkKeyword(keyword: string): string {
  const upper = keyword.toUpperCase().replace(/J/g, 'I');
  if (upper !== '' && !/^[A-Z]+$/.test(upper)) {
    throw new OperationError('The key must be letters of the English alphabet only.');
  }
  return upper;
}


const ROT8000_TRANSITIONS: Array<[number, boolean]> = [
  [33, true],
  [127, false],
  [161, true],
  [5760, false],
  [5761, true],
  [8192, false],
  [8203, true],
  [8232, false],
  [8234, true],
  [8239, false],
  [8240, true],
  [8287, false],
  [8288, true],
  [12288, false],
  [12289, true],
  [55296, false],
  [57344, true],
];

const ROT8000_MAP = (() => {
  const valid: number[] = [];
  let inRange = false;
  let next = 0;
  for (let code = 0; code < 0x10000; code++) {
    const transition = ROT8000_TRANSITIONS[next];
    if (transition && transition[0] === code) {
      inRange = transition[1];
      next++;
    }
    if (inRange) valid.push(code);
  }

  const half = valid.length / 2;
  const map = new Map<string, string>();
  for (let i = 0; i < valid.length; i++) {
    map.set(
      String.fromCharCode(valid[i] as number),
      String.fromCharCode(valid[(i + half) % valid.length] as number),
    );
  }
  return map;
})();

export const classicalOperations: Operation[] = [
  {
    id: 'bacon-encode',
    name: 'Bacon Cipher Encode',
    category: 'Encryption / Encoding',
    description: "Hides each letter as five symbols, the way Bacon's cipher does.",
    aliases: ['baconian', 'steganography'],
    args: [
      {
        name: 'Alphabet',
        type: 'option',
        value: 'Standard (I=J and U=V)',
        options: Object.keys(BACON_ALPHABETS),
      },
      { name: 'Translation', type: 'option', value: '0/1', options: ['0/1', 'A/B'] },
      { name: 'Keep extra characters', type: 'boolean', value: false },
      { name: 'Invert translation', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const alphabet = BACON_ALPHABETS[String(arg(args, 'Alphabet', 'Standard (I=J and U=V)'))];
      if (!alphabet) throw new OperationError('Unknown Bacon alphabet.');

      let out = input.replace(/./g, (char) => {
        const code = char.toUpperCase().charCodeAt(0) - 65;
        if (code < 0 || code > 25) return char;
        const mapped = alphabet.codes ? (alphabet.codes[code] as number) : code;
        return mapped.toString(2).padStart(5, '0');
      });

      if (arg(args, 'Invert translation', false)) {
        out = out.replace(/[01]/g, (bit) => (bit === '0' ? '1' : '0'));
      }
      if (!arg(args, 'Keep extra characters', false)) {
        out = (out.replace(/[^01]/g, '').match(/.{5}/g) ?? []).join(' ');
      }
      if (String(arg(args, 'Translation', '0/1')) === 'A/B') {
        out = out.replace(/[01]/g, (bit) => (bit === '0' ? 'A' : 'B'));
      }
      return out;
    },
  },
  {
    id: 'bacon-decode',
    name: 'Bacon Cipher Decode',
    category: 'Encryption / Encoding',
    description: "Reads five-symbol groups back into letters, for Bacon's cipher.",
    aliases: ['baconian decode'],
    args: [
      {
        name: 'Alphabet',
        type: 'option',
        value: 'Standard (I=J and U=V)',
        options: Object.keys(BACON_ALPHABETS),
      },
      { name: 'Translation', type: 'option', value: '0/1', options: BACON_TRANSLATIONS },
      { name: 'Invert translation', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const alphabet = BACON_ALPHABETS[String(arg(args, 'Alphabet', 'Standard (I=J and U=V)'))];
      if (!alphabet) throw new OperationError('Unknown Bacon alphabet.');
      const translation = String(arg(args, 'Translation', '0/1'));

      let bits: string;
      switch (translation) {
        case 'A/B':
          bits = input.replace(/[^ABab]/g, '').toUpperCase().replace(/A/g, '0').replace(/B/g, '1');
          break;
        case 'Case':
          bits = input.replace(/[^A-Za-z]/g, '').replace(/[a-z]/g, '0').replace(/[A-Z]/g, '1');
          break;
        case 'A-M/N-Z first letter':
          bits = input
            .replace(/[^A-Za-z]/g, '')
            .toUpperCase()
            .replace(/[A-M]/g, '0')
            .replace(/[N-Z]/g, '1');
          break;
        default:
          bits = input.replace(/[^01]/g, '');
      }
      if (arg(args, 'Invert translation', false)) {
        bits = bits.replace(/[01]/g, (bit) => (bit === '0' ? '1' : '0'));
      }

      const groups = bits.match(/.{5}/g) ?? [];
      return groups
        .map((group) => {
          const value = parseInt(group, 2);
          const index = alphabet.codes ? alphabet.codes.indexOf(value) : value;
          return index < 0 || index > 25 ? '?' : String.fromCharCode(65 + index);
        })
        .join('');
    },
  },
  {
    id: 'bifid-encode',
    name: 'Bifid Cipher Encode',
    category: 'Encryption / Encoding',
    description: 'Enciphers with the Bifid square, which spreads each letter over two.',
    aliases: ['bifid', 'polybius'],
    args: [{ name: 'Keyword', type: 'string', value: '' }],
    run: (input, args) => {
      const square = polybiusSquare(checkKeyword(String(arg(args, 'Keyword', ''))));
      const rows: number[] = [];
      const columns: number[] = [];
      const shape: Array<boolean | string> = [];

      for (const char of input) {
        const letter = char.toUpperCase().replace('J', 'I');
        const row = square.findIndex((line) => line.includes(letter));
        if (row < 0) {
          shape.push(char);
          continue;
        }
        rows.push(row);
        columns.push((square[row] as string[]).indexOf(letter));
        shape.push(char === letter);
      }

      const combined = [...rows, ...columns];
      const letters: string[] = [];
      for (let i = 0; i < combined.length; i += 2) {
        const row = square[combined[i] as number] as string[];
        letters.push(row[combined[i + 1] as number] as string);
      }

      let at = 0;
      return shape
        .map((item) => {
          if (typeof item === 'string') return item;
          const letter = letters[at++] ?? '';
          return item ? letter : letter.toLowerCase();
        })
        .join('');
    },
  },
  {
    id: 'bifid-decode',
    name: 'Bifid Cipher Decode',
    category: 'Encryption / Encoding',
    description: 'Deciphers Bifid text with the same keyword.',
    aliases: ['bifid decode'],
    args: [{ name: 'Keyword', type: 'string', value: '' }],
    run: (input, args) => {
      const square = polybiusSquare(checkKeyword(String(arg(args, 'Keyword', ''))));
      const coordinates: number[] = [];
      const shape: Array<boolean | string> = [];

      for (const char of input) {
        const letter = char.toUpperCase().replace('J', 'I');
        const row = square.findIndex((line) => line.includes(letter));
        if (row < 0) {
          shape.push(char);
          continue;
        }
        coordinates.push(row, (square[row] as string[]).indexOf(letter));
        shape.push(char === letter);
      }

      const half = coordinates.length / 2;
      const rows = coordinates.slice(0, half);
      const columns = coordinates.slice(half);
      const letters = rows.map((row, i) => (square[row] as string[])[columns[i] as number] as string);

      let at = 0;
      return shape
        .map((item) => {
          if (typeof item === 'string') return item;
          const letter = letters[at++] ?? '';
          return item ? letter : letter.toLowerCase();
        })
        .join('');
    },
  },
  {
    id: 'caesar-box-cipher',
    name: 'Caesar Box Cipher',
    category: 'Encryption / Encoding',
    description: 'Writes the text into a box of a given height and reads it out in rows.',
    aliases: ['scytale', 'columnar transposition'],
    args: [{ name: 'Box height', type: 'number', value: 1, min: 1 }],
    run: (input, args) => {
      const height = Math.max(1, Number(arg(args, 'Box height', 1)));
      const text = input.replace(/ /g, '');
      let out = '';
      for (let row = 0; row < height; row++) {
        for (let i = row; i < text.length; i += height) out += text.charAt(i);
      }
      return out;
    },
  },
  {
    id: 'cetacean-encode',
    name: 'Cetacean Cipher Encode',
    category: 'Encryption / Encoding',
    description: 'Writes each character as sixteen letters of e and E.',
    aliases: ['whale', 'eeee'],
    args: [],
    run: (input) =>
      Array.from(input, (char) =>
        char === ' '
          ? ' '
          : char
              .charCodeAt(0)
              .toString(2)
              .padStart(16, '0')
              .replace(/[01]/g, (bit) => (bit === '1' ? 'e' : 'E')),
      ).join(''),
  },
  {
    id: 'cetacean-decode',
    name: 'Cetacean Cipher Decode',
    category: 'Encryption / Encoding',
    description: 'Reads sixteen-letter groups of e and E back into characters.',
    aliases: ['whale decode'],
    args: [],
    run: (input) =>
      input
        .split(' ')
        .map((word) =>
          (word.match(/[eE]{16}/g) ?? [])
            .map((group) =>
              String.fromCharCode(parseInt(group.replace(/e/g, '1').replace(/E/g, '0'), 2)),
            )
            .join(''),
        )
        .join(' '),
  },
  {
    id: 'citrix-ctx1-encode',
    name: 'Citrix CTX1 Encode',
    category: 'Encryption / Encoding',
    description: 'Obfuscates a password the way Citrix CTX1 files do.',
    aliases: ['citrix', 'ica password'],
    args: [],
    run: (input) => {
      const out: number[] = [];
      let previous = 0;
      for (let i = 0; i < input.length; i++) {
        const unit = input.charCodeAt(i);
        for (const byte of [unit & 0xff, unit >> 8]) {
          previous = byte ^ 0xa5 ^ previous;
          out.push(((previous >>> 4) & 0xf) + 0x41, (previous & 0xf) + 0x41);
        }
      }
      return bytesToLatin1(new Uint8Array(out));
    },
  },
  {
    id: 'citrix-ctx1-decode',
    name: 'Citrix CTX1 Decode',
    category: 'Encryption / Encoding',
    description: 'Recovers a password from its Citrix CTX1 form.',
    aliases: ['citrix decode', 'ica password decode'],
    args: [],
    run: (input) => {
      const bytes = asBytes(input.trim());
      if (bytes.length % 4 !== 0) throw new OperationError('A CTX1 value is a multiple of 4 characters.');

      const reversed = Array.from(bytes).reverse();
      const out: number[] = [];
      let temp = 0;
      for (let i = 0; i < reversed.length; i += 2) {
        temp =
          i + 2 >= reversed.length
            ? 0
            : (((reversed[i + 2] as number) - 0x41) & 0xf) ^
              ((((reversed[i + 3] as number) - 0x41) << 4) & 0xf0);
        temp =
          ((((reversed[i] as number) - 0x41) & 0xf) ^
            ((((reversed[i + 1] as number) - 0x41) << 4) & 0xf0)) ^
          0xa5 ^
          temp;
        out.push(temp);
      }
      const utf16 = out.reverse();
      let text = '';
      for (let i = 0; i + 1 < utf16.length; i += 2) {
        text += String.fromCharCode((utf16[i] as number) | ((utf16[i + 1] as number) << 8));
      }
      return text;
    },
  },
  {
    id: 'rot8000',
    name: 'ROT8000',
    category: 'Encryption / Encoding',
    description: 'Rotates each character halfway around the printable Unicode plane.',
    aliases: ['rot 8000', 'unicode rot'],
    args: [],
    run: (input) => Array.from(input, (char) => ROT8000_MAP.get(char) ?? char).join(''),
  },
  {
    id: 'ror13',
    name: 'ROR13',
    category: 'Encryption / Encoding',
    description: 'The rotate-right-13 hash shellcode uses to find exported functions.',
    aliases: ['ror13 hash', 'shellcode', 'api hashing'],
    args: [],
    run: (input) => {
      let hash = 0;
      for (const byte of asBytes(input)) {
        hash = ((hash >>> 13) | (hash << 19)) >>> 0;
        hash = (hash + byte) >>> 0;
      }
      return `0x${hash.toString(16).padStart(8, '0').toUpperCase()}`;
    },
  },
  {
    id: 'rot47-brute-force',
    name: 'ROT47 Brute Force',
    category: 'Encryption / Encoding',
    description: 'Shows all 94 rotations of ROT47 so the readable one can be spotted.',
    aliases: ['rot47 all', 'try every rotation'],
    args: [
      { name: 'Sample length', type: 'number', value: 100, min: 1, max: 2000 },
      { name: 'Print amount', type: 'boolean', value: true },
    ],
    run: (input, args) => {
      const sample = input.slice(0, Math.max(1, Number(arg(args, 'Sample length', 100))));
      const showAmount = arg(args, 'Print amount', true);

      const lines: string[] = [];
      for (let amount = 1; amount < 94; amount++) {
        const rotated = Array.from(sample, (char) => {
          const code = char.charCodeAt(0);
          if (code < 33 || code > 126) return char;
          return String.fromCharCode(((code - 33 + amount) % 94) + 33);
        }).join('');
        lines.push(showAmount ? `Amount = ${String(amount).padStart(2)}: ${rotated}` : rotated);
      }
      return lines.join('\n');
    },
  },
];
