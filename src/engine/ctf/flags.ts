import type { FoundFlag } from './types';


const KNOWN = new Set(
  [
    'flag',
    'ctf',
    'key',
    'picoctf',
    'htb',
    'thm',
    'tryhackme',
    'hackthebox',
    'sec',
    'uiuctf',
    'actf',
    'dctf',
    'ractf',
    'csawctf',
    'gctf',
    'justctf',
    'openecsc',
    'owasp',
    'decodebox',
  ].map((p) => p.toLowerCase()),
);

const SHAPE = /\b([A-Za-z][A-Za-z0-9_-]{1,23})\{([^{}\r\n]{1,256})\}/g;

/*
 * A declared format has to be a prefix the shape above could have matched,
 * with or without its opening brace.
 *
 * The format is whatever is in the search box when the deeper pass runs, so it
 * can be the first letter of a word still being typed. Nobody declares "f" as
 * a flag format, but it is a hex digit, and searching for it found the middle
 * of a hex input and reported that as a flag.
 */
const DECLARED = /^([A-Za-z][A-Za-z0-9_-]{1,23})\{?$/;

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findFlags(text: string, depth: number, path: string, format = ''): FoundFlag[] {
  const found: FoundFlag[] = [];
  const declared = DECLARED.exec(format.trim());
  const wanted = declared?.[1]?.toLowerCase();

  for (const match of text.matchAll(SHAPE)) {
    const prefix = match[1]!.toLowerCase();
    found.push({
      text: match[0],
      depth,
      path,
      known: prefix === wanted || KNOWN.has(prefix),
    });
  }

  if (declared && !found.some((f) => f.text.toLowerCase().startsWith(declared[0].toLowerCase()))) {
    // Anchored the way the shape is: a prefix starts a word rather than sitting inside one.
    const loose = new RegExp(`\\b${literal(declared[0])}[^\\s\\r\\n]{2,256}`, 'gi');
    for (const match of text.matchAll(loose)) {
      found.push({ text: match[0], depth, path, known: true });
    }
  }

  return found;
}

export function mergeFlags(flags: FoundFlag[]): FoundFlag[] {
  const best = new Map<string, FoundFlag>();
  for (const flag of flags) {
    const seen = best.get(flag.text);
    if (!seen || flag.depth < seen.depth) best.set(flag.text, flag);
  }
  return [...best.values()].sort(
    (a, b) => Number(b.known) - Number(a.known) || a.depth - b.depth,
  );
}
