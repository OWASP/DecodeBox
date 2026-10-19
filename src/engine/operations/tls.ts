import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { md5 } from './hashing';
import { arg, type Operation } from './types';


const INPUT_FORMATS = ['Hex', 'Raw'];
const OUTPUT_FORMATS = ['Hash digest', 'Fingerprint string', 'Full details'];

function handshakeBytes(input: string, format: string): Uint8Array {
  if (format === 'Hex') {
    const cleaned = input.replace(/[^0-9a-fA-F]/g, '');
    if (cleaned.length % 2 !== 0) throw new OperationError('Hex input has an odd number of digits.');
    const out = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.substr(i * 2, 2), 16);
    return out;
  }
  return asBytes(input);
}

function inputArgs() {
  return [
    { name: 'Input format', type: 'option' as const, value: 'Hex', options: INPUT_FORMATS },
    { name: 'Output format', type: 'option' as const, value: 'Hash digest', options: OUTPUT_FORMATS },
  ];
}

class Cursor {
  at = 0;

  constructor(readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.at;
  }

  int(width: number): number {
    if (this.remaining < width) throw new OperationError('The handshake ends mid-field.');
    let value = 0;
    for (let i = 0; i < width; i++) value = value * 256 + (this.bytes[this.at++] as number);
    return value;
  }

  take(count: number): Uint8Array {
    if (count < 0 || this.remaining < count) {
      throw new OperationError(`A field claims ${count} bytes but only ${this.remaining} remain.`);
    }
    const slice = this.bytes.subarray(this.at, this.at + count);
    this.at += count;
    return slice;
  }

  skip(count: number): void {
    this.take(count);
  }

  text(count: number): string {
    return bytesToLatin1(this.take(count));
  }
}

function isGrease(value: number): boolean {
  return (value & 0x0f0f) === 0x0a0a && (value >> 8) === (value & 0xff);
}

function joinNonGrease(bytes: Uint8Array, width: number): string {
  const values: number[] = [];
  const cursor = new Cursor(bytes);
  while (cursor.remaining >= width) {
    const value = cursor.int(width);
    if (!isGrease(value)) values.push(value);
  }
  return values.join('-');
}

interface ClientHello {
  version: number;
  ciphers: Uint8Array;
  extensions: Array<{ type: number; body: Uint8Array }>;
}

function readClientHello(bytes: Uint8Array): ClientHello {
  const cursor = new Cursor(bytes);
  if (cursor.int(1) !== 0x16) throw new OperationError('This is not TLS handshake data.');
  cursor.skip(2);
  const recordLength = cursor.int(2);
  if (bytes.length !== recordLength + 5) {
    throw new OperationError('The record length does not match the data.');
  }
  if (cursor.int(1) !== 1) throw new OperationError('This is not a Client Hello.');
  cursor.int(3);

  const version = cursor.int(2);
  cursor.skip(32);
  cursor.skip(cursor.int(1));

  const ciphers = cursor.take(cursor.int(2));
  cursor.skip(cursor.int(1));

  const extensions: Array<{ type: number; body: Uint8Array }> = [];
  if (cursor.remaining >= 2) {
    const block = new Cursor(cursor.take(cursor.int(2)));
    while (block.remaining >= 4) {
      const type = block.int(2);
      extensions.push({ type, body: block.take(block.int(2)) });
    }
  }
  return { version, ciphers, extensions };
}

function fingerprintOutput(format: string, hash: string, text: string, details: string): string {
  if (format === 'Fingerprint string') return text;
  if (format === 'Full details') return details;
  return hash;
}


const JA4_VERSIONS: Record<number, string> = {
  0x0304: '13',
  0x0303: '12',
  0x0302: '11',
  0x0301: '10',
  0x0300: 's3',
  0x0002: 's2',
};

async function truncatedSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, JA4_TRUNCATION);
}

const JA4_TRUNCATION = 12;

function hex4(value: number): string {
  return value.toString(16).padStart(4, '0');
}

function pad2(count: number): string {
  return String(Math.min(99, count)).padStart(2, '0');
}

function hexList(bytes: Uint8Array): string {
  const values: string[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    values.push(hex4(((bytes[i] as number) << 8) | (bytes[i + 1] as number)));
  }
  return values.join(',');
}

function highestSupportedVersion(body: Uint8Array, fallback: number): number {
  if (body.length === 2) return ((body[0] as number) << 8) | (body[1] as number);

  const outer = new Cursor(body);
  const list = new Cursor(outer.take(Math.min(outer.int(1), outer.remaining)));
  let highest = 0;
  while (list.remaining >= 2) {
    const offered = list.int(2);
    if (!isGrease(offered) && offered > highest) highest = offered;
  }
  return highest === 0 ? fallback : highest;
}

function firstAlpnValue(body: Uint8Array): Uint8Array | null {
  const cursor = new Cursor(body);
  if (cursor.int(2) < 2) return null;
  const length = cursor.int(1);
  return length < 1 ? null : cursor.take(length);
}

function isAlphanumericByte(byte: number): boolean {
  return (
    (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a)
  );
}

function alpnFingerprint(value: Uint8Array | null): string {
  if (!value || value.length === 0) return '00';
  const first = value[0] as number;
  const last = value[value.length - 1] as number;
  if (isAlphanumericByte(first) && isAlphanumericByte(last)) {
    return String.fromCharCode(first) + String.fromCharCode(last);
  }
  return first.toString(16).padStart(2, '0')[0]! + last.toString(16).padStart(2, '0')[1]!;
}


const WIRE_TYPES: Record<number, string> = {
  0: 'varint',
  1: '64-bit',
  2: 'length-delimited',
  3: 'start group',
  4: 'end group',
  5: '32-bit',
};

interface ProtoField {
  field: number;
  type: string;
  value: unknown;
}

function decodeProtobuf(bytes: Uint8Array, depth = 0): ProtoField[] {
  if (depth > 20) throw new OperationError('Protobuf nested too deeply.');
  const cursor = new Cursor(bytes);
  const fields: ProtoField[] = [];

  const varint = (): bigint => {
    let value = 0n;
    let shift = 0n;
    for (;;) {
      const byte = cursor.int(1);
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
      if (shift > 70n) throw new OperationError('A varint never terminates.');
    }
  };

  while (cursor.remaining > 0) {
    const key = Number(varint());
    const field = key >>> 3;
    const wire = key & 7;
    const type = WIRE_TYPES[wire] ?? `unknown (${wire})`;

    switch (wire) {
      case 0:
        fields.push({ field, type, value: varint().toString() });
        break;
      case 1:
        fields.push({ field, type, value: `0x${bytesToHex(cursor.take(8))}` });
        break;
      case 5:
        fields.push({ field, type, value: `0x${bytesToHex(cursor.take(4))}` });
        break;
      case 2: {
        const body = cursor.take(Number(varint()));
        let value: unknown;
        try {
          const nested = decodeProtobuf(body, depth + 1);
          value = nested.length > 0 ? nested : `0x${bytesToHex(body)}`;
        } catch {
          const text = new TextDecoder('utf-8', { fatal: true });
          try {
            value = text.decode(body);
          } catch {
            value = `0x${bytesToHex(body)}`;
          }
        }
        fields.push({ field, type, value });
        break;
      }
      default:
        throw new OperationError(`Wire type ${wire} cannot be read without a schema.`);
    }
  }
  return fields;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}


const TLS_CONTENT_TYPES: Record<number, string> = {
  20: 'Change cipher spec',
  21: 'Alert',
  22: 'Handshake',
  23: 'Application data',
  24: 'Heartbeat',
};

const TLS_HANDSHAKE_TYPES: Record<number, string> = {
  0: 'Hello request',
  1: 'Client hello',
  2: 'Server hello',
  4: 'New session ticket',
  8: 'Encrypted extensions',
  11: 'Certificate',
  12: 'Server key exchange',
  13: 'Certificate request',
  14: 'Server hello done',
  15: 'Certificate verify',
  16: 'Client key exchange',
  20: 'Finished',
};

const TLS_VERSIONS: Record<number, string> = {
  0x0300: 'SSL 3.0',
  0x0301: 'TLS 1.0',
  0x0302: 'TLS 1.1',
  0x0303: 'TLS 1.2',
  0x0304: 'TLS 1.3',
};

export const tlsOperations: Operation[] = [
  {
    id: 'parse-tls-record',
    name: 'Parse TLS record',
    category: 'Networking',
    description: 'Reads the record headers of a TLS stream and names each message.',
    aliases: ['tls', 'ssl', 'handshake'],
    args: [{ name: 'Input format', type: 'option', value: 'Hex', options: INPUT_FORMATS }],
    run: (input, args) => {
      const bytes = handshakeBytes(input, String(arg(args, 'Input format', 'Hex')));
      const cursor = new Cursor(bytes);
      const lines: string[] = [];

      while (cursor.remaining >= 5) {
        const type = cursor.int(1);
        const version = cursor.int(2);
        const length = cursor.int(2);
        lines.push(
          `Record: ${TLS_CONTENT_TYPES[type] ?? `unknown (${type})`}, ` +
            `${TLS_VERSIONS[version] ?? `version 0x${version.toString(16)}`}, ${length} bytes`,
        );

        const body = cursor.take(Math.min(length, cursor.remaining));
        if (type === 22 && body.length >= 4) {
          const handshake = new Cursor(body);
          while (handshake.remaining >= 4) {
            const messageType = handshake.int(1);
            const messageLength = handshake.int(3);
            lines.push(
              `  ${TLS_HANDSHAKE_TYPES[messageType] ?? `unknown handshake (${messageType})`}, ${messageLength} bytes`,
            );
            if (messageLength > handshake.remaining) break;
            handshake.skip(messageLength);
          }
        }
      }
      if (lines.length === 0) throw new OperationError('No complete TLS record found.');
      return lines.join('\n');
    },
    detection: {
      magic: '160301',
      minLength: 16,
      formatName: 'TLS record',
    },
  },
  {
    id: 'ja3-fingerprint',
    name: 'JA3 Fingerprint',
    category: 'Networking',
    description: 'Fingerprints a TLS Client Hello the way JA3 does.',
    aliases: ['ja3', 'client fingerprint', 'tls fingerprint'],
    args: inputArgs(),
    run: (input, args) => {
      const hello = readClientHello(
        handshakeBytes(input, String(arg(args, 'Input format', 'Hex'))),
      );

      let curves = '';
      let pointFormats = '';
      const types: number[] = [];
      for (const extension of hello.extensions) {
        if (extension.type === 0x0a) {
          const body = new Cursor(extension.body);
          curves = joinNonGrease(body.take(body.int(2)), 2);
        } else if (extension.type === 0x0b) {
          const body = new Cursor(extension.body);
          pointFormats = joinNonGrease(body.take(body.int(1)), 1);
        }
        if (!isGrease(extension.type)) types.push(extension.type);
      }

      const ciphers = joinNonGrease(hello.ciphers, 2);
      const text = [String(hello.version), ciphers, types.join('-'), curves, pointFormats].join(',');
      const hash = md5(new TextEncoder().encode(text));

      return fingerprintOutput(
        String(arg(args, 'Output format', 'Hash digest')),
        hash,
        text,
        [
          `Hash digest:\n${hash}`,
          `\nFull JA3 string:\n${text}`,
          `\nTLS version:\n${hello.version}`,
          `\nCipher suites:\n${ciphers}`,
          `\nExtensions:\n${types.join('-')}`,
          `\nElliptic curves:\n${curves}`,
          `\nElliptic curve point formats:\n${pointFormats}`,
        ].join('\n'),
      );
    },
  },
  {
    id: 'ja3s-fingerprint',
    name: 'JA3S Fingerprint',
    category: 'Networking',
    description: 'Fingerprints a TLS Server Hello the way JA3S does.',
    aliases: ['ja3s', 'server fingerprint'],
    args: inputArgs(),
    run: (input, args) => {
      const bytes = handshakeBytes(input, String(arg(args, 'Input format', 'Hex')));
      const cursor = new Cursor(bytes);
      if (cursor.int(1) !== 0x16) throw new OperationError('This is not TLS handshake data.');
      cursor.skip(2);
      const recordLength = cursor.int(2);
      if (bytes.length !== recordLength + 5) {
        throw new OperationError('The record length does not match the data.');
      }
      if (cursor.int(1) !== 2) throw new OperationError('This is not a Server Hello.');
      cursor.int(3);

      const version = cursor.int(2);
      cursor.skip(32);
      cursor.skip(cursor.int(1));
      const cipher = cursor.int(2);
      cursor.skip(1);

      const types: number[] = [];
      if (cursor.remaining >= 2) {
        const block = new Cursor(cursor.take(cursor.int(2)));
        while (block.remaining >= 4) {
          types.push(block.int(2));
          block.skip(block.int(2));
        }
      }

      const text = [String(version), String(cipher), types.join('-')].join(',');
      const hash = md5(new TextEncoder().encode(text));
      return fingerprintOutput(
        String(arg(args, 'Output format', 'Hash digest')),
        hash,
        text,
        `Hash digest:\n${hash}\n\nFull JA3S string:\n${text}\n\nTLS version:\n${version}\nCipher suite:\n${cipher}\nExtensions:\n${types.join('-')}`,
      );
    },
  },
  {
    id: 'hassh-client-fingerprint',
    name: 'HASSH Client Fingerprint',
    category: 'Networking',
    description: 'Fingerprints an SSH client from the algorithms it offers.',
    aliases: ['hassh', 'ssh fingerprint'],
    args: inputArgs(),
    run: (input, args) => hassh(input, args, true),
  },
  {
    id: 'hassh-server-fingerprint',
    name: 'HASSH Server Fingerprint',
    category: 'Networking',
    description: 'Fingerprints an SSH server from the algorithms it offers.',
    aliases: ['hasshserver', 'ssh server fingerprint'],
    args: inputArgs(),
    run: (input, args) => hassh(input, args, false),
  },
  {
    id: 'ja4-fingerprint',
    name: 'JA4 Fingerprint',
    category: 'Networking',
    description: 'Fingerprints a TLS Client Hello the way JA4 does.',
    aliases: ['ja4', 'tls client fingerprint'],
    args: [
      { name: 'Input format', type: 'option', value: 'Hex', options: INPUT_FORMATS },
      {
        name: 'Output format',
        type: 'option',
        value: 'JA4',
        options: ['JA4', 'JA4 Original Rendering', 'JA4 Raw', 'JA4 Original Rendering Raw'],
      },
    ],
    run: async (input, args) => {
      const hello = readClientHello(
        handshakeBytes(input, String(arg(args, 'Input format', 'Hex'))),
      );

      let version = hello.version;
      let alpn = '00';
      let sni = false;
      let signatureAlgorithms = '';
      const extensionList: string[] = [];

      for (const extension of hello.extensions) {
        if (extension.type === 0x2b) version = highestSupportedVersion(extension.body, version);
        if (extension.type === 0x00) sni = true;
        if (extension.type === 0x10) alpn = alpnFingerprint(firstAlpnValue(extension.body));
        if (extension.type === 0x0d) signatureAlgorithms = hexList(extension.body.subarray(2));
        if (!isGrease(extension.type)) extensionList.push(hex4(extension.type));
      }

      const cipherList: string[] = [];
      const ciphers = new Cursor(hello.ciphers);
      while (ciphers.remaining >= 2) {
        const value = ciphers.int(2);
        if (!isGrease(value)) cipherList.push(hex4(value));
      }

      const prefix =
        't' +
        (JA4_VERSIONS[version] ?? '00') +
        (sni ? 'd' : 'i') +
        pad2(cipherList.length) +
        pad2(extensionList.length) +
        alpn;

      const sortedExtensions = [...extensionList]
        .filter((value) => value !== '0000' && value !== '0010')
        .sort();

      const sortedCiphersRaw = [...cipherList].sort().join(',');
      const originalCiphersRaw = cipherList.join(',');
      const sortedExtensionsRaw = `${sortedExtensions.join(',')}_${signatureAlgorithms}`;
      const originalExtensionsRaw = `${extensionList.join(',')}_${signatureAlgorithms}`;

      switch (String(arg(args, 'Output format', 'JA4'))) {
        case 'JA4 Raw':
          return `${prefix}_${sortedCiphersRaw}_${sortedExtensionsRaw}`;
        case 'JA4 Original Rendering Raw':
          return `${prefix}_${originalCiphersRaw}_${originalExtensionsRaw}`;
        case 'JA4 Original Rendering':
          return `${prefix}_${await truncatedSha256(originalCiphersRaw)}_${await truncatedSha256(originalExtensionsRaw)}`;
        default:
          return `${prefix}_${await truncatedSha256(sortedCiphersRaw)}_${await truncatedSha256(sortedExtensionsRaw)}`;
      }
    },
  },
  {
    id: 'ja4server-fingerprint',
    name: 'JA4Server Fingerprint',
    category: 'Networking',
    description: 'Fingerprints a TLS Server Hello the way JA4S does.',
    aliases: ['ja4s', 'tls server fingerprint'],
    args: [
      { name: 'Input format', type: 'option', value: 'Hex', options: INPUT_FORMATS },
      { name: 'Output format', type: 'option', value: 'JA4S', options: ['JA4S', 'JA4S Raw'] },
    ],
    run: async (input, args) => {
      const bytes = handshakeBytes(input, String(arg(args, 'Input format', 'Hex')));
      const cursor = new Cursor(bytes);
      if (cursor.int(1) !== 0x16) throw new OperationError('This is not TLS handshake data.');
      cursor.skip(2);
      cursor.int(2);
      if (cursor.int(1) !== 2) throw new OperationError('This is not a Server Hello.');
      cursor.int(3);

      let version = cursor.int(2);
      cursor.skip(32);
      cursor.skip(cursor.int(1));
      const cipher = cursor.int(2);
      cursor.skip(1);

      let alpn = '00';
      const extensionList: string[] = [];
      if (cursor.remaining >= 2) {
        const block = new Cursor(cursor.take(cursor.int(2)));
        while (block.remaining >= 4) {
          const type = block.int(2);
          const body = block.take(block.int(2));
          if (type === 0x2b) version = highestSupportedVersion(body, version);
          if (type === 0x10) alpn = alpnFingerprint(firstAlpnValue(body));
          extensionList.push(hex4(type));
        }
      }

      const prefix = `t${JA4_VERSIONS[version] ?? '00'}${pad2(extensionList.length)}${alpn}`;
      const extensionsRaw = extensionList.join(',');
      return String(arg(args, 'Output format', 'JA4S')) === 'JA4S Raw'
        ? `${prefix}_${hex4(cipher)}_${extensionsRaw}`
        : `${prefix}_${hex4(cipher)}_${await truncatedSha256(extensionsRaw)}`;
    },
  },
  {
    id: 'protobuf-decode',
    name: 'Protobuf Decode',
    category: 'Networking',
    description: 'Decodes a Protobuf message into its field numbers, wire types and values.',
    aliases: ['protocol buffers', 'protobuf', 'grpc'],
    args: [
      {
        name: 'Indent',
        type: 'number',
        value: 2,
        min: 0,
        max: 8,
        hint: 'Zero writes it on one line, for feeding into the next step.',
      },
    ],
    run: (input, args) =>
      JSON.stringify(
        decodeProtobuf(asBytes(input)),
        null,
        Math.max(0, Math.min(8, Number(arg(args, 'Indent', 2)))),
      ),
  },
  {
    id: 'protobuf-encode',
    name: 'Protobuf Encode',
    category: 'Networking',
    description: 'Encodes a list of field numbers, wire types and values as Protobuf.',
    aliases: ['protobuf encode', 'protocol buffers encode'],
    args: [],
    run: (input) => {
      let fields: ProtoField[];
      try {
        fields = JSON.parse(input) as ProtoField[];
      } catch {
        throw new OperationError('Input must be the JSON that Protobuf Decode produces.');
      }
      if (!Array.isArray(fields)) throw new OperationError('Expected a list of fields.');

      const out: number[] = [];
      const writeVarint = (value: bigint) => {
        let remaining = value;
        while (remaining >= 0x80n) {
          out.push(Number(remaining & 0x7fn) | 0x80);
          remaining >>= 7n;
        }
        out.push(Number(remaining));
      };

      for (const entry of fields) {
        const wire = Object.entries(WIRE_TYPES).find(([, name]) => name === entry.type)?.[0];
        if (wire === undefined) throw new OperationError(`'${entry.type}' is not a wire type.`);
        writeVarint(BigInt(entry.field) * 8n + BigInt(wire));

        if (wire === '0') {
          writeVarint(BigInt(String(entry.value)));
        } else if (wire === '2') {
          const text = String(entry.value);
          const body = /^0x[0-9a-f]*$/i.test(text)
            ? new Uint8Array((text.slice(2).match(/../g) ?? []).map((p) => parseInt(p, 16)))
            : new TextEncoder().encode(text);
          writeVarint(BigInt(body.length));
          out.push(...body);
        } else {
          const text = String(entry.value).replace(/^0x/i, '');
          const body = (text.match(/../g) ?? []).map((p) => parseInt(p, 16));
          out.push(...body);
        }
      }
      return bytesToLatin1(new Uint8Array(out));
    },
  },
];

function hassh(input: string, args: Parameters<Operation['run']>[1], client: boolean): string {
  const bytes = handshakeBytes(input, String(arg(args, 'Input format', 'Hex')));
  const cursor = new Cursor(bytes);

  const packetLength = cursor.int(4);
  if (bytes.length !== packetLength + 4) throw new OperationError('The packet length is wrong.');
  cursor.int(1);
  if (cursor.int(1) !== 20) throw new OperationError('This is not a Key Exchange Init.');
  cursor.skip(16);

  const list = () => cursor.text(cursor.int(4));
  const kex = list();
  list(); 
  const encryptionC2S = list();
  const encryptionS2C = list();
  const macC2S = list();
  const macS2C = list();
  const compressionC2S = list();
  const compressionS2C = list();

  const parts = client
    ? [kex, encryptionC2S, macC2S, compressionC2S]
    : [kex, encryptionS2C, macS2C, compressionS2C];
  const text = parts.join(';');
  const hash = md5(new TextEncoder().encode(text));

  return fingerprintOutput(
    String(arg(args, 'Output format', 'Hash digest')),
    hash,
    text,
    `Hash digest:\n${hash}\n\nFull HASSH string:\n${text}\n\nKey exchange algorithms:\n${parts[0]}\nEncryption algorithms:\n${parts[1]}\nMAC algorithms:\n${parts[2]}\nCompression algorithms:\n${parts[3]}`,
  );
}
