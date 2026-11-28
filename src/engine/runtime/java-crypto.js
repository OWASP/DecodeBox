import { TextDecoder } from '@exodus/bytes/encoding.js';
import { javaBytes, jsBytes } from './java-bytes';
import { curveSpec, importAsymmetric, exportAsymmetric } from './java-keys';

const nameOf = (value) => (typeof value === 'string' ? value : value.name);
const hmacName = (hash) => 'Hmac' + nameOf(hash).replace('-', '');
const mgf = (hash) => new (Java.type('java.security.spec.MGF1ParameterSpec'))(hash);

function macFor(hash, raw) {
  const mac = Java.type('javax.crypto.Mac').getInstance(hmacName(hash));
  // HMAC pads a short key with zeros. JCA rejects a zero-length SecretKeySpec.
  const bytes = raw.length ? raw : new (Java.type('byte[]'))(1);
  mac.init(new (Java.type('javax.crypto.spec.SecretKeySpec'))(bytes, hmacName(hash)));
  return mac;
}
function derive(params, raw, length) {
  const hash = nameOf(params.hash);
  const salt = javaBytes(params.salt);
  if (
    !Number.isSafeInteger(params.iterations) ||
    params.iterations < 1 ||
    length < 8 ||
    length % 8
  ) {
    throw new Error('Invalid PBKDF2 parameters.');
  }
  let password;
  try {
    password = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(jsBytes(raw));
  } catch {}
  if (password !== undefined && salt.length) {
    const chars = Java.to(password.split(''), 'char[]');
    const spec = new (Java.type('javax.crypto.spec.PBEKeySpec'))(
      chars,
      salt,
      params.iterations,
      length,
    );
    try {
      const factory = Java.type('javax.crypto.SecretKeyFactory').getInstance(
        'PBKDF2With' + hmacName(hash),
      );
      return jsBytes(factory.generateSecret(spec).getEncoded()).buffer;
    } finally {
      spec.clearPassword();
    }
  }
  // PBEKeySpec accepts characters. Preserve arbitrary binary passwords using RFC 8018 F.
  const mac = macFor(hash, raw);
  const out = new Uint8Array(length / 8);
  for (let offset = 0, block = 1; offset < out.length; block++) {
    mac.update(salt);
    let u = mac.doFinal(javaBytes(Uint8Array.of(block >>> 24, block >>> 16, block >>> 8, block)));
    const t = jsBytes(u);
    for (let i = 1; i < params.iterations; i++) {
      u = mac.doFinal(u);
      for (let j = 0; j < t.length; j++) t[j] ^= u[j];
    }
    out.set(t.subarray(0, out.length - offset), offset);
    offset += t.length;
  }
  return out.buffer;
}
function signature(params, material) {
  const name = nameOf(params);
  const hash = nameOf(params.hash ?? material.algorithm.hash);
  const jca =
    name === 'RSA-PSS'
      ? 'RSASSA-PSS'
      : hash.replace('-', '') + (name === 'ECDSA' ? 'withECDSAinP1363Format' : 'withRSA');
  const signer = Java.type('java.security.Signature').getInstance(jca);
  if (name === 'RSA-PSS')
    signer.setParameter(
      new (Java.type('java.security.spec.PSSParameterSpec'))(
        hash,
        'MGF1',
        mgf(hash),
        params.saltLength,
        1,
      ),
    );
  return signer;
}
function crypt(params, material, input, encrypt) {
  const name = nameOf(params);
  const Cipher = Java.type('javax.crypto.Cipher');
  let spec, cipher, key;
  if (name === 'RSA-OAEP') {
    const hash = material.algorithm.hash;
    cipher = Cipher.getInstance('RSA/ECB/OAEPPadding');
    spec = new (Java.type('javax.crypto.spec.OAEPParameterSpec'))(
      hash,
      'MGF1',
      mgf(hash),
      Java.type('javax.crypto.spec.PSource$PSpecified').DEFAULT,
    );
    key = material.key;
  } else {
    const modes = {
      'AES-GCM': 'AES/GCM/NoPadding',
      'AES-CBC': 'AES/CBC/PKCS5Padding',
      'AES-CTR': 'AES/CTR/NoPadding',
    };
    if (!Object.hasOwn(modes, name)) throw new Error('Unsupported cipher ' + name);
    cipher = Cipher.getInstance(modes[name]);
    key = new (Java.type('javax.crypto.spec.SecretKeySpec'))(material.raw, 'AES');
    spec =
      name === 'AES-GCM'
        ? new (Java.type('javax.crypto.spec.GCMParameterSpec'))(
            params.tagLength ?? 128,
            javaBytes(params.iv),
          )
        : new (Java.type('javax.crypto.spec.IvParameterSpec'))(
            javaBytes(params.iv ?? params.counter),
          );
  }
  cipher.init(encrypt ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE, key, spec);
  // JCA increments all 128 bits. Web Crypto wraps the low counter field and
  // preserves the nonce. The engine's AES-CTR operation uses a 64-bit field.
  if (name === 'AES-CTR') {
    const counter = new Uint8Array(params.counter);
    const view = new DataView(counter.buffer);
    const beforeWrap = ((1n << 64n) - view.getBigUint64(8)) * 16n;
    if (beforeWrap < BigInt(input.byteLength)) {
      const cut = Number(beforeWrap);
      const data = new Uint8Array(input);
      const output = new Uint8Array(data.length);
      output.set(jsBytes(cipher.doFinal(javaBytes(data.subarray(0, cut)))));
      view.setBigUint64(8, 0n);
      const next = new (Java.type('javax.crypto.spec.IvParameterSpec'))(javaBytes(counter));
      cipher.init(encrypt ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE, key, next);
      output.set(jsBytes(cipher.doFinal(javaBytes(data.subarray(cut)))), cut);
      return output.buffer;
    }
  }
  return jsBytes(cipher.doFinal(javaBytes(input))).buffer;
}
// The handles below are private to the engine. Only the algorithms used by registry
// operations cross this interface. All key generation, signatures and ciphers use JCA.
export function javaCrypto() {
  return {
    async digest(hash, bytes) {
      return jsBytes(
        Java.type('java.security.MessageDigest').getInstance(nameOf(hash)).digest(javaBytes(bytes)),
      ).buffer;
    },
    async importKey(format, data, algorithm, _extractable, usages) {
      if (format === 'raw') return { raw: javaBytes(data), algorithm, usages };
      return importAsymmetric(format, data, algorithm, usages);
    },
    async generateKey(algorithm, _extractable, usages) {
      const ec = algorithm.name === 'ECDSA';
      const generator = Java.type('java.security.KeyPairGenerator').getInstance(ec ? 'EC' : 'RSA');
      generator.initialize(ec ? curveSpec(algorithm.namedCurve) : algorithm.modulusLength);
      const pair = generator.generateKeyPair();
      return {
        publicKey: {
          key: pair.getPublic(),
          algorithm,
          usages: usages.filter((u) => ['verify', 'encrypt'].includes(u)),
          secret: false,
        },
        privateKey: {
          key: pair.getPrivate(),
          algorithm,
          usages: usages.filter((u) => ['sign', 'decrypt'].includes(u)),
          secret: true,
        },
      };
    },
    async exportKey(format, key) {
      return exportAsymmetric(format, key);
    },
    async deriveBits(params, key, length) {
      return derive(params, key.raw, length);
    },
    async sign(params, key, input) {
      if (nameOf(params) === 'HMAC')
        return jsBytes(macFor(key.algorithm.hash, key.raw).doFinal(javaBytes(input))).buffer;
      const s = signature(params, key);
      s.initSign(key.key);
      s.update(javaBytes(input));
      return jsBytes(s.sign()).buffer;
    },
    async verify(params, key, sig, input) {
      if (nameOf(params) === 'HMAC')
        return Java.type('java.security.MessageDigest').isEqual(
          javaBytes(sig),
          macFor(key.algorithm.hash, key.raw).doFinal(javaBytes(input)),
        );
      const s = signature(params, key);
      s.initVerify(key.key);
      s.update(javaBytes(input));
      return s.verify(javaBytes(sig));
    },
    async encrypt(params, key, data) {
      return crypt(params, key, data, true);
    },
    async decrypt(params, key, data) {
      return crypt(params, key, data, false);
    },
  };
}
