import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';


function base92Char(value: number): string {
  if (value === 0) return '!';
  if (value <= 61) return String.fromCharCode(0x23 + value - 1);
  return String.fromCharCode(0x61 + value - 62);
}

function base92Value(char: string): number {
  if (char === '!') return 0;
  const code = char.charCodeAt(0);
  if (code >= 0x23 && code <= 0x5f) return code - 0x23 + 1;
  if (code >= 0x61 && code <= 0x7d) return code - 0x61 + 62;
  throw new OperationError(`'${char}' is not a Base92 character.`);
}

function toBase92(bytes: Uint8Array): string {
  let bits = '';
  let out = '';
  let index = 0;

  while (index < bytes.length || bits.length >= 13) {
    while (bits.length < 13 && index < bytes.length) {
      bits += (bytes[index++] as number).toString(2).padStart(8, '0');
    }
    if (bits.length < 13) break;
    const value = parseInt(bits.slice(0, 13), 2);
    out += base92Char(Math.floor(value / 91)) + base92Char(value % 91);
    bits = bits.slice(13);
  }

  if (bits.length > 0) {
    if (bits.length < 7) {
      out += base92Char(parseInt(bits.padEnd(6, '0'), 2));
    } else {
      const value = parseInt(bits.padEnd(13, '0').slice(0, 13), 2);
      out += base92Char(Math.floor(value / 91)) + base92Char(value % 91);
    }
  }
  return out;
}

function fromBase92(text: string): Uint8Array {
  const out: number[] = [];
  let bits = '';

  for (let i = 0; i < text.length; i += 2) {
    const first = text[i] as string;
    const second = text[i + 1];
    if (second === undefined) {
      bits += base92Value(first).toString(2).padStart(6, '0');
    } else {
      bits += (base92Value(first) * 91 + base92Value(second)).toString(2).padStart(13, '0');
    }
    while (bits.length >= 8) {
      out.push(parseInt(bits.slice(0, 8), 2));
      bits = bits.slice(8);
    }
  }
  return new Uint8Array(out);
}


const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

const SEGWIT_HRPS = ['bc', 'tb', 'ltc', 'tltc', 'bcrt'];

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= BECH32_GENERATOR[i] as number;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const char of hrp) out.push(char.charCodeAt(0) >> 5);
  out.push(0);
  for (const char of hrp) out.push(char.charCodeAt(0) & 31);
  return out;
}

function bech32Constant(encoding: string): number {
  return encoding === 'Bech32m' ? BECH32M_CONST : BECH32_CONST;
}

function toWords(bytes: Uint8Array | number[]): number[] {
  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((value >> bits) & 31);
    }
  }
  if (bits > 0) out.push((value << (5 - bits)) & 31);
  return out;
}

function fromWords(words: number[]): number[] {
  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (const word of words) {
    value = (value << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 255);
    }
  }
  if (bits >= 5) throw new OperationError('Invalid Bech32 padding: an incomplete byte is left.');
  if (bits > 0 && ((value << (8 - bits)) & 255) !== 0) {
    throw new OperationError('Invalid Bech32 padding: the spare bits are not zero.');
  }
  return out;
}

function bech32Encode(hrp: string, words: number[], encoding: string): string {
  const lower = hrp.toLowerCase();
  const values = hrpExpand(lower).concat(words, [0, 0, 0, 0, 0, 0]);
  const mod = bech32Polymod(values) ^ bech32Constant(encoding);
  let out = `${lower}1`;
  for (const word of words) out += BECH32_CHARSET[word];
  for (let i = 0; i < 6; i++) out += BECH32_CHARSET[(mod >> (5 * (5 - i))) & 31];
  return out;
}

interface Bech32Decoded {
  hrp: string;
  bytes: number[];
  encoding: string;
  witnessVersion: number | null;
}

function bech32Decode(text: string, wanted: string): Bech32Decoded {
  const trimmed = text.trim();
  if (trimmed === '') throw new OperationError('Input is empty.');
  if (trimmed.length > 90) {
    throw new OperationError(`A Bech32 string is at most 90 characters; this is ${trimmed.length}.`);
  }
  if (/[A-Z]/.test(trimmed) && /[a-z]/.test(trimmed)) {
    throw new OperationError('Mixed case is not valid Bech32.');
  }

  const lower = trimmed.toLowerCase();
  const separator = lower.lastIndexOf('1');
  if (separator < 1) throw new OperationError("No '1' separator, so there is no readable part.");
  if (separator + 7 > lower.length) throw new OperationError('The data part is shorter than its checksum.');

  const hrp = lower.slice(0, separator);
  for (const char of hrp) {
    const code = char.charCodeAt(0);
    if (code < 33 || code > 126) throw new OperationError('The readable part has a non-printable character.');
  }

  const data: number[] = [];
  for (const char of lower.slice(separator + 1)) {
    const value = BECH32_CHARSET.indexOf(char);
    if (value === -1) throw new OperationError(`'${char}' is not a Bech32 character.`);
    data.push(value);
  }

  const verify = (encoding: string) =>
    bech32Polymod(hrpExpand(hrp).concat(data)) === bech32Constant(encoding);

  let encoding: string;
  if (wanted === 'Auto-detect') {
    if (verify('Bech32')) encoding = 'Bech32';
    else if (verify('Bech32m')) encoding = 'Bech32m';
    else throw new OperationError('Checksum does not match either Bech32 or Bech32m.');
  } else {
    if (!verify(wanted)) throw new OperationError(`Invalid ${wanted} checksum.`);
    encoding = wanted;
  }

  const words = data.slice(0, -6);
  const first = words[0];
  if (SEGWIT_HRPS.includes(hrp) && first !== undefined && first <= 16) {
    try {
      const program = fromWords(words.slice(1));
      const validV0 = first === 0 && (program.length === 20 || program.length === 32);
      const validOther = first !== 0 && program.length >= 2 && program.length <= 40;
      if (validV0 || validOther) {
        return { hrp, bytes: [first, ...program], encoding, witnessVersion: first };
      }
    } catch {
    }
  }
  return { hrp, bytes: fromWords(words), encoding, witnessVersion: null };
}

function hex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}


const BRAILLE_ASCII = " A1B'K2L@CIF/MSP\"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)=";
const BRAILLE_DOTS =
  '⠀⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿';


const MODHEX_ALPHABET = 'cbdefghijklnrtuv';

const MODHEX_DELIMITERS: Record<string, string> = {
  Space: ' ',
  Comma: ',',
  'Semi-colon': ';',
  Colon: ':',
  'Line feed': '\n',
  CRLF: '\r\n',
  None: '',
};

const MODHEX_DELIM_OPTIONS = Object.keys(MODHEX_DELIMITERS);


function toCobs(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) return new Uint8Array();
  const out: number[] = [0];
  let codeIndex = 0;
  let code = 1;

  for (const byte of bytes) {
    if (byte !== 0) {
      out.push(byte);
      code++;
      if (code !== 0xff) continue;
    }
    out[codeIndex] = code;
    codeIndex = out.length;
    out.push(0);
    code = 1;
  }
  out[codeIndex] = code;
  return new Uint8Array(out);
}

function fromCobs(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) return new Uint8Array();
  if (bytes.includes(0)) {
    throw new OperationError('COBS-encoded data cannot contain a zero byte.');
  }

  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const code = bytes[i++] as number;
    for (let j = 1; j < code && i < bytes.length; j++) out.push(bytes[i++] as number);
    if (code !== 0xff && i < bytes.length) out.push(0);
  }
  return new Uint8Array(out);
}

export const alphabetOperations: Operation[] = [
  {
    id: 'to-base92',
    name: 'To Base92',
    category: 'Data format',
    description: 'Encodes data as Base92, a dense printable-ASCII alphabet.',
    aliases: ['base92 encode', 'b92'],
    args: [],
    run: (input) => toBase92(asBytes(input)),
  },
  {
    id: 'from-base92',
    name: 'From Base92',
    category: 'Data format',
    description: 'Decodes Base92-encoded data.',
    aliases: ['base92 decode'],
    args: [],
    run: (input) => bytesToLatin1(fromBase92(input.trim())),
  },
  {
    id: 'to-bech32',
    name: 'To Bech32',
    category: 'Data format',
    description: 'Encodes data as a Bech32 or Bech32m string with a checksum.',
    aliases: ['bech32 encode', 'segwit', 'bip173'],
    args: [
      { name: 'Human-readable part', type: 'string', value: 'bc' },
      { name: 'Encoding', type: 'option', value: 'Bech32', options: ['Bech32', 'Bech32m'] },
      { name: 'Input format', type: 'option', value: 'Raw bytes', options: ['Raw bytes', 'Hex'] },
      { name: 'Mode', type: 'option', value: 'Generic', options: ['Generic', 'Bitcoin SegWit'] },
      { name: 'Witness version', type: 'number', value: 0, min: 0, max: 16 },
    ],
    run: (input, args) => {
      const hrp = String(arg(args, 'Human-readable part', 'bc'));
      if (hrp === '') throw new OperationError('A human-readable part is required.');
      for (const char of hrp) {
        const code = char.charCodeAt(0);
        if (code < 33 || code > 126) {
          throw new OperationError('The readable part must be printable ASCII.');
        }
      }

      const encoding = String(arg(args, 'Encoding', 'Bech32'));
      const bytes =
        String(arg(args, 'Input format', 'Raw bytes')) === 'Hex'
          ? Array.from(input.replace(/[^0-9a-fA-F]/g, '').match(/../g) ?? [], (p) => parseInt(p, 16))
          : Array.from(asBytes(input));

      if (String(arg(args, 'Mode', 'Generic')) === 'Bitcoin SegWit') {
        const version = Number(arg(args, 'Witness version', 0));
        if (version < 0 || version > 16) {
          throw new OperationError('The witness version must be between 0 and 16.');
        }
        if (bytes.length < 2 || bytes.length > 40) {
          throw new OperationError(
            `A witness program is 2 to 40 bytes; this is ${bytes.length}.`,
          );
        }
        if (version === 0 && bytes.length !== 20 && bytes.length !== 32) {
          throw new OperationError('A version 0 witness program must be 20 or 32 bytes.');
        }
        return bech32Encode(hrp, [version, ...toWords(bytes)], encoding);
      }
      return bech32Encode(hrp, toWords(bytes), encoding);
    },
  },
  {
    id: 'from-bech32',
    name: 'From Bech32',
    category: 'Data format',
    description: 'Decodes a Bech32 or Bech32m string and verifies its checksum.',
    aliases: ['bech32 decode', 'bitcoin address', 'bip350'],
    args: [
      {
        name: 'Encoding',
        type: 'option',
        value: 'Auto-detect',
        options: ['Auto-detect', 'Bech32', 'Bech32m'],
      },
      {
        name: 'Output format',
        type: 'option',
        value: 'Hex',
        options: ['Hex', 'Raw', 'Bitcoin scriptPubKey', 'HRP: Hex', 'JSON'],
      },
    ],
    run: (input, args) => {
      if (input.trim() === '') return '';
      const decoded = bech32Decode(input, String(arg(args, 'Encoding', 'Auto-detect')));
      const format = String(arg(args, 'Output format', 'Hex'));

      if (format === 'Raw') return bytesToLatin1(new Uint8Array(decoded.bytes));
      if (format === 'HRP: Hex') return `${decoded.hrp}: ${hex(decoded.bytes)}`;
      if (format === 'JSON') {
        return JSON.stringify(
          { hrp: decoded.hrp, encoding: decoded.encoding, data: hex(decoded.bytes) },
          null,
          2,
        );
      }
      if (format === 'Bitcoin scriptPubKey') {
        const version = decoded.witnessVersion;
        if (version === null || decoded.bytes.length < 2) return hex(decoded.bytes);
        const program = decoded.bytes.slice(1);
        const opcode = version === 0 ? 0x00 : 0x50 + version;
        return hex([opcode, program.length, ...program]);
      }
      return hex(decoded.bytes);
    },
    detection: {
      pattern: /^[a-z0-9]{1,83}1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,}$/,
      minLength: 14,
      formatName: 'Bech32',
    },
  },
  {
    id: 'to-braille',
    name: 'To Braille',
    category: 'Data format',
    description: 'Converts text to six-dot braille symbols.',
    aliases: ['braille encode', 'dots'],
    args: [],
    run: (input) =>
      Array.from(input, (char) => {
        const index = BRAILLE_ASCII.indexOf(char.toUpperCase());
        return index < 0 ? char : (BRAILLE_DOTS[index] as string);
      }).join(''),
  },
  {
    id: 'from-braille',
    name: 'From Braille',
    category: 'Data format',
    description: 'Converts six-dot braille symbols back to text.',
    aliases: ['braille decode'],
    args: [],
    run: (input) =>
      Array.from(input, (char) => {
        const index = BRAILLE_DOTS.indexOf(char);
        return index < 0 ? char : (BRAILLE_ASCII[index] as string);
      }).join(''),
    detection: {
      pattern: /^[⠀-⠿\s]+$/,
      minLength: 4,
      formatName: 'Braille',
    },
  },
  {
    id: 'to-modhex',
    name: 'To Modhex',
    category: 'Data format',
    description: 'Converts data to modhex, the alphabet YubiKeys type.',
    aliases: ['modhex encode', 'yubikey'],
    args: [
      { name: 'Delimiter', type: 'option', value: 'Space', options: MODHEX_DELIM_OPTIONS },
      { name: 'Bytes per line', type: 'number', value: 0, min: 0 },
    ],
    run: (input, args) => {
      const delimiter = MODHEX_DELIMITERS[String(arg(args, 'Delimiter', 'Space'))] ?? ' ';
      const perLine = Math.max(0, Number(arg(args, 'Bytes per line', 0)));
      const bytes = asBytes(input);

      const groups = Array.from(bytes, (byte) => {
        const high = MODHEX_ALPHABET[(byte >> 4) & 0xf] as string;
        return high + (MODHEX_ALPHABET[byte & 0xf] as string);
      });
      return groups
        .map((group, i) => {
          const last = i === groups.length - 1;
          if (last) return group;
          const wrap = perLine > 0 && (i + 1) % perLine === 0;
          return group + delimiter + (wrap ? '\n' : '');
        })
        .join('');
    },
  },
  {
    id: 'from-modhex',
    name: 'From Modhex',
    category: 'Data format',
    description: 'Converts a modhex string back into its raw bytes.',
    aliases: ['modhex decode', 'yubikey decode'],
    args: [],
    run: (input) => {
      const cleaned = input.toLowerCase().replace(/[^cbdefghijklnrtuv]/g, '');
      if (cleaned.length === 0) return '';
      if (cleaned.length % 2 !== 0) {
        throw new OperationError('Modhex needs an even number of characters.');
      }
      const out = new Uint8Array(cleaned.length / 2);
      for (let i = 0; i < out.length; i++) {
        const high = MODHEX_ALPHABET.indexOf(cleaned[i * 2] as string);
        const low = MODHEX_ALPHABET.indexOf(cleaned[i * 2 + 1] as string);
        out[i] = (high << 4) | low;
      }
      return bytesToLatin1(out);
    },
    detection: {
      pattern: /^(?:[cbdefghijklnrtuv]{2}[\s,;:]?)+$/i,
      minLength: 16,
      formatName: 'Modhex',
    },
  },
  {
    id: 'to-cobs',
    name: 'To COBS',
    category: 'Data format',
    description: 'Encodes bytes with consistent overhead byte stuffing.',
    aliases: ['cobs encode', 'byte stuffing'],
    args: [],
    run: (input) => bytesToLatin1(toCobs(asBytes(input))),
  },
  {
    id: 'from-cobs',
    name: 'From COBS',
    category: 'Data format',
    description: 'Decodes consistent overhead byte stuffing back to raw bytes.',
    aliases: ['cobs decode'],
    args: [],
    run: (input) => bytesToLatin1(fromCobs(asBytes(input))),
  },
];
