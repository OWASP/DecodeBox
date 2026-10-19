import { OperationError } from '../types';
import { asBytes, bytesToLatin1, latin1ToBytes } from '../core/bytes';
import { arg, type Operation } from './types';


interface Node {
  cls: number;
  constructed: boolean;
  tag: number;
  header: number;
  start: number;
  end: number;
  content: Uint8Array;
  children: Node[];
}

const MAX_ASN1_DEPTH = 40;

const UNIVERSAL_TAGS: Record<number, string> = {
  1: 'BOOLEAN',
  2: 'INTEGER',
  3: 'BIT STRING',
  4: 'OCTET STRING',
  5: 'NULL',
  6: 'OBJECT IDENTIFIER',
  10: 'ENUMERATED',
  12: 'UTF8String',
  16: 'SEQUENCE',
  17: 'SET',
  19: 'PrintableString',
  20: 'TeletexString',
  22: 'IA5String',
  23: 'UTCTime',
  24: 'GeneralizedTime',
  26: 'VisibleString',
  27: 'GeneralString',
  30: 'BMPString',
};

const OIDS: Record<string, string> = {
  '1.2.840.113549.1.1.1': 'rsaEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '1.2.840.113549.1.9.7': 'challengePassword',
  '1.2.840.113549.1.9.14': 'extensionRequest',
  '1.2.840.10040.4.1': 'dsa',
  '1.2.840.10040.4.3': 'dsaWithSha1',
  '1.2.840.10045.2.1': 'ecPublicKey',
  '1.2.840.10045.3.1.7': 'prime256v1',
  '1.2.840.10045.4.3.2': 'ecdsaWithSHA256',
  '1.2.840.10045.4.3.3': 'ecdsaWithSHA384',
  '1.2.840.10045.4.3.4': 'ecdsaWithSHA512',
  '1.3.132.0.34': 'secp384r1',
  '1.3.132.0.35': 'secp521r1',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
  '2.5.4.3': 'commonName',
  '2.5.4.4': 'surname',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'countryName',
  '2.5.4.7': 'localityName',
  '2.5.4.8': 'stateOrProvinceName',
  '2.5.4.9': 'streetAddress',
  '2.5.4.10': 'organizationName',
  '2.5.4.11': 'organizationalUnitName',
  '2.5.4.12': 'title',
  '2.5.4.15': 'businessCategory',
  '2.5.4.17': 'postalCode',
  '2.5.4.42': 'givenName',
  '2.5.29.14': 'subjectKeyIdentifier',
  '2.5.29.15': 'keyUsage',
  '2.5.29.17': 'subjectAltName',
  '2.5.29.19': 'basicConstraints',
  '2.5.29.31': 'cRLDistributionPoints',
  '2.5.29.32': 'certificatePolicies',
  '2.5.29.35': 'authorityKeyIdentifier',
  '2.5.29.37': 'extKeyUsage',
  '1.3.6.1.5.5.7.1.1': 'authorityInfoAccess',
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.4.1.11129.2.4.2': 'signedCertificateTimestampList',
  '0.9.2342.19200300.100.1.25': 'domainComponent',
};

const DN_SHORT: Record<string, string> = {
  commonName: 'CN',
  countryName: 'C',
  localityName: 'L',
  stateOrProvinceName: 'ST',
  organizationName: 'O',
  organizationalUnitName: 'OU',
  emailAddress: 'emailAddress',
  serialNumber: 'serialNumber',
  domainComponent: 'DC',
};

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const ASN1_INPUT_FORMATS = ['Auto', 'PEM', 'Hex', 'Base64', 'Raw'] as const;

export const ASN1_FORMAT_ARG = {
  name: 'Input format',
  type: 'option' as const,
  value: 'Auto',
  options: [...ASN1_INPUT_FORMATS],
  hint: 'Auto reads PEM, hex and raw DER. Say Base64 for a certificate pasted without its header.',
};

function fromBase64(text: string, what: string): Uint8Array {
  try {
    return latin1ToBytes(atob(text.replace(/[^A-Za-z0-9+/=]/g, '')));
  } catch {
    throw new OperationError(`${what} does not hold valid Base64.`);
  }
}

function fromHex(text: string): Uint8Array {
  const cleaned = text.replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length < 2 || cleaned.length % 2 !== 0) {
    throw new OperationError('Hex input must be a whole number of bytes.');
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.substr(i * 2, 2), 16);
  return out;
}

function parseHexInput(text: string, format = 'Auto'): Uint8Array {
  const pem = /-----BEGIN [^-]+-----([\s\S]*?)-----END [^-]+-----/.exec(text);

  if (format === 'PEM') {
    if (!pem) throw new OperationError('No -----BEGIN----- block found.');
    return fromBase64(pem[1] as string, 'The PEM block');
  }
  if (format === 'Hex') return fromHex(text);
  if (format === 'Base64') return fromBase64(text, 'The input');
  if (format === 'Raw') return asBytes(text);

  if (pem) return fromBase64(pem[1] as string, 'The PEM block');
  const cleaned = text.replace(/[^0-9a-fA-F]/g, '');
  if (cleaned.length >= 4 && cleaned.length % 2 === 0 && /^[0-9a-f\s]+$/i.test(text.trim())) {
    return fromHex(text);
  }
  const trimmed = text.trim();
  if (/^MI[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.replace(/\s/g, '').length >= 32) {
    return fromBase64(trimmed, 'The input');
  }
  return asBytes(text);
}


function parseNode(bytes: Uint8Array, at: number, depth: number): Node {
  if (depth > MAX_ASN1_DEPTH) throw new OperationError('ASN.1 nested too deeply.');
  if (at >= bytes.length) throw new OperationError('ASN.1 data ends inside a value.');

  const identifier = bytes[at] as number;
  const cls = identifier >> 6;
  const constructed = (identifier & 0x20) !== 0;
  let tag = identifier & 0x1f;
  let cursor = at + 1;

  if (tag === 0x1f) {
    tag = 0;
    for (;;) {
      const byte = bytes[cursor++];
      if (byte === undefined) throw new OperationError('ASN.1 tag runs off the end.');
      tag = (tag << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
  }

  const first = bytes[cursor++];
  if (first === undefined) throw new OperationError('ASN.1 length runs off the end.');
  let length: number;
  if (first < 0x80) {
    length = first;
  } else if (first === 0x80) {
    throw new OperationError('Indefinite lengths are BER, not DER.');
  } else {
    const count = first & 0x7f;
    if (count > 6) throw new OperationError('ASN.1 length field is implausibly large.');
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + (bytes[cursor++] ?? 0);
  }

  const end = cursor + length;
  if (end > bytes.length) {
    throw new OperationError(`A value claims ${length} bytes but only ${bytes.length - cursor} remain.`);
  }

  const node: Node = {
    cls,
    constructed,
    tag,
    header: at,
    start: cursor,
    end,
    content: bytes.subarray(cursor, end),
    children: [],
  };

  if (constructed) {
    let inner = cursor;
    while (inner < end) {
      const child = parseNode(bytes, inner, depth + 1);
      node.children.push(child);
      inner = child.end;
    }
  }
  return node;
}

function parseDer(bytes: Uint8Array): Node {
  if (bytes.length === 0) throw new OperationError('No data to parse.');
  return parseNode(bytes, 0, 0);
}


function decodeOid(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const first = bytes[0] as number;
  const parts = [Math.floor(first / 40), first % 40];
  let value = 0n;
  for (let i = 1; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    value = (value << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) {
      parts.push(Number(value));
      value = 0n;
    }
  }
  return parts.join('.');
}

function encodeOid(dotted: string): Uint8Array {
  const parts = dotted.trim().split('.').map(Number);
  if (parts.length < 2 || parts.some((p) => !Number.isInteger(p) || p < 0)) {
    throw new OperationError('An object identifier is a dotted list of whole numbers.');
  }
  const out: number[] = [(parts[0] as number) * 40 + (parts[1] as number)];
  for (const part of parts.slice(2)) {
    const groups: number[] = [];
    let value = part;
    do {
      groups.unshift(value & 0x7f);
      value >>>= 7;
    } while (value > 0);
    for (let i = 0; i < groups.length - 1; i++) groups[i] = (groups[i] as number) | 0x80;
    out.push(...groups);
  }
  return new Uint8Array(out);
}

function oidName(dotted: string): string {
  const name = OIDS[dotted];
  return name ? `${name} (${dotted})` : dotted;
}

function readInteger(node: Node): string {
  let value = 0n;
  const negative = ((node.content[0] as number) & 0x80) !== 0;
  for (const byte of node.content) value = (value << 8n) | BigInt(byte);
  if (negative) value -= 1n << BigInt(node.content.length * 8);
  return node.content.length > 8 ? `0x${hex(node.content)}` : value.toString();
}

function readTime(node: Node): string {
  const text = bytesToLatin1(node.content);
  const match = /^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z?$/.exec(text);
  if (!match) return text;
  const rawYear = match[1] as string;
  const year = rawYear.length === 2 ? (Number(rawYear) >= 50 ? 1900 : 2000) + Number(rawYear) : Number(rawYear);
  return `${year}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}Z`;
}

function nodeLabel(node: Node): string {
  if (node.cls === 2) return `[${node.tag}]`;
  if (node.cls !== 0) return `[class ${node.cls} tag ${node.tag}]`;
  return UNIVERSAL_TAGS[node.tag] ?? `[UNIVERSAL ${node.tag}]`;
}

function nodeValue(node: Node): string {
  if (node.constructed) return '';
  switch (node.cls === 0 ? node.tag : -1) {
    case 1:
      return node.content[0] ? 'true' : 'false';
    case 2:
    case 10:
      return readInteger(node);
    case 3: {
      const unused = node.content[0] ?? 0;
      return `${unused} unused bits, 0x${hex(node.content.subarray(1))}`;
    }
    case 5:
      return '';
    case 6:
      return oidName(decodeOid(node.content));
    case 12:
    case 19:
    case 20:
    case 22:
    case 26:
    case 27:
      return new TextDecoder().decode(node.content);
    case 23:
    case 24:
      return readTime(node);
    default:
      return `0x${hex(node.content)}`;
  }
}

function renderTree(node: Node, indent = ''): string {
  const value = nodeValue(node);
  const head = `${indent}${nodeLabel(node)} (${node.end - node.start} bytes)${value ? `: ${value}` : ''}`;
  if (node.children.length === 0) return head;
  return [head, ...node.children.map((child) => renderTree(child, `${indent}  `))].join('\n');
}


function findOid(node: Node): string | null {
  if (node.cls === 0 && node.tag === 6) return decodeOid(node.content);
  for (const child of node.children) {
    const found = findOid(child);
    if (found) return found;
  }
  return null;
}

function readName(node: Node): string {
  const parts: string[] = [];
  for (const rdn of node.children) {
    for (const pair of rdn.children) {
      const oid = pair.children[0];
      const value = pair.children[1];
      if (!oid || !value) continue;
      const name = OIDS[decodeOid(oid.content)] ?? decodeOid(oid.content);
      parts.push(`${DN_SHORT[name] ?? name}=${new TextDecoder().decode(value.content)}`);
    }
  }
  return parts.join(', ');
}

const KEY_USAGE = [
  'digitalSignature',
  'nonRepudiation',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
];

function readSubjectAltNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  const sequence = parseDer(bytes);
  for (const entry of sequence.children) {
    const text = bytesToLatin1(entry.content);
    switch (entry.tag) {
      case 1:
        names.push(`email:${text}`);
        break;
      case 2:
        names.push(`DNS:${text}`);
        break;
      case 6:
        names.push(`URI:${text}`);
        break;
      case 7:
        names.push(
          `IP:${entry.content.length === 4 ? Array.from(entry.content).join('.') : hex(entry.content)}`,
        );
        break;
      default:
        names.push(`[${entry.tag}]:${text}`);
    }
  }
  return names;
}

function describeExtension(oid: string, critical: boolean, value: Uint8Array): string {
  const name = OIDS[oid] ?? oid;
  const flag = critical ? ' (critical)' : '';

  try {
    switch (name) {
      case 'subjectAltName':
        return `${name}${flag}: ${readSubjectAltNames(value).join(', ')}`;
      case 'basicConstraints': {
        const node = parseDer(value);
        const ca = node.children[0]?.tag === 1 ? Boolean(node.children[0]?.content[0]) : false;
        const pathLen = node.children.find((c) => c.tag === 2);
        return `${name}${flag}: CA=${ca}${pathLen ? `, pathLenConstraint=${readInteger(pathLen)}` : ''}`;
      }
      case 'keyUsage': {
        const node = parseDer(value);
        const unused = node.content[0] ?? 0;
        const bits = node.content.subarray(1);
        const used: string[] = [];
        const total = bits.length * 8 - unused;
        for (let i = 0; i < total && i < KEY_USAGE.length; i++) {
          if ((bits[i >> 3] as number) & (0x80 >> i % 8)) used.push(KEY_USAGE[i] as string);
        }
        return `${name}${flag}: ${used.join(', ')}`;
      }
      case 'extKeyUsage': {
        const node = parseDer(value);
        return `${name}${flag}: ${node.children.map((c) => OIDS[decodeOid(c.content)] ?? decodeOid(c.content)).join(', ')}`;
      }
      case 'subjectKeyIdentifier':
        return `${name}${flag}: ${hex(parseDer(value).content)}`;
      default:
        return `${name}${flag}: 0x${hex(value).slice(0, 96)}${value.length > 48 ? '…' : ''}`;
    }
  } catch {
    return `${name}${flag}: 0x${hex(value).slice(0, 96)}`;
  }
}

function describePublicKey(node: Node): string[] {
  const algorithm = node.children[0];
  const keyBits = node.children[1];
  if (!algorithm || !keyBits) return ['Public key: unreadable'];

  const oid = findOid(algorithm) ?? '';
  const name = OIDS[oid] ?? oid;
  const lines = [`  Algorithm: ${name}`];

  if (name === 'rsaEncryption') {
    try {
      const inner = parseDer(keyBits.content.subarray(1));
      const modulus = inner.children[0];
      const exponent = inner.children[1];
      if (modulus) {
        const bits = (modulus.content.length - (modulus.content[0] === 0 ? 1 : 0)) * 8;
        lines.push(`  Key size: ${bits} bits`);
      }
      if (exponent) lines.push(`  Exponent: ${readInteger(exponent)}`);
    } catch {
      lines.push('  Key: could not be read');
    }
  } else if (name === 'ecPublicKey') {
    const curve = algorithm.children[1];
    if (curve && curve.tag === 6) lines.push(`  Curve: ${OIDS[decodeOid(curve.content)] ?? decodeOid(curve.content)}`);
    lines.push(`  Point: 0x${hex(keyBits.content.subarray(1)).slice(0, 64)}…`);
  }
  return lines;
}

function parseCertificate(bytes: Uint8Array): string {
  const certificate = parseDer(bytes);
  const tbs = certificate.children[0];
  const signatureAlgorithm = certificate.children[1];
  const signature = certificate.children[2];
  if (!tbs || !signatureAlgorithm || !signature) {
    throw new OperationError('This is not an X.509 certificate.');
  }

  const versioned = tbs.children[0]?.cls === 2 && tbs.children[0]?.tag === 0;
  const at = (index: number) => tbs.children[index + (versioned ? 1 : 0)];
  const version = versioned ? Number(readInteger(tbs.children[0]?.children[0] as Node)) + 1 : 1;

  const validity = at(3);
  const lines = [
    `Version: ${version}`,
    `Serial number: ${at(0) ? readInteger(at(0) as Node) : '?'}`,
    `Signature algorithm: ${oidName(findOid(signatureAlgorithm) ?? '')}`,
    `Issuer: ${at(2) ? readName(at(2) as Node) : '?'}`,
    `Not before: ${validity?.children[0] ? readTime(validity.children[0]) : '?'}`,
    `Not after:  ${validity?.children[1] ? readTime(validity.children[1]) : '?'}`,
    `Subject: ${at(4) ? readName(at(4) as Node) : '?'}`,
    'Public key:',
  ];
  const key = at(5);
  if (key) lines.push(...describePublicKey(key));

  const extensions = tbs.children.find((child) => child.cls === 2 && child.tag === 3);
  if (extensions?.children[0]) {
    lines.push('Extensions:');
    for (const extension of extensions.children[0].children) {
      const oid = extension.children[0];
      const critical = extension.children[1]?.tag === 1 && Boolean(extension.children[1]?.content[0]);
      const value = extension.children[extension.children.length - 1];
      if (!oid || !value) continue;
      lines.push(`  ${describeExtension(decodeOid(oid.content), critical, value.content)}`);
    }
  }
  lines.push(`Signature: 0x${hex(signature.content.subarray(1)).slice(0, 64)}…`);
  return lines.join('\n');
}


function parseSshKey(input: string): string {
  const match = /(?:^|\s)(AAAA[A-Za-z0-9+/=]+)/.exec(input.trim());
  if (!match) throw new OperationError('No Base64 SSH key found.');

  let bytes: Uint8Array;
  try {
    bytes = latin1ToBytes(atob(match[1] as string));
  } catch {
    throw new OperationError('The key is not valid Base64.');
  }

  const fields: Uint8Array[] = [];
  let at = 0;
  while (at + 4 <= bytes.length) {
    const length = ((bytes[at] as number) << 24) | ((bytes[at + 1] as number) << 16) | ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
    at += 4;
    if (length < 0 || at + length > bytes.length) break;
    fields.push(bytes.subarray(at, at + length));
    at += length;
  }
  if (fields.length === 0) throw new OperationError('The key has no readable fields.');

  const type = bytesToLatin1(fields[0] as Uint8Array);
  const lines = [`Key type: ${type}`];

  if (type.startsWith('ssh-rsa')) {
    const modulus = fields[2];
    if (modulus) {
      lines.push(`Key size: ${(modulus.length - (modulus[0] === 0 ? 1 : 0)) * 8} bits`);
      lines.push(`Exponent: 0x${hex(fields[1] as Uint8Array)}`);
    }
  } else if (type.startsWith('ecdsa-sha2')) {
    lines.push(`Curve: ${bytesToLatin1(fields[1] ?? new Uint8Array())}`);
    lines.push(`Point: 0x${hex(fields[2] ?? new Uint8Array())}`);
  } else if (type.startsWith('ssh-ed25519')) {
    lines.push(`Public key: 0x${hex(fields[1] ?? new Uint8Array())}`);
  }
  lines.push(`Fields: ${fields.length}`);
  return lines.join('\n');
}

export const asn1Operations: Operation[] = [
  {
    id: 'parse-asn1',
    name: 'Parse ASN.1 hex string',
    category: 'Public Key',
    description: 'Renders DER-encoded data as the tag, length and value tree it is.',
    aliases: ['asn1', 'der', 'ber', 'tlv tree'],
    args: [
      ASN1_FORMAT_ARG,
      { name: 'Starting offset', type: 'number', value: 0, min: 0 },
    ],
    run: (input, args) => {
      const bytes = parseHexInput(input, String(arg(args, 'Input format', 'Auto')));
      const offset = Math.max(0, Number(arg(args, 'Starting offset', 0)));
      return renderTree(parseDer(bytes.subarray(offset)));
    },
  },
  {
    id: 'hex-to-object-identifier',
    name: 'Hex to Object Identifier',
    category: 'Public Key',
    description: 'Decodes the DER encoding of an object identifier into dotted form.',
    aliases: ['oid decode', 'object id'],
    args: [ASN1_FORMAT_ARG],
    run: (input, args) => {
      const bytes = parseHexInput(input, String(arg(args, 'Input format', 'Auto')));
      const content = bytes[0] === 0x06 ? bytes.subarray(2, 2 + (bytes[1] ?? 0)) : bytes;
      const dotted = decodeOid(content);
      if (dotted === '') throw new OperationError('No object identifier found.');
      return dotted;
    },
  },
  {
    id: 'object-identifier-to-hex',
    name: 'Object Identifier to Hex',
    category: 'Public Key',
    description: 'Encodes a dotted object identifier as its DER bytes.',
    aliases: ['oid encode'],
    args: [],
    run: (input) => hex(encodeOid(input)),
  },
  {
    id: 'parse-x509-certificate',
    name: 'Parse X.509 certificate',
    category: 'Public Key',
    description: 'Reads a certificate and reports its names, validity, key and extensions.',
    aliases: ['certificate', 'x509', 'ssl cert', 'tls cert'],
    args: [ASN1_FORMAT_ARG],
    run: (input, args) =>
      parseCertificate(parseHexInput(input, String(arg(args, 'Input format', 'Auto')))),
    detection: {
      pattern: /-----BEGIN CERTIFICATE-----/,
      minLength: 60,
      formatName: 'X.509 certificate',
    },
  },
  {
    id: 'parse-csr',
    name: 'Parse CSR',
    category: 'Public Key',
    description: 'Reads a certificate signing request and reports what it asks for.',
    aliases: ['certificate request', 'pkcs10'],
    args: [ASN1_FORMAT_ARG],
    run: (input, args) => {
      const request = parseDer(parseHexInput(input, String(arg(args, 'Input format', 'Auto'))));
      const info = request.children[0];
      if (!info) throw new OperationError('This is not a certificate signing request.');

      const lines = [
        `Version: ${info.children[0] ? Number(readInteger(info.children[0])) + 1 : '?'}`,
        `Subject: ${info.children[1] ? readName(info.children[1]) : '?'}`,
        'Public key:',
      ];
      if (info.children[2]) lines.push(...describePublicKey(info.children[2]));
      lines.push(
        `Signature algorithm: ${oidName(findOid(request.children[1] as Node) ?? '')}`,
      );
      return lines.join('\n');
    },
    detection: {
      pattern: /-----BEGIN CERTIFICATE REQUEST-----/,
      minLength: 60,
      formatName: 'PKCS#10 request',
    },
  },
  {
    id: 'parse-x509-crl',
    name: 'Parse X.509 CRL',
    category: 'Public Key',
    description: 'Reads a certificate revocation list and lists what it revokes.',
    aliases: ['crl', 'revocation'],
    args: [ASN1_FORMAT_ARG],
    run: (input, args) => {
      const crl = parseDer(parseHexInput(input, String(arg(args, 'Input format', 'Auto'))));
      const list = crl.children[0];
      if (!list) throw new OperationError('This is not a certificate revocation list.');

      const versioned = list.children[0]?.tag === 2;
      const at = (index: number) => list.children[index + (versioned ? 1 : 0)];
      const lines = [
        `Version: ${versioned ? Number(readInteger(list.children[0] as Node)) + 1 : 1}`,
        `Signature algorithm: ${oidName(findOid(at(0) as Node) ?? '')}`,
        `Issuer: ${at(1) ? readName(at(1) as Node) : '?'}`,
        `This update: ${at(2) ? readTime(at(2) as Node) : '?'}`,
      ];
      const nextUpdate = at(3);
      if (nextUpdate && (nextUpdate.tag === 23 || nextUpdate.tag === 24)) {
        lines.push(`Next update: ${readTime(nextUpdate)}`);
      }

      const revoked = list.children.find((child) => child.tag === 16 && child.children.length > 0 && child.children[0]?.children.length === 2);
      if (!revoked || revoked.children.length === 0) {
        lines.push('Revoked certificates: none');
        return lines.join('\n');
      }
      lines.push(`Revoked certificates: ${revoked.children.length}`);
      for (const entry of revoked.children.slice(0, 50)) {
        const serial = entry.children[0];
        const date = entry.children[1];
        lines.push(
          `  ${serial ? readInteger(serial) : '?'} revoked ${date ? readTime(date) : '?'}`,
        );
      }
      if (revoked.children.length > 50) lines.push(`  … and ${revoked.children.length - 50} more`);
      return lines.join('\n');
    },
    detection: {
      pattern: /-----BEGIN X509 CRL-----/,
      minLength: 60,
      formatName: 'X.509 CRL',
    },
  },
  {
    id: 'public-key-from-certificate',
    name: 'Public Key from Certificate',
    category: 'Public Key',
    description: 'Extracts the subject public key from a certificate as PEM.',
    aliases: ['extract public key', 'cert public key'],
    args: [ASN1_FORMAT_ARG],
    run: (input, args) => {
      const bytes = parseHexInput(input, String(arg(args, 'Input format', 'Auto')));
      const certificate = parseDer(bytes);
      const tbs = certificate.children[0];
      if (!tbs) throw new OperationError('This is not an X.509 certificate.');

      const versioned = tbs.children[0]?.cls === 2 && tbs.children[0]?.tag === 0;
      const key = tbs.children[5 + (versioned ? 1 : 0)];
      if (!key) throw new OperationError('The certificate has no subject public key.');

      const der = bytes.subarray(key.header, key.end);
      const base64 = btoa(bytesToLatin1(der));
      const lines = base64.match(/.{1,64}/g) ?? [];
      return ['-----BEGIN PUBLIC KEY-----', ...lines, '-----END PUBLIC KEY-----', ''].join('\n');
    },
  },
  {
    id: 'parse-ssh-host-key',
    name: 'Parse SSH Host Key',
    category: 'Public Key',
    description: 'Reads an SSH public key and reports its type and size.',
    aliases: ['ssh key', 'authorized_keys', 'host key'],
    args: [
      {
        name: 'Output',
        type: 'option',
        value: 'Report',
        options: ['Report', 'Fingerprint only'],
        hint: 'The fingerprint alone is what you compare against a known-hosts entry.',
      },
    ],
    run: (input, args) => {
      const report = parseSshKey(input);
      if (arg(args, 'Output', 'Report') === 'Report') return report;
      const line = report.split('\n').find((l) => /fingerprint/i.test(l));
      if (!line) throw new OperationError('No fingerprint in the parsed key.');
      return line.split(/:\s+/).slice(1).join(': ').trim();
    },
    detection: {
      pattern: /(ssh-rsa|ssh-ed25519|ecdsa-sha2-\w+)\s+AAAA[A-Za-z0-9+/=]+/,
      minLength: 40,
      formatName: 'SSH public key',
    },
  },
];
