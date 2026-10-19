
export interface AlphabetRule {
  opId: string;
  title: string;
  confidence: number;
  test: (compact: string, raw: string) => string | null;
}

export function compact(text: string): string {
  return text.replace(/\s+/g, '');
}

function only(text: string, pattern: RegExp): boolean {
  return text.length > 0 && pattern.test(text);
}

function groups(raw: string): string[] {
  return raw.trim().split(/\s+/).filter((g) => g.length > 0);
}

export const ALPHABET_RULES: AlphabetRule[] = [
  {
    opId: 'from-binary',
    title: 'Read it as binary',
    confidence: 0.8,
    test: (c) => {
      if (!only(c, /^[01]+$/) || c.length < 16 || c.length % 8 !== 0) return null;
      return `${c.length} characters, all 0 or 1, and a whole number of eight-bit groups`;
    },
  },
  {
    opId: 'from-morse',
    title: 'Read it as Morse code',
    confidence: 0.85,
    test: (c, raw) => {
      if (!only(c, /^[.\-/|]+$/) || c.length < 4) return null;
      return `${groups(raw).length} groups made only of dots, dashes and separators`;
    },
  },
  {
    opId: 'bacon-decode',
    title: 'Read it as a Baconian cipher',
    confidence: 0.7,
    test: (c) => {
      if (c.length < 10 || c.length % 5 !== 0) return null;
      const distinct = new Set(c.toUpperCase());
      if (distinct.size !== 2) return null;
      return `only two distinct characters (${[...distinct].join(' and ')}), in groups of five`;
    },
  },
  {
    opId: 'from-base32',
    title: 'Decode as Base32',
    confidence: 0.7,
    test: (c) => {
      if (!only(c, /^[A-Z2-7]+=*$/) || c.length < 8 || c.length % 8 !== 0) return null;
      if (/[a-z0189+/]/.test(c)) return null;
      return 'upper case with no 0, 1, 8 or 9 — the Base32 alphabet — and a length divisible by 8';
    },
  },
  {
    opId: 'from-base58',
    title: 'Decode as Base58',
    confidence: 0.6,
    test: (c) => {
      if (!only(c, /^[1-9A-HJ-NP-Za-km-z]+$/) || c.length < 16) return null;
      if (c.length < 24 || /[0OIl]/.test(c)) return null;
      return 'no 0, O, I or l anywhere in 24+ characters — the Base58 alphabet leaves them out';
    },
  },
  {
    opId: 'from-decimal',
    title: 'Read it as decimal byte values',
    confidence: 0.7,
    test: (_c, raw) => {
      const parts = groups(raw);
      if (parts.length < 4) return null;
      if (!parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
      return `${parts.length} whitespace-separated numbers, none above 255`;
    },
  },
  {
    opId: 'from-octal',
    title: 'Read it as octal byte values',
    confidence: 0.55,
    test: (_c, raw) => {
      const parts = groups(raw);
      if (parts.length < 4) return null;
      if (!parts.every((p) => /^[0-7]{1,3}$/.test(p))) return null;
      return `${parts.length} groups of octal digits, none containing 8 or 9`;
    },
  },
  {
    opId: 'a1z26-decode',
    title: 'Read it as letter positions (A=1, Z=26)',
    confidence: 0.7,
    test: (_c, raw) => {
      const parts = raw.trim().split(/[\s,.-]+/).filter((p) => p.length > 0);
      if (parts.length < 4) return null;
      if (!parts.every((p) => /^\d{1,2}$/.test(p) && Number(p) >= 1 && Number(p) <= 26)) return null;
      return `${parts.length} numbers, every one between 1 and 26`;
    },
  },
  {
    opId: 'from-base85',
    title: 'Decode as Base85',
    confidence: 0.55,
    test: (c) => {
      if (c.length < 20) return null;
      if (!/^<~/.test(c) && !/[!#$%&()*+;<=>?@^_`{|}~-]/.test(c)) return null;
      if (!only(c, /^[\x21-\x75<~>]+$/)) return null;
      return 'characters from the wider Base85 alphabet that Base64 never produces';
    },
  },
];

export interface AlphabetHint {
  opId: string;
  title: string;
  confidence: number;
  reason: string;
}

export function alphabetHints(text: string): AlphabetHint[] {
  const sample = text.length > 8192 ? text.slice(0, 8192) : text;
  const packed = compact(sample);
  if (packed.length === 0) return [];

  const found: AlphabetHint[] = [];
  for (const rule of ALPHABET_RULES) {
    const reason = rule.test(packed, sample);
    if (reason) {
      found.push({ opId: rule.opId, title: rule.title, confidence: rule.confidence, reason });
    }
  }
  return found;
}
