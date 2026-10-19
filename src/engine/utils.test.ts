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
  const result = await bake(input, recipe(...entries));
  if (result.error) throw new Error(`${String(entries[0])}: ${result.error.message}`);
  return renderText(result.output);
}

async function failure(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (!result.error) throw new Error(`expected a failure, got '${result.output}'`);
  return result.error.message;
}

describe('casing', () => {
  it('swaps and alternates case', async () => {
    expect(await run('Hello World', 'swap-case')).toBe('hELLO wORLD');
    expect(await run('hello', 'alternating-caps')).toBe('hElLo');
    expect(await run('a-b-c', 'alternating-caps')).toBe('a-B-c');
  });

  it('lists every casing in the published order', async () => {
    expect(await run('test', 'get-all-casings')).toBe(
      'test\nTest\ntEst\nTEst\nteSt\nTeSt\ntESt\nTESt\ntesT\nTesT\ntEsT\nTEsT\nteST\nTeST\ntEST\nTEST',
    );
    expect(await run('t', 'get-all-casings')).toBe('t\nT');
  });

  it('refuses an input whose casings would not fit in a browser', async () => {
    expect(await failure('abcdefghijklmnopqrstuvwxyz', 'get-all-casings')).toMatch(/is the limit/);
  });

  it('widens a regular expression to match either case', async () => {
    expect(await run('S0meth!ng', 'to-case-insensitive-regex')).toBe(
      '[sS]0[mM][eE][tT][hH]![nN][gG]',
    );
    expect(await run('[A-Z]', 'to-case-insensitive-regex')).toBe('[A-Za-z]');
    expect(await run('[a-z]', 'to-case-insensitive-regex')).toBe('[A-Za-z]');
    expect(await run('[H-d]', 'to-case-insensitive-regex')).toBe('[A-DH-dh-z]');
    expect(await run('[!-D]', 'to-case-insensitive-regex')).toBe('[!-Da-d]');
    expect(await run('[%-^]', 'to-case-insensitive-regex')).toBe('[%-^a-z]');
    expect(await run('[K-`]', 'to-case-insensitive-regex')).toBe('[K-`k-z]');
  });

  it('collapses a widened expression back', async () => {
    expect(
      await run('[sS]0[mM][eE][tT][hH]![nN][Gg] [wr][On][g]?', 'from-case-insensitive-regex'),
    ).toBe('s0meth!nG [wr][On][g]?');
  });

  it('rewrites identifiers between the three code conventions', async () => {
    expect(await run('parseHTTPResponse', 'to-snake-case')).toBe('parse_http_response');
    expect(await run('parse_http_response', 'to-camel-case')).toBe('parseHttpResponse');
    expect(await run('Parse HTTP Response', 'to-kebab-case')).toBe('parse-http-response');
  });

  it('converts leet speak both ways', async () => {
    expect(await run('leet', 'convert-leet-speak')).toBe('l337');
    expect(await run('l337', ['convert-leet-speak', { Direction: 'From Leet Speak' }])).toBe(
      'leet',
    );
    expect(await run('HELLO', 'convert-leet-speak')).toBe('H3LL0');
    expect(await run('H3LL0', ['convert-leet-speak', { Direction: 'From Leet Speak' }])).toBe(
      'HeLLo',
    );
  });

  it('strips terminal colour codes', async () => {
    expect(await run('\x1b[31mred\x1b[0m text', 'remove-ansi-escape-codes')).toBe('red text');
  });

  it('escapes and unescapes a string literal', async () => {
    expect(await run('a\nb\tc', 'escape-string')).toBe('a\\nb\\tc');
    expect(await run("it's", 'escape-string')).toBe("it\\'s");
    expect(await run('aéb', ['escape-string', { 'Escape level': 'Everything' }])).toBe(
      '\\x61\\xe9\\x62',
    );
    expect(
      await run('aéb', ['escape-string', { 'Escape level': 'Everything', 'Uppercase hex': true }]),
    ).toBe('\\x61\\xE9\\x62');
    expect(await run('a\\nb\\x41\\u0042', 'unescape-string')).toBe('a\nbAB');
  });

  it('expands character ranges', async () => {
    expect(await run('a-f', 'expand-alphabet-range')).toBe('abcdef');
    expect(await run('0-9', ['expand-alphabet-range', { Delimiter: ',' }])).toBe(
      '0,1,2,3,4,5,6,7,8,9',
    );
  });

  it('adds combining marks without changing the letters', async () => {
    const struck = await run('ab', ['unicode-text-format', { Strikethrough: true }]);
    expect(struck).toBe('a̶b̶');
    expect(struck.replace(/̶/g, '')).toBe('ab');
  });
});

describe('comparison', () => {
  it('counts differing bytes and bits', async () => {
    expect(await run('ABCD\n\nABCE', 'hamming-distance')).toBe('1');
    expect(await run('ABCD\n\nABCE', ['hamming-distance', { Unit: 'Bit' }])).toBe('1');
    expect(await run('00\n\nff', ['hamming-distance', { Unit: 'Bit', 'Input type': 'Hex' }])).toBe(
      '8',
    );
  });

  it('refuses samples of different lengths', async () => {
    expect(await failure('AB\n\nABC', 'hamming-distance')).toMatch(/same length/);
  });

  it('measures the classic edit distance', async () => {
    expect(await run('kitten\nsitting', 'levenshtein-distance')).toBe('3');
    expect(await run('flaw\nlawn', 'levenshtein-distance')).toBe('2');
    expect(await run('same\nsame', 'levenshtein-distance')).toBe('0');
  });

  it('ranks fuzzy matches with the best first', async () => {
    const ranked = await run('src/engine/bytes.ts\nsrc/components/Pane.tsx\nREADME.md', [
      'fuzzy-match',
      { Search: 'byts' },
    ]);
    expect(ranked.split('\n')[0]).toContain('bytes.ts');
  });

  it('marks the offsets every sample agrees on', async () => {
    const report = await run('abcd\n\nabxd', 'offset-checker');
    expect(report.split('\n').pop()).toBe('^^ ^');
  });

  it('diffs by line, marking each side', async () => {
    const diff = await run('one\ntwo\nthree\n\none\n2\nthree', 'diff');
    expect(diff).toContain('- two');
    expect(diff).toContain('+ 2');
    expect(diff).toContain('  one');
  });

  it('diffs by character without markup', async () => {
    expect(await run('abc\n\nabd', ['diff', { 'Diff by': 'Character' }])).toBe('ab[-c-]{+d+}');
  });
});

describe('byte and line sequences', () => {
  it('takes and drops every nth byte', async () => {
    expect(await run('0123456789', 'take-nth-bytes')).toBe('048');
    expect(await run('0123456789', ['take-nth-bytes', { 'Starting at': 1 }])).toBe('159');
    expect(await run('0123456789', 'drop-nth-bytes')).toBe('1235679');
  });

  it('draws a path list as a tree', async () => {
    expect(
      await run(
        '/test_dir1/test_file1.txt\n/test_dir1/test_file2.txt\n/test_dir2/test_file1.txt',
        'file-tree',
      ),
    ).toBe('test_dir1\n|---test_file1.txt\n|---test_file2.txt\ntest_dir2\n|---test_file1.txt');
  });

  it('filters lines by pattern, and by the pattern inverted', async () => {
    expect(await run('alpha\nbeta\ngamma', ['filter', { Regex: '^a' }])).toBe('alpha');
    expect(
      await run('alpha\nbeta\ngamma', ['filter', { Regex: '^a', 'Invert condition': true }]),
    ).toBe('beta\ngamma');
  });

  it('keeps every piece when it shuffles', async () => {
    const shuffled = await run('a\nb\nc\nd\ne\nf', 'shuffle');
    expect(shuffled.split('\n').sort().join('')).toBe('abcdef');
  });

  it('generates the published De Bruijn sequence', async () => {
    expect(await run('', 'generate-de-bruijn-sequence')).toBe('00010111');
  });

  it('generates the number of random bytes asked for', async () => {
    expect((await run('', ['pseudo-random-number-generator', { 'Number of bytes': 16 }])).length).toBe(
      32,
    );
    const integers = await run('', [
      'pseudo-random-integer-generator',
      { 'Number of integers': 50, 'Min value': 1, 'Max value': 6 },
    ]);
    const values = integers.split(' ').map(Number);
    expect(values).toHaveLength(50);
    expect(values.every((v) => v >= 1 && v <= 6)).toBe(true);
  });

  it('generates the same filler text twice', async () => {
    const first = await run('', ['generate-lorem-ipsum', { Length: 2 }]);
    const second = await run('', ['generate-lorem-ipsum', { Length: 2 }]);
    expect(first).toBe(second);
    expect(first.startsWith('Lorem ipsum')).toBe(true);
  });
});

describe('units and identifiers', () => {
  it('converts lengths, data and mass', async () => {
    expect(
      await run('1', ['convert-distance', { 'Input units': 'Miles (mi)', 'Output units': 'Metres (m)' }]),
    ).toBe('1609.344');
    expect(
      await run('1024', [
        'convert-data-units',
        { 'Input units': 'Bytes (B)', 'Output units': 'Kibibytes (KiB)' },
      ]),
    ).toBe('1');
    expect(
      await run('1', ['convert-mass', { 'Input units': 'Pound (lb)', 'Output units': 'Gram (g)' }]),
    ).toBe('453.59237');
  });

  it('matches the published haversine distance', async () => {
    expect(await run('51.487263,-0.124323, 38.9517,-77.1467', 'haversine-distance')).toBe(
      '5902542.836',
    );
    expect(await run('51.487263,-0.124323, 51.487263,-0.124323', 'haversine-distance')).toBe(
      '0.000',
    );
  });

  it('converts to the unit it is asked for', async () => {
    expect(
      await run('51.487263,-0.124323, 38.9517,-77.1467', [
        'haversine-distance',
        { Units: 'Kilometres', 'Decimal places': 1 },
      ]),
    ).toBe('5902.5');
    expect(
      await run('51.487263,-0.124323, 38.9517,-77.1467', [
        'haversine-distance',
        { Units: 'Miles', 'Decimal places': 0 },
      ]),
    ).toBe('3668');
  });

  it('prints a colour in every notation', async () => {
    const report = await run('#d9edf7', 'parse-colour-code');
    expect(report).toContain('RGB:  rgb(217, 237, 247)');
    expect(report).toContain('Hex:  #d9edf7');
    expect(report).toContain('HSL:  hsl(200, 65%, 91%)');
  });

  it('reads UNIX permissions in both notations', async () => {
    const octal = await run('755', 'parse-unix-file-permissions');
    expect(octal).toContain('Textual representation: -rwxr-xr-x');
    const textual = await run('drwxr-xr-x', 'parse-unix-file-permissions');
    expect(textual).toContain('Octal representation:   755');
    expect(textual).toContain('File type: Directory');
    expect(await run('1777', 'parse-unix-file-permissions')).toContain('sticky bit is set');
  });

  it('reads the timestamp out of an ObjectID', async () => {
    expect(await run('507f1f77bcf86cd799439011', 'parse-objectid-timestamp')).toBe(
      '2012-10-17T21:13:27.000Z',
    );
  });

  it('reports the version and time of a UUID', async () => {
    const v4 = await run('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', 'analyse-uuid');
    expect(v4).toContain('Version: 4');
    expect(v4).toContain('RFC 4122');

    const v1 = await run('c232ab00-9414-11ec-b3c8-9f6bdeced846', 'analyse-uuid');
    expect(v1).toContain('Version: 1');
    expect(v1).toContain('2022-02-22');
  });

  it('says plainly when something is not a UUID', async () => {
    expect(await failure('not-a-uuid', 'analyse-uuid')).toMatch(/Not a UUID/);
  });
});
