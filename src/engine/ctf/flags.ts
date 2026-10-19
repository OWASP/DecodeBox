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

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findFlags(text: string, depth: number, path: string, format = ''): FoundFlag[] {
  const found: FoundFlag[] = [];
  const wanted = format.trim().toLowerCase();

  for (const match of text.matchAll(SHAPE)) {
    const prefix = match[1]!.toLowerCase();
    found.push({
      text: match[0],
      depth,
      path,
      known: prefix === wanted || KNOWN.has(prefix),
    });
  }

  if (wanted && !found.some((f) => f.text.toLowerCase().startsWith(wanted))) {
    const loose = new RegExp(`${literal(format.trim())}[^\\s\\r\\n]{2,256}`, 'gi');
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
