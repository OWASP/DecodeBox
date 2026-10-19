import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';

const LINE_DELIMITERS: Record<string, string> = {
  'Line feed': '\n',
  CRLF: '\r\n',
  Space: ' ',
  Comma: ',',
  'Semi-colon': ';',
  Colon: ':',
  Nothing: '',
};

const LINE_DELIM_OPTIONS = Object.keys(LINE_DELIMITERS);

function lineDelimiter(name: string): string {
  return LINE_DELIMITERS[name] ?? '\n';
}

const MAX_SLEEP_MS = 3000;


const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GREGORIAN_OFFSET_MS = 12219292800000;

function uuidBytes(input: string): Uint8Array {
  const trimmed = input.trim();
  if (!UUID_PATTERN.test(trimmed)) throw new OperationError('Not a UUID.');
  const hex = trimmed.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function uuidVariant(byte: number): string {
  if ((byte & 0x80) === 0x00) return 'NCS (reserved, legacy)';
  if ((byte & 0xc0) === 0x80) return 'RFC 4122 / RFC 9562';
  if ((byte & 0xe0) === 0xc0) return 'Microsoft (reserved)';
  return 'Reserved for future definition';
}


const LOREM_WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(
    ' ',
  );

function loremWords(count: number, from: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(LOREM_WORDS[(from + i) % LOREM_WORDS.length] as string);
  }
  return out;
}

const SENTENCE_LENGTHS = [11, 8, 14, 9, 12, 7, 15, 10];

function sentenceStart(index: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) at += SENTENCE_LENGTHS[i % SENTENCE_LENGTHS.length] as number;
  return at % LOREM_WORDS.length;
}

function loremSentence(index: number): string {
  const length = SENTENCE_LENGTHS[index % SENTENCE_LENGTHS.length] as number;
  const body = loremWords(length, sentenceStart(index)).join(' ');
  return `${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
}


function permissionTriple(bits: number, extra: '' | 's' | 't'): string {
  const read = bits & 4 ? 'r' : '-';
  const write = bits & 2 ? 'w' : '-';
  const execute = bits & 1;
  if (extra === '') return read + write + (execute ? 'x' : '-');
  return read + write + (execute ? extra : extra.toUpperCase());
}

export const sequenceOperations: Operation[] = [
  {
    id: 'take-nth-bytes',
    name: 'Take nth bytes',
    category: 'Utils',
    description: 'Keeps every nth byte and drops the rest.',
    aliases: ['sample bytes', 'stride', 'every nth'],
    args: [
      { name: 'Take every', type: 'number', value: 4, min: 1 },
      { name: 'Starting at', type: 'number', value: 0, min: 0 },
      { name: 'Apply to each line', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const every = Number(arg(args, 'Take every', 4));
      const start = Number(arg(args, 'Starting at', 0));
      if (!Number.isInteger(every) || every <= 0) {
        throw new OperationError("'Take every' must be a positive whole number.");
      }
      if (!Number.isInteger(start) || start < 0) {
        throw new OperationError("'Starting at' cannot be negative.");
      }

      const eachLine = arg(args, 'Apply to each line', false);
      const bytes = asBytes(input);
      const out: number[] = [];
      let offset = 0;
      for (let i = 0; i < bytes.length; i++) {
        if (eachLine && bytes[i] === 0x0a) {
          out.push(0x0a);
          offset = i + 1;
        } else if (i - offset >= start && (i - (start + offset)) % every === 0) {
          out.push(bytes[i] as number);
        }
      }
      return bytesToLatin1(new Uint8Array(out));
    },
  },
  {
    id: 'drop-nth-bytes',
    name: 'Drop nth bytes',
    category: 'Utils',
    description: 'Removes every nth byte and keeps the rest.',
    aliases: ['remove bytes', 'thin out'],
    args: [
      { name: 'Drop every', type: 'number', value: 4, min: 1 },
      { name: 'Starting at', type: 'number', value: 0, min: 0 },
      { name: 'Apply to each line', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const every = Number(arg(args, 'Drop every', 4));
      const start = Number(arg(args, 'Starting at', 0));
      if (!Number.isInteger(every) || every <= 0) {
        throw new OperationError("'Drop every' must be a positive whole number.");
      }
      if (!Number.isInteger(start) || start < 0) {
        throw new OperationError("'Starting at' cannot be negative.");
      }

      const eachLine = arg(args, 'Apply to each line', false);
      const bytes = asBytes(input);
      const out: number[] = [];
      let offset = 0;
      for (let i = 0; i < bytes.length; i++) {
        if (eachLine && bytes[i] === 0x0a) {
          out.push(0x0a);
          offset = i + 1;
        } else if (i - offset < start || (i - (start + offset)) % every !== 0) {
          out.push(bytes[i] as number);
        }
      }
      return bytesToLatin1(new Uint8Array(out));
    },
  },
  {
    id: 'shuffle',
    name: 'Shuffle',
    category: 'Utils',
    description: 'Randomly reorders the pieces the input splits into.',
    aliases: ['randomise order', 'scramble'],
    args: [{ name: 'Delimiter', type: 'option', value: 'Line feed', options: LINE_DELIM_OPTIONS }],
    run: (input, args) => {
      if (input.length === 0) return input;
      const delimiter = lineDelimiter(String(arg(args, 'Delimiter', 'Line feed')));
      const pieces = delimiter === '' ? [...input] : input.split(delimiter);

      const random = new Uint32Array(pieces.length);
      crypto.getRandomValues(random);
      for (let i = pieces.length - 1; i > 0; i--) {
        const j = (random[i] as number) % (i + 1);
        [pieces[i], pieces[j]] = [pieces[j] as string, pieces[i] as string];
      }
      return pieces.join(delimiter);
    },
  },
  {
    id: 'filter',
    name: 'Filter',
    category: 'Utils',
    description: 'Keeps only the pieces that match a regular expression.',
    aliases: ['grep', 'select', 'where'],
    args: [
      { name: 'Delimiter', type: 'option', value: 'Line feed', options: LINE_DELIM_OPTIONS },
      { name: 'Regex', type: 'string', value: '' },
      { name: 'Invert condition', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const delimiter = lineDelimiter(String(arg(args, 'Delimiter', 'Line feed')));
      let regex: RegExp;
      try {
        regex = new RegExp(String(arg(args, 'Regex', '')));
      } catch {
        throw new OperationError('Not a valid regular expression.');
      }
      const invert = arg(args, 'Invert condition', false);
      return input
        .split(delimiter)
        .filter((piece) => regex.test(piece) !== invert)
        .join(delimiter);
    },
  },
  {
    id: 'file-tree',
    name: 'File Tree',
    category: 'Utils',
    description: 'Draws a list of paths as a directory tree.',
    aliases: ['directory tree', 'paths', 'tree'],
    args: [
      { name: 'File path delimiter', type: 'string', value: '/' },
      { name: 'Delimiter', type: 'option', value: 'Line feed', options: LINE_DELIM_OPTIONS },
    ],
    run: (input, args) => {
      const separator = String(arg(args, 'File path delimiter', '/')) || '/';
      const delimiter = lineDelimiter(String(arg(args, 'Delimiter', 'Line feed')));

      const seen = new Set<string>();
      const lines: string[] = [];
      const paths = [...new Set(input.split(delimiter))].filter((p) => p !== '').sort();

      for (const path of paths) {
        const parts = path.split(separator).filter((part, i) => !(i === 0 && part === ''));
        parts.forEach((part, depth) => {
          const key = parts.slice(0, depth + 1).join('/');
          if (seen.has(key)) return;
          seen.add(key);
          lines.push(depth === 0 ? part : `${'|   '.repeat(depth - 1)}|---${part}`);
        });
      }
      return lines.join('\n');
    },
  },
  {
    id: 'sleep',
    name: 'Sleep',
    category: 'Utils',
    description: 'Pauses the recipe for a moment before passing the input on.',
    aliases: ['wait', 'delay', 'pause'],
    args: [{ name: 'Time (ms)', type: 'number', value: 1000, min: 0, max: MAX_SLEEP_MS }],
    run: async (input, args) => {
      const wanted = Number(arg(args, 'Time (ms)', 1000));
      const time = Math.min(Math.max(0, wanted), MAX_SLEEP_MS);
      await new Promise((resolve) => setTimeout(resolve, time));
      return input;
    },
  },
  {
    id: 'pseudo-random-number-generator',
    name: 'Pseudo-Random Number Generator',
    category: 'Utils',
    description: 'Generates random bytes from the browser cryptographic generator.',
    aliases: ['prng', 'random', 'entropy'],
    args: [
      { name: 'Number of bytes', type: 'number', value: 32, min: 1, max: 65536 },
      {
        name: 'Output as',
        type: 'option',
        value: 'Hex',
        options: ['Hex', 'Integer', 'Byte array', 'Raw bytes'],
      },
    ],
    run: (_input, args) => {
      const count = Math.min(65536, Math.max(1, Number(arg(args, 'Number of bytes', 32))));
      const bytes = new Uint8Array(count);
      crypto.getRandomValues(bytes);

      switch (String(arg(args, 'Output as', 'Hex'))) {
        case 'Integer': {
          let value = 0n;
          for (const byte of bytes) value = (value << 8n) | BigInt(byte);
          return value.toString();
        }
        case 'Byte array':
          return `[${Array.from(bytes).join(', ')}]`;
        case 'Raw bytes':
          return bytesToLatin1(bytes);
        default:
          return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      }
    },
  },
  {
    id: 'pseudo-random-integer-generator',
    name: 'Pseudo-Random Integer Generator',
    category: 'Other',
    description: 'Generates whole numbers in a range, without modulo bias.',
    aliases: ['random integer', 'dice', 'random number'],
    args: [
      { name: 'Number of integers', type: 'number', value: 1, min: 1, max: 10000 },
      { name: 'Min value', type: 'number', value: 0 },
      { name: 'Max value', type: 'number', value: 99 },
      { name: 'Delimiter', type: 'option', value: 'Space', options: LINE_DELIM_OPTIONS },
    ],
    run: (_input, args) => {
      const count = Math.min(10000, Math.max(1, Number(arg(args, 'Number of integers', 1))));
      const min = Math.ceil(Number(arg(args, 'Min value', 0)));
      const max = Math.floor(Number(arg(args, 'Max value', 99)));
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
        throw new OperationError('The bounds must be safe integers.');
      }
      if (min > max) throw new OperationError('The minimum cannot exceed the maximum.');

      const range = max - min + 1;
      const limit = 2 ** 32 - (2 ** 32 % range);
      const out: number[] = [];
      const buffer = new Uint32Array(1);
      while (out.length < count) {
        crypto.getRandomValues(buffer);
        const value = buffer[0] as number;
        if (value < limit) out.push(min + (value % range));
      }
      return out.join(lineDelimiter(String(arg(args, 'Delimiter', 'Space'))));
    },
  },
  {
    id: 'generate-de-bruijn-sequence',
    name: 'Generate De Bruijn Sequence',
    category: 'Other',
    description: 'Generates a cyclic sequence containing every subsequence exactly once.',
    aliases: ['de bruijn', 'pattern', 'cyclic pattern'],
    args: [
      { name: 'Alphabet size (k)', type: 'number', value: 2, min: 2, max: 9 },
      { name: 'Key length (n)', type: 'number', value: 3, min: 2, max: 32 },
    ],
    run: (_input, args) => {
      const k = Number(arg(args, 'Alphabet size (k)', 2));
      const n = Number(arg(args, 'Key length (n)', 3));
      if (!Number.isInteger(k) || k < 2 || k > 9) {
        throw new OperationError('The alphabet size must be a whole number between 2 and 9.');
      }
      if (!Number.isInteger(n) || n < 2) {
        throw new OperationError('The key length must be a whole number of at least 2.');
      }
      if (k ** n > 50000) {
        throw new OperationError(`k^n is ${k ** n}; keep it under 50,000.`);
      }

      const a = new Array<number>(k * n).fill(0);
      const sequence: number[] = [];
      const db = (t: number, p: number): void => {
        if (t > n) {
          if (n % p !== 0) return;
          for (let j = 1; j <= p; j++) sequence.push(a[j] as number);
          return;
        }
        a[t] = a[t - p] as number;
        db(t + 1, p);
        for (let j = (a[t - p] as number) + 1; j < k; j++) {
          a[t] = j;
          db(t + 1, t);
        }
      };
      db(1, 1);
      return sequence.join('');
    },
  },
  {
    id: 'generate-lorem-ipsum',
    name: 'Generate Lorem Ipsum',
    category: 'Other',
    description: 'Generates placeholder text of a chosen length.',
    aliases: ['filler text', 'placeholder', 'dummy text'],
    args: [
      { name: 'Length', type: 'number', value: 3, min: 1, max: 1000 },
      {
        name: 'Length in',
        type: 'option',
        value: 'Paragraphs',
        options: ['Paragraphs', 'Sentences', 'Words', 'Bytes'],
      },
    ],
    run: (_input, args) => {
      const length = Math.min(1000, Math.max(1, Number(arg(args, 'Length', 3))));
      switch (String(arg(args, 'Length in', 'Paragraphs'))) {
        case 'Words':
          return loremWords(length, 0).join(' ');
        case 'Sentences':
          return Array.from({ length }, (_, i) => loremSentence(i)).join(' ');
        case 'Bytes': {
          let out = '';
          for (let i = 0; out.length < length; i++) out += `${loremSentence(i)} `;
          return out.slice(0, length);
        }
        default:
          return Array.from({ length }, (_, p) =>
            Array.from({ length: 4 }, (_, s) => loremSentence(p * 4 + s)).join(' '),
          ).join('\n\n');
      }
    },
  },
  {
    id: 'analyse-uuid',
    name: 'Analyse UUID',
    category: 'Other',
    description: 'Reports the version, variant and embedded timestamp of a UUID.',
    aliases: ['uuid version', 'guid', 'parse uuid'],
    args: [{ name: 'Include metadata', type: 'boolean', value: true }],
    run: (input, args) => {
      const bytes = uuidBytes(input);
      const version = ((bytes[6] as number) >> 4) & 0xf;
      const lines = [`Version: ${version}`, `Variant: ${uuidVariant(bytes[8] as number)}`];

      if (arg(args, 'Include metadata', true)) {
        const view = new DataView(bytes.buffer);
        if (version === 1) {
          const low = BigInt(view.getUint32(0));
          const mid = BigInt(view.getUint16(4));
          const high = BigInt(view.getUint16(6) & 0x0fff);
          const ticks = (high << 48n) | (mid << 32n) | low;
          const millis = Number(ticks / 10000n) - GREGORIAN_OFFSET_MS;
          lines.push(`Timestamp: ${new Date(millis).toISOString()}`);
          lines.push(
            `Node: ${Array.from(bytes.subarray(10), (b) => b.toString(16).padStart(2, '0')).join(':')}`,
          );
          lines.push(`Multicast bit: ${(bytes[10] as number) & 1 ? 'set (random node)' : 'clear'}`);
        } else if (version === 7) {
          const millis = Number((BigInt(view.getUint32(0)) << 16n) | BigInt(view.getUint16(4)));
          lines.push(`Timestamp: ${new Date(millis).toISOString()}`);
        } else if (version === 4) {
          lines.push('Random: 122 bits, no embedded time or node.');
        }
      }

      let integer = 0n;
      for (const byte of bytes) integer = (integer << 8n) | BigInt(byte);
      lines.push(`Integer: ${integer}`);
      return lines.join('\n');
    },
  },
  {
    id: 'parse-unix-file-permissions',
    name: 'Parse UNIX file permissions',
    category: 'Utils',
    description: 'Explains a permission string or octal mode, and converts between them.',
    aliases: ['chmod', 'file mode', 'rwx'],
    args: [],
    run: (input) => {
      const trimmed = input.trim();
      let bits = 0;
      let fileType = '';

      if (/^[0-7]{1,4}$/.test(trimmed)) {
        bits = parseInt(trimmed.padStart(4, '0'), 8);
      } else if (/^[dlpcbDsrwxsStT-]{9,10}$/.test(trimmed)) {
        const textual = trimmed.length === 10 ? trimmed : `-${trimmed}`;
        fileType =
          { d: 'Directory', l: 'Symbolic link', p: 'Named pipe', s: 'Socket', c: 'Character device', b: 'Block device', D: 'Door', '-': 'Regular file' }[
            textual[0] as string
          ] ?? 'Regular file';

        const triple = (offset: number, setBit: number, marks: string) => {
          let value = 0;
          if (textual[offset] === 'r') value |= 4;
          if (textual[offset + 1] === 'w') value |= 2;
          const last = textual[offset + 2];
          if (last === 'x' || last === marks[0]) value |= 1;
          if (last === marks[0] || last === marks[1]) bits |= setBit << 9;
          return value;
        };
        bits |= triple(1, 4, 'ss') << 6;
        bits |= triple(4, 2, 'ss') << 3;
        bits |= triple(7, 1, 'tT');
      } else {
        throw new OperationError(
          'Enter permissions as octal (755) or as a mode string (drwxr-xr-x).',
        );
      }

      const special = (bits >> 9) & 7;
      const textual =
        (fileType === 'Directory' ? 'd' : fileType === 'Symbolic link' ? 'l' : '-') +
        permissionTriple((bits >> 6) & 7, special & 4 ? 's' : '') +
        permissionTriple((bits >> 3) & 7, special & 2 ? 's' : '') +
        permissionTriple(bits & 7, special & 1 ? 't' : '');

      const lines = [
        `Textual representation: ${textual}`,
        `Octal representation:   ${special ? special.toString(8) : ''}${((bits >> 6) & 7).toString(8)}${((bits >> 3) & 7).toString(8)}${(bits & 7).toString(8)}`,
      ];
      if (fileType) lines.push(`File type: ${fileType}`);
      if (special & 4) lines.push('The setuid flag is set: the file runs as its owner.');
      if (special & 2) lines.push('The setgid flag is set: the file runs as its group.');
      if (special & 1) lines.push('The sticky bit is set: only an owner can delete entries.');
      if (bits & 0o002) lines.push('World-writable: anyone on the system can change this.');
      return lines.join('\n');
    },
  },
  {
    id: 'parse-objectid-timestamp',
    name: 'Parse ObjectID timestamp',
    category: 'Utils',
    description: 'Reads the creation time out of a MongoDB ObjectID.',
    aliases: ['mongodb', 'objectid', 'bson id'],
    args: [],
    run: (input) => {
      const trimmed = input.trim();
      if (!/^[0-9a-f]{24}$/i.test(trimmed)) {
        throw new OperationError('An ObjectID is 24 hexadecimal characters.');
      }
      const seconds = parseInt(trimmed.slice(0, 8), 16);
      return new Date(seconds * 1000).toISOString();
    },
  },
];
