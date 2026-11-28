import { TextDecoder, TextEncoder } from '@exodus/bytes/encoding.js';
import urls from 'whatwg-url/lib/url-state-machine.js';
import forms from 'whatwg-url/lib/urlencoded.js';
import { javaBytes, jsBytes } from './java-bytes';
import { javaCrypto } from './java-crypto';
import { checkSize, MAX_OUTPUT } from './limits';

function transform(bytes, format, compress, limit = MAX_OUTPUT) {
  const source = new (Java.type('java.io.ByteArrayInputStream'))(javaBytes(bytes));
  const sink = new (Java.type('java.io.ByteArrayOutputStream'))();
  const raw = format === 'deflate-raw';
  let codec, stream;
  try {
    if (compress) {
      if (format === 'gzip') stream = new (Java.type('java.util.zip.GZIPOutputStream'))(sink);
      else {
        codec = new (Java.type('java.util.zip.Deflater'))(-1, raw);
        stream = new (Java.type('java.util.zip.DeflaterOutputStream'))(sink, codec);
      }
      source.transferTo(stream);
      stream.finish();
      checkSize(sink.size(), limit);
    } else {
      if (format === 'gzip') stream = new (Java.type('java.util.zip.GZIPInputStream'))(source);
      else {
        codec = new (Java.type('java.util.zip.Inflater'))(raw);
        stream = new (Java.type('java.util.zip.InflaterInputStream'))(source, codec);
      }
      const buffer = new (Java.type('byte[]'))(8192);
      for (let count; (count = stream.read(buffer)) !== -1; ) {
        checkSize(sink.size() + count, limit);
        sink.write(buffer, 0, count);
      }
      if (codec && !codec.finished()) throw new Error('Incomplete DEFLATE stream.');
    }
    return jsBytes(sink.toByteArray());
  } finally {
    try {
      stream?.close();
    } finally {
      codec?.end();
    }
  }
}

export function createGraalProvider() {
  const rng = new (Java.type('java.security.SecureRandom'))();
  const base64 = Java.type('java.util.Base64');
  const clock = Java.type('java.lang.System');
  const now = () => Number(clock.nanoTime()) / 1e6;
  const ZoneId = Java.type('java.time.ZoneId');
  const Instant = Java.type('java.time.Instant');
  const DateTimeFormatter = Java.type('java.time.format.DateTimeFormatter');
  const zoneName = DateTimeFormatter.ofPattern('z', Java.type('java.util.Locale').US);
  const encoder = new TextEncoder();
  return {
    name: 'graaljs-java',
    timeZones: () => [
      'UTC',
      ...Array.from(ZoneId.getAvailableZoneIds().toArray(), String)
        .filter((z) => z.includes('/'))
        .sort(),
    ],
    zoneOffset(zone, instant) {
      return (
        ZoneId.of(zone).getRules().getOffset(Instant.ofEpochMilli(instant)).getTotalSeconds() / 60
      );
    },
    zoneAbbreviation(zone, instant) {
      return String(zoneName.format(Instant.ofEpochMilli(instant).atZone(ZoneId.of(zone))));
    },
    secureRandom: true,
    compressionFormats: () => ['gzip', 'deflate', 'deflate-raw'],
    subtle: javaCrypto(),
    decoder: (label, options) => new TextDecoder(label, options),
    encode: (text) => encoder.encode(text),
    toBase64(binary) {
      if (/[\u0100-\uffff]/.test(binary)) throw new TypeError('Base64 requires bytes.');
      return String(
        base64
          .getEncoder()
          .encodeToString(javaBytes(Uint8Array.from(binary, (c) => c.charCodeAt(0)))),
      );
    },
    fromBase64(encoded) {
      const bytes = jsBytes(base64.getDecoder().decode(encoded.replace(/[\t\n\f\r ]/g, '')));
      let text = '';
      for (let i = 0; i < bytes.length; i += 8192)
        text += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return text;
    },
    parseUrl(text) {
      const u = urls.parseURL(text);
      if (!u) throw new TypeError('Invalid URL.');
      return {
        protocol: u.scheme + ':',
        hostname: u.host === null ? '' : urls.serializeHost(u.host),
        port: String(u.port ?? ''),
        username: u.username,
        password: u.password,
        pathname: urls.serializePath(u),
        hash: u.fragment ? '#' + u.fragment : '',
        searchParams: forms.parseUrlencodedString(u.query ?? ''),
      };
    },
    query: (text) => forms.parseUrlencodedString(text),
    random(target) {
      const buffer = new (Java.type('byte[]'))(target.byteLength);
      rng.nextBytes(buffer);
      new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(buffer);
      return target;
    },
    uuid: () => String(Java.type('java.util.UUID').randomUUID()),
    transform: async (...args) => transform(...args),
    now,
    // Plain Graal contexts have no event loop. Java work stays on the owning thread.
    async delay(ms) {
      Java.type('java.lang.Thread').sleep(ms);
    },
    async timed(work, ms, timeout) {
      const start = now();
      const result = await work();
      if (now() - start > ms) throw timeout();
      return result;
    },
  };
}
