import { describe, expect, it } from 'vitest';
import { bake, encodeInput, renderText } from './index';
import { getOperation, TEXT_OPERATION_IDS } from './operations';
import { rewrap } from './core/rewrap';
import { tryDecodeUtf8 } from './core/bytes';
import type { Recipe, RecipeStep } from './types';

type Value = string | number | boolean;
type Entry = string | [string, Record<string, Value>];

function step(entry: Entry, i: number): RecipeStep {
  const [opId, overrides] = typeof entry === 'string' ? [entry, {}] : entry;
  const op = getOperation(opId);
  if (!op) throw new Error(`Unknown operation '${opId}'`);
  return {
    uid: `s${i}`,
    opId,
    args: op.args.map((a) => ({ ...a, value: overrides[a.name] ?? a.value })),
    disabled: false,
  };
}

function recipe(entries: Entry[]): Recipe {
  return { id: 'verified', name: 'verified', steps: entries.map(step) };
}

async function bytesOut(bytes: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(bytes, recipe(entries));
  if (result.error) throw new Error(`${JSON.stringify(entries[0])}: ${result.error.message}`);
  return result.output;
}

async function text(input: string, ...entries: Entry[]): Promise<string> {
  return renderText(await bytesOut(encodeInput(input, 'UTF-8'), ...entries));
}

async function refusal(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(encodeInput(input, 'UTF-8'), recipe(entries));
  return result.error?.message ?? '';
}

const fromHex = (hex: string): string =>
  (hex.replace(/\s+/g, '').match(/../g) ?? []).map((b) => String.fromCharCode(parseInt(b, 16))).join('');

const toHex = (bytes: string): string =>
  Array.from(bytes, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');

async function roundTrip(input: string, forward: Entry, inverse: Entry): Promise<string> {
  return text(input, forward, inverse);
}

describe('text and encoding operations give the published answers', () => {
  it('Punycode converts an internationalised domain both ways', async () => {
    expect(await text('münchen.de', 'to-punycode')).toBe('xn--mnchen-3ya.de');
    expect(await text('xn--mnchen-3ya.de', 'from-punycode')).toBe('münchen.de');
  });

  it('Base45 matches the RFC 9285 examples', async () => {
    expect(await text('AB', 'to-base45')).toBe('BB8');
    expect(await text('Hello!!', 'to-base45')).toBe('%69 VD92EX0');
    expect(await text('ietf!', 'to-base45')).toBe('QED8WEX0');
    expect(await text('QED8WEX0', 'from-base45')).toBe('ietf!');
    expect(await text('%69 VD92EX0', 'from-base45')).toBe('Hello!!');
  });

  it('Quoted-printable decodes escapes and soft line breaks', async () => {
    expect(await text('caf=C3=A9 a=3Db', 'from-quoted-printable')).toBe('café a=b');
    expect(await text('abc=\r\ndef', 'from-quoted-printable')).toBe('abcdef');
  });

  it('UUencode writes the standard body and reads it back', async () => {
    const encoded = await text('Cat', 'to-uuencode');
    expect(encoded).toContain('#0V%T');
    expect(await roundTrip('Cat and dog, 123!', 'to-uuencode', 'from-uuencode')).toBe('Cat and dog, 123!');
  });

  it('Charcode turns characters into numbers and back', async () => {
    const codes = await text('Hi', ['to-charcode', { Base: '16' }]);
    expect(codes).toMatch(/48/);
    expect(codes).toMatch(/69/);
    expect(await roundTrip('Hello', ['to-charcode', { Base: '10' }], ['from-charcode', { Base: '10' }])).toBe('Hello');
  });

  it('Data URIs carry the payload as Base64', async () => {
    expect(await text('hello', 'to-data-uri')).toContain('base64,aGVsbG8=');
    expect(await text('data:text/plain;base64,aGVsbG8=', 'from-data-uri')).toBe('hello');
  });

  it('JSON escaping survives a round trip and really escapes', async () => {
    const source = 'a"b\\c\nd';
    const escaped = await text(source, 'json-escape');
    expect(escaped).not.toBe(source);
    expect(await text(escaped, 'json-unescape')).toBe(source);
  });

  it('Unicode normalisation decomposes and recomposes', async () => {
    expect(await text('é', ['normalise-unicode', { Form: 'NFD' }])).toBe('é');
    expect(await text('é', ['normalise-unicode', { Form: 'NFC' }])).toBe('é');
  });

  it('text encodings round-trip non-ASCII text', async () => {
    expect(await roundTrip('Grüße ✓', 'encode-text', 'decode-text')).toBe('Grüße ✓');
    expect(await roundTrip('Grüße', ['encode-text', { Encoding: 'UTF-16LE' }], ['decode-text', { Encoding: 'UTF-16LE' }])).toBe('Grüße');
  });

  it('Braille and case-insensitive regex do their conversions', async () => {
    const braille = await text('hello', 'to-braille');
    expect(braille).not.toBe('hello');
    expect((await text(braille, 'from-braille')).toLowerCase()).toBe('hello');
    expect((await text('[hH][iI]', 'from-case-insensitive-regex')).toLowerCase()).toBe('hi');
  });

  it('unescaping operations remove the escapes they are named after', async () => {
    expect(await text('\\u0041\\u0042', 'unescape-unicode')).toBe('AB');
    expect(await text('a\\tb\\nc', 'unescape-string')).toBe('a\tb\nc');
    expect(await text('[31mred[0m', 'remove-ansi-escape-codes')).toBe('red');
    expect(await text('hxxp://evil[.]com', 'refang')).toBe('http://evil.com');
  });

  it('Unicode text format adds combining marks', async () => {
    const underlined = await text('ab', ['unicode-text-format', { Underline: true }]);
    expect(underlined).not.toBe('ab');
    expect(underlined.replace(/[̀-ͯ]/g, '')).toBe('ab');
  });
});

describe('line and selection operations cut where they say', () => {
  it('head, tail and take bytes', async () => {
    expect(await text('a\nb\nc', ['head', { Lines: 2 }])).toBe('a\nb');
    expect(await text('a\nb\nc', ['tail', { Lines: 2 }])).toBe('b\nc');
    expect(await text('abcdef', ['take-bytes', { Start: 1, Length: 3 }])).toBe('bcd');
  });

  it('filtering keeps and drops the right lines', async () => {
    expect(await text('a\nb\nc\nab', ['filter-lines', { Pattern: 'b' }])).toBe('b\nab');
    expect(await text('a\nb\nc\nab', ['filter-lines', { Pattern: 'b', Invert: true }])).toBe('a\nc');
    expect(await text('a\nb\nc\nab', ['filter', { Regex: 'b' }])).toBe('b\nab');
    expect(await text('a\nb\na\nc', 'unique')).toBe('a\nb\nc');
  });

  it('regular expressions and counting find every match', async () => {
    const found = await text('a1b22c333', ['regular-expression', { Pattern: '\\d+' }]);
    expect(found).toContain('22');
    expect(found).toContain('333');
    expect(await text('foo boo', ['count-occurrences', { Search: 'o' }])).toContain('4');
  });

  it('HTTP headers are stripped down to the body', async () => {
    expect(await text('HTTP/1.1 200 OK\r\nX-Test: y\r\n\r\nbody text', 'strip-http-headers')).toBe('body text');
  });
});

describe('arithmetic and set operations compute the right numbers', () => {
  it('modular arithmetic', async () => {
    expect(await text('', ['modular-inverse', { 'Value (a)': '3', 'Modulus (m)': '11' }])).toContain('4');
    expect(
      await text('', ['modular-exponentiation', { Base: '4', Exponent: '13', Modulus: '497' }]),
    ).toContain('445');
    const gcd = await text('', ['extended-gcd', { 'Value a': '240', 'Value b': '46' }]);
    expect(gcd).toMatch(/\b2\b/);
    expect(gcd).toMatch(/-9/);
    expect(gcd).toMatch(/47/);
  });

  it('set operations', async () => {
    const sets = '1,2,3\\n\\n2,3,4';
    const input = sets.replace(/\\n/g, '\n');
    const split = (s: string) => s.split(/[,\s]+/).filter(Boolean).sort();
    expect(split(await text(input, 'set-union'))).toEqual(['1', '2', '3', '4']);
    expect(split(await text(input, 'set-intersection'))).toEqual(['2', '3']);
    expect(split(await text(input, 'set-difference'))).toEqual(['1']);
    expect(split(await text(input, 'symmetric-difference'))).toEqual(['1', '4']);
    const product = await text('1,2\n\na,b', 'cartesian-product');
    for (const pair of ['1', '2', 'a', 'b']) expect(product).toContain(pair);
    expect(product.length).toBeGreaterThan('1,2\n\na,b'.length);
  });

  it('IPv6 addresses expand and compress', async () => {
    expect(await text('2001:db8::1', 'expand-ipv6')).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(await text('2001:0db8:0000:0000:0000:0000:0000:0001', 'compress-ipv6')).toBe('2001:db8::1');
  });
});

describe('bitwise operations change exactly the bits they should', () => {
  it('add, NOT and bit rotation', async () => {
    expect(await text('ABC', ['add', { Key: '01' }])).toBe('BCD');
    expect(toHex(await bytesOut(fromHex('41'), 'not'))).toBe('be');
    expect(toHex(await bytesOut(fromHex('41'), 'not', 'not'))).toBe('41');
    expect(toHex(await bytesOut(fromHex('80'), ['bit-rotate', { Amount: 1, Direction: 'Left' }]))).toBe('01');
    expect(toHex(await bytesOut(fromHex('01'), ['bit-rotate', { Amount: 1, Direction: 'Right' }]))).toBe('80');
  });
});

describe('compression follows the zlib and deflate formats', () => {
  it('inflates known streams', async () => {
    expect(renderText(await bytesOut(fromHex('789ccb48cdc9c90700062c0215'), 'zlib-inflate'))).toBe('hello');
    expect(renderText(await bytesOut(fromHex('cb48cdc9c90700'), 'raw-inflate'))).toBe('hello');
  });

  it('deflates into something smaller that inflates back', async () => {
    const source = 'abcabcabcabcabcabcabcabcabcabcabcabcabcabc';
    const zlib = await bytesOut(source, 'zlib-deflate');
    expect(zlib.length).toBeLessThan(source.length);
    expect(toHex(zlib).startsWith('78')).toBe(true);
    expect(await bytesOut(zlib, 'zlib-inflate')).toBe(source);
    const raw = await bytesOut(source, 'raw-deflate');
    expect(raw.length).toBeLessThan(source.length);
    expect(await bytesOut(raw, 'raw-inflate')).toBe(source);
  });
});

describe('ciphers and MACs match their standard vectors', () => {
  it('HMAC-SHA-256, RFC 4231 test case 2', async () => {
    expect(await text('what do ya want for nothing?', ['hmac', { Key: 'Jefe', Hash: 'SHA-256' }])).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('AES-CBC, NIST SP 800-38A F.2.1 first block, and back', async () => {
    const key = '2b7e151628aed2a6abf7158809cf4f3c';
    const iv = '000102030405060708090a0b0c0d0e0f';
    const plain = fromHex('6bc1bee22e409f96e93d7e117393172a');
    const cipher = await bytesOut(plain, ['aes-encrypt', { Key: key, IV: iv, Mode: 'AES-CBC' }]);
    expect(cipher.startsWith('7649abac8119b246cee98e9b12e9197d')).toBe(true);
    const decrypted = await bytesOut(cipher, ['aes-decrypt', { Key: key, IV: iv, Mode: 'AES-CBC' }]);
    expect(toHex(decrypted)).toBe('6bc1bee22e409f96e93d7e117393172a');
  });

  it('AES-GCM round-trips and refuses without a key', async () => {
    const key = '000102030405060708090a0b0c0d0e0f';
    const iv = '000102030405060708090a0b';
    const cipher = await bytesOut('attack at dawn', ['aes-encrypt', { Key: key, IV: iv }]);
    expect(await bytesOut(cipher, ['aes-decrypt', { Key: key, IV: iv }])).toBe('attack at dawn');
    expect(await refusal('attack at dawn', 'aes-encrypt')).not.toBe('');
  });

  it('TEA round-trips in CBC mode', async () => {
    const args = { Key: '00112233445566778899aabbccddeeff', IV: '0102030405060708' };
    const cipher = await bytesOut('sixteen byte msg and more', ['tea-encrypt', args]);
    expect(cipher).not.toContain('sixteen');
    expect(
      await bytesOut(cipher, ['tea-decrypt', { ...args, Input: 'Hex', Output: 'Raw' }]),
    ).toBe('sixteen byte msg and more');
  });

  it('Vigenère, the classic LEMON example', async () => {
    expect(await text('ATTACKATDAWN', ['vigenere-encode', { Key: 'LEMON' }])).toBe('LXFOPVEFRNHR');
    expect(await text('LXFOPVEFRNHR', ['vigenere-decode', { Key: 'LEMON' }])).toBe('ATTACKATDAWN');
  });

  it('Compare hash tells a match from a mismatch', async () => {
    const digest = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
    const match = await text('hello', ['compare-hash', { 'Expected digest': digest, Hash: 'SHA-256' }]);
    const miss = await text('hellO', ['compare-hash', { 'Expected digest': digest, Hash: 'SHA-256' }]);
    expect(match).not.toBe(miss);
    expect(match.toLowerCase()).toMatch(/match/);
  });
});

describe('Re-wrap inverts structured formats with the right settings', () => {
  async function viaRewrap(input: string, forward: Entry): Promise<string> {
    const first = step(forward, 0);
    const mid = await bytesOut(input, forward);
    const all = (await import('./operations/index')).OPERATIONS;
    const plan = rewrap([first], all, () => 'inverse');
    if (!plan.ok) throw new Error(plan.blockers.map((b) => b.reason).join('; '));
    const result = await bake(mid, { id: 'r', name: 'r', steps: plan.steps });
    if (result.error) throw new Error(result.error.message);
    return result.output;
  }

  it('Bech32 comes back as the original bytes, not as hex', async () => {
    expect(await viaRewrap('hello', 'to-bech32')).toBe('hello');
  });

  it('Protobuf decodes and re-encodes the same wire bytes', async () => {
    const wire = fromHex('089601');
    const json = await bytesOut(wire, ['protobuf-decode', { Indent: 0 }]);
    expect(toHex(await bytesOut(json, 'protobuf-encode'))).toBe('089601');
  });
});

describe('generators and timing report sensible values', () => {
  it('keys and IVs are fresh hex of the requested size', async () => {
    const key = await text('', ['generate-key', { Bits: '256' }]);
    expect(key).toMatch(/^[0-9a-f]{64}$/i);
    expect(await text('', ['generate-key', { Bits: '256' }])).not.toBe(key);
    const iv = await text('', ['generate-iv', { Bytes: 16 }]);
    expect(iv).toMatch(/^[0-9a-f]{32}$/i);
  });

  it('now reports the current time', async () => {
    const seconds = Number((await text('', ['now', { Format: 'Unix seconds' }])).trim());
    expect(Math.abs(seconds - Date.now() / 1000)).toBeLessThan(300);
  });

  it('sleep waits and passes its input through untouched', async () => {
    const started = Date.now();
    expect(await text('unchanged', ['sleep', { 'Time (ms)': 60 }])).toBe('unchanged');
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it('Numberwang says something', async () => {
    expect((await text('42', 'numberwang')).trim().length).toBeGreaterThan(0);
  });
});

describe('operations that work on text read UTF-8 input as text', () => {
  it('URL encoding percent-encodes the UTF-8 bytes, and raw bytes as they are', async () => {
    expect(await text('café au lait', 'url-encode')).toBe('caf%C3%A9%20au%20lait');
    expect(await bytesOut(fromHex('e9'), 'url-encode')).toBe('%E9');
    expect(await text("a.b-c_d~e!f'(g)*", 'url-encode')).toBe("a.b-c_d~e!f'(g)*");
    expect(await text('a.b', ['url-encode', { 'Encode all special chars': true }])).toBe('a%2Eb');
    expect(await text('café', 'url-encode', 'url-decode')).toBe('café');
  });

  it('case conversion handles letters beyond ASCII', async () => {
    expect(await text('café grüße', 'to-upper-case')).toBe('CAFÉ GRÜSSE');
    expect(await text('ÉTÉ Ω', 'to-lower-case')).toBe('été ω');
    expect(await text('Éa', 'swap-case')).toBe('éA');
  });

  it('reversing by character keeps multi-byte characters whole', async () => {
    expect(await text('añb Ω', 'reverse')).toBe('Ω bña');
  });

  it('escapes and entities use code points, not UTF-8 bytes', async () => {
    expect((await text('é', 'escape-unicode')).toLowerCase()).toContain('\\u00e9');
    expect(await text('é', 'to-html-entity-all')).toBe('&#233;');
    expect((await text('é', 'escape-string')).toLowerCase()).toContain('\\xe9');
    expect(await text('\\u00e9', 'unescape-unicode')).toBe('é');
    expect(toHex(await bytesOut('\\u00e9', 'unescape-unicode'))).toBe('c3a9');
    expect(toHex(await bytesOut('&#233;&amp;', 'from-html-entity'))).toBe('c3a926');
    const escaped = await text('é', ['json-escape', { 'Escape non-ASCII': true }]);
    expect(escaped.toLowerCase()).toContain('\\u00e9');
    expect(await text(escaped, 'json-unescape')).toBe('é');
  });

  it('diacritics and smart characters are handled without mangling letters', async () => {
    expect(await text('Café naïve', 'remove-diacritics')).toBe('Cafe naive');
    const smart = await text('Café “quoted”', 'escape-smart-characters');
    expect(smart).toContain('Café');
    expect(smart).toContain('"quoted"');
  });

  it('alphabet encoders leave what they cannot map intact', async () => {
    expect(await text('Grüße', 'to-morse')).toBe('--. .-. ... ... .');
    expect(await text('aé', 'to-braille')).toBe('⠁é');
    expect(await text('aé', 'to-nato')).toContain('é');
  });

  it('rotation, transposition and keyword ciphers round-trip non-ASCII text', async () => {
    expect(await text('Café Ωμέγα', 'rot8000', 'rot8000')).toBe('Café Ωμέγα');
    expect(await text('Grüße Ωμέγα', 'rail-fence-encode', 'rail-fence-decode')).toBe('Grüße Ωμέγα');
    expect(await text('pässwörd', 'citrix-ctx1-encode', 'citrix-ctx1-decode')).toBe('pässwörd');
    expect(await text('Grüße Ωμέγα', 'lzstring-compress', 'lzstring-decompress')).toBe('Grüße Ωμέγα');
    expect(await text('Café Grüße', 'rake')).toContain('café');
  });

  it('NT hashes are computed over the password as text', async () => {
    expect(await text('password', 'nt-hash')).toBe('8846f7eaee8fb117ad06bdd830b7586c');
    const op = getOperation('nt-hash');
    expect(op).toBeDefined();
    expect(await text('pässwörd', 'nt-hash')).toBe(await op!.run('pässwörd', op!.args));
  });

  it('no text operation turns non-ASCII input into invalid UTF-8', async () => {
    const sample = encodeInput('Café Grüße ÉTÉ naïve Ωμέγα', 'UTF-8');
    const broken: string[] = [];
    for (const id of TEXT_OPERATION_IDS) {
      const result = await bake(sample, recipe([id]));
      if (result.error) continue;
      if (tryDecodeUtf8(Uint8Array.from(result.output, (c) => c.charCodeAt(0))) === null) broken.push(id);
    }
    expect(broken).toEqual([]);
  });
});

describe('file-format parsers read real structures', () => {
  const elf = fromHex(
    '7f454c46 02 01 01 00 0000000000000000' +
      '0200 3e00 01000000 0010400000000000 4000000000000000 0000000000000000' +
      '00000000 4000 3800 0000 4000 0000 0000',
  );

  const dosHeader = Array.from({ length: 0x40 }, (_, i) =>
    i === 0 ? '4d' : i === 1 ? '5a' : i === 0x3c ? '40' : '00',
  ).join('');
  const pe = fromHex(`${dosHeader}50450000 6486 0000 00000000 00000000 00000000 0000 2200`);

  const tiff = '49492a00 08000000 0100 0f01 0200 05000000 1a000000 00000000 5465737400';
  const app1Payload = `457869660000${tiff}`.replace(/\s+/g, '');
  const app1 = `ffe1${(app1Payload.length / 2 + 2).toString(16).padStart(4, '0')}${app1Payload}`;

  const crl = [
    '-----BEGIN X509 CRL-----',
    'MIIBdTBfAgEBMA0GCSqGSIb3DQEBCwUAMBwxGjAYBgNVBAMMEURlY29kZUJveCBU',
    'ZXN0IENBFw0yNjA5MTYyMzQxMTFaFw0yNjEwMTYyMzQxMTFaoA8wDTALBgNVHRQE',
    'BAICEAAwDQYJKoZIhvcNAQELBQADggEBAKo5a6dF6Es++TXSMaRY0Bv4S9aUTNWk',
    'XVSZg0Dvt01s65FBRCPGdM9OF47LvXumiNEZ4gEGdQLUvr+Uk92ufW4NO4BNepc9',
    'yznLAAMQM34JErc27i1PhLGC3VeQjnZGhSzt/idyD9VOXVMRRRX80bqRyHKPzl8T',
    'HEPatgolE7I7OxyTIf4tup9l5mjD22g+UQae8JFCaJmsGKef5PHNB4UROf9s50oz',
    'BlZ4ZQ7rGOrJjvy16K/8/+3O5MNjpn/SoMZgZ/384S+q4JL3C4e6lzU60UcWSgEA',
    'V1j+dCnWFp3PrQZIbcSvprQusS9tHDUTVW7Yl9cdVT8fib/+xAToauk=',
    '-----END X509 CRL-----',
  ].join('\n');

  it('ELF headers', async () => {
    const report = renderText(await bytesOut(elf, 'parse-elf'));
    for (const fact of ['64-bit', 'little', 'executable', 'x86-64', '0x401000']) {
      expect(report).toContain(fact);
    }
  });

  it('PE headers', async () => {
    const report = renderText(await bytesOut(pe, 'parse-pe'));
    expect(report).toContain('x86-64');
    expect(report).toContain('executable');
  });

  it('EXIF tags in a JPEG', async () => {
    const report = renderText(await bytesOut(fromHex(`ffd8${app1}ffd9`), 'extract-exif'));
    expect(report).toContain('Make');
    expect(report).toContain('Test');
  });

  it('Strip EXIF keeps every other byte, including the end marker', async () => {
    expect(toHex(await bytesOut(fromHex(`ffd8${app1}ffd9`), 'strip-exif'))).toBe('ffd8ffd9');

    const kept = 'ffdb0004aabb';
    const scan = 'ffda00040102112233ffd9';
    const photo = fromHex(`ffd8${kept}${app1}${scan}`);
    expect(toHex(await bytesOut(photo, 'strip-exif'))).toBe(`ffd8${kept}${scan}`);

    const padded = fromHex(`ffd8ffff${app1}${scan}`);
    const stripped = await bytesOut(padded, 'strip-exif');
    expect(stripped).not.toContain('Exif');
    expect(toHex(stripped).endsWith(scan)).toBe(true);
  });

  it('X.509 CRLs generated by OpenSSL', async () => {
    const report = renderText(await bytesOut(crl, 'parse-x509-crl'));
    expect(report).toContain('CN=DecodeBox Test CA');
    expect(report).toContain('sha256WithRSAEncryption');
    expect(report).toContain('2026-09-16T23:41:11Z');
    expect(report).toContain('2026-10-16T23:41:11Z');
  });
});
