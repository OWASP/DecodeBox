import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { analyse, bake, encodeInput, findInLayers, renderText } from './index';
import { getOperation } from './operations';
import type { Recipe, RecipeStep } from './types';

/*
 * Property-based tests: fast-check generates thousands of inputs, including
 * the awkward ones nobody writes by hand (empty, one byte, NUL runs, long
 * repeats, lone surrogates), and shrinks any failure to the smallest input
 * that still fails.
 */

const RUNS = { numRuns: 60 };
const SLOW = 30_000;

function step(opId: string, i: number): RecipeStep {
  const op = getOperation(opId);
  if (!op) throw new Error(`Unknown operation '${opId}'`);
  return { uid: `p${i}`, opId, args: op.args.map((a) => ({ ...a })), disabled: false };
}

async function chain(input: string, ...ids: string[]): Promise<string> {
  const recipe: Recipe = { id: 'property', name: 'property', steps: ids.map(step) };
  const result = await bake(input, recipe);
  if (result.error) throw new Error(`${ids.join(' then ')}: ${result.error.message}`);
  return result.output;
}

const latin1 = (values: Iterable<number>): string => String.fromCharCode(...values);

/*
 * Empty input is left out on purpose: several decoders refuse it with a
 * message ("There is nothing to compress"), which is a choice, not a fault.
 */
const randomBytes = fc.uint8Array({ minLength: 1, maxLength: 512 }).map(latin1);
const repeatedBytes = fc
  .tuple(fc.uint8Array({ minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 120 }))
  .map(([unit, times]) => latin1(unit).repeat(times));
const repeatedWords = fc
  .array(fc.constantFrom('0', '1', '12', '345', ' ', ',', 'ab', '\n'), { minLength: 1, maxLength: 400 })
  .map((parts) => parts.join(''));
// What a To Decimal or To Octal layer hands the next one in a chain.
const numberLists = fc
  .array(fc.integer({ min: 0, max: 255 }), { minLength: 1, maxLength: 160 })
  .map((values) => values.join(' '));
// Leading zero bytes are what Base58 and Base62 have to count separately.
const leadingZeros = fc
  .tuple(fc.integer({ min: 1, max: 4 }), fc.uint8Array({ maxLength: 16 }))
  .map(([zeros, rest]) => latin1(new Array<number>(zeros).fill(0)) + latin1(rest));
const anyBytes = fc.oneof(randomBytes, repeatedBytes, repeatedWords, numberLists, leadingZeros);

const anyText = fc.string({ unit: 'grapheme', maxLength: 80 });

const BYTE_ROUND_TRIPS: [string, string][] = [
  ['to-base64', 'from-base64'],
  ['to-base32', 'from-base32'],
  ['to-base45', 'from-base45'],
  ['to-base58', 'from-base58'],
  ['to-base62', 'from-base62'],
  ['to-base85', 'from-base85'],
  ['to-base92', 'from-base92'],
  ['to-hex', 'from-hex'],
  ['to-octal', 'from-octal'],
  ['to-binary', 'from-binary'],
  ['to-decimal', 'from-decimal'],
  ['to-modhex', 'from-modhex'],
  ['to-uuencode', 'from-uuencode'],
  ['to-cobs', 'from-cobs'],
  ['url-encode', 'url-decode'],
  ['gzip', 'gunzip'],
  ['zlib-deflate', 'zlib-inflate'],
  ['raw-deflate', 'raw-inflate'],
  ['lz4-compress', 'lz4-decompress'],
  ['bzip2-compress', 'bzip2-decompress'],
  ['lzma-compress', 'lzma-decompress'],
];

describe.each(BYTE_ROUND_TRIPS)('%s, then %s', (forward, inverse) => {
  it(
    'gives back any bytes exactly',
    async () => {
      await fc.assert(
        fc.asyncProperty(anyBytes, async (input) => {
          expect(await chain(input, forward, inverse)).toBe(input);
        }),
        RUNS,
      );
    },
    SLOW,
  );
});

const TEXT_ROUND_TRIPS: [string, string][] = [
  ['escape-unicode', 'unescape-unicode'],
  ['json-escape', 'json-unescape'],
  ['to-html-entity', 'from-html-entity'],
  ['to-base64', 'from-base64'],
  ['url-encode', 'url-decode'],
];

describe.each(TEXT_ROUND_TRIPS)('%s, then %s', (forward, inverse) => {
  it(
    'gives back any text exactly',
    async () => {
      await fc.assert(
        fc.asyncProperty(anyText, async (input) => {
          expect(renderText(await chain(encodeInput(input, 'UTF-8'), forward, inverse))).toBe(input);
        }),
        RUNS,
      );
    },
    SLOW,
  );
});

describe('automatic decoding of hostile input', () => {
  it(
    'always finishes, without throwing, on any input',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.oneof(anyBytes, anyText), async (input) => {
          const { root } = await analyse(input, { budgetMs: 2_000 });
          expect(root).toBeDefined();
        }),
        { numRuns: 40 },
      );
    },
    SLOW * 4,
  );

  it(
    'searches every layer for any query, literal or pattern, without throwing',
    async () => {
      const { root } = await analyse(Buffer.from(Buffer.from('{"flag":"x"}').toString('base64')).toString('base64'));
      fc.assert(
        fc.property(anyText, fc.boolean(), fc.boolean(), (query, regex, caseSensitive) => {
          expect(() => findInLayers(root, query, { regex, caseSensitive })).not.toThrow();
        }),
        { numRuns: 300 },
      );
    },
    SLOW,
  );
});
