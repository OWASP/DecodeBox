import type { EmbeddedFind, RecipeStep } from '../types';
import { getOperation } from '../operations';
import { asBytes, byteLength, previewText } from '../core/bytes';
import { matchSignature } from '../core/signatures';
import { utf16leRatio } from '../operations/dataFormat';
import { containsMarker, isCleanText } from './readability';
import { stepById } from './steps';

/*
 * Encoded data is rarely handed over on its own. It arrives glued to a prefix,
 * sitting in a log line, or as one field of something larger — `testbTRzaA==`
 * is four characters of text followed by Base64 for `m4sh`, and a detector
 * that only ever looks at the whole input sees nothing but noise.
 *
 * Finding the encoded part is harder than it sounds, because the prefix is
 * usually made of characters the encoding would accept. `test` is four legal
 * Base64 characters, so the run of Base64-looking text starts at the very
 * beginning of the input and decoding it from there gives rubbish.
 *
 * What rescues it is the group size. Base64 encodes in groups of four, so the
 * real payload can only start at an offset that leaves a whole number of
 * groups before the end. That is a handful of offsets to try rather than all
 * of them, and the one that decodes to valid UTF-8 text is the answer. The
 * same argument works for hex in groups of two.
 */

export type Embedded = EmbeddedFind;

interface Kind {
  format: string;
  opId: string;
  args?: Record<string, string>;
  pattern: RegExp;
  /** Characters per group; 1 means any length will do. */
  unit: number;
  /** A run without this is an ordinary word, not this format. */
  requires?: RegExp;
}

const KINDS: Kind[] = [
  {
    format: 'JWT',
    opId: 'jwt-decode',
    pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?/g,
    unit: 1,
  },
  {
    format: 'Base64',
    opId: 'from-base64',
    pattern: /[A-Za-z0-9+/]{8,}={0,2}/g,
    unit: 4,
  },
  {
    format: 'Base64url',
    opId: 'from-base64',
    args: { Alphabet: 'A-Za-z0-9-_' },
    pattern: /[A-Za-z0-9_-]{8,}/g,
    unit: 4,
    requires: /[-_]/,
  },
  {
    format: 'Hex',
    opId: 'from-hex',
    pattern: /[0-9a-fA-F]{8,}/g,
    unit: 2,
  },
  {
    format: 'URL encoding',
    opId: 'url-decode',
    pattern: /(?:%[0-9a-fA-F]{2})+/g,
    unit: 1,
  },
];

const MAX_SCAN = 64 * 1024;
const MAX_RUNS = 64;
/** How far into a run the payload is allowed to start. */
const MAX_SHIFT = 16;
const MIN_WINDOW = 8;
const MIN_DECODED_BYTES = 4;

function decodeWith(kind: Kind, text: string): { decoded: string; step: RecipeStep } | null {
  const step = stepById(kind.opId, kind.args ?? {});
  const operation = getOperation(kind.opId);
  if (!step || !operation) return null;

  try {
    const out = operation.run(text, step.args);
    if (typeof out !== 'string') return null;
    return { decoded: out, step };
  } catch {
    return null;
  }
}

/*
 * What counts as having decoded something.
 *
 * Text is the common case and the strict one: valid UTF-8, printable, with a
 * letter in it. But a payload buried in a larger document is very often not
 * text at all — a PowerShell command stored as UTF-16LE, or a whole file — and
 * those are recognised by shape instead, or the scan would walk past exactly
 * the things worth finding.
 */
function acceptable(decoded: string): boolean {
  if (byteLength(decoded) < MIN_DECODED_BYTES) return false;
  if (isCleanText(decoded) && /[A-Za-z]/.test(decoded)) return true;

  const bytes = asBytes(decoded);
  return utf16leRatio(bytes) > 0.8 || matchSignature(bytes) !== null;
}

/**
 * The longest window inside a run that decodes to text.
 *
 * The whole run is tried first, and that ordering matters for more than
 * speed. Dropping four characters from the front of Base64 text drops three
 * bytes and leaves text behind, so a run that already decodes cleanly would
 * otherwise also "contain" every one of its own tails. When the whole run
 * decodes there is nothing embedded in it — it simply is the encoding.
 *
 * Longest wins among the rest, because a shorter window is almost always a
 * tail of the real one.
 */
function bestWindow(
  kind: Kind,
  run: string,
  whole: string,
): { start: number; text: string; decoded: string; step: RecipeStep } | null {
  const full = decodeWith(kind, run);
  if (full && acceptable(full.decoded)) {
    if (run === whole) return null;
    return { start: 0, text: run, decoded: full.decoded, step: full.step };
  }

  let best: { start: number; text: string; decoded: string; step: RecipeStep } | null = null;

  const maxTrim = kind.unit - 1;
  for (let start = 1; start <= Math.min(MAX_SHIFT, run.length - MIN_WINDOW); start++) {
    for (let end = run.length; end >= run.length - maxTrim; end--) {
      const length = end - start;
      if (length < MIN_WINDOW) continue;
      if (kind.unit > 1 && length % kind.unit !== 0) continue;
      if (best && length <= best.text.length) continue;

      const text = run.slice(start, end);
      if (text === whole) continue;

      const result = decodeWith(kind, text);
      if (!result || !acceptable(result.decoded)) continue;

      best = { start, text, decoded: result.decoded, step: result.step };
    }
  }

  return best;
}

function confidenceOf(decoded: string): number {
  const size = Math.min(byteLength(decoded), 48) / 240;
  const marker = containsMarker(decoded) ? 0.15 : 0;
  return Math.min(0.85, 0.55 + size + marker);
}

/**
 * Encoded data found inside something larger.
 *
 * Nothing that covers the whole input is returned — that is the ordinary
 * detector's job, and reporting it here as well would say the same thing
 * twice.
 */
export function findEmbedded(input: string, limit = 4): Embedded[] {
  const text = input.length > MAX_SCAN ? input.slice(0, MAX_SCAN) : input;
  const whole = text.trim();
  if (whole.length < MIN_WINDOW + 1) return [];

  const found: Embedded[] = [];
  const claimed: Array<[number, number]> = [];
  let runs = 0;

  for (const kind of KINDS) {
    for (const hit of text.matchAll(kind.pattern)) {
      if (runs++ >= MAX_RUNS) break;

      const run = hit[0];
      const runOffset = hit.index ?? 0;
      if (run.length < MIN_WINDOW) continue;
      if (kind.requires && !kind.requires.test(run)) continue;

      /*
       * A run that covers the whole input is not skipped here, only the
       * window that does. `testbTRzaA==` is entirely made of Base64
       * characters, so the run is the whole string — and the payload is
       * inside it.
       */

      const window = bestWindow(kind, run, whole);
      if (!window) continue;

      const offset = runOffset + window.start;
      const end = offset + window.text.length;
      if (claimed.some(([s, e]) => offset < e && end > s)) continue;

      const cut = stepById('take-bytes', { Start: offset, Length: window.text.length });
      if (!cut) continue;

      claimed.push([offset, end]);
      found.push({
        format: kind.format,
        offset,
        length: window.text.length,
        source: window.text,
        decoded: window.decoded,
        preview: previewText(window.decoded),
        confidence: confidenceOf(window.decoded),
        steps: [cut, window.step],
      });
    }
  }

  return found
    .sort((a, b) => b.confidence - a.confidence || b.length - a.length)
    .slice(0, limit);
}
