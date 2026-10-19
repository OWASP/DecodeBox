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

describe('Bacon cipher', () => {
  const encoded =
    '00011 00100 00010 01101 00011 01000 01100 00110 00001 00000 00010 01101 01100 10100 01101 10000 01001 10001';

  it('decodes the published vector in every translation', async () => {
    expect(await run(encoded, 'bacon-decode')).toBe('DECODINGBACONWORKS');
    expect(
      await run(encoded.replace(/[01]/g, (b) => (b === '0' ? '1' : '0')), [
        'bacon-decode',
        { 'Invert translation': true },
      ]),
    ).toBe('DECODINGBACONWORKS');
    expect(
      await run(encoded.replace(/0/g, 'a').replace(/1/g, 'b'), [
        'bacon-decode',
        { Translation: 'A/B' },
      ]),
    ).toBe('DECODINGBACONWORKS');
  });

  it('encodes the published sentence exactly', async () => {
    const sentence = "There's a fox, and it jumps over the fence.";
    expect(await run(sentence, 'bacon-encode')).toBe(
      '10010 00111 00100 10000 00100 10001 00000 00101 01101 10101 00000 01100 00011 01000 ' +
        '10010 01000 10011 01011 01110 10001 01101 10011 00100 10000 10010 00111 00100 00101 ' +
        '00100 01100 00010 00100',
    );
    expect(await run(sentence, ['bacon-encode', { Translation: 'A/B' }])).toBe(
      'BAABA AABBB AABAA BAAAA AABAA BAAAB AAAAA AABAB ABBAB BABAB AAAAA ABBAA AAABB ABAAA ' +
        'BAABA ABAAA BAABB ABABB ABBBA BAAAB ABBAB BAABB AABAA BAAAA BAABA AABBB AABAA AABAB ' +
        'AABAA ABBAA AAABA AABAA',
    );
    expect(await run(sentence, ['bacon-encode', { Alphabet: 'Complete' }])).toBe(
      '10011 00111 00100 10001 00100 10010 00000 00101 01110 10111 00000 01101 00011 01000 ' +
        '10011 01001 10100 01100 01111 10010 01110 10101 00100 10001 10011 00111 00100 00101 ' +
        '00100 01101 00010 00100',
    );
  });

  it('reads a message hidden in letter case', async () => {
    expect(
      await run('abcdefghiJ', ['bacon-decode', { Translation: 'Case' }]),
    ).toBe('AB');
  });
});

describe('Bifid cipher', () => {
  it('round-trips with a keyword', async () => {
    const encoded = await run('Attack at dawn', ['bifid-encode', { Keyword: 'decodebox' }]);
    expect(encoded).not.toBe('Attack at dawn');
    expect(await run(encoded, ['bifid-decode', { Keyword: 'decodebox' }])).toBe('Attack at dawn');
  });

  it('keeps punctuation and case where it found them', async () => {
    const encoded = await run('Hello, World!', ['bifid-encode', { Keyword: '' }]);
    expect(encoded).toMatch(/^[A-Za-z]{5}, [A-Za-z]{5}!$/);
  });

  it('refuses a key that is not letters', async () => {
    const result = await bake('abc', recipe(['bifid-encode', { Keyword: 'key1' }]));
    expect(result.error?.message).toMatch(/letters of the English alphabet/);
  });
});

describe('Caesar box', () => {
  it('matches the published vectors', async () => {
    expect(await run('Hello World!', ['caesar-box-cipher', { 'Box height': 3 }])).toBe('Hlodeor!lWl');
    expect(await run('Hlodeor!lWl', ['caesar-box-cipher', { 'Box height': 4 }])).toBe('HelloWorld!');
  });
});

describe('Cetacean cipher', () => {
  it('matches the published vector', async () => {
    expect(await run('a b c で', 'cetacean-encode')).toBe(
      'EEEEEEEEEeeEEEEe EEEEEEEEEeeEEEeE EEEEEEEEEeeEEEee EEeeEEEEEeeEEeee',
    );
    expect(
      await run(
        'EEEEEEEEEeeEEEEe EEEEEEEEEeeEEEeE EEEEEEEEEeeEEEee EEeeEEEEEeeEEeee',
        'cetacean-decode',
      ),
    ).toBe('a b c で');
  });
});

describe('ROR13', () => {
  it('matches the hashes shellcode uses', async () => {
    expect(await run('AddConsoleAliasW', 'ror13')).toBe('0x9916128C');
    expect(await run('LoadLibraryA', 'ror13')).toBe('0xEC0E4E8E');
    expect(await run('CloseHandle', 'ror13')).toBe('0x0FFD97FB');
  });
});

describe('ROT8000 and ROT47 brute force', () => {
  it('rotates back to itself when applied twice', async () => {
    const text = 'Hello, world! 你好';
    expect(await run(text, 'rot8000', 'rot8000')).toBe(text);
  });

  it('lists every ROT47 rotation, one of which is the plaintext', async () => {
    const rotated = await run('Hello, World!', ['rot47', { Amount: 20 }]);
    const all = await run(rotated, 'rot47-brute-force');
    expect(all.split('\n')).toHaveLength(93);
    expect(all).toContain('Hello, World!');
  });
});

describe('Citrix CTX1', () => {
  it('round-trips a password', async () => {
    const encoded = await run('password', 'citrix-ctx1-encode');
    expect(encoded).toMatch(/^[A-P]+$/);
    expect(await run(encoded, 'citrix-ctx1-decode')).toBe('password');
  });

  it('refuses a length that cannot be CTX1', async () => {
    const result = await bake('ABC', recipe('citrix-ctx1-decode'));
    expect(result.error?.message).toMatch(/multiple of 4/);
  });
});
