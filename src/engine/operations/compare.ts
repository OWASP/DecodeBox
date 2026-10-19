import { OperationError } from '../types';
import { asBytes } from '../core/bytes';
import { arg, type Operation } from './types';


const SAMPLE_DELIMITERS: Record<string, string> = {
  'Blank line': '\n\n',
  'Line feed': '\n',
  CRLF: '\r\n',
  Space: ' ',
  Comma: ',',
  'Semi-colon': ';',
  Colon: ':',
  Nothing: '',
};

const SAMPLE_DELIM_OPTIONS = Object.keys(SAMPLE_DELIMITERS);

function twoSamples(input: string, name: string): [string, string] {
  const delimiter = SAMPLE_DELIMITERS[name] ?? '\n\n';
  const samples = delimiter === '' ? [input] : input.split(delimiter);
  if (samples.length !== 2) {
    throw new OperationError(
      `Expected exactly two samples separated by ${name.toLowerCase()}; found ${samples.length}.`,
    );
  }
  return [samples[0] as string, samples[1] as string];
}


const MAX_DIFF_TOKENS = 4000;

type DiffPart = { value: string; added?: boolean; removed?: boolean };

function diffTokens(left: string[], right: string[]): DiffPart[] {
  if (left.length > MAX_DIFF_TOKENS || right.length > MAX_DIFF_TOKENS) {
    throw new OperationError(
      `Too much to diff: ${MAX_DIFF_TOKENS} pieces per sample is the limit. Try diffing by line.`,
    );
  }

  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      const row = table[i] as number[];
      row[j] =
        left[i] === right[j]
          ? ((table[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((table[i + 1] as number[])[j] as number, (row[j + 1] as number));
    }
  }

  const parts: DiffPart[] = [];
  const push = (value: string, kind: 'same' | 'added' | 'removed') => {
    const last = parts[parts.length - 1];
    const matches =
      last !== undefined &&
      Boolean(last.added) === (kind === 'added') &&
      Boolean(last.removed) === (kind === 'removed');
    if (matches && last) last.value += value;
    else parts.push({ value, ...(kind === 'added' ? { added: true } : {}), ...(kind === 'removed' ? { removed: true } : {}) });
  };

  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push(left[i] as string, 'same');
      i++;
      j++;
    } else if (((table[i + 1] as number[])[j] as number) >= ((table[i] as number[])[j + 1] as number)) {
      push(left[i] as string, 'removed');
      i++;
    } else {
      push(right[j] as string, 'added');
      j++;
    }
  }
  while (i < left.length) push(left[i++] as string, 'removed');
  while (j < right.length) push(right[j++] as string, 'added');
  return parts;
}

function tokenise(text: string, by: string, ignoreWhitespace: boolean): string[] {
  switch (by) {
    case 'Character':
      return [...text];
    case 'Word':
      return ignoreWhitespace
        ? text.split(/\s+/).filter((w) => w !== '')
        : (text.match(/\s+|\S+/g) ?? []);
    case 'Sentence':
      return text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
    case 'Line':
    default: {
      const lines = text.split('\n').map((line) => `${line}\n`);
      const trimmed = ignoreWhitespace ? lines.map((line) => line.trim() + '\n') : lines;
      return trimmed;
    }
  }
}


interface FuzzyWeights {
  sequential: number;
  separator: number;
  camel: number;
  firstLetter: number;
  leadingPenalty: number;
  maxLeadingPenalty: number;
  unmatchedPenalty: number;
}

function fuzzyMatch(
  pattern: string,
  text: string,
  weights: FuzzyWeights,
  patternAt = 0,
  textAt = 0,
  depth = 0,
): { score: number; indexes: number[] } | null {
  if (depth >= 10 || patternAt === pattern.length || textAt === text.length) return null;

  const matches: number[] = [];
  let best: { score: number; indexes: number[] } | null = null;
  let p = patternAt;
  let t = textAt;

  while (p < pattern.length && t < text.length) {
    if ((pattern[p] as string).toLowerCase() === (text[t] as string).toLowerCase()) {
      const alternative = fuzzyMatch(pattern, text, weights, p, t + 1, depth + 1);
      if (alternative && (!best || alternative.score > best.score)) best = alternative;
      matches.push(t);
      p++;
    }
    t++;
  }

  if (p !== pattern.length) return best;

  let score = 100;
  score += Math.max(weights.maxLeadingPenalty, weights.leadingPenalty * (matches[0] ?? 0));
  score += weights.unmatchedPenalty * (text.length - matches.length);

  matches.forEach((index, i) => {
    if (i > 0 && index === (matches[i - 1] as number) + 1) score += weights.sequential;
    if (index > 0) {
      const before = text[index - 1] as string;
      const here = text[index] as string;
      if (before !== before.toUpperCase() && here !== here.toLowerCase()) score += weights.camel;
      if (before === '_' || before === ' ') score += weights.separator;
    } else {
      score += weights.firstLetter;
    }
  });

  const here = { score, indexes: matches };
  return best && best.score > score ? best : here;
}

export const compareOperations: Operation[] = [
  {
    id: 'hamming-distance',
    name: 'Hamming Distance',
    category: 'Utils',
    description: 'Counts the positions at which two equal-length samples differ.',
    aliases: ['bit difference', 'distance'],
    args: [
      {
        name: 'Sample delimiter',
        type: 'option',
        value: 'Blank line',
        options: SAMPLE_DELIM_OPTIONS,
      },
      { name: 'Unit', type: 'option', value: 'Byte', options: ['Byte', 'Bit'] },
      { name: 'Input type', type: 'option', value: 'Raw string', options: ['Raw string', 'Hex'] },
    ],
    run: (input, args) => {
      const [first, second] = twoSamples(input, String(arg(args, 'Sample delimiter', 'Blank line')));
      const hex = String(arg(args, 'Input type', 'Raw string')) === 'Hex';
      const parse = (text: string) =>
        hex
          ? new Uint8Array(
              (text.replace(/[^0-9a-fA-F]/g, '').match(/../g) ?? []).map((pair) =>
                parseInt(pair, 16),
              ),
            )
          : asBytes(text);

      const left = parse(first);
      const right = parse(second);
      if (left.length !== right.length) {
        throw new OperationError(
          `Samples must be the same length; they are ${left.length} and ${right.length} bytes.`,
        );
      }

      const byBit = String(arg(args, 'Unit', 'Byte')) === 'Bit';
      let distance = 0;
      for (let i = 0; i < left.length; i++) {
        const a = left[i] as number;
        const b = right[i] as number;
        if (!byBit) {
          if (a !== b) distance++;
          continue;
        }
        for (let xored = a ^ b; xored !== 0; xored &= xored - 1) distance++;
      }
      return String(distance);
    },
  },
  {
    id: 'levenshtein-distance',
    name: 'Levenshtein Distance',
    category: 'Utils',
    description: 'The number of single-character edits between two samples.',
    aliases: ['edit distance', 'string distance'],
    args: [
      {
        name: 'Sample delimiter',
        type: 'option',
        value: 'Line feed',
        options: SAMPLE_DELIM_OPTIONS,
      },
      { name: 'Insertion cost', type: 'number', value: 1, min: 0 },
      { name: 'Deletion cost', type: 'number', value: 1, min: 0 },
      { name: 'Substitution cost', type: 'number', value: 1, min: 0 },
    ],
    run: (input, args) => {
      const [source, target] = twoSamples(
        input,
        String(arg(args, 'Sample delimiter', 'Line feed')),
      );
      const insert = Number(arg(args, 'Insertion cost', 1));
      const remove = Number(arg(args, 'Deletion cost', 1));
      const substitute = Number(arg(args, 'Substitution cost', 1));
      if (insert < 0 || remove < 0 || substitute < 0) {
        throw new OperationError('Costs cannot be negative.');
      }

      let current = Array.from({ length: source.length + 1 }, (_, i) => remove * i);
      for (const char of target) {
        const next = new Array<number>(source.length + 1);
        next[0] = (current[0] as number) + insert;
        for (let j = 0; j < source.length; j++) {
          const substitution =
            (current[j] as number) + (source[j] === char ? 0 : substitute);
          next[j + 1] = Math.min(
            (current[j + 1] as number) + insert,
            (next[j] as number) + remove,
            substitution,
          );
        }
        current = next;
      }
      return String(current[current.length - 1]);
    },
  },
  {
    id: 'fuzzy-match',
    name: 'Fuzzy Match',
    category: 'Utils',
    description: 'Finds loose matches for a search string and scores how good each one is.',
    aliases: ['approximate search', 'sublime search'],
    args: [
      { name: 'Search', type: 'string', value: '' },
      { name: 'Sequential bonus', type: 'number', value: 15 },
      { name: 'Separator bonus', type: 'number', value: 30 },
      { name: 'Camel bonus', type: 'number', value: 30 },
      { name: 'First letter bonus', type: 'number', value: 15 },
      { name: 'Leading letter penalty', type: 'number', value: -5 },
      { name: 'Max leading letter penalty', type: 'number', value: -15 },
      { name: 'Unmatched letter penalty', type: 'number', value: -1 },
    ],
    run: (input, args) => {
      const search = String(arg(args, 'Search', ''));
      if (search === '') throw new OperationError('Enter something to search for.');

      const weights: FuzzyWeights = {
        sequential: Number(arg(args, 'Sequential bonus', 15)),
        separator: Number(arg(args, 'Separator bonus', 30)),
        camel: Number(arg(args, 'Camel bonus', 30)),
        firstLetter: Number(arg(args, 'First letter bonus', 15)),
        leadingPenalty: Number(arg(args, 'Leading letter penalty', -5)),
        maxLeadingPenalty: Number(arg(args, 'Max leading letter penalty', -15)),
        unmatchedPenalty: Number(arg(args, 'Unmatched letter penalty', -1)),
      };

      const lines = input.split('\n');
      const scored = lines
        .map((line) => ({ line, match: fuzzyMatch(search, line, weights) }))
        .filter((entry) => entry.match !== null)
        .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));

      if (scored.length === 0) return '(no matches)';
      return scored.map((entry) => `${String(entry.match?.score).padStart(5)}  ${entry.line}`).join('\n');
    },
  },
  {
    id: 'offset-checker',
    name: 'Offset checker',
    category: 'Utils',
    description: 'Marks the positions where two or more samples hold the same byte.',
    aliases: ['align', 'compare samples', 'common bytes'],
    args: [
      {
        name: 'Sample delimiter',
        type: 'option',
        value: 'Blank line',
        options: SAMPLE_DELIM_OPTIONS,
      },
    ],
    run: (input, args) => {
      const delimiter = SAMPLE_DELIMITERS[String(arg(args, 'Sample delimiter', 'Blank line'))] ?? '\n\n';
      const samples = input.split(delimiter);
      if (samples.length < 2) {
        throw new OperationError('Not enough samples; check the delimiter or paste more data.');
      }

      const shortest = Math.min(...samples.map((s) => s.length));
      let marks = '';
      for (let i = 0; i < shortest; i++) {
        const first = samples[0]?.[i];
        marks += samples.every((sample) => sample[i] === first) ? '^' : ' ';
      }
      return [...samples, marks].join('\n');
    },
  },
  {
    id: 'diff',
    name: 'Diff',
    category: 'Utils',
    description: 'Shows what changed between two samples, by character, word, line or sentence.',
    aliases: ['compare', 'difference', 'changes'],
    args: [
      {
        name: 'Sample delimiter',
        type: 'option',
        value: 'Blank line',
        options: SAMPLE_DELIM_OPTIONS,
      },
      {
        name: 'Diff by',
        type: 'option',
        value: 'Line',
        options: ['Character', 'Word', 'Line', 'Sentence'],
      },
      { name: 'Show added', type: 'boolean', value: true },
      { name: 'Show removed', type: 'boolean', value: true },
      { name: 'Show unchanged', type: 'boolean', value: true },
      { name: 'Ignore whitespace', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const [left, right] = twoSamples(input, String(arg(args, 'Sample delimiter', 'Blank line')));
      const by = String(arg(args, 'Diff by', 'Line'));
      const ignoreWhitespace = arg(args, 'Ignore whitespace', false);
      const showAdded = arg(args, 'Show added', true);
      const showRemoved = arg(args, 'Show removed', true);
      const showSame = arg(args, 'Show unchanged', true);

      const parts = diffTokens(
        tokenise(left, by, ignoreWhitespace),
        tokenise(right, by, ignoreWhitespace),
      );

      const marker = by === 'Line' || by === 'Sentence';
      let out = '';
      for (const part of parts) {
        if (part.added && !showAdded) continue;
        if (part.removed && !showRemoved) continue;
        if (!part.added && !part.removed && !showSame) continue;

        if (!marker) {
          out += part.added ? `{+${part.value}+}` : part.removed ? `[-${part.value}-]` : part.value;
          continue;
        }
        const sign = part.added ? '+' : part.removed ? '-' : ' ';
        out += part.value
          .split('\n')
          .filter((line, i, all) => !(i === all.length - 1 && line === ''))
          .map((line) => `${sign} ${line}`)
          .join('\n');
        out += '\n';
      }
      return marker ? out.replace(/\n$/, '') : out;
    },
  },
];
