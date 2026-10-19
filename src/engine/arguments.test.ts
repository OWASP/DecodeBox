import { describe, expect, it } from 'vitest';
import { OPERATIONS } from './operations/index';
import { renderText } from './core/bytes';


const BS = String.fromCharCode(92);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const NBSP = String.fromCharCode(160);

const byId = new Map(OPERATIONS.map((o) => [o.id, o]));

function run(id: string, input: string, over: Record<string, string | number | boolean> = {}) {
  const op = byId.get(id);
  if (!op) throw new Error(`no such operation: ${id}`);
  const result = op.run(
    input,
    op.args.map((a) => (a.name in over ? { ...a, value: over[a.name]! } : { ...a })),
  );
  if (typeof result !== 'string') throw new Error(`${id} is asynchronous`);
  return result;
}

describe('escaping unicode', () => {
  it('writes the escape syntax it is asked for', () => {
    expect(run('escape-unicode', 'café')).toBe(`caf${BS}u00e9`);
    expect(run('escape-unicode', 'café', { Prefix: '%u' })).toBe('caf%u00e9');
    expect(run('escape-unicode', 'café', { Prefix: 'U+' })).toBe('cafU+00e9');
  });

  it('terminates an HTML entity and nothing else', () => {
    expect(run('escape-unicode', 'café', { Prefix: '&#x' })).toBe('caf&#x00e9;');
  });

  it('escapes ASCII only when asked', () => {
    expect(run('escape-unicode', 'Hi')).toBe('Hi');
    expect(run('escape-unicode', 'Hi', { 'Encode all characters': true })).toBe(
      `${BS}u0048${BS}u0069`,
    );
  });

  it('widens a two-digit escape rather than truncating the character', () => {
    expect(run('escape-unicode', '☕', { Prefix: `${BS}x` })).toBe(`${BS}x2615`);
  });

  it('reads every prefix at once by default', () => {
    expect(renderText(run('unescape-unicode', `caf${BS}u00e9`))).toBe('café');
    expect(renderText(run('unescape-unicode', 'caf%u00e9'))).toBe('café');
    expect(renderText(run('unescape-unicode', 'cafU+00e9'))).toBe('café');
  });

  it('leaves the other prefixes alone when narrowed to one', () => {
    expect(run('unescape-unicode', `caf${BS}u00e9`, { Prefix: '%u' })).toBe(`caf${BS}u00e9`);
    expect(run('unescape-unicode', 'caf%u00e9', { Prefix: `${BS}u` })).toBe('caf%u00e9');
  });

  it('round-trips', () => {
    expect(renderText(run('unescape-unicode', run('escape-unicode', 'café ☕')))).toBe('café ☕');
  });
});

describe('HTML entities', () => {
  it('prefers the named entity, and can be told not to', () => {
    expect(run('to-html-entity', '<a>')).toBe('&lt;a&gt;');
    expect(run('to-html-entity', '<a>', { Format: 'Numeric' })).toBe('&#60;a&#62;');
    expect(run('to-html-entity', '<a>', { Format: 'Hex' })).toBe('&#x3c;a&#x3e;');
  });

  it('escapes everything when asked, which is what defeats a naive filter', () => {
    expect(run('to-html-entity', 'Hi', { 'Convert all characters': true })).toBe('&#72;&#105;');
  });

  it('round-trips through From HTML Entity', () => {
    const original = '<a href="x">&';
    expect(run('from-html-entity', run('to-html-entity', original))).toBe(original);
    expect(
      run('from-html-entity', run('to-html-entity', original, { 'Convert all characters': true })),
    ).toBe(original);
  });
});

describe('casing scope', () => {
  it('cases the whole input by default', () => {
    expect(run('to-upper-case', 'hello world. bye')).toBe('HELLO WORLD. BYE');
    expect(run('to-lower-case', 'HELLO')).toBe('hello');
  });

  it('cases each word, sentence or paragraph', () => {
    expect(run('to-upper-case', 'hello world. bye', { Scope: 'Word' })).toBe('Hello World. Bye');
    expect(run('to-upper-case', 'hello world. bye', { Scope: 'Sentence' })).toBe('Hello world. Bye');
    expect(run('to-upper-case', `one two${LF}three`, { Scope: 'Paragraph' })).toBe(
      `One two${LF}Three`,
    );
  });

  it('flattens what was already there, so the scope is the whole answer', () => {
    expect(run('to-upper-case', 'HELLO world', { Scope: 'Word' })).toBe('Hello World');
    expect(run('to-upper-case', 'hello WORLD', { Scope: 'Word' })).toBe('Hello World');
  });
});

describe('removing whitespace', () => {
  it('removes all of it by default', () => {
    expect(run('remove-whitespace', `a b${TAB}c${LF}d`)).toBe('abcd');
  });

  it('keeps what it is told to keep', () => {
    expect(run('remove-whitespace', `a b${TAB}c`, { Spaces: false })).toBe('a bc');
  });

  it('counts the non-breaking space, which is the invisible one', () => {
    expect(run('remove-whitespace', `a${NBSP}b`)).toBe('ab');
  });

  it('can take out the full stops a defanged address uses', () => {
    expect(run('remove-whitespace', '1.2.3.4', { 'Full stops': true })).toBe('1234');
    expect(run('remove-whitespace', '1.2.3.4')).toBe('1.2.3.4');
  });

  it('does nothing at all when nothing is selected', () => {
    expect(
      run('remove-whitespace', 'a b', {
        Spaces: false,
        'Carriage returns': false,
        'Line feeds': false,
        Tabs: false,
        'Form feeds': false,
      }),
    ).toBe('a b');
  });
});

describe('unique', () => {
  it('splits on the delimiter it is given', () => {
    expect(run('unique', `a${LF}b${LF}a`)).toBe(`a${LF}b`);
    expect(run('unique', 'a,b,a', { Delimiter: 'Comma' })).toBe('a,b');
  });

  it('counts occurrences the way uniq -c does', () => {
    expect(run('unique', `a${LF}b${LF}a`, { 'Display count': true })).toBe(`2 a${LF}1 b`);
  });
});

describe('byte listings', () => {
  it('writes the delimiter it is given', () => {
    expect(run('to-binary', 'Hi', { Delimiter: 'Comma' })).toBe('01001000,01101001');
    expect(run('to-hex-latin1', 'Hi', { Delimiter: 'Space', Uppercase: true })).toBe('48 69');
    expect(run('to-octal', 'Hi', { 'Pad to three digits': true })).toBe('110 151');
  });

  it('handles seven-bit ASCII listings, which are common and not bytes', () => {
    expect(run('to-binary', 'Hi', { 'Byte length': 7 })).toBe('1001000 1101001');
    expect(run('from-binary', '1001000 1101001', { 'Byte length': 7 })).toBe('Hi');
  });

  it('round-trips binary at the default width', () => {
    expect(run('from-binary', run('to-binary', 'Hi'))).toBe('Hi');
  });

  it('reads signed byte listings, which is how Java and C# dump them', () => {
    expect(run('to-decimal', String.fromCharCode(255), { 'Support signed values': true })).toBe(
      '-1',
    );
    expect(run('from-decimal', '-1', { 'Support signed values': true })).toBe(
      String.fromCharCode(255),
    );
  });

  it('still refuses a negative value when signed values are off', () => {
    expect(() => run('from-decimal', '-1')).toThrow();
  });

  it('decodes a listing whatever separates it', () => {
    expect(run('from-octal', '110,151')).toBe('Hi');
    expect(run('from-octal', '110 151')).toBe('Hi');
    expect(run('from-octal', `110;151`)).toBe('Hi');
  });
});

describe('line numbers', () => {
  it('starts where an excerpt actually starts', () => {
    expect(run('add-line-numbers', `a${LF}b`, { 'Start at': 998 })).toBe(`998 a${LF}999 b`);
  });

  it('widens for the last number, not the count', () => {
    expect(run('add-line-numbers', `a${LF}b${LF}c`, { 'Start at': 998 })).toContain('1000 c');
  });

  it('takes the separator it is given', () => {
    expect(run('add-line-numbers', 'a', { Separator: ': ' })).toBe('1: a');
    expect(run('add-line-numbers', `a${LF}b`, { 'Pad with zeros': true, 'Start at': 9 })).toBe(
      `09 a${LF}10 b`,
    );
  });
});

describe('defanging', () => {
  it('defangs everything by default', () => {
    expect(run('defang', 'http://bad.example.com/x')).toBe('hxxp[://]bad[.]example[.]com/x');
  });

  it('leaves alone what it is told to leave alone', () => {
    expect(run('defang', 'mail@bad.example.com', { 'At signs': false })).toBe(
      'mail@bad[.]example[.]com',
    );
    expect(run('defang', 'http://x.com', { Dots: false })).toBe('hxxp[://]x.com');
  });

  it('round-trips through refang in every bracket style', () => {
    const original = 'http://bad.example.com/x?a=1';
    for (const style of ['Square', 'Round', 'Curly']) {
      expect(run('refang', run('defang', original, { 'Bracket style': style }))).toBe(original);
    }
  });
});

describe('CIDR', () => {
  it('summarises by default', () => {
    expect(run('cidr-range', '10.0.0.0/30')).toContain('Netmask:    255.255.255.252');
  });

  it('lists the addresses when asked, which is what feeds the next step', () => {
    expect(run('cidr-range', '10.0.0.0/30', { Output: 'List every address' })).toBe(
      ['10.0.0.0', '10.0.0.1', '10.0.0.2', '10.0.0.3'].join(LF),
    );
    expect(run('cidr-range', '10.0.0.0/30', { Output: 'List usable hosts' })).toBe(
      ['10.0.0.1', '10.0.0.2'].join(LF),
    );
  });

  it('refuses to enumerate a block that would fill the window', () => {
    expect(() => run('cidr-range', '10.0.0.0/8', { Output: 'List every address' })).toThrow(
      /above the limit/,
    );
  });
});

describe('haversine', () => {
  it('converts rather than making you convert', () => {
    const london = '51.487263,-0.124323, 38.9517,-77.1467';
    expect(run('haversine-distance', london, { Units: 'Kilometres', 'Decimal places': 1 })).toBe(
      '5902.5',
    );
    expect(run('haversine-distance', london, { Units: 'Nautical miles', 'Decimal places': 0 })).toBe(
      '3187',
    );
  });

  it('stays a bare number, so it can feed the next step', () => {
    expect(run('haversine-distance', '0,0, 0,1', { Units: 'Kilometres' })).toMatch(/^[\d.]+$/);
  });
});

describe('sorting JSON keys', () => {
  it('sorts both ways', () => {
    expect(run('sort-json-keys', '{"b":1,"a":2}', { Indent: 0 })).toBe('{"a":2,"b":1}');
    expect(run('sort-json-keys', '{"b":1,"a":2}', { Indent: 0, Order: 'Descending' })).toBe(
      '{"b":1,"a":2}',
    );
  });

  it('can write one line, which is what a canonical-form checksum needs', () => {
    expect(run('sort-json-keys', '{"b":1,"a":{"d":1,"c":2}}', { Indent: 0 })).toBe(
      '{"a":{"c":2,"d":1},"b":1}',
    );
  });
});

describe('radix alphabets', () => {
  const payload = 'The quick brown fox';

  it('round-trips every Base58 alphabet', () => {
    for (const alphabet of ['Bitcoin (and IPFS)', 'Ripple', 'Flickr']) {
      expect(run('from-base58', run('to-base58', payload, { Alphabet: alphabet }), { Alphabet: alphabet })).toBe(
        payload,
      );
    }
  });

  it('produces different text for different Base58 alphabets', () => {
    const bitcoin = run('to-base58', payload, { Alphabet: 'Bitcoin (and IPFS)' });
    const ripple = run('to-base58', payload, { Alphabet: 'Ripple' });
    expect(bitcoin).not.toBe(ripple);
    expect(bitcoin).toHaveLength(ripple.length);
  });

  it('keeps Bitcoin as the default, so old recipes are unchanged', () => {
    expect(run('to-base58', payload)).toBe(run('to-base58', payload, { Alphabet: 'Bitcoin (and IPFS)' }));
  });

  it('round-trips every Base62 alphabet', () => {
    for (const alphabet of ['0-9A-Za-z', '0-9a-zA-Z', 'A-Za-z0-9', 'a-zA-Z0-9']) {
      expect(run('from-base62', run('to-base62', payload, { Alphabet: alphabet }), { Alphabet: alphabet })).toBe(
        payload,
      );
    }
  });

  it('round-trips every Base85 alphabet', () => {
    for (const alphabet of ['Ascii85 (standard)', 'Z85', 'RFC 1924 (IPv6)']) {
      expect(run('from-base85', run('to-base85', payload, { Alphabet: alphabet }), { Alphabet: alphabet })).toBe(
        payload,
      );
    }
  });

  it('uses the z shorthand only where it exists', () => {
    const zeros = String.fromCharCode(0, 0, 0, 0);
    expect(run('to-base85', zeros)).toBe('z');
    expect(run('to-base85', zeros, { Alphabet: 'Z85' })).not.toContain('z');
    expect(run('from-base85', run('to-base85', zeros, { Alphabet: 'Z85' }), { Alphabet: 'Z85' })).toBe(
      zeros,
    );
  });
});

describe('hexdump', () => {
  it('takes the width it is given', () => {
    const dump = run('to-hexdump', 'abcdefgh', { 'Bytes per line': 4 });
    expect(dump.split(LF)).toHaveLength(2);
    expect(dump.split(LF)[0]).toBe('00000000  61 62 63 64  |abcd|');
  });

  it('uppercases the offsets as well as the bytes', () => {
    expect(run('to-hexdump', String.fromCharCode(255), { 'Uppercase hex': true })).toContain('FF');
  });

  it('can print the trailing length line xxd writes', () => {
    const dump = run('to-hexdump', 'abc', { 'Include final length': true });
    expect(dump.split(LF).at(-1)).toBe('00000003');
  });

  it('round-trips at any width', () => {
    for (const width of [1, 4, 16, 32]) {
      expect(run('from-hexdump', run('to-hexdump', 'hello world', { 'Bytes per line': width }))).toBe(
        'hello world',
      );
    }
  });
});

describe('morse', () => {
  it('writes the default convention', () => {
    expect(run('to-morse', 'SOS HI')).toBe('... --- ... / .... ..');
  });

  it('round-trips every symbol format', () => {
    const cases: [string, string][] = [
      ['Dash/Dot', 'Dash is long'],
      ['Dot/Dash', 'Dot is long'],
      ['Underscore/Full stop', 'Dash is long'],
      ['Long/Short', 'Dash is long'],
    ];
    for (const [format, symbols] of cases) {
      expect(run('from-morse', run('to-morse', 'SOS', { Format: format }), { Symbols: symbols })).toBe(
        'SOS',
      );
    }
  });

  it('swaps the symbols in one pass', () => {
    expect(run('to-morse', 'SOS', { Format: 'Dot/Dash' })).toBe('--- ... ---');
  });

  it('round-trips every letter delimiter', () => {
    for (const delimiter of ['Space', 'Comma', 'Semi-colon']) {
      expect(run('from-morse', run('to-morse', 'HI', { 'Letter delimiter': delimiter }))).toBe('HI');
    }
  });

  it('round-trips every word delimiter', () => {
    for (const delimiter of ['Forward slash', 'Backslash', 'Line feed']) {
      expect(run('from-morse', run('to-morse', 'HI OK', { 'Word delimiter': delimiter }))).toBe(
        'HI OK',
      );
    }
  });

  it('offers no letter delimiter that a word break also uses', () => {
    const op = byId.get('to-morse');
    const letter = op?.args.find((a) => a.name === 'Letter delimiter');
    const word = op?.args.find((a) => a.name === 'Word delimiter');
    const overlap = (letter?.options ?? []).filter((o) => (word?.options ?? []).includes(o));
    expect(overlap).toEqual([]);
  });
});

describe('entropy', () => {
  it('gives a bare number when that is what feeds the next step', () => {
    expect(run('entropy', 'hello world', { Visualisation: 'Number only' })).toMatch(/^\d\.\d{4}$/);
  });

  it('draws a scale against the fixed maximum of eight', () => {
    const scale = run('entropy', 'hello world', { Visualisation: 'Scale' });
    expect(scale).toMatch(/^0 \[[#-]{24}\] 8/);
  });

  it('measures per block, which is what finds an encrypted region', () => {
    const flat = run('entropy', 'a'.repeat(600), { Visualisation: 'Per block', 'Block size': 256 });
    const lines = flat.split(LF).filter((l) => l.startsWith('0x'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('0.000');
  });

  it('states the ceiling, because a small block cannot reach eight', () => {
    expect(run('entropy', 'x'.repeat(128), { Visualisation: 'Per block', 'Block size': 64 })).toContain(
      'ceiling 6.00 bits',
    );
  });

  it('refuses a block size larger than the input rather than reporting nothing', () => {
    expect(() => run('entropy', 'short', { Visualisation: 'Per block', 'Block size': 256 })).toThrow(
      /shorter than one/,
    );
  });
});

describe('minifiers', () => {
  it('still refuses invalid JSON by default', () => {
    expect(() => run('json-minify', '{ "a": 1, }')).toThrow();
  });

  it('can compact invalid JSON without claiming it is valid', () => {
    expect(run('json-minify', '{ "a": 1, }', { 'On invalid JSON': 'Strip whitespace anyway' })).toBe(
      '{"a":1,}',
    );
  });

  it('leaves whitespace inside strings alone when stripping', () => {
    expect(
      run('json-minify', '{ "a b": "c d" }', { 'On invalid JSON': 'Strip whitespace anyway' }),
    ).toBe('{"a b":"c d"}');
  });

  it('keeps XML comments unless told otherwise', () => {
    expect(run('xml-minify', '<a> <!-- x --> <b/> </a>')).toBe('<a><!-- x --><b/></a>');
    expect(run('xml-minify', '<a> <!-- x --> <b/> </a>', { 'Preserve comments': false })).toBe(
      '<a><b/></a>',
    );
  });
});

describe('query strings', () => {
  it('sorts when asked, so two captures can be compared', () => {
    expect(run('parse-query-string', 'b=2&a=1', { 'Sort by name': true })).toBe('a  1' + LF + 'b  2');
  });

  it('keeps repeated names as an array rather than losing one', () => {
    expect(JSON.parse(run('parse-query-string', 'a=1&a=2&b=3', { Output: 'JSON' }))).toEqual({
      a: ['1', '2'],
      b: '3',
    });
  });

  it('writes one pair per line for feeding onwards', () => {
    expect(run('parse-query-string', 'b=2&a=1', { Output: 'One per line' })).toBe('b=2' + LF + 'a=1');
  });
});

describe('embedded file scan', () => {
  it('can skip the signature at offset zero, which is the file itself', () => {
    const png = String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) + 'x'.repeat(32);
    expect(run('scan-embedded-files', png)).toContain('0x00000000');
    expect(run('scan-embedded-files', png, { 'Ignore the first byte': true })).not.toContain(
      '0x00000000',
    );
  });
});

describe('A1Z26', () => {
  it('round-trips every delimiter', () => {
    for (const delimiter of ['Space', 'Comma', 'Hyphen', 'Line feed']) {
      expect(run('a1z26-decode', run('a1z26-encode', 'HI OK', { Delimiter: delimiter }))).toBe(
        'HI OK',
      );
    }
  });

  it('writes the delimiter it was given', () => {
    expect(run('a1z26-encode', 'HI', { Delimiter: 'Hyphen' })).toBe('8-9');
  });
});

describe('parse timestamp', () => {
  it('shows every plausible reading when the unit is not known', () => {
    expect(run('parse-timestamp', '1700000000')).toContain('As seconds:');
  });

  it('converts rather than reporting, once the unit is named', () => {
    const expected = '2023-11-14T22:13:20.000Z';
    expect(run('parse-timestamp', '1700000000', { Units: 'Seconds' })).toBe(expected);
    expect(run('parse-timestamp', '1700000000000', { Units: 'Milliseconds' })).toBe(expected);
    expect(run('parse-timestamp', '1700000000000000', { Units: 'Microseconds' })).toBe(expected);
    expect(run('parse-timestamp', '1700000000000000000', { Units: 'Nanoseconds' })).toBe(expected);
  });
});

describe('parse date and time', () => {
  it('reads an unzoned timestamp as UTC by default', () => {
    expect(run('parse-datetime', '2023-11-14 22:13:20')).toContain('14 Nov 2023 22:13:20 GMT');
  });

  it('can be told to read it as local time instead', () => {
    const local = run('parse-datetime', '2023-11-14 22:13:20', { Assume: 'Local time' });
    const utc = run('parse-datetime', '2023-11-14 22:13:20');
    if (new Date().getTimezoneOffset() !== 0) expect(local).not.toBe(utc);
  });

  it('never overrides a zone the string already carries', () => {
    expect(run('parse-datetime', '2023-11-14T22:13:20Z')).toContain('14 Nov 2023 22:13:20 GMT');
    expect(run('parse-datetime', '2023-11-14T22:13:20+05:30')).toContain(
      '14 Nov 2023 16:43:20 GMT',
    );
    expect(run('parse-datetime', '2023-11-14T22:13:20Z', { Assume: 'Local time' })).toContain(
      '22:13:20 GMT',
    );
  });
});

describe('detect file type', () => {
  const png = String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) + 'x'.repeat(20);

  it('reports by default', () => {
    expect(run('detect-file-type', png)).toContain('Extension:');
  });

  it('gives a bare extension for feeding a filename', () => {
    expect(run('detect-file-type', png, { Output: 'Extension only' })).toBe('png');
  });

  it('refuses rather than returning an empty extension for an unknown file', () => {
    expect(() => run('detect-file-type', 'x'.repeat(40), { Output: 'Extension only' })).toThrow();
  });
});

describe('gzip headers', () => {
  async function gzip(input: string, over: Record<string, string | number | boolean> = {}) {
    const op = byId.get('gzip')!;
    return String(
      await op.run(
        input,
        op.args.map((a) => (a.name in over ? { ...a, value: over[a.name]! } : { ...a })),
      ),
    );
  }
  const codes = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

  it('writes no optional fields by default', () => {
    return gzip('hello world').then((out) => {
      expect(codes(out)[3]).toBe(0);
    });
  });

  it('sets the FNAME and FCOMMENT flags when given them', async () => {
    const out = await gzip('hello world', { Filename: 'update.sh', Comment: 'ok' });
    expect(codes(out)[3]).toBe(0x18);
    expect(out.slice(10, 20)).toBe('update.sh' + String.fromCharCode(0));
  });

  it('still produces something gunzip reads', async () => {
    const out = await gzip('hello world', { Filename: 'update.sh', Comment: 'ok' });
    const gunzip = byId.get('gunzip')!;
    expect(await gunzip.run(out, [])).toBe('hello world');
  });

  it('stores a timestamp little-endian, as RFC 1952 says', async () => {
    const out = await gzip('x', { 'Modification time': 'Unix timestamp', Timestamp: 1700000000 });
    const b = codes(out);
    expect(((b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! << 24)) >>> 0)).toBe(1700000000);
  });
});

describe('file signatures', () => {
  const png = String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) + 'x'.repeat(30);

  it('names the kind a signature belongs to', () => {
    expect(run('detect-file-type', png, { Output: 'Kind only' })).toBe('Images');
  });

  it('filters a carve to one kind', () => {
    expect(run('scan-embedded-files', png, { 'Only this kind': 'Images' })).toContain('1 signature');
    expect(run('scan-embedded-files', png, { 'Only this kind': 'Archives' })).toBe(
      '(no file signatures found)',
    );
  });
});

describe('the remaining settings', () => {
  it('writes NATO with the delimiter and case it is given', () => {
    expect(run('to-nato', 'ab')).toBe('Alfa Bravo');
    expect(run('to-nato', 'ab', { Delimiter: 'Comma', Case: 'Upper case' })).toBe('ALFA, BRAVO');
  });

  it('wraps quoted-printable at the width it is given', () => {
    const out = run('to-quoted-printable', 'A'.repeat(40), { 'Line length': 20 });
    expect(out.split('\r\n')[0]).toHaveLength(20);
  });

  it('can escape JSON without the surrounding quotes', () => {
    expect(run('json-escape', 'a"b')).toBe('"a\\"b"');
    expect(run('json-escape', 'a"b', { 'Include the quotes': false })).toBe('a\\"b');
  });

  it('can escape everything above ASCII', () => {
    expect(run('json-escape', 'café', { 'Escape non-ASCII': true })).toBe('"caf\\u00e9"');
  });

  it('reads UTF-16 in either byte order', () => {
    const le = String.fromCharCode(0x68, 0, 0x69, 0);
    const be = String.fromCharCode(0, 0x68, 0, 0x69);
    expect(run('from-utf16le', le)).toBe('hi');
    expect(run('from-utf16le', be, { 'Byte order': 'Big-endian' })).toBe('hi');
    expect(run('from-utf16le', be)).not.toBe('hi');
  });

  it('gives parse-uri a machine-readable form', () => {
    const parsed = JSON.parse(run('parse-uri', 'https://a.com:8443/p?x=1#f', { Output: 'JSON' }));
    expect(parsed.port).toBe('8443');
    expect(parsed.query).toEqual({ x: '1' });
  });
});

describe('ROT brute force', () => {
  it('samples rather than printing twenty-five copies of a long message', () => {
    const long = 'a'.repeat(500);
    const out = run('rot-n', long, { 'Sample length': 10 });
    expect(out.split(LF)).toHaveLength(25);
    expect(out.split(LF)[0]).toBe(' 1: bbbbbbbbbb');
  });

  it('can drop the labels, for feeding the list onwards', () => {
    expect(run('rot-n', 'abc', { 'Print rotation amount': false }).split(LF)[0]).toBe('bcd');
  });
});
