import { describe, expect, it } from 'vitest';
import { bake, encodeInput, INPUT_ENCODINGS, renderText } from './index';
import { getOperation } from './operations';
import type { Recipe } from './types';


function recipe(...entries: Array<string | [string, Record<string, string>]>): Recipe {
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

async function run(
  input: string,
  ...entries: Array<string | [string, Record<string, string>]>
): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (result.error) throw new Error(result.error.message);
  return renderText(result.output);
}

const bytes = (...values: number[]) => values.map((v) => String.fromCharCode(v)).join('');

describe('bytes survive the pipeline', () => {
  it('carries every byte value through hex unchanged', async () => {
    for (const hex of ['80', 'e9', 'c3a9', '1f8b', '00ff', 'fffefdfc', '48656c6c6f']) {
      expect(await run(hex, 'from-hex', ['to-hex', { Delimiter: 'None' }]), hex).toBe(hex);
    }
  });

  it('keeps two different byte strings different', async () => {
    const one = await run('e9', 'from-hex', ['to-hex', { Delimiter: 'None' }]);
    const two = await run('c3a9', 'from-hex', ['to-hex', { Delimiter: 'None' }]);
    expect(one).not.toBe(two);
  });

  it('produces Base64 another tool would recognise', async () => {
    expect(await run(bytes(0x80), 'to-base64')).toBe('gA==');
    expect(await run(bytes(0x00, 0xff, 0xe9), 'to-base64')).toBe('AP/p');
    expect(await run(bytes(0x1f, 0x8b, 0x08, 0x00), 'to-base64')).toBe('H4sIAA==');

    const packed = await run('hello hello hello', 'gzip', 'to-base64');
    expect(packed.startsWith('H4sI')).toBe(true);
  });

  it('hashes the bytes, not a re-encoding of them', async () => {
    expect(await run(bytes(0x80), 'md5')).toBe('8d39dd7eef115ea6975446ef4082951f');
    expect(await run(bytes(0x80), 'sha-256')).toBe(
      '76be8b528d0075f7aae98d6fa57a6d3c83ae480a8469e668d7b0af968995ac71',
    );
    expect(await run(bytes(0x00, 0xff, 0xe9), 'md5')).toBe('8495a32c80173629851bf91ea4cfe3f9');
    expect(await run(bytes(0x1f, 0x8b, 0x08, 0x00), 'sha-256')).toBe(
      'fd72d30440b0bae1b1c6db6c8ad807f238ef3ca613aa7e8d5329e1e8ddf7da72',
    );
  });

  it('unwraps a layered payload without touching the bytes in between', async () => {
    const secret = 'the quick brown fox jumps over the lazy dog, at some length';
    const packed = await run(secret, 'gzip', 'to-base64');
    expect(await run(packed, 'from-base64', 'gunzip')).toBe(secret);
  });
});

describe('the input edge', () => {
  it('offers the raw reading first, then the character sets', () => {
    expect(INPUT_ENCODINGS[0]).toBe('Raw bytes');
    expect(INPUT_ENCODINGS).toContain('UTF-8');
    expect(INPUT_ENCODINGS).toContain('UTF-16LE');
  });

  it('reads typed text in the chosen character set, once', async () => {
    expect(await run(encodeInput('café', 'UTF-8'), 'to-base64')).toBe('Y2Fmw6k=');
    expect(await run(encodeInput('café', 'ISO-8859-1 (Latin-1)'), 'to-base64')).toBe('Y2Fm6Q==');
    expect(await run(encodeInput('café', 'UTF-8'), 'md5')).toBe(
      '07117fe4a1ebd544965dc19573183da2',
    );
  });

  it('leaves data that is already bytes alone', () => {
    const file = bytes(0x1f, 0x8b, 0x08, 0x00, 0xff);
    expect(encodeInput(file, 'Raw bytes')).toBe(file);
  });

  it('writes a question mark rather than failing on a character a code page lacks', () => {
    expect(encodeInput('a中b', 'ISO-8859-1 (Latin-1)')).toBe('a?b');
  });

  it('encodes UTF-16LE the way Windows tooling does', () => {
    expect(encodeInput('hi', 'UTF-16LE')).toBe(bytes(0x68, 0x00, 0x69, 0x00));
    expect(encodeInput('hi', 'UTF-16BE')).toBe(bytes(0x00, 0x68, 0x00, 0x69));
  });
});

describe('rendering for the screen', () => {
  it('shows UTF-8 bytes as the text they are', () => {
    expect(renderText(bytes(0x63, 0x61, 0x66, 0xc3, 0xa9))).toBe('café');
  });

  it('shows bytes that are not text one character per byte', () => {
    expect(renderText(bytes(0x1f, 0x8b, 0x08))).toBe(bytes(0x1f, 0x8b, 0x08));
  });
});
