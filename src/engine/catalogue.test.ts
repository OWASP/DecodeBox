import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation, OPERATIONS, CATEGORY_ORDER } from './operations';
import type { Recipe } from './types';

type Entry = string | [string, Record<string, string | number | boolean>];

function recipe(...entries: Entry[]): Recipe {
  return {
    id: 'test',
    name: 'test',
    steps: entries.map((entry, i) => {
      const [opId, overrides] = typeof entry === 'string' ? [entry, {}] : entry;
      const op = getOperation(opId);
      if (!op) throw new Error(`Unknown operation '${opId}'`);
      return {
        uid: `s${i}`,
        opId,
        args: op.args.map((a) => ({ ...a, value: overrides[a.name] ?? a.value })),
        disabled: false,
      };
    }),
  };
}

async function run(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (result.error) throw new Error(`${String(entries[0])}: ${result.error.message}`);
  return renderText(result.output);
}

const byte = (...values: number[]) => values.map((v) => String.fromCharCode(v & 0xff)).join('');
const le16 = (n: number) => byte(n, n >> 8);
const le32 = (n: number) => byte(n, n >> 8, n >> 16, n >> 24);

function buildZip(name: string, content: string): string {
  const size = content.length;
  const local =
    'PK\x03\x04' + le16(20) + le16(0) + le16(0) + le16(0) + le16(0) +
    le32(0) + le32(size) + le32(size) + le16(name.length) + le16(0) + name + content;

  const central =
    'PK\x01\x02' + le16(20) + le16(20) + le16(0) + le16(0) + le16(0) + le16(0) +
    le32(0) + le32(size) + le32(size) + le16(name.length) + le16(0) + le16(0) +
    le16(0) + le16(0) + le32(0) + le32(0) + name;

  const eocd =
    'PK\x05\x06' + le16(0) + le16(0) + le16(1) + le16(1) +
    le32(central.length) + le32(local.length) + le16(0);

  return local + central + eocd;
}

function buildPe(): string {
  const optionalSize = 240;
  const coff =
    'PE\0\0' +
    le16(0x8664) + le16(1) + le32(1700000000) + le32(0) + le32(0) +
    le16(optionalSize) + le16(0x0022) +
    le16(0x20b) + '\0'.repeat(optionalSize - 2);

  const section =
    '.text\0\0\0' + le32(0x1000) + le32(0x1000) + le32(0x800) + le32(0x400) +
    le32(0) + le32(0) + le16(0) + le16(0) + le32(0x60000020);

  return 'MZ' + '\0'.repeat(0x3a) + le32(0x40) + coff + section;
}

describe('catalogue integrity', () => {
  it('has no duplicate ids or names', () => {
    const ids = OPERATIONS.map((o) => o.id);
    const names = OPERATIONS.map((o) => o.name);
    expect(new Set(ids).size, 'duplicate operation id').toBe(ids.length);
    expect(new Set(names).size, 'duplicate operation name').toBe(names.length);
  });

  it('gives every operation a real description, aliases and a known category', () => {
    for (const op of OPERATIONS) {
      expect(op.id, `${op.name} has a non-slug id`).toMatch(/^[a-z0-9-]+$/);
      expect(op.description.length, `${op.name} has a thin description`).toBeGreaterThan(15);
      expect(op.description.endsWith('.'), `${op.name} description is not a sentence`).toBe(true);
      expect(op.aliases.length, `${op.name} has no aliases`).toBeGreaterThan(0);
      expect(CATEGORY_ORDER, `${op.name} is in an unlisted category`).toContain(op.category);
    }
  });

  it('declares valid argument shapes', () => {
    for (const op of OPERATIONS) {
      for (const a of op.args) {
        if (a.type === 'option') {
          expect(a.options, `${op.name}.${a.name} is an option with no choices`).toBeDefined();
          expect(a.options).toContain(String(a.value));
        }
        if (a.type === 'toggleString') {
          expect(a.toggleValues, `${op.name}.${a.name} has no toggle values`).toBeDefined();
          expect(a.toggleValues).toContain(a.toggleValue);
        }
        if (a.type === 'number') expect(typeof a.value).toBe('number');
        if (a.type === 'boolean') expect(typeof a.value).toBe('boolean');
      }
    }
  });

  it('never crashes on hostile input, whatever the operation', async () => {
    const nasty = ['', '   ', '\0\0\0', '<script>alert(1)</script>', 'a'.repeat(3000), '💣🔥', '%%%%'];

    for (const op of OPERATIONS) {
      for (const input of nasty) {
        const result = await bake(input, recipe(op.id));
        expect(typeof result.output, `${op.name} returned a non-string`).toBe('string');
      }
    }
}, 240000);
});

describe('round trips', () => {
  it('recovers the original through every encode/decode pair', async () => {
    const text = 'The quick brown fox 0123456789';
    const pairs: Array<[string, string]> = [
      ['to-base64', 'from-base64'],
      ['to-base32', 'from-base32'],
      ['to-base58', 'from-base58'],
      ['to-base85', 'from-base85'],
      ['to-base45', 'from-base45'],
      ['to-base62', 'from-base62'],
      ['to-hex', 'from-hex'],
      ['to-octal', 'from-octal'],
      ['to-binary', 'from-binary'],
      ['to-decimal', 'from-decimal'],
      ['to-charcode', 'from-charcode'],
      ['url-encode', 'url-decode'],
      ['to-quoted-printable', 'from-quoted-printable'],
      ['to-uuencode', 'from-uuencode'],
      ['to-hexdump', 'from-hexdump'],
      ['gzip', 'gunzip'],
      ['zlib-deflate', 'zlib-inflate'],
      ['raw-deflate', 'raw-inflate'],
      ['json-escape', 'json-unescape'],
    ];

    for (const [encode, decode] of pairs) {
      expect(await run(text, encode, decode), `${encode} then ${decode}`).toBe(text);
    }
  });

  it('recovers through operations that are their own inverse', async () => {
    const text = 'Attack at dawn, 07:30.';
    for (const opId of ['rot13', 'rot47', 'atbash', 'not', 'reverse']) {
      expect(await run(text, opId, opId), opId).toBe(text);
    }
  });

  it('recovers through keyed ciphers', async () => {
    const text = 'MEETMEATTHEBRIDGE';
    expect(
      await run(text, ['vigenere-encode', { Key: 'LEMON' }], ['vigenere-decode', { Key: 'LEMON' }]),
    ).toBe(text);
    expect(await run(text, ['affine-encode', { a: 5, b: 8 }], ['affine-decode', { a: 5, b: 8 }])).toBe(
      text,
    );
    expect(
      await run(text, ['rail-fence-encode', { Rails: 4 }], ['rail-fence-decode', { Rails: 4 }]),
    ).toBe(text);
    expect(await run(text, 'a1z26-encode', 'a1z26-decode')).toBe(text);
    expect(await run(text, 'to-morse', 'from-morse')).toBe(text);
    expect(await run(text, ['rc4', { Key: 'secret' }], ['rc4', { Key: 'secret' }])).toBe(text);
  });

  it('round-trips AES through every supported mode', async () => {
    const text = 'classified: exfil at 0300';
    const key = '000102030405060708090a0b0c0d0e0f';

    const modes: Array<[string, string]> = [
      ['AES-GCM', '000102030405060708090a0b'],
      ['AES-CBC', '000102030405060708090a0b0c0d0e0f'],
      ['AES-CTR', '000102030405060708090a0b0c0d0e0f'],
    ];

    for (const [mode, iv] of modes) {
      const cipher = await run(text, ['aes-encrypt', { Key: key, IV: iv, Mode: mode }]);
      expect(cipher, `${mode} produced no ciphertext`).toMatch(/^[0-9a-f]+$/);
      expect(await run(cipher, ['aes-decrypt', { Key: key, IV: iv, Mode: mode }]), mode).toBe(text);
    }
  });

  it('refuses to decrypt GCM with the wrong key rather than returning garbage', async () => {
    const cipher = await run('secret', [
      'aes-encrypt',
      { Key: '00'.repeat(16), IV: '00'.repeat(12), Mode: 'AES-GCM' },
    ]);
    const result = await bake(
      cipher,
      recipe(['aes-decrypt', { Key: 'ff'.repeat(16), IV: '00'.repeat(12), Mode: 'AES-GCM' }]),
    );
    expect(result.error?.message).toContain('altered');
  });
});

describe('known answers', () => {
  it('matches published digests and checksums', async () => {
    expect(await run('abc', 'md5')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(await run('', 'md5')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(await run('The quick brown fox jumps over the lazy dog', 'md5')).toBe(
      '9e107d9d372bb6826bd81d3542a419d6',
    );
    expect(await run('abc', 'sha-256')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await run('123456789', 'crc-32')).toBe('cbf43926');
    expect(await run('123456789', 'crc-16')).toBe('4b37');
    expect(await run('Wikipedia', 'adler-32')).toBe('11e60398');
  });

  it('matches published encodings', async () => {
    expect(await run('Man ', 'to-base85')).toBe('9jqo^');
    expect(await run('AB', 'to-base45')).toBe('BB8');
    expect(await run('hello', 'to-base32')).toBe('NBSWY3DP');
    expect(await run('Hello World!', 'to-base58')).toBe('2NEpo7TZRRrLZSi2U');
    expect(await run('SOS', 'to-morse')).toBe('... --- ...');
    expect(await run('xn--mnchen-3ya.de', 'from-punycode')).toBe('münchen.de');
  });

  it('reads network structures correctly', async () => {
    const cidr = await run('192.168.1.130/26', 'cidr-range');
    expect(cidr).toContain('192.168.1.128/26');
    expect(cidr).toContain('255.255.255.192');
    expect(cidr).toContain('192.168.1.191');
    expect(cidr).toContain('62');

    expect(await run('2001:db8::1', 'expand-ipv6')).toBe('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(await run('2001:0db8:0000:0000:0000:0000:0000:0001', 'compress-ipv6')).toBe('2001:db8::1');
    expect(await run('192.168.1.1', ['change-ip-format', { To: 'Decimal' }])).toBe('3232235777');
    expect(await run('3232235777', ['change-ip-format', { To: 'Dotted decimal' }])).toBe(
      '192.168.1.1',
    );
  });

  it('identifies files from their magic bytes', async () => {
    expect(await run('\x89PNG\r\n\x1a\n rest of the file', 'detect-file-type')).toContain(
      'PNG image',
    );
    expect(await run('PK\x03\x04 and the rest', 'detect-file-type')).toContain('ZIP archive');
    expect(await run('nothing recognisable here at all', 'detect-file-type')).toContain(
      'No known file signature',
    );
  });

  it('handles structured data', async () => {
    const json = await run('name,role\nada,analyst\ngrace,lead', 'csv-to-json');
    expect(JSON.parse(json)).toEqual([
      { name: 'ada', role: 'analyst' },
      { name: 'grace', role: 'lead' },
    ]);
    expect(await run(json, 'json-to-csv')).toBe('name,role\nada,analyst\ngrace,lead');

    const quoted = await run('a,b\n"x,y",z', 'csv-to-json');
    expect((JSON.parse(quoted) as Array<{ a: string }>)[0]?.a).toBe('x,y');

    expect(await run('{"b":1,"a":2}', 'sort-json-keys')).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });

  it('transforms text as described', async () => {
    expect(await run('hello world foo', ['to-case', { Style: 'camelCase' }])).toBe('helloWorldFoo');
    expect(await run('helloWorldFoo', ['to-case', { Style: 'kebab-case' }])).toBe('hello-world-foo');
    expect(await run('a\nbb\nccc', ['head', { Lines: 2 }])).toBe('a\nbb');
    expect(await run('a\nbb\nccc', ['tail', { Lines: 2 }])).toBe('bb\nccc');
    expect(await run('one two one', ['count-occurrences', { Search: 'one' }])).toBe('2');
    expect(await run('<p>hi <b>there</b></p>', 'strip-html')).toBe('hi there');
    expect(await run('café', 'remove-diacritics')).toBe('cafe');
    expect(
      await run('a1 b2 c3', ['regular-expression', { Pattern: '[a-z](\\d)', 'Capture group': 1 }]),
    ).toBe('1\n2\n3');
  });

  it('converts between time representations', async () => {
    const parsed = await run('1735689600', 'from-unix-timestamp');
    expect(parsed).toContain('2025-01-01T00:00:00.000Z');
    expect(parsed).toContain('Wednesday');

    expect(await run('2025-01-01T00:00:00Z', 'to-unix-timestamp')).toBe('1735689600');

    const filetime = await run('2025-01-01T00:00:00Z', 'to-filetime');
    expect(filetime).toBe('133801632000000000');
    expect(await run(filetime, 'from-filetime')).toContain('2025-01-01T00:00:00.000Z');
  });

  it('reads image headers and renders them', async () => {
    const png = await run(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'from-base64',
      'image-info',
    );
    expect(png).toContain('PNG');
    expect(png).toContain('1 × 1');
    expect(png).toContain('truecolour');

    const uri = await run(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'from-base64',
      'render-image',
    );
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);

    const classified = await bake(uri, recipe('to-upper-case'));
    expect((await bake('x', recipe())).outputType).toBe('text');
    expect(classified.output.length).toBeGreaterThan(0);
  });

  it('refuses to render SVG, which is markup that can carry script', async () => {
    const result = await bake('<svg xmlns="http://www.w3.org/2000/svg"></svg>', recipe('render-image'));
    expect(result.error?.message).toContain('script');
  });

  it('reads a ZIP central directory and extracts an entry', async () => {
    const zip = buildZip('notes.txt', 'the payload was staged at 0300');
    const listing = await run(zip, 'list-zip');
    expect(listing).toContain('notes.txt');
    expect(listing).toContain('1 entries');
    expect(await run(zip, ['extract-from-zip', { File: 'notes.txt' }])).toBe(
      'the payload was staged at 0300',
    );
  });

  it('parses executable headers', async () => {
    const pe = buildPe();
    const parsed = await run(pe, 'parse-pe');
    expect(parsed).toContain('x86-64');
    expect(parsed).toContain('PE32+');

    const elf = 'ELF' + '' + ' '.repeat(8) + ' ' + '> ' + ' '.repeat(20);
    const elfOut = await run(elf, 'parse-elf');
    expect(elfOut).toContain('64-bit');
    expect(elfOut).toContain('x86-64');
    expect(elfOut).toContain('executable');
  });

  it('inspects a JWT without pretending to verify it', async () => {
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiZXhwIjoxNzM1Njg5NjAwfQ.sig';
    const report = await run(token, 'jwt-verify-shape');
    expect(report).toContain('HS256');
    expect(report).toContain('EXPIRED');
    expect(report).toContain('NOT verified');
  });
});

describe('arithmetic and logic', () => {
  it('computes set operations against two samples', async () => {
    const sets = '1,2,3\n\n3,4,5';
    expect(await run(sets, 'set-union')).toBe('1,2,3,4,5');
    expect(await run(sets, 'set-intersection')).toBe('3');
    expect(await run(sets, 'set-difference')).toBe('1,2');
    expect(await run(sets, 'symmetric-difference')).toBe('1,2,4,5');
    expect(await run('1,2\n\na,b', 'cartesian-product')).toBe('(1,a),(1,b),(2,a),(2,b)');
    expect(await run('1,2', 'power-set')).toBe('\n1\n2\n1,2');
  });

  it('names the delimiter that failed rather than guessing at one set', async () => {
    const result = await bake('1,2,3', recipe('set-union'));
    expect(result.error?.message).toContain('sample delimiter');
  });

  it('matches published arithmetic examples', async () => {
    expect(await run('0x0a 8 .5', 'sum')).toBe('18.5');
    expect(await run('0x0a 8 .5', 'divide')).toBe('2.5');
    expect(await run('1 2 3 4', 'mean')).toBe('2.5');
    expect(await run('1 3 2', 'median')).toBe('2');
    expect(await run('1 2 3 4', 'median')).toBe('2.5');
    expect(await run('1 2 3 4', 'standard-deviation')).toBe(String(Math.sqrt(1.25)));
    expect(await run('15 4 7', ['mod', { Modulus: 3 }])).toBe('0 1 1');
    expect(await run('2 3 4', 'multiply')).toBe('24');
    expect(await run('10 3 2', 'subtract')).toBe('5');
  });

  it('stays exact past the float limit, where a double would round', async () => {
    expect(await run('9007199254740993 1', 'sum')).toBe('9007199254740994');
    expect(await run('4294967296 4294967296', 'multiply')).toBe('18446744073709551616');
  });

  it('does number theory with published answers', async () => {
    expect(
      await run('', ['modular-exponentiation', { Base: '4', Exponent: '13', Modulus: '497' }]),
    ).toBe('445');
    expect(await run('4', ['modular-exponentiation', { Exponent: '13', Modulus: '497' }])).toBe(
      '445',
    );
    expect(await run('', ['modular-inverse', { 'Value (a)': '3', 'Modulus (m)': '11' }])).toBe('4');

    const gcd = await run('', ['extended-gcd', { 'Value a': '240', 'Value b': '46' }]);
    expect(gcd).toContain('gcd: 2');
    expect(gcd).toContain('x = -9');
    expect(gcd).toContain('y = 47');
  });

  it('refuses a modular inverse that does not exist', async () => {
    const result = await bake(
      '',
      recipe(['modular-inverse', { 'Value (a)': '2', 'Modulus (m)': '4' }]),
    );
    expect(result.error?.message).toContain('No inverse exists');
  });

  it('applies bitwise operations byte by byte', async () => {
    expect(await run('abc', ['or', { Key: 'ff' }])).toBe(byte(0xff, 0xff, 0xff));
    expect(await run('abc', ['and', { Key: '0f' }])).toBe(byte(1, 2, 3));
    expect(await run('abc', ['add', { Key: '01' }])).toBe('bcd');
    expect(await run('bcd', ['sub', { Key: '01' }])).toBe('abc');
  });

  it('rotates bits with and without carrying between bytes', async () => {
    expect(await run('abc', ['bit-rotate', { Amount: 4, Direction: 'Left' }])).toBe(
      await run('abc', ['bit-rotate', { Amount: 4, Direction: 'Right' }]),
    );

    const carried = await run('abc', [
      'bit-rotate',
      { Amount: 3, Direction: 'Left', 'Carry through': true },
    ]);
    expect(
      await run(carried, ['bit-rotate', { Amount: 3, Direction: 'Right', 'Carry through': true }]),
    ).toBe('abc');
  });

  it('keeps the sign bit on an arithmetic right shift', async () => {
    const high = byte(0x80);
    expect(await run(high, ['bit-shift', { Amount: 1, Direction: 'Right' }])).toBe(byte(0x40));
    expect(
      await run(high, ['bit-shift', { Amount: 1, Direction: 'Right', Type: 'Arithmetic shift' }]),
    ).toBe(byte(0xc0));
  });
});

describe('checksums', () => {
  const CHECK = '123456789';

  it('matches the published CRC check values', async () => {
    const cases: Array<[string, string]> = [
      ['CRC-3/GSM', '4'],
      ['CRC-5/USB', '19'],
      ['CRC-8', 'f4'],
      ['CRC-8/AUTOSAR', 'df'],
      ['CRC-8/BLUETOOTH', '26'],
      ['CRC-8/MAXIM-DOW', 'a1'],
      ['CRC-16/ARC', 'bb3d'],
      ['CRC-16/CCITT-FALSE', '29b1'],
      ['CRC-16/XMODEM', '31c3'],
      ['CRC-16/MODBUS', '4b37'],
      ['CRC-16/KERMIT', '2189'],
      ['CRC-32/ISO-HDLC', 'cbf43926'],
      ['CRC-32/BZIP2', 'fc891918'],
      ['CRC-32/CKSUM', '765e7680'],
      ['CRC-32/JAMCRC', '340bc6d9'],
      ['CRC-64/XZ', '995dc9bbdf1939fa'],
      ['CRC-64/ECMA-182', '6c40df5f0b497347'],
    ];

    for (const [algorithm, expected] of cases) {
      expect(await run(CHECK, ['crc-checksum', { Algorithm: algorithm }]), algorithm).toBe(expected);
    }
  });

  it('accepts a custom polynomial and reproduces a named model', async () => {
    expect(
      await run(CHECK, [
        'crc-checksum',
        {
          Algorithm: 'Custom',
          Width: 32,
          Polynomial: '04C11DB7',
          Initialisation: 'FFFFFFFF',
          'Reflect input': true,
          'Reflect output': true,
          'Final XOR': 'FFFFFFFF',
        },
      ]),
    ).toBe('cbf43926');
  });

  it('rejects a custom polynomial that is not hexadecimal', async () => {
    const result = await bake(
      CHECK,
      recipe(['crc-checksum', { Algorithm: 'Custom', Polynomial: 'nonsense' }]),
    );
    expect(result.error?.message).toContain('hexadecimal');
  });

  it('matches published Fletcher checksums', async () => {
    expect(await run('abcde', 'fletcher-32')).toBe('f04fc729');
    expect(await run('abcde', 'fletcher-64')).toBe('c8c6c527646362c6');
    expect(await run('abcdef', 'fletcher-32')).toBe('56502d2a');
    expect(await run('abcdefgh', 'fletcher-64')).toBe('312e2b28cccac8c6');
  });

  it('computes the internet header checksum', async () => {
    const header = byte(
      0x45, 0x00, 0x00, 0x73, 0x00, 0x00, 0x40, 0x00, 0x40, 0x11, 0x00, 0x00,
      0xc0, 0xa8, 0x00, 0x01, 0xc0, 0xa8, 0x00, 0xc7,
    );
    expect(await run(header, 'tcp-ip-checksum')).toBe('b861');
  });

  it('validates a card number with the Luhn check digit', async () => {
    const result = await run('453914880343646', 'luhn-checksum');
    expect(result).toContain('Checksum: 7');
    expect(result).toContain('453914880343646' + '7');
  });

  it('says which character broke a Luhn radix rather than skipping it', async () => {
    const result = await bake('12z4', recipe(['luhn-checksum', { Radix: 10 }]));
    expect(result.error?.message).toContain("'z'");
  });

  it('XORs blocks together and round-trips a parity bit', async () => {
    expect(await run(byte(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08), ['xor-checksum', { 'Block size': 4 }])).toBe(
      '0404040c',
    );

    const encoded = await run('A', ['parity-bit', { Mode: 'Even Parity', Position: 'Start' }]);
    expect(encoded).toBe('001000001');
    expect(
      await run(encoded, ['parity-bit', { Mode: 'Even Parity', Position: 'Start', Direction: 'Decode' }]),
    ).toBe('OK: A');
  });

  it('sweeps every checksum and can narrow to one width', async () => {
    const all = await run(CHECK, 'all-checksums');
    expect(all).toContain('cbf43926');
    expect(all.split('\n').length).toBeGreaterThan(150);

    const only64 = await run(CHECK, ['all-checksums', { 'Length (bits)': '64' }]);
    expect(only64).toContain('995dc9bbdf1939fa');
    expect(only64).not.toContain('cbf43926');
  });
});

describe('digests', () => {
  it('matches the published MD2 and MD4 vectors from their RFCs', async () => {
    expect(await run('', 'md2')).toBe('8350e5a3e24c153df2275c9f80692773');
    expect(await run('a', 'md2')).toBe('32ec01ec4a6dac72c0ab96fb34c0b5d1');
    expect(await run('abc', 'md2')).toBe('da853b0d3f88d99b30283a69e6ded6bb');
    expect(await run('message digest', 'md2')).toBe('ab4f496bfb2a530b219ff33031fe06b0');

    expect(await run('', 'md4')).toBe('31d6cfe0d16ae931b73c59d7e0c089c0');
    expect(await run('a', 'md4')).toBe('bde52cb31de33e46245e05fbdbd6fb24');
    expect(await run('abc', 'md4')).toBe('a448017aaf21d8525fc10ae87aa6729d');
    expect(await run('abcdefghijklmnopqrstuvwxyz', 'md4')).toBe(
      'd79e1c308aa5bbcdeea8ed63df412da9',
    );
  });

  it('matches the published SHA-0 vectors', async () => {
    expect(await run('abc', 'sha-0')).toBe('0164b8a914cd2a5e74c4f7ff082c4d97f1edf880');
    expect(await run('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', 'sha-0')).toBe(
      'd2516ee1acfa5baf33dfc1c471e438449ef134c8',
    );
  });

  it('matches the published RIPEMD vectors at every size', async () => {
    expect(await run('', ['ripemd', { Size: '160' }])).toBe(
      '9c1185a5c5e9fc54612808977ee8f548b2258d31',
    );
    expect(await run('abc', ['ripemd', { Size: '160' }])).toBe(
      '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc',
    );
    expect(await run('message digest', ['ripemd', { Size: '160' }])).toBe(
      '5d0689ef49d2fae572b881b123a85ffa21595f36',
    );

    expect(await run('', ['ripemd', { Size: '128' }])).toBe('cdf26213a150dc3ecb610f18f6b38b46');
    expect(await run('abc', ['ripemd', { Size: '128' }])).toBe('c14a12199c66e4ba84636b0f69144c77');

    expect(await run('', ['ripemd', { Size: '256' }])).toBe(
      '02ba4c4e5f8ecd1877fc52d64d30e37a2d9774fb1e5d026380ae0168e3c5522d',
    );
    expect(await run('abc', ['ripemd', { Size: '256' }])).toBe(
      'afbd6e228b9d8cbbcef5ca2d03e6dba10ac0bc7dcbe4680e1e42d2e975459b65',
    );

    expect(await run('', ['ripemd', { Size: '320' }])).toBe(
      '22d65d5661536cdc75c1fdf5c6de7b41b9f27325ebc61e8557177d705a0ec880151c3a32a00899b8',
    );
    expect(await run('abc', ['ripemd', { Size: '320' }])).toBe(
      'de4c01b3054f8930a79d09ae738e92301e5a17085beffdc1b8d116713e74f82fa942d64cdbc4682d',
    );
  });

  it('matches the published SM3 vectors', async () => {
    expect(await run('abc', 'sm3')).toBe(
      '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0',
    );
    expect(await run('abcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd', 'sm3')).toBe(
      'debe9ff92275b8a138604889c18e5a4d6fdb70e5387e5765293dcba39c0c5732',
    );
  });

  it('computes the NT hash of a password', async () => {
    expect(await run('password', 'nt-hash')).toBe('8846f7eaee8fb117ad06bdd830b7586c');
    expect(await run('', 'nt-hash')).toBe('31d6cfe0d16ae931b73c59d7e0c089c0');
  });

  it('matches the reference MurmurHash3 values', async () => {
    expect(await run('', ['murmurhash3', { Seed: 0 }])).toBe('0');
    expect(await run('', ['murmurhash3', { Seed: 1 }])).toBe('1364076727');
    expect(await run('test', ['murmurhash3', { Seed: 0 }])).toBe('3127628307');
    expect(await run('Hello, world!', ['murmurhash3', { Seed: 1234 }])).toBe('4210478515');
    expect(await run('test', ['murmurhash3', { Seed: 0, 'Convert to signed': true }])).toBe(
      '-1167338989',
    );
  });

  it('agrees with the hashes the platform does provide', async () => {
    expect(await run('abc', 'sha-0')).not.toBe(await run('abc', 'sha-1'));
  });
});

describe('the Keccak family', () => {
  it('matches the published SHA-3 vectors', async () => {
    expect(await run('', ['sha3', { Size: '256' }])).toBe(
      'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
    );
    expect(await run('abc', ['sha3', { Size: '224' }])).toBe(
      'e642824c3f8cf24ad09234ee7d3c766fc9a3a5168d0c94ad73b46fdf',
    );
    expect(await run('abc', ['sha3', { Size: '256' }])).toBe(
      '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532',
    );
    expect(await run('abc', ['sha3', { Size: '384' }])).toBe(
      'ec01498288516fc926459f58e2c6ad8df9b473cb0fc08c2596da7cf0e49be4b298d88cea927ac7f539f1edf228376d25',
    );
    expect(await run('abc', ['sha3', { Size: '512' }])).toBe(
      'b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e' +
        '10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0',
    );
  });

  it('matches the published original Keccak vectors, which SHA-3 does not', async () => {
    expect(await run('', ['keccak', { Size: '256' }])).toBe(
      'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
    expect(await run('abc', ['keccak', { Size: '256' }])).toBe(
      '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );
    expect(await run('', ['keccak', { Size: '512' }])).toBe(
      '0eab42de4c3ceb9235fc91acffe746b29c29a8c366b7c60e4e67c466f36a4304' +
        'c00fa9caf9d87976ba469bcbe06713b435f091ef2769fb160cdab33d3670680e',
    );

    expect(await run('abc', ['keccak', { Size: '256' }])).not.toBe(
      await run('abc', ['sha3', { Size: '256' }]),
    );
  });

  it('matches the published SHAKE vectors and extends to any length', async () => {
    expect(await run('', ['shake', { Capacity: '128', Size: 256 }])).toBe(
      '7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26',
    );
    expect(await run('', ['shake', { Capacity: '256', Size: 512 }])).toBe(
      '46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762f' +
        'd75dc4ddd8c0f200cb05019d67b592f6fc821c49479ab48640292eacb3b7c4be',
    );

    const long = await run('abc', ['shake', { Capacity: '128', Size: 512 }]);
    const short = await run('abc', ['shake', { Capacity: '128', Size: 128 }]);
    expect(long.startsWith(short)).toBe(true);
  });

  it('hashes input longer than one sponge block', async () => {
    expect(await run('a'.repeat(200), ['sha3', { Size: '256' }])).toHaveLength(64);
    expect(
      await run('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', ['sha3', { Size: '256' }]),
    ).toBe('41c0dba2a9d6240849100376a8235e2c82e1b9998a999e21db32dd97496d3376');
  });
});

describe('BLAKE2', () => {
  it('matches the RFC 7693 BLAKE2b vectors', async () => {
    expect(await run('', ['blake2b', { Size: '512' }])).toBe(
      '786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419' +
        'd25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce',
    );
    expect(await run('abc', ['blake2b', { Size: '512' }])).toBe(
      'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1' +
        '7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
    );
    expect(await run('abc', ['blake2b', { Size: '256' }])).toBe(
      'bddd813c634239723171ef3fee98579b94964e3bb1cb3e427262c8c068d52319',
    );
  });

  it('matches the RFC 7693 BLAKE2s vectors', async () => {
    expect(await run('', ['blake2s', { Size: '256' }])).toBe(
      '69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9',
    );
    expect(await run('abc', ['blake2s', { Size: '256' }])).toBe(
      '508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982',
    );
  });

  it('keys BLAKE2 into a MAC, changing the digest', async () => {
    const unkeyed = await run('abc', ['blake2b', { Size: '256' }]);
    const keyed = await run('abc', ['blake2b', { Size: '256', Key: 'secret' }]);
    expect(keyed).not.toBe(unkeyed);
    expect(keyed).toHaveLength(64);

    const other = await run('abc', ['blake2b', { Size: '256', Key: 'secreu' }]);
    expect(other).not.toBe(keyed);
  });

  it('can emit Base64 instead of hex', async () => {
    const hex = await run('abc', ['blake2s', { Size: '256' }]);
    const b64 = await run('abc', ['blake2s', { Size: '256', 'Output encoding': 'Base64' }]);
    expect(atob(b64).length).toBe(32);
    expect(
      Array.from(atob(b64))
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    ).toBe(hex);
  });

  it('hashes past a single block boundary', async () => {
    expect(await run('a'.repeat(300), ['blake2b', { Size: '512' }])).toHaveLength(128);
    expect(await run('a'.repeat(300), ['blake2s', { Size: '256' }])).toHaveLength(64);
  });
});
