import { latin1ToBytes, tryDecodeUtf8 } from '../core/bytes';

/**
 * Whether a decoded result is text rather than bytes that happen to print.
 *
 * The distinction matters because a wrong guess at a short encoding usually
 * still produces bytes, and Latin-1 has a printable character for almost all
 * of them. Requiring valid UTF-8 is what separates `m4sh` from `µë-m4sh`:
 * both look like characters, only one is a decode that worked.
 */
export function isCleanText(byteString: string): boolean {
  if (byteString.length === 0) return false;

  const text = tryDecodeUtf8(latin1ToBytes(byteString));
  if (text === null) return false;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 0x20 || code === 0x7f) return false;
    if (code >= 0x80 && code <= 0x9f) return false;
  }

  return true;
}

/**
 * How much of a decoded string is text rather than control characters.
 *
 * Counted over characters, not bytes, so that a correctly decoded `é` or `س`
 * counts once as the character it is rather than twice as the bytes it takes.
 */
export function printableTextRatio(text: string): number {
  if (text.length === 0) return 0;

  let printable = 0;
  let total = 0;
  for (const char of text) {
    total++;
    const code = char.codePointAt(0) ?? 0;
    const control = (code < 0x20 && code !== 9 && code !== 10 && code !== 13) ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f);
    if (!control) printable++;
  }

  return printable / total;
}

const EXPECTED: Record<string, number> = {
  ' ': 0.18,
  e: 0.1,
  t: 0.075,
  a: 0.065,
  o: 0.062,
  i: 0.057,
  n: 0.057,
  s: 0.053,
  r: 0.05,
  h: 0.05,
  l: 0.033,
  d: 0.032,
  c: 0.023,
  u: 0.023,
  m: 0.02,
  f: 0.02,
  p: 0.016,
  g: 0.016,
  w: 0.016,
  y: 0.015,
  b: 0.012,
  v: 0.008,
  k: 0.006,
  x: 0.002,
  j: 0.001,
  q: 0.001,
  z: 0.001,
};

export function readability(text: string): number {
  if (text.length === 0) return 0;

  const sample = text.slice(0, 2048);
  let printable = 0;
  let controls = 0;
  const counts = new Map<string, number>();

  for (const char of sample) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) printable++;
    else if (code < 32 || code === 127) controls++;

    const lower = char.toLowerCase();
    if (EXPECTED[lower] !== undefined) counts.set(lower, (counts.get(lower) ?? 0) + 1);
  }

  const printableRatio = printable / sample.length;
  if (controls / sample.length > 0.05) return 0;
  if (printableRatio < 0.9) return printableRatio * 0.3;

  let divergence = 0;
  for (const [char, expected] of Object.entries(EXPECTED)) {
    const observed = (counts.get(char) ?? 0) / sample.length;
    divergence += Math.abs(observed - expected);
  }

  const frequencyScore = Math.max(0, 1 - divergence / 1.1);

  return Math.min(1, printableRatio * 0.35 + frequencyScore * 0.65);
}

const MARKERS = [
  'the ',
  ' and ',
  'http',
  'select ',
  'function',
  'password',
  'error',
  'true',
  'false',
  'null',
  'user',
  'admin',
  '<?xml',
  '<html',
  'begin ',
];

export function containsMarker(text: string): string | null {
  const lower = text.slice(0, 4096).toLowerCase();
  return MARKERS.find((marker) => lower.includes(marker)) ?? null;
}
