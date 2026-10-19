import { describe, expect, it } from 'vitest';
import { inspect } from './inspect';
import { analyse } from './analysis';
import { toChain, lastLayer, terminusOf } from './detection/chain';
import { flatten } from './analysis/report';
import { decodeBaseN, encodeBaseN } from './core/alphabet';
import { OperationError } from './types';

function wrap(value: string, times: number): string {
  let out = value;
  for (let i = 0; i < times; i++) out = btoa(out);
  return out;
}

const B64 = 'A-Za-z0-9+/=';

describe('unwrapping and mapping as one piece of work', () => {
  /*
   * These were two calls started at once, deriving the same chain twice from
   * the same bytes. Interleaved on one thread, each one's time budget was
   * being spent by the other, and on a deeply wrapped megabyte both gave up
   * after a handful of layers and reported that there might be more below.
   */
  it('reaches the payload and maps every layer of it', async () => {
    const deep = wrap('the flag is here', 28);

    const { root, analysis } = await inspect(deep);

    expect(toChain(root)).toHaveLength(29);
    expect(lastLayer(root).output).toBe('the flag is here');
    expect(terminusOf(root)?.reason).toBe('plain');

    expect(analysis.maxDepth).toBe(28);
    expect(analysis.truncated).toBe(false);
    expect(flatten(analysis.root).some((n) => n.output === 'the flag is here')).toBe(true);
  });

  it('maps the same tree whether or not it is given the chain', async () => {
    const deep = wrap('the flag is here', 12);

    const shared = (await inspect(deep)).analysis;
    const alone = await analyse(deep);

    expect(shared.nodes).toBe(alone.nodes);
    expect(shared.maxDepth).toBe(alone.maxDepth);
    expect(flatten(shared.root).map((n) => n.format)).toEqual(
      flatten(alone.root).map((n) => n.format),
    );
  });

  it('still branches into payloads found inside a layer', async () => {
    const { analysis } = await inspect(btoa('note=okZ3JlZXRpbmdzIGZyb20gdGhlIGxvZw=='));
    const nodes = flatten(analysis.root);

    expect(nodes.some((n) => n.origin !== undefined)).toBe(true);
    expect(nodes.some((n) => n.output === 'greetings from the log')).toBe(true);
  });

  it('stops honestly when the chain itself stopped', async () => {
    const deep = wrap('the flag is here', 12);

    const { root, analysis } = await inspect(deep, { decode: { maxDepth: 4 } });

    expect(toChain(root)).toHaveLength(5);
    expect(terminusOf(root)?.reason).toBe('depth');
    expect(analysis.maxDepth).toBe(4);
  });
});

describe('under load', () => {
  /*
   * The shape of the file this was reported with: a megabyte on one line,
   * wrapped forty-four times, ending in three characters.
   *
   * It used to come back with six layers and "there may be another layer below
   * this" on both the strip and the tree, because unwrapping and mapping were
   * racing each other for the same time budget while doing the same work.
   */
  it('finishes a megabyte wrapped forty-four times', async () => {
    const deep = wrap('mmd', 44);
    expect(deep.length).toBeGreaterThan(900_000);

    const { root, analysis } = await inspect(deep);

    expect(toChain(root)).toHaveLength(45);
    expect(lastLayer(root).output).toBe('mmd');
    expect(analysis.maxDepth).toBe(44);
    expect(analysis.truncated).toBe(false);
  }, 120_000);

  /*
   * Forty-four layers written out in full is six lines of the same word in
   * every finding, every search hit and every panel that says where a layer
   * came from.
   */
  it('counts repeated layers in a path instead of listing them', async () => {
    const { analysis } = await inspect(wrap('the flag is here', 20));
    const deepest = flatten(analysis.root).sort((a, b) => b.depth - a.depth)[0];

    expect(deepest?.path).toBe('Input → Base64 ×20');
    expect(deepest?.path.length).toBeLessThan(40);
  }, 60_000);
});

describe('the base-N decoder on its fast path', () => {
  const text = 'The deployment failed twice last night and nobody was paged about it.';

  it('round-trips every alphabet it is given', () => {
    for (const [spec, size] of [
      [B64, 64],
      ['A-Za-z0-9-_', 64],
      ['A-Z2-7=', 32],
      ['0-9A-V=', 32],
    ] as const) {
      const bytes = new TextEncoder().encode(text);
      const encoded = encodeBaseN(bytes, spec, size);
      expect(Array.from(decodeBaseN(encoded, spec, size)), spec).toEqual(Array.from(bytes));
    }
  });

  it('drops characters outside the alphabet, wherever they are', () => {
    const clean = 'SGVsbG8gd29ybGQh';
    const dirty = ` ${clean.slice(0, 4)}\n\t${clean.slice(4, 9)}  ${clean.slice(9)} `;

    expect(new TextDecoder().decode(decodeBaseN(dirty, B64, 64))).toBe('Hello world!');
  });

  it('leaves input that is already clean exactly as it is', () => {
    expect(new TextDecoder().decode(decodeBaseN('SGVsbG8gd29ybGQh', B64, 64))).toBe('Hello world!');
  });

  it('names the stray character when it is told not to remove any', () => {
    expect(() => decodeBaseN('SGVsbG8*d29ybGQh', B64, 64, { removeNonAlphabet: false })).toThrow(
      OperationError,
    );
    expect(() => decodeBaseN('SGVsbG8*d29ybGQh', B64, 64, { removeNonAlphabet: false })).toThrow(
      /'\*' is not in this alphabet/,
    );
  });

  it('reads an alphabet that reaches outside ASCII by the slower route', () => {
    // 32 characters above ASCII, then 10 digits and 22 letters: 64 exactly.
    const spec = 'à-ÿ0-9A-V';
    const bytes = new Uint8Array([1, 2, 3, 250]);
    expect(Array.from(decodeBaseN(encodeBaseN(bytes, spec, 64), spec, 64))).toEqual(
      Array.from(bytes),
    );
  });

  it('is not fooled by a high character that indexes past the table', () => {
    // 'Ā' is beyond ASCII, so it is not in the alphabet and must be dropped.
    expect(new TextDecoder().decode(decodeBaseN('SGVsbG8Āgd29ybGQh', B64, 64))).toBe(
      'Hello world!',
    );
  });
});
