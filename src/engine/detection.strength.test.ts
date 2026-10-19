import { describe, expect, it } from 'vitest';
import { autoDecode, bake, detect, lastLayer, terminusOf, toChain } from './index';
import { findEmbedded } from './detection/embedded';
import { getOperation } from './operations';
import { shortCandidates } from './detection/short';
import type { RecipeStep } from './types';

function utf8Base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function wrap(value: string, times: number): string {
  let out = value;
  for (let i = 0; i < times; i++) out = btoa(out);
  return out;
}

async function run(input: string, steps: RecipeStep[]): Promise<string> {
  const result = await bake(input, { id: 'test', name: 'test', steps });
  expect(result.error).toBeUndefined();
  return result.output;
}

describe('depth', () => {
  /*
   * Six layers was the old limit, and the old limit is the bug: anything
   * wrapped more than six times ended with "there may be another layer below
   * this" rather than with the payload.
   */
  for (const times of [8, 12, 20, 24]) {
    it(`unwraps ${times} layers of Base64 without hitting a limit`, async () => {
      const root = await autoDecode(wrap('the flag is here', times));
      const chain = toChain(root);

      expect(chain).toHaveLength(times + 1);
      expect(lastLayer(root).output).toBe('the flag is here');
      expect(terminusOf(root)?.reason).toBe('plain');
      expect(terminusOf(root)?.complete).toBe(true);
    });
  }

  it('still stops for a reason that is not the depth limit', async () => {
    const root = await autoDecode('The deployment failed twice last night and nobody was paged.');
    expect(terminusOf(root)?.reason).toBe('plain');
  });
});

describe('text that is not ASCII', () => {
  /*
   * Decoded output used to be scored on printable ASCII bytes alone, which
   * declared every language needing more than one byte per character to be
   * binary noise. Base64 of Persian decoded perfectly and then scored 0.15.
   */
  const samples: Array<[string, string]> = [
    ['Persian', 'سلام دنیا، این یک پیام است'],
    ['Chinese', '这是一个测试消息'],
    ['French', 'café au lait très chaud'],
    ['Emoji', 'deploy failed ☕ retry later'],
    ['ASCII', 'hello world this is a message'],
  ];

  for (const [name, text] of samples) {
    it(`detects Base64 of ${name} text`, async () => {
      const encoded = utf8Base64(text);

      const [best] = await detect(encoded);
      expect(best?.id).toBe('from-base64');
      expect(best?.confidence ?? 0).toBeGreaterThanOrEqual(0.55);

      const root = await autoDecode(encoded);
      expect(toChain(root)).toHaveLength(2);
      expect(lastLayer(root).output).toBe(
        String.fromCharCode(...new TextEncoder().encode(text)),
      );
    });
  }
});

describe('input too short for the ordinary detectors', () => {
  it('reads bW1k as Base64', async () => {
    const [best] = shortCandidates('bW1k');
    expect(best?.format).toBe('Base64');
    expect(best?.preview).toBe('mmd');

    expect(lastLayer(await autoDecode('bW1k')).output).toBe('mmd');
  });

  it('reads short hex when it carries a hex letter', () => {
    expect(shortCandidates('6f6b6f')[0]?.preview).toBe('oko');
  });

  it('refuses a plain number that happens to be even-length', () => {
    expect(shortCandidates('505050')).toHaveLength(0);
  });

  it('refuses an ordinary lower-case word', () => {
    for (const word of ['test', 'abcd', 'code', 'mood', 'java']) {
      expect(shortCandidates(word), word).toHaveLength(0);
    }
  });

  it('refuses a decode that is not valid UTF-8 or is a control character', () => {
    expect(shortCandidates('//9/')).toHaveLength(0);
    expect(shortCandidates('A1B2')).toHaveLength(0);
  });

  it('says nothing about input the ordinary detectors can judge', () => {
    expect(shortCandidates('dGVzdGluZw==')).toHaveLength(0);
  });
});

describe('encoded data inside something larger', () => {
  it('finds Base64 glued to a prefix of ordinary text', async () => {
    const [find] = findEmbedded('testbTRzaA==');

    expect(find?.format).toBe('Base64');
    expect(find?.offset).toBe(4);
    expect(find?.source).toBe('bTRzaA==');
    expect(find?.decoded).toBe('m4sh');

    expect(await run('testbTRzaA==', find?.steps ?? [])).toBe('m4sh');
  });

  it('reports it on the input layer of a decode', async () => {
    const root = await autoDecode('testbTRzaA==');
    expect(root.embedded?.[0]?.decoded).toBe('m4sh');
  });

  it('finds a payload in the middle of a line', async () => {
    const line = 'msg=[dGhlIHNlY3JldCBpcyBoZXJl] level=warn';
    const [find] = findEmbedded(line);

    expect(find?.decoded).toBe('the secret is here');
    expect(await run(line, find?.steps ?? [])).toBe('the secret is here');
  });

  it('finds hex embedded in a sentence', () => {
    const [find] = findEmbedded('the key is 68656c6c6f20776f726c64 ok');
    expect(find?.format).toBe('Hex');
    expect(find?.decoded).toBe('hello world');
  });

  it('finds a JWT in a log line', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.abc';
    const [find] = findEmbedded(`GET /api 401 authorization=Bearer ${jwt}`);

    expect(find?.format).toBe('JWT');
    expect(find?.decoded).toContain('HS256');
  });

  it('says nothing about data that decodes as a whole', () => {
    expect(findEmbedded(utf8Base64('the whole thing is Base64 and nothing else'))).toHaveLength(0);
  });

  it('says nothing about ordinary prose', () => {
    expect(
      findEmbedded('The deployment failed twice last night and nobody was paged about it.'),
    ).toHaveLength(0);
    expect(findEmbedded('Please review the attached quarterly figures before Thursday.')).toHaveLength(0);
  });
});

describe('formats that were invisible', () => {
  /*
   * Each of these encodes cleanly and then was not recognised on the way
   * back. Braille is the sharpest case: its alphabet lives outside ASCII, so
   * the pattern was being matched against UTF-8 bytes and could never hit.
   */
  const roundTrips: Array<[string, string]> = [
    ['to-braille', 'from-braille'],
    ['to-base45', 'from-base45'],
    ['to-decimal', 'from-decimal'],
    ['to-base85', 'from-base85'],
    ['to-base32', 'from-base32'],
    ['to-base58', 'from-base58'],
    ['to-morse', 'from-morse'],
    ['to-binary', 'from-binary'],
    ['to-octal', 'from-octal'],
    ['to-uuencode', 'from-uuencode'],
  ];

  const sentence = 'The deployment failed twice last night and nobody was paged about it.';

  for (const [encoder, decoder] of roundTrips) {
    it(`recognises what ${encoder} produces`, async () => {
      const op = getOperation(encoder);
      expect(op, encoder).toBeDefined();

      const step: RecipeStep = {
        uid: encoder,
        opId: encoder,
        args: (op?.args ?? []).map((a) => ({ ...a })),
        disabled: false,
      };
      const encoded = await run(sentence, [step]);

      const [best] = await detect(encoded);
      expect(best?.id, `${encoder} -> ${best?.id ?? 'nothing'}`).toBe(decoder);
      expect(best?.confidence ?? 0).toBeGreaterThanOrEqual(0.55);
    });
  }

  it('does not read an ordinary column of numbers as bytes', async () => {
    for (const numbers of ['1024 2048 4096 8192 16384', '1999 2001 2004 2007 2011', '1 2 3 4 5 6 7 8']) {
      const found = await detect(numbers);
      expect(found.some((c) => c.id === 'from-decimal'), numbers).toBe(false);
    }
  });
});

describe('guessing by brute force', () => {
  const sentence = 'The deployment failed twice last night and nobody was paged about it.';

  it('still finds a real rotation', async () => {
    const rot13 = sentence.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });

    const [best] = await detect(rot13);
    expect(best?.format).toBe('ROT13');
  });

  /*
   * A log line with a Base64 blob in it reads poorly, so some rotation of it
   * always reads slightly better. That used to be enough to announce ROT5.
   */
  it('does not call an ordinary log line a rotation', async () => {
    const line =
      '2026-09-20 11:02:14 WARN auth: user=admin token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
      '.eyJzdWIiOiI0MiJ9.sig payload=aHR0cDovLzE5Mi4xNjguMS45OS9hLnBzMQ==';

    const found = await detect(line);
    expect(found.some((c) => c.id.startsWith('brute-rot')), 'claimed a rotation').toBe(false);
  });
});
