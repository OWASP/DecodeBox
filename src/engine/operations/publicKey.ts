import { OperationError } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';


function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) {
    throw new OperationError('This needs Web Crypto, which the browser has not exposed here.');
  }
  return api;
}


function fromBase64(text: string): Uint8Array {
  const cleaned = text.replace(/\s+/g, '');
  try {
    return Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  } catch {
    throw new OperationError('The key is not valid Base64.');
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toPem(label: string, bytes: Uint8Array): string {
  const body = toBase64(bytes).match(/.{1,64}/g) ?? [];
  return [`-----BEGIN ${label}-----`, ...body, `-----END ${label}-----`, ''].join('\n');
}

interface Pem {
  label: string;
  bytes: Uint8Array;
}

function readPem(text: string): Pem {
  const found = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END [A-Z0-9 ]+-----/.exec(text.trim());
  if (!found) {
    const bare = text.trim();
    if (/^[A-Za-z0-9+/=\s]+$/.test(bare) && bare.length > 32) {
      return { label: 'UNLABELLED', bytes: fromBase64(bare) };
    }
    throw new OperationError('No PEM block found: expected -----BEGIN … ----- and its END line.');
  }
  return { label: found[1]!.trim(), bytes: fromBase64(found[2]!) };
}


function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, body: number[] | Uint8Array): number[] {
  const content = Array.from(body);
  return [tag, ...derLength(content.length), ...content];
}

const OID_RSA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];

function wrapPkcs1Private(pkcs1: Uint8Array): Uint8Array {
  const algorithm = der(0x30, [...der(0x06, OID_RSA), ...der(0x05, [])]);
  const body = [...der(0x02, [0x00]), ...algorithm, ...der(0x04, pkcs1)];
  return new Uint8Array(der(0x30, body));
}

function wrapPkcs1Public(pkcs1: Uint8Array): Uint8Array {
  const algorithm = der(0x30, [...der(0x06, OID_RSA), ...der(0x05, [])]);
  const body = [...algorithm, ...der(0x03, [0x00, ...pkcs1])];
  return new Uint8Array(der(0x30, body));
}


type Family = 'RSA-OAEP' | 'RSASSA-PKCS1-v1_5' | 'RSA-PSS' | 'ECDSA';

function algorithmFor(family: Family, hash: string, curve: string): RsaHashedImportParams | EcKeyImportParams {
  if (family === 'ECDSA') return { name: 'ECDSA', namedCurve: curve };
  return { name: family, hash };
}

async function importPrivate(
  pem: string,
  family: Family,
  hash: string,
  curve: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const { label, bytes } = readPem(pem);
  if (label === 'EC PRIVATE KEY') {
    throw new OperationError(
      'This is a SEC1 key. Convert it with `openssl pkcs8 -topk8 -nocrypt` and paste the PKCS#8 form.',
    );
  }
  if (/ENCRYPTED/.test(label)) {
    throw new OperationError('This private key is encrypted. Decrypt it before pasting it in.');
  }

  const data = label === 'RSA PRIVATE KEY' ? wrapPkcs1Private(bytes) : bytes;
  try {
    return await subtle().importKey('pkcs8', data as BufferSource, algorithmFor(family, hash, curve), true, usages);
  } catch (error) {
    throw new OperationError(
      `That private key could not be read as ${family}: ${error instanceof Error ? error.message : 'import failed'}`,
    );
  }
}

async function importPublic(
  pem: string,
  family: Family,
  hash: string,
  curve: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const { label, bytes } = readPem(pem);
  const data = label === 'RSA PUBLIC KEY' ? wrapPkcs1Public(bytes) : bytes;
  try {
    return await subtle().importKey('spki', data as BufferSource, algorithmFor(family, hash, curve), true, usages);
  } catch (error) {
    throw new OperationError(
      `That public key could not be read as ${family}: ${error instanceof Error ? error.message : 'import failed'}`,
    );
  }
}


function encodeOutput(bytes: Uint8Array, format: string): string {
  if (format === 'Hex') return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  if (format === 'Base64') return toBase64(bytes);
  return bytesToLatin1(bytes);
}

function decodeInput(text: string, format: string): Uint8Array {
  if (format === 'Hex') {
    const cleaned = text.replace(/[^0-9a-fA-F]/g, '');
    if (cleaned.length % 2 !== 0) throw new OperationError('Hex needs an even number of digits.');
    return Uint8Array.from(cleaned.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  }
  if (format === 'Base64') return fromBase64(text);
  return asBytes(text);
}

const HASHES = ['SHA-256', 'SHA-384', 'SHA-512', 'SHA-1'];
const CURVES = ['P-256', 'P-384', 'P-521'];
const FORMATS = ['Hex', 'Base64', 'Raw bytes'];


function derToRaw(signature: Uint8Array, size: number): Uint8Array {
  if (signature[0] !== 0x30) throw new OperationError('That is not a DER signature: it does not start with a SEQUENCE.');

  let at = 2;
  if ((signature[1]! & 0x80) !== 0) at = 2 + (signature[1]! & 0x7f);

  const readInteger = (): Uint8Array => {
    if (signature[at] !== 0x02) throw new OperationError('A DER signature holds two INTEGERs.');
    const length = signature[at + 1]!;
    let start = at + 2;
    const end = start + length;
    while (signature[start] === 0 && end - start > 1) start++;
    at = end;
    return signature.subarray(start, end);
  };

  const r = readInteger();
  const s = readInteger();
  if (r.length > size || s.length > size) {
    throw new OperationError(`The signature holds numbers too large for a ${size * 8}-bit curve.`);
  }

  const out = new Uint8Array(size * 2);
  out.set(r, size - r.length);
  out.set(s, size * 2 - s.length);
  return out;
}

function rawToDer(raw: Uint8Array): Uint8Array {
  if (raw.length % 2 !== 0) throw new OperationError('A raw signature is two numbers of equal length.');
  const half = raw.length / 2;

  const integer = (bytes: Uint8Array): number[] => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const trimmed = Array.from(bytes.subarray(start));
    if ((trimmed[0]! & 0x80) !== 0) trimmed.unshift(0);
    return der(0x02, trimmed);
  };

  return new Uint8Array(der(0x30, [...integer(raw.subarray(0, half)), ...integer(raw.subarray(half))]));
}

const CURVE_SIZES: Record<string, number> = { 'P-256': 32, 'P-384': 48, 'P-521': 66 };


const KEY_ARG = {
  name: 'Key',
  type: 'textarea' as const,
  value: '',
  hint: 'PEM: -----BEGIN PUBLIC KEY----- or -----BEGIN PRIVATE KEY-----',
};

export const publicKeyOperations: Operation[] = [
  {
    id: 'generate-rsa-key-pair',
    name: 'Generate RSA Key Pair',
    category: 'Public Key',
    description: 'Generates an RSA key pair and writes both halves as PEM.',
    aliases: ['rsa keygen', 'new rsa key', 'private key'],
    budgetMs: 60000,
    args: [
      { name: 'Key size', type: 'option', value: '2048', options: ['2048', '3072', '4096', '1024'] },
      { name: 'Hash', type: 'option', value: 'SHA-256', options: HASHES },
      {
        name: 'Use',
        type: 'option',
        value: 'Signing',
        options: ['Signing', 'Encryption'],
        hint: 'A key is imported for one or the other, so it is stamped now',
      },
    ],
    run: async (_input, args) => {
      const bits = Number(arg(args, 'Key size', '2048'));
      const signing = arg(args, 'Use', 'Signing') === 'Signing';
      const pair = (await subtle().generateKey(
        {
          name: signing ? 'RSASSA-PKCS1-v1_5' : 'RSA-OAEP',
          modulusLength: bits,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: String(arg(args, 'Hash', 'SHA-256')),
        },
        true,
        signing ? ['sign', 'verify'] : ['encrypt', 'decrypt'],
      )) as CryptoKeyPair;

      const publicKey = new Uint8Array(await subtle().exportKey('spki', pair.publicKey));
      const privateKey = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
      return toPem('PUBLIC KEY', publicKey) + '\n' + toPem('PRIVATE KEY', privateKey);
    },
  },
  {
    id: 'generate-ecdsa-key-pair',
    name: 'Generate ECDSA Key Pair',
    category: 'Public Key',
    description: 'Generates an elliptic curve key pair and writes both halves as PEM.',
    aliases: ['ec keygen', 'new ec key', 'elliptic curve key'],
    budgetMs: 30000,
    args: [{ name: 'Curve', type: 'option', value: 'P-256', options: CURVES }],
    run: async (_input, args) => {
      const pair = (await subtle().generateKey(
        { name: 'ECDSA', namedCurve: String(arg(args, 'Curve', 'P-256')) },
        true,
        ['sign', 'verify'],
      )) as CryptoKeyPair;

      const publicKey = new Uint8Array(await subtle().exportKey('spki', pair.publicKey));
      const privateKey = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
      return toPem('PUBLIC KEY', publicKey) + '\n' + toPem('PRIVATE KEY', privateKey);
    },
  },
  {
    id: 'rsa-encrypt',
    name: 'RSA Encrypt',
    category: 'Public Key',
    description: 'Encrypts a short message to an RSA public key using OAEP padding.',
    aliases: ['rsa oaep', 'encrypt to public key'],
    budgetMs: 30000,
    args: [
      KEY_ARG,
      { name: 'Hash', type: 'option', value: 'SHA-256', options: HASHES },
      { name: 'Output', type: 'option', value: 'Base64', options: FORMATS },
    ],
    run: async (input, args) => {
      const key = await importPublic(
        String(arg(args, 'Key', '')),
        'RSA-OAEP',
        String(arg(args, 'Hash', 'SHA-256')),
        'P-256',
        ['encrypt'],
      );
      let cipher: ArrayBuffer;
      try {
        cipher = await subtle().encrypt({ name: 'RSA-OAEP' }, key, asBytes(input) as BufferSource);
      } catch {
        throw new OperationError(
          'RSA can only encrypt a message shorter than its modulus. Encrypt a symmetric key with it and the data with that.',
        );
      }
      return encodeOutput(new Uint8Array(cipher), String(arg(args, 'Output', 'Base64')));
    },
  },
  {
    id: 'rsa-decrypt',
    name: 'RSA Decrypt',
    category: 'Public Key',
    description: 'Decrypts an OAEP-padded message with an RSA private key.',
    aliases: ['rsa oaep decrypt', 'decrypt with private key'],
    budgetMs: 30000,
    args: [
      KEY_ARG,
      { name: 'Hash', type: 'option', value: 'SHA-256', options: HASHES },
      { name: 'Input', type: 'option', value: 'Base64', options: FORMATS },
    ],
    run: async (input, args) => {
      const key = await importPrivate(
        String(arg(args, 'Key', '')),
        'RSA-OAEP',
        String(arg(args, 'Hash', 'SHA-256')),
        'P-256',
        ['decrypt'],
      );
      const data = decodeInput(input, String(arg(args, 'Input', 'Base64')));
      try {
        const plain = await subtle().decrypt({ name: 'RSA-OAEP' }, key, data as BufferSource);
        return bytesToLatin1(new Uint8Array(plain));
      } catch {
        throw new OperationError(
          'That did not decrypt: the key, the padding hash, or the ciphertext is not the right one.',
        );
      }
    },
  },
  {
    id: 'rsa-sign',
    name: 'RSA Sign',
    category: 'Public Key',
    description: 'Signs the input with an RSA private key, in PKCS#1 v1.5 or PSS.',
    aliases: ['sign with rsa', 'rsassa', 'rsa pss'],
    budgetMs: 30000,
    args: [
      KEY_ARG,
      { name: 'Scheme', type: 'option', value: 'PKCS#1 v1.5', options: ['PKCS#1 v1.5', 'PSS'] },
      { name: 'Hash', type: 'option', value: 'SHA-256', options: HASHES },
      { name: 'Output', type: 'option', value: 'Base64', options: FORMATS },
    ],
    run: async (input, args) => {
      const pss = arg(args, 'Scheme', 'PKCS#1 v1.5') === 'PSS';
      const hash = String(arg(args, 'Hash', 'SHA-256'));
      const key = await importPrivate(String(arg(args, 'Key', '')), pss ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5', hash, 'P-256', ['sign']);

      const parameters = pss
        ? { name: 'RSA-PSS', saltLength: Number(hash.slice(4)) / 8 }
        : { name: 'RSASSA-PKCS1-v1_5' };
      const signature = await subtle().sign(parameters, key, asBytes(input) as BufferSource);
      return encodeOutput(new Uint8Array(signature), String(arg(args, 'Output', 'Base64')));
    },
  },
  {
    id: 'rsa-verify',
    name: 'RSA Verify',
    category: 'Public Key',
    description: 'Checks an RSA signature over the input against a public key.',
    aliases: ['verify rsa signature', 'check signature'],
    budgetMs: 30000,
    args: [
      KEY_ARG,
      { name: 'Signature', type: 'string', value: '' },
      { name: 'Signature format', type: 'option', value: 'Base64', options: FORMATS },
      { name: 'Scheme', type: 'option', value: 'PKCS#1 v1.5', options: ['PKCS#1 v1.5', 'PSS'] },
      { name: 'Hash', type: 'option', value: 'SHA-256', options: HASHES },
    ],
    run: async (input, args) => {
      const pss = arg(args, 'Scheme', 'PKCS#1 v1.5') === 'PSS';
      const hash = String(arg(args, 'Hash', 'SHA-256'));
      const key = await importPublic(String(arg(args, 'Key', '')), pss ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5', hash, 'P-256', ['verify']);

      const signature = decodeInput(
        String(arg(args, 'Signature', '')),
        String(arg(args, 'Signature format', 'Base64')),
      );
      if (signature.length === 0) throw new OperationError('There is no signature to check.');

      const parameters = pss
        ? { name: 'RSA-PSS', saltLength: Number(hash.slice(4)) / 8 }
        : { name: 'RSASSA-PKCS1-v1_5' };
      const valid = await subtle().verify(
        parameters,
        key,
        signature as BufferSource,
        asBytes(input) as BufferSource,
      );
      return valid
        ? `Verified: this signature was made over this data with the matching private key.`
        : 'Not verified. The data, the signature, or the key does not belong to the other two.';
    },
  },
  {
    id: 'ecdsa-sign',
    name: 'ECDSA Sign',
    category: 'Public Key',
    description: 'Signs the input with an elliptic curve private key.',
    aliases: ['sign with ec', 'elliptic curve signature'],
    budgetMs: 30000,
    args: [
      KEY_ARG,
      { name: 'Curve', type: 'option', value: 'P-256', options: CURVES },
      { name: 'Hash', type: 'option', value: 'SHA-256', options: HASHES },
      { name: 'Signature form', type: 'option', value: 'Raw (r||s)', options: ['Raw (r||s)', 'DER'] },
      { name: 'Output', type: 'option', value: 'Hex', options: FORMATS },
    ],
    run: async (input, args) => {
      const curve = String(arg(args, 'Curve', 'P-256'));
      const key = await importPrivate(String(arg(args, 'Key', '')), 'ECDSA', 'SHA-256', curve, ['sign']);
      const signature = new Uint8Array(
        await subtle().sign(
          { name: 'ECDSA', hash: String(arg(args, 'Hash', 'SHA-256')) },
          key,
          asBytes(input) as BufferSource,
        ),
      );
      const shaped = arg(args, 'Signature form', 'Raw (r||s)') === 'DER' ? rawToDer(signature) : signature;
      return encodeOutput(shaped, String(arg(args, 'Output', 'Hex')));
    },
  },
  {
    id: 'ecdsa-verify',
    name: 'ECDSA Verify',
    category: 'Public Key',
    description: 'Checks an elliptic curve signature over the input against a public key.',
    aliases: ['verify ec signature', 'check ecdsa'],
    budgetMs: 30000,
    args: [
      KEY_ARG,
      { name: 'Signature', type: 'string', value: '' },
      { name: 'Signature format', type: 'option', value: 'Hex', options: FORMATS },
      { name: 'Curve', type: 'option', value: 'P-256', options: CURVES },
      { name: 'Hash', type: 'option', value: 'SHA-256', options: HASHES },
    ],
    run: async (input, args) => {
      const curve = String(arg(args, 'Curve', 'P-256'));
      const size = CURVE_SIZES[curve]!;
      const key = await importPublic(String(arg(args, 'Key', '')), 'ECDSA', 'SHA-256', curve, ['verify']);

      let signature = decodeInput(
        String(arg(args, 'Signature', '')),
        String(arg(args, 'Signature format', 'Hex')),
      );
      if (signature.length === 0) throw new OperationError('There is no signature to check.');
      if (signature[0] === 0x30 && signature.length !== size * 2) signature = derToRaw(signature, size);

      const valid = await subtle().verify(
        { name: 'ECDSA', hash: String(arg(args, 'Hash', 'SHA-256')) },
        key,
        signature as BufferSource,
        asBytes(input) as BufferSource,
      );
      return valid
        ? 'Verified: this signature was made over this data with the matching private key.'
        : 'Not verified. The data, the signature, or the key does not belong to the other two.';
    },
  },
  {
    id: 'ecdsa-signature-conversion',
    name: 'ECDSA Signature Conversion',
    category: 'Public Key',
    description: 'Converts an ECDSA signature between the DER, raw and JSON ways of writing it.',
    aliases: ['der to raw', 'raw to der', 'signature format'],
    args: [
      { name: 'Input format', type: 'option', value: 'Auto', options: ['Auto', 'DER', 'Raw (r||s)', 'JSON'] },
      { name: 'Output format', type: 'option', value: 'Raw (r||s)', options: ['Raw (r||s)', 'DER', 'JSON'] },
      { name: 'Curve', type: 'option', value: 'P-256', options: CURVES },
      { name: 'Encoding', type: 'option', value: 'Hex', options: FORMATS },
    ],
    run: (input, args) => {
      const curve = String(arg(args, 'Curve', 'P-256'));
      const size = CURVE_SIZES[curve]!;
      const encoding = String(arg(args, 'Encoding', 'Hex'));
      const declared = String(arg(args, 'Input format', 'Auto'));

      let raw: Uint8Array;
      const trimmed = input.trim();
      if (declared === 'JSON' || (declared === 'Auto' && trimmed.startsWith('{'))) {
        let parsed: { r?: string; s?: string };
        try {
          parsed = JSON.parse(trimmed) as { r?: string; s?: string };
        } catch {
          throw new OperationError('That is not valid JSON.');
        }
        if (!parsed.r || !parsed.s) throw new OperationError("The JSON needs an 'r' and an 's'.");
        raw = new Uint8Array(size * 2);
        const half = (value: string): Uint8Array =>
          Uint8Array.from(value.replace(/^0x/, '').padStart(size * 2, '0').match(/../g) ?? [], (p) =>
            Number.parseInt(p, 16),
          );
        raw.set(half(parsed.r), 0);
        raw.set(half(parsed.s), size);
      } else {
        const bytes = decodeInput(input, encoding);
        const isDer = declared === 'DER' || (declared === 'Auto' && bytes[0] === 0x30 && bytes.length !== size * 2);
        raw = isDer ? derToRaw(bytes, size) : bytes;
        if (raw.length !== size * 2) {
          throw new OperationError(
            `A raw ${curve} signature is ${size * 2} bytes; this one is ${raw.length}.`,
          );
        }
      }

      const output = String(arg(args, 'Output format', 'Raw (r||s)'));
      if (output === 'JSON') {
        const hex = (bytes: Uint8Array): string =>
          Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        return JSON.stringify(
          { r: hex(raw.subarray(0, size)), s: hex(raw.subarray(size)) },
          null,
          2,
        );
      }
      return encodeOutput(output === 'DER' ? rawToDer(raw) : raw, encoding);
    },
  },
  {
    id: 'pem-to-jwk',
    name: 'PEM to JWK',
    category: 'Public Key',
    description: 'Converts a PEM key into the JSON Web Key form used by JOSE and OIDC.',
    aliases: ['jwk', 'json web key', 'pem convert'],
    budgetMs: 30000,
    args: [
      { name: 'Kind', type: 'option', value: 'Auto', options: ['Auto', 'RSA', 'ECDSA'] },
      { name: 'Curve', type: 'option', value: 'P-256', options: CURVES },
      { name: 'Hash', type: 'option', value: 'SHA-256', options: HASHES },
    ],
    run: async (input, args) => {
      const { label } = readPem(input);
      const isPrivate = /PRIVATE/.test(label);
      const kind = String(arg(args, 'Kind', 'Auto'));
      const curve = String(arg(args, 'Curve', 'P-256'));
      const hash = String(arg(args, 'Hash', 'SHA-256'));

      const families: Family[] =
        kind === 'RSA' ? ['RSASSA-PKCS1-v1_5'] : kind === 'ECDSA' ? ['ECDSA'] : ['RSASSA-PKCS1-v1_5', 'ECDSA'];

      let lastError = '';
      for (const family of families) {
        try {
          const key = isPrivate
            ? await importPrivate(input, family, hash, curve, ['sign'])
            : await importPublic(input, family, hash, curve, ['verify']);
          const jwk = await subtle().exportKey('jwk', key);
          return JSON.stringify(jwk, null, 2);
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'import failed';
        }
      }
      throw new OperationError(`That key could not be read: ${lastError}`);
    },
  },
  {
    id: 'jwk-to-pem',
    name: 'JWK to PEM',
    category: 'Public Key',
    description: 'Converts a JSON Web Key back into PEM.',
    aliases: ['json web key to pem', 'jwk convert'],
    budgetMs: 30000,
    args: [{ name: 'Hash', type: 'option', value: 'SHA-256', options: HASHES }],
    run: async (input, args) => {
      let jwk: JsonWebKey & { kty?: string; crv?: string; d?: string };
      try {
        jwk = JSON.parse(input.trim()) as JsonWebKey;
      } catch {
        throw new OperationError('That is not valid JSON.');
      }
      if (!jwk.kty) throw new OperationError("A JWK needs a 'kty' saying what kind of key it is.");

      const isPrivate = typeof jwk.d === 'string';
      const algorithm: RsaHashedImportParams | EcKeyImportParams =
        jwk.kty === 'EC'
          ? { name: 'ECDSA', namedCurve: jwk.crv ?? 'P-256' }
          : { name: 'RSASSA-PKCS1-v1_5', hash: String(arg(args, 'Hash', 'SHA-256')) };

      let key: CryptoKey;
      try {
        key = await subtle().importKey('jwk', jwk, algorithm, true, isPrivate ? ['sign'] : ['verify']);
      } catch (error) {
        throw new OperationError(
          `That JWK could not be read: ${error instanceof Error ? error.message : 'import failed'}`,
        );
      }

      const exported = new Uint8Array(await subtle().exportKey(isPrivate ? 'pkcs8' : 'spki', key));
      return toPem(isPrivate ? 'PRIVATE KEY' : 'PUBLIC KEY', exported);
    },
  },
  {
    id: 'public-key-from-private-key',
    name: 'Public Key from Private Key',
    category: 'Public Key',
    description: 'Derives the public half of a private key and writes it as PEM.',
    aliases: ['extract public key', 'pubkey from privkey'],
    budgetMs: 30000,
    args: [
      { name: 'Kind', type: 'option', value: 'Auto', options: ['Auto', 'RSA', 'ECDSA'] },
      { name: 'Curve', type: 'option', value: 'P-256', options: CURVES },
    ],
    run: async (input, args) => {
      const kind = String(arg(args, 'Kind', 'Auto'));
      const curve = String(arg(args, 'Curve', 'P-256'));
      const families: Family[] =
        kind === 'RSA' ? ['RSASSA-PKCS1-v1_5'] : kind === 'ECDSA' ? ['ECDSA'] : ['RSASSA-PKCS1-v1_5', 'ECDSA'];

      let lastError = '';
      for (const family of families) {
        try {
          const key = await importPrivate(input, family, 'SHA-256', curve, ['sign']);
          const jwk = (await subtle().exportKey('jwk', key)) as JsonWebKey;
          for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']) {
            delete (jwk as unknown as Record<string, unknown>)[secret];
          }
          jwk.key_ops = ['verify'];

          const algorithm: RsaHashedImportParams | EcKeyImportParams =
            family === 'ECDSA' ? { name: 'ECDSA', namedCurve: curve } : { name: family, hash: 'SHA-256' };
          const publicKey = await subtle().importKey('jwk', jwk, algorithm, true, ['verify']);
          return toPem('PUBLIC KEY', new Uint8Array(await subtle().exportKey('spki', publicKey)));
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'import failed';
        }
      }
      throw new OperationError(`That private key could not be read: ${lastError}`);
    },
  },
];

