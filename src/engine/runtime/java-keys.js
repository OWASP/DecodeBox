import { p256, p384, p521 } from '@noble/curves/nist.js';
import { javaBytes, jsBytes } from './java-bytes';

const curves = {
  'P-256': ['secp256r1', p256, 32],
  'P-384': ['secp384r1', p384, 48],
  'P-521': ['secp521r1', p521, 66],
};
const rsaFields = {
  n: 'getModulus',
  e: 'getPublicExponent',
  d: 'getPrivateExponent',
  p: 'getPrimeP',
  q: 'getPrimeQ',
  dp: 'getPrimeExponentP',
  dq: 'getPrimeExponentQ',
  qi: 'getCrtCoefficient',
};

function decodeInteger(text) {
  const bytes = Java.type('java.util.Base64').getUrlDecoder().decode(text);
  return new (Java.type('java.math.BigInteger'))(1, bytes);
}
function unsigned(integer, width) {
  let bytes = jsBytes(integer.toByteArray());
  if (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  if (!width) return bytes;
  const padded = new Uint8Array(width);
  padded.set(bytes, width - bytes.length);
  return padded;
}
function encode(bytes) {
  return String(
    Java.type('java.util.Base64').getUrlEncoder().withoutPadding().encodeToString(javaBytes(bytes)),
  );
}
export function curveSpec(name) {
  if (!Object.hasOwn(curves, name)) throw new Error('Unsupported EC curve.');
  return new (Java.type('java.security.spec.ECGenParameterSpec'))(curves[name][0]);
}
function ecParameters(name) {
  const ap = Java.type('java.security.AlgorithmParameters').getInstance('EC');
  ap.init(curveSpec(name));
  return ap.getParameterSpec(Java.type('java.security.spec.ECParameterSpec').class);
}
export function importAsymmetric(format, data, algorithm, usages) {
  const ec = algorithm.name === 'ECDSA';
  const factory = Java.type('java.security.KeyFactory').getInstance(ec ? 'EC' : 'RSA');
  const secret = format === 'pkcs8' || (format === 'jwk' && data.d !== undefined);
  let spec;
  if (format === 'jwk') {
    if (data.ext === false || (data.use !== undefined && data.use !== 'sig')) {
      throw new Error('JWK does not permit export for signature use.');
    }
    if (data.alg !== undefined && !ec && data.alg !== 'RS' + algorithm.hash.replace('SHA-', '')) {
      throw new Error('JWK algorithm does not match the requested RSA hash.');
    }
    if (
      data.kty !== (ec ? 'EC' : 'RSA') ||
      (data.key_ops && !usages.every((u) => data.key_ops.includes(u)))
    ) {
      throw new Error('Key type or usage mismatch.');
    }
    if (ec) {
      if (data.crv !== algorithm.namedCurve) throw new Error('EC curve mismatch.');
      const params = ecParameters(data.crv);
      if (secret) {
        const [, curve, width] = curves[data.crv];
        const point = curve.getPublicKey(unsigned(decodeInteger(data.d), width), false);
        if (
          encode(point.slice(1, 1 + width)) !== data.x ||
          encode(point.slice(1 + width)) !== data.y
        ) {
          throw new Error('JWK public and private EC components do not match.');
        }
      }
      spec = secret
        ? new (Java.type('java.security.spec.ECPrivateKeySpec'))(decodeInteger(data.d), params)
        : new (Java.type('java.security.spec.ECPublicKeySpec'))(
            new (Java.type('java.security.spec.ECPoint'))(
              decodeInteger(data.x),
              decodeInteger(data.y),
            ),
            params,
          );
    } else {
      const fields = secret ? Object.keys(rsaFields) : ['n', 'e'];
      const Spec = Java.type(
        secret ? 'java.security.spec.RSAPrivateCrtKeySpec' : 'java.security.spec.RSAPublicKeySpec',
      );
      spec = new Spec(...fields.map((f) => decodeInteger(data[f])));
    }
  } else {
    const Spec = Java.type(
      secret ? 'java.security.spec.PKCS8EncodedKeySpec' : 'java.security.spec.X509EncodedKeySpec',
    );
    spec = new Spec(javaBytes(data));
  }
  const key = secret ? factory.generatePrivate(spec) : factory.generatePublic(spec);
  if (ec && !key.getParams().getOrder().equals(ecParameters(algorithm.namedCurve).getOrder())) {
    throw new Error('The key has a different named curve.');
  }
  return { key, secret, algorithm, usages };
}
export function exportAsymmetric(format, { key, secret, algorithm, usages }) {
  if (format !== 'jwk') return jsBytes(key.getEncoded()).buffer;
  const jwk = { key_ops: usages, ext: true };
  if (algorithm.name === 'ECDSA') {
    const [, curve, width] = curves[algorithm.namedCurve];
    Object.assign(jwk, { kty: 'EC', crv: algorithm.namedCurve });
    if (secret) {
      const d = unsigned(key.getS(), width);
      const point = curve.getPublicKey(d, false);
      Object.assign(jwk, {
        d: encode(d),
        x: encode(point.slice(1, 1 + width)),
        y: encode(point.slice(1 + width)),
      });
    } else {
      jwk.x = encode(unsigned(key.getW().getAffineX(), width));
      jwk.y = encode(unsigned(key.getW().getAffineY(), width));
    }
  } else {
    jwk.kty = 'RSA';
    for (const name of secret ? Object.keys(rsaFields) : ['n', 'e'])
      jwk[name] = encode(unsigned(key[rsaFields[name]]()));
    const hash = algorithm.hash.replace('SHA-', '');
    jwk.alg =
      algorithm.name === 'RSA-OAEP'
        ? hash === '1'
          ? 'RSA-OAEP'
          : 'RSA-OAEP-' + hash
        : (algorithm.name === 'RSA-PSS' ? 'PS' : 'RS') + hash;
  }
  return jwk;
}
