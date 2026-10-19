import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
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
  return renderText(await rawRun(input, ...entries));
}

async function rawRun(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (result.error) throw new Error(`${String(entries[0])}: ${result.error.message}`);
  return result.output;
}

function outputHex(text: string): string {
  return Array.from(text, (c) => (c.charCodeAt(0) & 0xff).toString(16).padStart(2, '0')).join('');
}

async function failure(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (!result.error) throw new Error(`expected a failure, got '${result.output}'`);
  return result.error.message;
}

describe('IEEE 754 floats', () => {
  it('reads the bytes of 0.5 at both sizes and both byte orders', async () => {
    expect(await run('3f0000003f000000', 'from-hex', 'to-float')).toBe('0.5 0.5');
    expect(
      await run('0000003f0000003f', 'from-hex', ['to-float', { Endianness: 'Little Endian' }]),
    ).toBe('0.5 0.5');
    expect(
      await run('3fe00000000000003fe0000000000000', 'from-hex', [
        'to-float',
        { Size: 'Double (8 bytes)' },
      ]),
    ).toBe('0.5 0.5');
    expect(
      await run('000000000000e03f000000000000e03f', 'from-hex', [
        'to-float',
        { Size: 'Double (8 bytes)', Endianness: 'Little Endian' },
      ]),
    ).toBe('0.5 0.5');
  });

  it('writes the same bytes back', async () => {
    expect(outputHex(await rawRun('0.5 0.5', 'from-float'))).toBe('3f0000003f000000');
    expect(
      outputHex(
        await rawRun('0.5 0.5', [
          'from-float',
          { Endianness: 'Little Endian', Size: 'Double (8 bytes)' },
        ]),
      ),
    ).toBe('000000000000e03f000000000000e03f');
  });

  it('refuses a byte count that is not a whole number of floats', async () => {
    expect(await failure('3f00', 'from-hex', 'to-float')).toMatch(/multiple of 4/);
  });
});

describe('radix conversion', () => {
  it('reads integers and fractions in another base', async () => {
    expect(await run('1010', ['from-base', { Radix: 2 }])).toBe('10');
    expect(await run('10.1', ['from-base', { Radix: 2 }])).toBe('2.5');
    expect(await run('a.8', ['from-base', { Radix: 16 }])).toBe('10.5');
    expect(await run('77', ['from-base', { Radix: 8 }])).toBe('63');
    expect(await run('7.4', ['from-base', { Radix: 8 }])).toBe('7.5');
  });

  it('writes decimal back out in another base', async () => {
    expect(await run('255', ['to-base', { Radix: 16 }])).toBe('ff');
    expect(await run('2.5', ['to-base', { Radix: 2 }])).toBe('10.1');
    expect(await run('63', ['to-base', { Radix: 8 }])).toBe('77');
  });

  it('keeps every digit of an integer far beyond a float', async () => {
    const huge = '123456789012345678901234567890';
    expect(await run(huge, ['to-base', { Radix: 16 }], ['from-base', { Radix: 16 }])).toBe(huge);
  });

  it('rejects a digit the radix does not have, and an impossible radix', async () => {
    expect(await failure('2', ['from-base', { Radix: 2 }])).toMatch(/not a digit in base 2/);
    expect(await failure('10', ['from-base', { Radix: 40 }])).toMatch(/between 2 and 36/);
  });
});

describe('binary-coded decimal', () => {
  it('encodes the schemes CyberChef publishes vectors for', async () => {
    expect(await run('0', 'to-bcd')).toBe('0000');
    expect(await run('1234567890', ['to-bcd', { Packed: false }])).toBe(
      '0000 0001 0000 0010 0000 0011 0000 0100 0000 0101 0000 0110 0000 0111 0000 1000 0000 1001 0000 0000',
    );
    expect(
      await run('1234567890', ['to-bcd', { Signed: true, 'Output format': 'Bytes' }]),
    ).toBe('00000001 00100011 01000101 01100111 10001001 00001100');
    expect(
      await run('-1234567890', ['to-bcd', { Scheme: '8 4 -2 -1', Signed: true }]),
    ).toBe('0000 0111 0110 0101 0100 1011 1010 1001 1000 1111 0000 1101');
  });

  it('decodes them back, sign nibble included', async () => {
    expect(await run('0000', 'from-bcd')).toBe('0');
    expect(
      await run('00000001 00100011 01000101 01100111 10001001 00001101', [
        'from-bcd',
        { Signed: true, 'Input format': 'Bytes' },
      ]),
    ).toBe('-1234567890');
    expect(
      await run(
        '00000100 00000101 00000110 00000111 00001000 00001001 00001010 00001011 00001100 00000011',
        ['from-bcd', { Scheme: 'Excess-3', Packed: false, 'Input format': 'Bytes' }],
      ),
    ).toBe('1234567890');
  });

  it('round-trips through raw bytes', async () => {
    expect(
      await run(
        '1234567890',
        ['to-bcd', { Scheme: '4 2 2 1', Signed: true, 'Output format': 'Raw' }],
        ['from-bcd', { Scheme: '4 2 2 1', Signed: true, 'Input format': 'Raw' }],
      ),
    ).toBe('1234567890');
  });

  it('will not pretend a fraction is a whole number', async () => {
    expect(await failure('1.5', 'to-bcd')).toMatch(/whole decimal numbers/);
  });
});

describe('Base92', () => {
  it('matches the examples in the Base92 specification', async () => {
    expect(await run('', 'to-base92')).toBe('');
    expect(await run('AB', 'to-base92')).toBe('8y2');
    expect(await run('Hello!!', 'to-base92')).toBe(';K_$aOTo&');
    expect(await run('base-92', 'to-base92')).toBe('DX2?V<Y(*');
    expect(await run("G'_DW[B", 'from-base92')).toBe('ietf!');
  });

  it('names the character it could not read', async () => {
    expect(await failure('~', 'from-base92')).toMatch(/not a Base92 character/);
  });
});

describe('Bech32', () => {
  it('encodes the CyberChef vectors for both checksum constants', async () => {
    expect(await run('', 'to-bech32')).toBe('bc1gmk9yu');
    expect(await run('A', 'to-bech32')).toBe('bc1gyufle22');
    expect(await run('Hello', 'to-bech32')).toBe('bc1fpjkcmr0gzsgcg');
    expect(await run('test', ['to-bech32', { 'Human-readable part': 'custom' }])).toBe(
      'custom1w3jhxaq593qur',
    );
    expect(await run('', ['to-bech32', { Encoding: 'Bech32m' }])).toBe('bc1a8xfp7');
    expect(await run('Hello', ['to-bech32', { Encoding: 'Bech32m' }])).toBe('bc1fpjkcmr0a7qya2');
  });

  it('decodes the BIP-173 and BIP-350 vectors', async () => {
    expect(await run('bc1fpjkcmr0gzsgcg', ['from-bech32', { 'Output format': 'Raw' }])).toBe(
      'Hello',
    );
    expect(await run('BC1FPJKCMR0GZSGCG', ['from-bech32', { 'Output format': 'Raw' }])).toBe(
      'Hello',
    );
    expect(await run('bc1fpjkcmr0gzsgcg', ['from-bech32', { 'Output format': 'HRP: Hex' }])).toBe(
      'bc: 48656c6c6f',
    );
    expect(
      await run('abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw', [
        'from-bech32',
        { 'Output format': 'HRP: Hex' },
      ]),
    ).toBe('abcdef: 00443214c74254b635cf84653a56d7c675be77df');
    expect(
      await run('split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w', [
        'from-bech32',
        { 'Output format': 'HRP: Hex' },
      ]),
    ).toBe('split: c5f38b70305f519bf66d85fb6cf03058f3dde463ecd7918f2dc743918f2d');
    expect(
      await run('abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx', [
        'from-bech32',
        { 'Output format': 'HRP: Hex' },
      ]),
    ).toBe('abcdef: ffbbcdeb38bdab49ca307b9ac5a928398a418820');
  });

  it('handles SegWit addresses as witness version plus program', async () => {
    expect(
      await run('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', [
        'from-bech32',
        { 'Output format': 'Bitcoin scriptPubKey' },
      ]),
    ).toBe('0014751e76e8199196d454941c45d1b3a323f1433bd6');
    expect(
      await run('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', [
        'from-bech32',
        { 'Output format': 'Bitcoin scriptPubKey' },
      ]),
    ).toBe('512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
    expect(
      await run('BC1SW50QGDZ25J', ['from-bech32', { 'Output format': 'Bitcoin scriptPubKey' }]),
    ).toBe('6002751e');

    expect(
      await run('751e76e8199196d454941c45d1b3a323f1433bd6', [
        'to-bech32',
        { 'Input format': 'Hex', Mode: 'Bitcoin SegWit' },
      ]),
    ).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    expect(
      await run('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', [
        'to-bech32',
        { 'Input format': 'Hex', Mode: 'Bitcoin SegWit', Encoding: 'Bech32m', 'Witness version': 1 },
      ]),
    ).toBe('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0');
  });

  it('reports the reason a string is not valid Bech32', async () => {
    expect(await failure('bc1FpjKcmr0gzsgcg', 'from-bech32')).toMatch(/Mixed case/);
    expect(await failure('noseparator', 'from-bech32')).toMatch(/separator/);
    expect(await failure('bc1fpjkcmr0gzsgcx', 'from-bech32')).toMatch(/Checksum does not match/);
    expect(
      await failure('bc1fpjkcmr0gzsgcg', ['from-bech32', { Encoding: 'Bech32m' }]),
    ).toMatch(/Invalid Bech32m checksum/);
  });
});

describe('braille, modhex and COBS', () => {
  it('writes hello in six-dot braille', async () => {
    expect(await run('hello', 'to-braille')).toBe('⠓⠑⠇⠇⠕');
    expect(await run('⠓⠑⠇⠇⠕', 'from-braille')).toBe('HELLO');
  });

  it('matches the modhex vectors, delimiters included', async () => {
    expect(await run('aberystwyth', ['to-modhex', { Delimiter: 'None' }])).toBe(
      'hbhdhgidikieifiiikifhj',
    );
    expect(await run('aberystwyth', ['to-modhex', { Delimiter: 'Colon' }])).toBe(
      'hb:hd:hg:id:ik:ie:if:ii:ik:if:hj',
    );
    expect(
      await run('aberystwyth', ['to-modhex', { Delimiter: 'Comma', 'Bytes per line': 4 }]),
    ).toBe('hb,hd,hg,id,\nik,ie,if,ii,\nik,if,hj');
    expect(await run('uhkgkbuhkgkbugltlkugltkc', 'from-modhex')).toBe('救救孩子');
    expect(await run('uhKGkbUHkgkBUGltlkugltkc', 'from-modhex')).toBe('救救孩子');
  });

  it('matches the COBS examples from the specification', async () => {
    const cobs = async (hexIn: string) =>
      run(hexIn, 'from-hex', 'to-cobs', ['to-hex', { Delimiter: 'Space' }]);
    expect(await cobs('00')).toBe('01 01');
    expect(await cobs('00 00')).toBe('01 01 01');
    expect(await cobs('00 11 00')).toBe('01 02 11 01');
    expect(await cobs('11 22 00 33')).toBe('03 11 22 02 33');

    expect(
      await run('01 02 11 01', 'from-hex', 'from-cobs', ['to-hex', { Delimiter: 'Space' }]),
    ).toBe('00 11 00');
  });

  it('survives a run longer than a single COBS block', async () => {
    const long = 'a'.repeat(600);
    expect(await run(long, 'to-cobs', 'from-cobs')).toBe(long);
  });

  it('refuses COBS data with the delimiter byte still in it', async () => {
    expect(await failure('00 01', 'from-hex', 'from-cobs')).toMatch(/cannot contain a zero byte/);
  });
});

describe('caret and M- notation', () => {
  it('decodes the four escape shapes', async () => {
    const hex = async (input: string) => outputHex(await rawRun(input, 'caret-m-decode'));
    expect(await hex('^A')).toBe('01');
    expect(await hex('^?')).toBe('7f');
    expect(await hex('M-A')).toBe('c1');
    expect(await hex('M-^A')).toBe('81');
    expect(await hex('M-^?')).toBe('ff');
    expect(await hex('plain')).toBe('706c61696e');
  });
});

describe('text and integers', () => {
  it('matches the published conversions in both directions', async () => {
    expect(await run('"ABC"', 'text-integer')).toBe('4276803');
    expect(await run('"ABC"', ['text-integer', { 'Output format': 'Hexadecimal' }])).toBe(
      '0x414243',
    );
    expect(await run("'Hello'", 'text-integer')).toBe('310939249775');
    expect(await run('Hi', 'text-integer')).toBe('18537');
    expect(await run('0xFF', 'text-integer')).toBe('255');
    expect(await run('255', ['text-integer', { 'Output format': 'Hexadecimal' }])).toBe('0xff');
    expect(await run('4276803', ['text-integer', { 'Output format': 'String' }])).toBe('ABC');
    expect(await run('0x48656C6C6F', ['text-integer', { 'Output format': 'String' }])).toBe(
      'Hello',
    );
    expect(
      await run('113091951015816448506195587157728348242683688608116', [
        'text-integer',
        { 'Output format': 'String' },
      ]),
    ).toBe('Mary had a little cat');
    expect(await run('"  test  "', 'text-integer')).toBe('2314978187545944096');
  });

  it('says which character is out of range', async () => {
    expect(await failure('aΓa', 'text-integer')).toMatch(/outside Latin-1/);
  });
});

describe('smart characters', () => {
  it('replaces the substitutions a word processor makes', async () => {
    expect(await run('“hello” — ‘world’…', 'escape-smart-characters')).toBe(
      '"hello" -- \'world\'...',
    );
    expect(await run('a b', 'escape-smart-characters')).toBe('a b');
  });

  it('does what it is told with characters it has no mapping for', async () => {
    expect(await run('a中b', ['escape-smart-characters', { 'Unmappable characters': 'Remove' }])).toBe('ab');
    expect(
      await run('a中b', ['escape-smart-characters', { 'Unmappable characters': "Replace with '.'" }]),
    ).toBe('a.b');
    expect(await run('a中b', 'escape-smart-characters')).toBe('a中b');
  });
});

describe('hex content, PEM and TLV', () => {
  it('writes special bytes the way a Snort rule does', async () => {
    expect(await run('foo=bar', 'to-hex-content')).toBe('foo|3d|bar');
    expect(await run('foo|3d|bar', 'from-hex-content')).toBe('foo=bar');
    expect(await run('a b', ['to-hex-content', { Convert: 'Only special chars including spaces' }])).toBe(
      'a|20|b',
    );
    expect(await run('AB', ['to-hex-content', { Convert: 'All chars' }])).toBe('|4142|');
  });

  it('round-trips DER through PEM', async () => {
    const pem = await run('466f6f', 'hex-to-pem');
    expect(pem).toBe('-----BEGIN CERTIFICATE-----\nRm9v\n-----END CERTIFICATE-----\n');
    expect(await run(pem, 'pem-to-hex')).toBe('466f6f');
  });

  it('reports a PEM block with no footer', async () => {
    expect(await failure('-----BEGIN CERTIFICATE-----\nRm9v\n', 'pem-to-hex')).toMatch(
      /No matching/,
    );
  });

  it('splits length-value and key-length-value records', async () => {
    const lv = await run('\x05House\x04room\x04door', ['parse-tlv', { 'Type/Key size': 0 }]);
    expect(JSON.parse(lv)).toEqual([
      { length: 5, value: '486f757365' },
      { length: 4, value: '726f6f6d' },
      { length: 4, value: '646f6f72' },
    ]);

    const klv = await run('\x04\x05House\x05\x04room\x42\x04door', 'parse-tlv');
    expect(JSON.parse(klv)).toEqual([
      { key: '04', length: 5, value: '486f757365' },
      { key: '05', length: 4, value: '726f6f6d' },
      { key: '42', length: 4, value: '646f6f72' },
    ]);
  });

  it('reads BER long-form lengths whatever the declared length size', async () => {
    const input = '\x01\x82\x01\x00' + 'A'.repeat(256) + '\x02\x03ABC';
    const parsed: Array<{ key: string; length: number }> = JSON.parse(
      await run(input, ['parse-tlv', { 'Use BER': true }]),
    );
    expect(parsed.map((r) => [r.key, r.length])).toEqual([
      ['01', 256],
      ['02', 3],
    ]);
  });
});

describe('MIME encoded words', () => {
  it('decodes the RFC 2047 examples', async () => {
    expect(await run('(=?ISO-8859-1?Q?a?=)', 'mime-decoding')).toBe('(a)');
    expect(await run('(=?ISO-8859-1?Q?a?= b)', 'mime-decoding')).toBe('(a b)');
    expect(await run('(=?ISO-8859-1?Q?a?= =?ISO-8859-1?Q?b?=)', 'mime-decoding')).toBe('(ab)');
    expect(await run('(=?ISO-8859-1?Q?a?=\r\n =?ISO-8859-1?Q?b?=)', 'mime-decoding')).toBe('(ab)');
    expect(await run('Subject: =?UTF-8?B?Y2Fmw6k=?=', 'mime-decoding')).toBe('Subject: café');
    expect(await run('Subject: =?UTF-8?B?5pel5pys6Kqe?=', 'mime-decoding')).toBe(
      'Subject: 日本語',
    );
    expect(
      await run(
        '=?utf-8?q?=C3=89ric?= <eric@example.org>, =?utf-8?q?Ana=C3=AFs?= <anais@example.org>',
        'mime-decoding',
      ),
    ).toBe('Éric <eric@example.org>, Anaïs <anais@example.org>');
  });

  it('leaves a header with no encoded words alone', async () => {
    expect(await run('Subject: plain text', 'mime-decoding')).toBe('Subject: plain text');
  });
});

describe('Base64 offsets', () => {
  it('shows the run that survives every alignment', async () => {
    const report = await run('The quick brown fox', 'show-base64-offsets');
    expect(report).toContain('VGhlIHF1aWNrIGJyb3duIGZveA==');
    for (const line of report.split('\n')) {
      const stable = /^ {2}stable\s+(\S+)$/.exec(line);
      if (stable) expect(report).toContain(stable[1] as string);
    }
  });
});

describe('character sets', () => {
  it('writes text in the code page it is asked for', async () => {
    expect(
      outputHex(await rawRun('日本語', ['encode-text', { Encoding: 'Shift-JIS (Japanese)' }])),
    ).toBe('93fa967b8cea');
    expect(
      outputHex(
        await rawRun('привет', ['encode-text', { Encoding: 'Windows-1251 (Cyrillic)' }]),
      ),
    ).toBe('eff0e8e2e5f2');
    expect(
      outputHex(
        await rawRun('café', ['encode-text', { Encoding: 'Windows-1252 (Western European)' }]),
      ),
    ).toBe('636166e9');
  });

  it('reads those same bytes back', async () => {
    expect(
      await run('93fa967b8cea', 'from-hex', ['decode-text', { Encoding: 'Shift-JIS (Japanese)' }]),
    ).toBe('日本語');
    expect(
      await run('eff0e8e2e5f2', 'from-hex', [
        'decode-text',
        { Encoding: 'Windows-1251 (Cyrillic)' },
      ]),
    ).toBe('привет');
  });

  it('explains mojibake by showing the reading that produced it', async () => {
    expect(
      await run('636166c3a9', 'from-hex', [
        'decode-text',
        { Encoding: 'Windows-1252 (Western European)' },
      ]),
    ).toBe('cafÃ©');
  });

  it('keeps Latin-1 as Latin-1 rather than the Windows page that shadows it', async () => {
    expect(
      await run('80', 'from-hex', ['decode-text', { Encoding: 'ISO-8859-1 (Latin-1)' }]),
    ).toBe('\u0080');
    expect(
      await run('80', 'from-hex', [
        'decode-text',
        { Encoding: 'Windows-1252 (Western European)' },
      ]),
    ).toBe('€');
  });

  it('decodes the whole 0x80-0x9F block of Windows-1252 as the standard defines it', async () => {
    const expected =
      '€‚ƒ„…†‡' +
      'ˆ‰Š‹ŒŽ' +
      '‘’“”•–—' +
      '˜™š›œžŸ';

    const index = [
      0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
      0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
      0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
      0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
    ];
    expect([...expected].map((c) => c.codePointAt(0))).toEqual(index);

    const hex = Array.from({ length: 32 }, (_, i) => (0x80 + i).toString(16)).join('');
    expect(
      await run(hex, 'from-hex', ['decode-text', { Encoding: 'Windows-1252 (Western European)' }]),
    ).toBe(expected);

    const latin1 = Array.from({ length: 32 }, (_, i) => String.fromCharCode(0x80 + i)).join('');
    expect(
      await run(hex, 'from-hex', ['decode-text', { Encoding: 'ISO-8859-1 (Latin-1)' }]),
    ).toBe(latin1);
  });

  it('encodes Windows-1252 with the same table it decodes with', async () => {
    expect(
      await rawRun('€', ['encode-text', { Encoding: 'Windows-1252 (Western European)' }], 'to-hex'),
    ).toBe('80');
  });

  it('lists every reading when the encoding is unknown', async () => {
    const report = await run('93fa967b8cea', 'from-hex', 'text-encoding-brute-force');
    expect(report).toContain('日本語');
    expect(report.split('\n').length).toBeGreaterThan(20);
  });
});
