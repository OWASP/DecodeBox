import type { Candidate, Evidence } from '../types';
import { getOperation } from '../operations';
import { byteLength, previewText } from '../core/bytes';
import { isCleanText } from './readability';
import { stepById } from './steps';

/*
 * Every detector in the catalogue sets a minimum length, because on a handful
 * of characters the ordinary evidence — alphabet, entropy, length multiples —
 * is worth nothing: four characters belong to almost every alphabet at once.
 *
 * That leaves a gap, and `bW1k` falls into it. It is Base64 for `mmd`, and
 * nothing recognised it, because the shortest Base64 there can be is exactly
 * one group below the eight characters the ordinary detector asks for.
 *
 * This module closes the gap without simply lowering the bar. It takes only
 * the formats that have a fixed group size, insists on a whole number of
 * groups, and then throws away anything whose result is not valid UTF-8 text.
 * That last rule is what does the work: a wrong guess on three bytes almost
 * always lands on a byte no text would contain.
 *
 * Against an ordinary word it still has to be careful. `test` is four Base64
 * characters too. So each format also names what an accidental match would
 * lack — capitals and digits for Base64, a hex letter for hex — and refuses a
 * candidate that reads like something a person would simply type.
 */

/** Below this, every detector in the catalogue declines to judge. */
export const SHORTEST_ORDINARY = 8;

/** Fewer bytes than this is not a decode, it is a coincidence. */
const MIN_DECODED_BYTES = 3;

interface Compact {
  opId: string;
  format: string;
  args?: Record<string, string>;
  /** The whole input must be nothing but this format's alphabet. */
  alphabet: RegExp;
  /** Characters that make up one complete group of output bytes. */
  unit: number;
  /** What an accidental match — an ordinary short word — would not have. */
  distinctive: RegExp;
  distinctiveNote: string;
}

const COMPACT: Compact[] = [
  {
    opId: 'from-base64',
    format: 'Base64',
    alphabet: /^[A-Za-z0-9+/]+={0,2}$/,
    unit: 4,
    distinctive: /[A-Z0-9+/]/,
    distinctiveNote: 'a capital, a digit or a + or /',
  },
  {
    opId: 'from-base64',
    format: 'Base64url',
    args: { Alphabet: 'A-Za-z0-9-_' },
    alphabet: /^[A-Za-z0-9_-]+$/,
    unit: 4,
    distinctive: /[-_]/,
    distinctiveNote: 'a - or _, which is what makes it the URL-safe alphabet',
  },
  {
    opId: 'from-hex',
    format: 'Hex',
    alphabet: /^[0-9a-fA-F]+$/,
    unit: 2,
    distinctive: /[a-fA-F]/,
    distinctiveNote: 'a letter from a to f, which a plain number would not have',
  },
];

function evidenceFor(
  entry: Compact,
  input: string,
  decoded: string,
  groups: number,
): Evidence[] {
  return [
    {
      label: `decodes to "${decoded}"`,
      detail:
        `The ${input.length} characters decode to ${byteLength(decoded)} bytes that are valid ` +
        `UTF-8 text. On input this short that is the whole case: a wrong reading of these bytes ` +
        `lands on a control character or an invalid sequence almost every time, and this one ` +
        `does not.`,
      weight: 0.8,
    },
    {
      label: `${groups} whole ${entry.format} group${groups === 1 ? '' : 's'}`,
      detail:
        `${entry.format} encodes in groups of ${entry.unit} characters, and this is a whole ` +
        `number of them with nothing left over.`,
      weight: 0.5,
    },
    {
      label: 'short input, so read it as a possibility',
      detail:
        `Under ${SHORTEST_ORDINARY} characters there is not enough of anything — alphabet, ` +
        `entropy, length — to be certain. It contains ${entry.distinctiveNote}, which is why ` +
        `this is offered rather than an ordinary word being mistaken for an encoding, but a ` +
        `short string genuinely can be both.`,
      weight: 0.35,
    },
  ];
}

/**
 * Candidates for input too short for the ordinary detectors to judge.
 *
 * Returns nothing at all for anything the ordinary detectors can handle.
 */
export function shortCandidates(input: string): Candidate[] {
  const text = input.trim();
  if (text.length === 0 || text.length >= SHORTEST_ORDINARY) return [];

  const found: Candidate[] = [];

  for (const entry of COMPACT) {
    if (text.length % entry.unit !== 0) continue;
    if (!entry.alphabet.test(text)) continue;
    if (!entry.distinctive.test(text)) continue;

    const step = stepById(entry.opId, entry.args ?? {});
    const operation = getOperation(entry.opId);
    if (!step || !operation) continue;

    let decoded: string;
    try {
      const out = operation.run(text, step.args);
      if (typeof out !== 'string') continue;
      decoded = out;
    } catch {
      continue;
    }

    if (decoded === text) continue;
    if (byteLength(decoded) < MIN_DECODED_BYTES) continue;
    if (!isCleanText(decoded)) continue;

    const groups = text.length / entry.unit;
    const letters = /[A-Za-z]/.test(decoded) ? 0.06 : 0;

    found.push({
      id: `short-${entry.opId}-${entry.format}`,
      format: entry.format,
      confidence: 0.58 + letters,
      evidence: evidenceFor(entry, text, decoded, groups),
      preview: previewText(decoded),
      steps: [step],
    });
  }

  return found.sort((a, b) => b.confidence - a.confidence);
}
