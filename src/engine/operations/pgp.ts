import { OperationError } from '../types';
import { asBytes } from '../core/bytes';
import { arg, type Operation } from './types';


const ARMOR = /-----BEGIN PGP ([A-Z ]+)-----([\s\S]*?)-----END PGP \1-----/;

const PACKET_NAMES: Record<number, string> = {
  1: 'Public-key encrypted session key',
  2: 'Signature',
  3: 'Symmetric-key encrypted session key',
  4: 'One-pass signature',
  5: 'Secret key',
  6: 'Public key',
  7: 'Secret subkey',
  8: 'Compressed data',
  9: 'Symmetrically encrypted data',
  10: 'Marker',
  11: 'Literal data',
  12: 'Trust',
  13: 'User ID',
  14: 'Public subkey',
  17: 'User attribute',
  18: 'Symmetrically encrypted and integrity protected data',
  19: 'Modification detection code',
};

const PUBLIC_KEY_ALGORITHMS: Record<number, string> = {
  1: 'RSA (encrypt or sign)',
  2: 'RSA (encrypt only)',
  3: 'RSA (sign only)',
  16: 'Elgamal (encrypt only)',
  17: 'DSA',
  18: 'ECDH',
  19: 'ECDSA',
  22: 'EdDSA',
};

const HASH_ALGORITHMS: Record<number, string> = {
  1: 'MD5',
  2: 'SHA-1',
  3: 'RIPEMD-160',
  8: 'SHA-256',
  9: 'SHA-384',
  10: 'SHA-512',
  11: 'SHA-224',
};

const SIGNATURE_TYPES: Record<number, string> = {
  0x00: 'binary document',
  0x01: 'canonical text document',
  0x10: 'generic certification of a user ID',
  0x11: 'persona certification',
  0x12: 'casual certification',
  0x13: 'positive certification',
  0x18: 'subkey binding',
  0x19: 'primary key binding',
  0x1f: 'direct key signature',
  0x20: 'key revocation',
  0x28: 'subkey revocation',
  0x30: 'certification revocation',
};

const CURVES: Record<string, string> = {
  '2a8648ce3d030107': 'NIST P-256',
  '2b81040022': 'NIST P-384',
  '2b81040023': 'NIST P-521',
  '2b8104000a': 'secp256k1',
  '2b06010401da470f01': 'Ed25519',
  '2b060104019755010501': 'Curve25519',
  '2b2403030208010107': 'brainpoolP256r1',
  '2b240303020801010d': 'brainpoolP512r1',
};

interface Packet {
  tag: number;
  body: Uint8Array;
  at: number;
}

function readPackets(bytes: Uint8Array): Packet[] {
  const packets: Packet[] = [];
  let at = 0;

  while (at < bytes.length) {
    const header = bytes[at];
    if (header === undefined || (header & 0x80) === 0) {
      throw new OperationError(`The byte at offset ${at} does not start a packet.`);
    }
    const start = at;
    at++;

    let tag: number;
    let length: number;

    if ((header & 0x40) !== 0) {
      tag = header & 0x3f;
      const first = bytes[at++]!;
      if (first < 192) {
        length = first;
      } else if (first < 224) {
        length = ((first - 192) << 8) + bytes[at++]! + 192;
      } else if (first === 255) {
        length = (bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!;
        at += 4;
      } else {
        length = 1 << (first & 0x1f);
      }
    } else {
      tag = (header >> 2) & 0x0f;
      const type = header & 0x03;
      if (type === 0) length = bytes[at++]!;
      else if (type === 1) {
        length = (bytes[at]! << 8) | bytes[at + 1]!;
        at += 2;
      } else if (type === 2) {
        length = (bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!;
        at += 4;
      } else {
        length = bytes.length - at; 
      }
    }

    if (length < 0 || at + length > bytes.length) {
      throw new OperationError(`The ${PACKET_NAMES[tag] ?? `tag ${tag}`} packet runs past the end of the block.`);
    }
    packets.push({ tag, body: bytes.subarray(at, at + length), at: start });
    at += length;
  }
  return packets;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function skipMpi(body: Uint8Array, at: number): { next: number; bits: number } {
  const bits = (body[at]! << 8) | body[at + 1]!;
  return { next: at + 2 + Math.ceil(bits / 8), bits };
}

async function fingerprint(body: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return '(needs Web Crypto)';

  const data = new Uint8Array(3 + body.length);
  data[0] = 0x99;
  data[1] = (body.length >> 8) & 0xff;
  data[2] = body.length & 0xff;
  data.set(body, 3);

  const digest = new Uint8Array(await subtle.digest('SHA-1', data as BufferSource));
  return hex(digest).toUpperCase();
}

function isoDate(seconds: number): string {
  if (seconds === 0) return 'never';
  const millis = seconds * 1000;
  if (!Number.isFinite(millis) || Math.abs(millis) > 8.64e15) return `(out of range: ${seconds})`;
  return new Date(millis).toISOString();
}

async function describeKey(packet: Packet, lines: string[]): Promise<void> {
  const body = packet.body;
  const version = body[0]!;
  const kind = PACKET_NAMES[packet.tag] ?? `tag ${packet.tag}`;

  if (version !== 4 && version !== 6) {
    lines.push(`${kind}: version ${version}, which is older than this reads in detail.`);
    return;
  }

  const created = (body[1]! << 24) | (body[2]! << 16) | (body[3]! << 8) | body[4]!;
  const algorithm = body[5]!;
  lines.push(`${kind}`);
  lines.push(`  Algorithm:   ${PUBLIC_KEY_ALGORITHMS[algorithm] ?? `unknown (${algorithm})`}`);
  lines.push(`  Created:     ${isoDate(created >>> 0)}`);

  if (algorithm === 1 || algorithm === 2 || algorithm === 3) {
    const modulus = skipMpi(body, 6);
    lines.push(`  Key size:    ${modulus.bits} bits`);
  } else if (algorithm === 18 || algorithm === 19 || algorithm === 22) {
    const length = body[6]!;
    const oid = hex(body.subarray(7, 7 + length));
    lines.push(`  Curve:       ${CURVES[oid] ?? `OID ${oid}`}`);
  } else if (algorithm === 17) {
    const p = skipMpi(body, 6);
    lines.push(`  Key size:    ${p.bits} bits`);
  }

  const print = await fingerprint(body);
  lines.push(`  Fingerprint: ${print.replace(/(.{4})/g, '$1 ').trim()}`);
  lines.push(`  Key ID:      ${print.slice(-16)}`);
}

function describeSignature(packet: Packet, lines: string[]): void {
  const body = packet.body;
  const version = body[0]!;
  if (version !== 4 && version !== 5) {
    lines.push(`Signature: version ${version}`);
    return;
  }

  const type = body[1]!;
  const publicKey = body[2]!;
  const hash = body[3]!;
  lines.push('Signature');
  lines.push(`  Type:        ${SIGNATURE_TYPES[type] ?? `0x${type.toString(16)}`}`);
  lines.push(`  Algorithm:   ${PUBLIC_KEY_ALGORITHMS[publicKey] ?? `unknown (${publicKey})`}`);
  lines.push(`  Hash:        ${HASH_ALGORITHMS[hash] ?? `unknown (${hash})`}`);

  const hashedLength = (body[4]! << 8) | body[5]!;
  let at = 6;
  const end = at + hashedLength;
  while (at < end && at < body.length) {
    let length = body[at++]!;
    if (length >= 192 && length < 255) length = ((length - 192) << 8) + body[at++]! + 192;
    else if (length === 255) {
      length = (body[at]! << 24) | (body[at + 1]! << 16) | (body[at + 2]! << 8) | body[at + 3]!;
      at += 4;
    }
    if (length === 0) continue;

    const subtype = body[at]! & 0x7f;
    const value = body.subarray(at + 1, at + length);
    at += length;

    if (subtype === 2) {
      const time = (value[0]! << 24) | (value[1]! << 16) | (value[2]! << 8) | value[3]!;
      lines.push(`  Signed:      ${isoDate(time >>> 0)}`);
    } else if (subtype === 9) {
      const seconds = (value[0]! << 24) | (value[1]! << 16) | (value[2]! << 8) | value[3]!;
      lines.push(`  Expires:     ${seconds === 0 ? 'never' : `${Math.round(seconds / 86400)} days after creation`}`);
    } else if (subtype === 16) {
      lines.push(`  Issuer:      ${hex(value).toUpperCase()}`);
    } else if (subtype === 33) {
      lines.push(`  Issuer key:  ${hex(value.subarray(1)).toUpperCase()}`);
    }
  }
}

export const pgpOperations: Operation[] = [
  {
    id: 'parse-pgp-key',
    name: 'Parse PGP Key',
    category: 'Public Key',
    description: 'Reads an OpenPGP key block: its packets, algorithms, user IDs and fingerprints.',
    aliases: ['pgp key', 'gpg key', 'openpgp', 'key block'],
    budgetMs: 30000,
    args: [{ name: 'Show every packet', type: 'boolean', value: false }],
    run: async (input, args) => {
      const armored = ARMOR.exec(input);
      let bytes: Uint8Array;

      if (armored) {
        const body = armored[2]!
          .split(/\r?\n/)
          .filter((line) => line.trim().length > 0 && !line.includes(':') && !line.startsWith('='))
          .join('');
        try {
          bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
        } catch {
          throw new OperationError('The armored block is not valid Base64.');
        }
      } else {
        bytes = asBytes(input);
        if (bytes.length === 0 || (bytes[0]! & 0x80) === 0) {
          throw new OperationError(
            'That is neither an armored PGP block nor a raw packet stream.',
          );
        }
      }

      const packets = readPackets(bytes);
      const lines: string[] = [
        armored ? `PGP ${armored[1]!.trim().toLowerCase()}` : 'PGP packet stream',
        `${packets.length} packet${packets.length === 1 ? '' : 's'}, ${bytes.length} bytes`,
        '',
      ];

      const showEverything = arg(args, 'Show every packet', false);

      for (const packet of packets) {
        switch (packet.tag) {
          case 5:
          case 6:
          case 7:
          case 14:
            await describeKey(packet, lines);
            if (packet.tag === 5 || packet.tag === 7) {
              lines.push('  Secret:      yes — this block contains private key material.');
            }
            break;
          case 13:
            lines.push(`User ID: ${new TextDecoder().decode(packet.body)}`);
            break;
          case 17:
            lines.push(`User attribute: ${packet.body.length} bytes (usually a photograph)`);
            break;
          case 2:
            describeSignature(packet, lines);
            break;
          default:
            if (showEverything) {
              lines.push(
                `${PACKET_NAMES[packet.tag] ?? `Packet tag ${packet.tag}`}: ${packet.body.length} bytes`,
              );
            }
        }
        lines.push('');
      }

      return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    },
    detection: { pattern: /-----BEGIN PGP (PUBLIC|PRIVATE) KEY BLOCK-----/, formatName: 'PGP key' },
  },
];
