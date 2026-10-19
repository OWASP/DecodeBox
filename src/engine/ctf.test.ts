import { describe, expect, it } from 'vitest';
import { bake, hints, renderText } from './index';
import {
  alphabetHints,
  caesarShift,
  findFlags,
  indexOfCoincidence,
  letters,
  vigenereKey,
} from './ctf';
import { getOperation } from './operations';
import type { Hint } from './ctf';


const b64 = (text: string): string => Buffer.from(text, 'latin1').toString('base64');

async function run(steps: Hint['steps'], input: string): Promise<string> {
  const result = await bake(input, { id: 'ctf', name: 'hint', steps });
  if (result.error) throw new Error(result.error.message);
  return renderText(result.output);
}

function find(list: Hint[], match: RegExp): Hint | undefined {
  return list.find((h) => match.test(h.title));
}

const PROSE =
  'The certificate was issued last spring and nobody noticed that it had already expired ' +
  'by the time the service was deployed to production. The monitoring stayed green for ' +
  'eleven days because the check only looked at whether the port was open, and the port ' +
  'was open the whole time. Somebody eventually opened the page in a browser.';

function caesar(text: string, shift: number): string {
  return text.replace(/[a-z]/gi, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + shift) % 26) + base);
  });
}

function vigenere(text: string, key: string): string {
  let k = 0;
  return text.replace(/[a-z]/gi, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    const shift = key.toUpperCase().charCodeAt(k++ % key.length) - 65;
    return String.fromCharCode(((char.charCodeAt(0) - base + shift) % 26) + base);
  });
}

describe('flags', () => {
  it('finds the shape rather than a list of known prefixes', () => {
    const found = findFlags('nothing here except zzzctf{a_prefix_nobody_has_heard_of}', 0, '');
    expect(found).toHaveLength(1);
    expect(found[0]?.text).toBe('zzzctf{a_prefix_nobody_has_heard_of}');
    expect(found[0]?.known).toBe(false);
  });

  it('marks a well-known prefix as known', () => {
    expect(findFlags('picoCTF{s0m3_t3xt}', 0, '')[0]?.known).toBe(true);
    expect(findFlags('HTB{another_one}', 0, '')[0]?.known).toBe(true);
  });

  it('promotes the format the user declared', () => {
    const found = findFlags('weirdname{value}', 0, '', 'weirdname');
    expect(found[0]?.known).toBe(true);
  });

  it('searches for a declared format that is not brace-shaped', () => {
    const found = findFlags('the answer is CTF-9f3a2b1c0d and nothing else', 0, '', 'CTF-');
    expect(found.map((f) => f.text)).toContain('CTF-9f3a2b1c0d');
  });

  it('does not call ordinary code a flag', () => {
    expect(findFlags('if (x) { doSomething(); }', 0, '')).toHaveLength(0);
    expect(findFlags('function f() {}', 0, '')).toHaveLength(0);
  });
});

describe('index of coincidence', () => {
  it('separates English from a polyalphabetic cipher', () => {
    const english = indexOfCoincidence(letters(PROSE));
    const enciphered = indexOfCoincidence(letters(vigenere(PROSE, 'LEMON')));

    expect(english).toBeGreaterThan(0.06);
    expect(enciphered).toBeLessThan(0.05);
  });

  it('is unchanged by a Caesar shift, which is the point of it', () => {
    const before = indexOfCoincidence(letters(PROSE));
    const after = indexOfCoincidence(letters(caesar(PROSE, 11)));
    expect(after).toBeCloseTo(before, 10);
  });
});

describe('key recovery', () => {
  it('recovers a Caesar shift', () => {
    for (const shift of [3, 7, 13, 19, 25]) {
      const guess = caesarShift(caesar(PROSE, shift));
      expect(guess?.shift, `shift ${shift}`).toBe((26 - shift) % 26);
    }
  });

  it('refuses to guess a shift for text that is not monoalphabetic', () => {
    expect(caesarShift(vigenere(PROSE, 'LEMON'))).toBeNull();
    expect(caesarShift('too short')).toBeNull();
  });

  it('recovers a Vigenère key and its length', () => {
    for (const key of ['LEMON', 'ATTACK', 'DECODEBOX']) {
      const guess = vigenereKey(vigenere(PROSE, key));
      expect(guess?.key, key).toBe(key);
      expect(guess?.keyLength, key).toBe(key.length);
    }
  });

  it('refuses to invent a key for plain English', () => {
    expect(vigenereKey(PROSE)).toBeNull();
  });

  it('refuses an encoding that merely looks alphabetic', () => {
    const encoded = Buffer.from(PROSE, 'latin1').toString('base64');
    expect(vigenereKey(encoded)).toBeNull();
    expect(caesarShift(encoded)).toBeNull();

    expect(vigenereKey(Buffer.from(PROSE, 'latin1').toString('hex'))).toBeNull();
    expect(caesarShift(Buffer.from(PROSE, 'latin1').toString('hex'))).toBeNull();

    expect(vigenereKey(encoded + vigenere(PROSE, 'LEMON'))).toBeNull();
  });

  it('still works on ciphertext with the spaces stripped', () => {
    const stripped = vigenere(PROSE, 'LEMON').replace(/[^a-z]/gi, '');
    expect(vigenereKey(stripped)?.key).toBe('LEMON');
  });
});

describe('alphabet hints', () => {
  it('reads the alphabet, not the content', () => {
    const cases: Array<[string, string]> = [
      ['01001000 01101001 00100001 00100001', 'from-binary'],
      ['.... . .-.. .-.. ---', 'from-morse'],
      ['72 101 108 108 111 33', 'from-decimal'],
      ['8 5 12 12 15', 'a1z26-decode'],
    ];

    for (const [text, opId] of cases) {
      const found = alphabetHints(text);
      expect(found.map((h) => h.opId), text).toContain(opId);
    }
  });

  it('states the observation it made, every time', () => {
    for (const hint of alphabetHints('01001000 01101001 00100001 00100001')) {
      expect(hint.reason.length).toBeGreaterThan(10);
    }
  });

  it('says nothing about ordinary prose', () => {
    expect(alphabetHints(PROSE)).toHaveLength(0);
  });
});

describe('CTF mode', () => {
  it('finds a flag buried under three encodings', async () => {
    const buried = b64(b64(Buffer.from('flag{layers_all_the_way_down}', 'latin1').toString('hex')));
    const report = await hints(buried);

    expect(report.flags.map((f) => f.text)).toContain('flag{layers_all_the_way_down}');
    expect(report.flags[0]?.depth).toBe(3);
    expect(report.hints[0]?.kind).toBe('flag');
    expect(report.hints[0]?.title).toBe('flag{layers_all_the_way_down}');
  });

  it('gives a recipe that reaches the flag from the original input', async () => {
    const buried = b64(b64(Buffer.from('flag{reachable}', 'latin1').toString('hex')));
    const report = await hints(buried);

    const hint = report.hints[0]!;
    expect(hint.steps.length).toBeGreaterThan(0);
    expect(await run(hint.steps, buried)).toContain('flag{reachable}');
  });

  it('runs every recipe it hands out, from the input, without failing', async () => {
    const report = await hints(b64(caesar('The password for the archive is hunter2. ' + PROSE, 8)));

    const withSteps = report.hints.filter((h) => h.steps.length > 0);
    expect(withSteps.length).toBeGreaterThan(0);

    for (const hint of withSteps) {
      for (const step of hint.steps) {
        expect(getOperation(step.opId), `${hint.title} uses an unknown op`).toBeDefined();
      }
      await expect(
        run(hint.steps, b64(caesar('The password for the archive is hunter2. ' + PROSE, 8))),
        hint.title,
      ).resolves.toBeTypeOf('string');
    }
  });

  it('cracks a Caesar hidden under Base64 and says how it knew', async () => {
    const report = await hints(b64(caesar(PROSE, 11)));
    const hint = find(report.hints, /Rotate the alphabet by 15|Undo ROT13/);

    expect(hint, 'no rotation hint').toBeDefined();
    expect(hint!.depth).toBe(1);
    expect(hint!.path).toBe('Base64');
    expect(hint!.reason).toMatch(/[Ii]ndex of coincidence/);
    expect(await run(hint!.steps, b64(caesar(PROSE, 11)))).toContain('certificate');
  });

  it('recovers a Vigenère key from ciphertext and shows the plaintext', async () => {
    const cipher = vigenere(PROSE, 'LEMON');
    const report = await hints(cipher);
    const hint = find(report.hints, /Vigen/);

    expect(hint, 'no Vigenère hint').toBeDefined();
    expect(hint!.title).toContain('LEMON');
    expect(hint!.reason).toMatch(/columns/);
    expect(await run(hint!.steps, cipher)).toContain('certificate');
  });

  it('does not offer a cipher key for a Base64 blob', async () => {
    const report = await hints(b64(PROSE));
    expect(find(report.hints, /Vigen/), 'invented a Vigenère key for Base64').toBeUndefined();
    expect(find(report.hints, /Rotate the alphabet/), 'invented a rotation').toBeUndefined();
    const chain = find(report.hints, /^Peel /);
    expect(chain?.kind).toBe('decode');
    expect(await run(chain!.steps, b64(PROSE))).toContain('certificate');
  });

  it('raises its confidence when the plaintext contains a real word', async () => {
    const report = await hints(caesar(PROSE, 11));
    const hint = find(report.hints, /Rotate the alphabet/)!;
    expect(hint.reason).toContain('The result contains "the"');
    expect(hint.confidence).toBeGreaterThan(0.9);
  });

  it('says a digest is one-way instead of suggesting a decode', async () => {
    const report = await hints('5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8');
    const hint = find(report.hints, /SHA-256/);

    expect(hint?.kind).toBe('identify');
    expect(hint?.title).toMatch(/crack it, do not decode it/);
    expect(hint?.steps).toHaveLength(0);
  });

  it('carries a reason on every hint, with no exceptions', async () => {
    const report = await hints(b64('01001000 01101001 00100001 00100001'));
    expect(report.hints.length).toBeGreaterThan(0);
    for (const hint of report.hints) {
      expect(hint.reason.length, hint.title).toBeGreaterThan(15);
      expect(hint.confidence).toBeGreaterThan(0);
      expect(hint.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('ranks a found flag above everything it merely suggests', async () => {
    const report = await hints(`Some noise, then CTF{ranked_first}, then ${b64(PROSE)}`);
    expect(report.hints[0]?.kind).toBe('flag');
  });

  it('returns an empty report for empty input rather than guessing', async () => {
    const report = await hints('   \n  ');
    expect(report.hints).toHaveLength(0);
    expect(report.flags).toHaveLength(0);
  });
});

describe('how deep the CTF workspace looks', () => {
  /*
   * A flag is the one thing most likely to be wrapped many times on purpose,
   * so the CTF tab was the last place that should have stopped at six layers.
   */
  it('reaches a flag wrapped twelve times', async () => {
    let wrapped = 'flag{deep_enough_to_matter}';
    for (let i = 0; i < 12; i++) wrapped = b64(wrapped);

    const report = await hints(wrapped);

    expect(report.layers).toBe(13);
    expect(report.truncated).toBe(false);
    expect(report.flags.map((f) => f.text)).toContain('flag{deep_enough_to_matter}');
  });
});
