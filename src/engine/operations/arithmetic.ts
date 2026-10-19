import { OperationError, type OperationArg } from '../types';
import { asBytes, bytesToLatin1 } from '../core/bytes';
import { arg, type Operation } from './types';
import { KEY_FORMATS, parseKey } from './keys';


const ARITHMETIC_DELIMITERS: Record<string, string> = {
  'Line feed': '\n',
  Space: ' ',
  Comma: ',',
  'Semi-colon': ';',
  Colon: ':',
  CRLF: '\r\n',
};

export const ARITHMETIC_DELIM_OPTIONS = Object.keys(ARITHMETIC_DELIMITERS);

function arithmeticDelimiter(name: string): string {
  return ARITHMETIC_DELIMITERS[name] ?? ' ';
}

export function unescapeDelimiter(text: string): string {
  return text.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (match, body: string) => {
    switch (body[0]) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '0':
        return '\0';
      case '\\':
        return '\\';
      case 'x':
      case 'u':
        return String.fromCharCode(parseInt(body.slice(1), 16));
      default:
        return match;
    }
  });
}


interface NumberList {
  values: number[];
  exact: bigint[] | null;
}

function parseNumbers(input: string, delimiterName: string): NumberList {
  const parts = input.split(arithmeticDelimiter(delimiterName));
  const values: number[] = [];
  let exact: bigint[] | null = [];

  for (const part of parts) {
    const token = part.trim().replace(/^\+/, '');
    if (token === '') continue;

    const isHex = /^-?0x[0-9a-fA-F]+$/.test(token);
    const isInteger = /^-?[0-9]+$/.test(token);
    const value = Number(token);
    if (!Number.isFinite(value)) continue;

    values.push(value);
    if (exact !== null) {
      if (isHex || isInteger) {
        exact.push(token.startsWith('-') ? -BigInt(token.slice(1)) : BigInt(token));
      } else {
        exact = null;
      }
    }
  }

  return { values, exact };
}

function requireNumbers(list: NumberList, what: string): NumberList {
  if (list.values.length === 0) {
    throw new OperationError(`No numbers found to ${what}. Check the delimiter.`);
  }
  return list;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return value.toFixed(0);
  return String(value);
}

function numberArgs(name = 'Delimiter'): OperationArg[] {
  return [{ name, type: 'option', value: 'Space', options: ARITHMETIC_DELIM_OPTIONS }];
}


function parseBigInt(value: string, label: string): bigint {
  const token = value.trim().replace(/^\+/, '');
  const negative = token.startsWith('-');
  const body = negative ? token.slice(1) : token;

  if (/^0x[0-9a-fA-F]+$/i.test(body) || /^[0-9]+$/.test(body)) {
    const parsed = BigInt(body);
    return negative ? -parsed : parsed;
  }
  throw new OperationError(`${label} must be a decimal or hex (0x…) integer.`);
}

function egcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  let [oldR, r] = [a, b];
  let [oldS, s] = [1n, 0n];
  let [oldT, t] = [0n, 1n];

  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
    [oldT, t] = [t, oldT - quotient * t];
  }
  return [oldR, oldS, oldT];
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  let result = 1n;
  let b = ((base % modulus) + modulus) % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

function fromArgOrInput(
  first: string,
  second: string,
  input: string,
  labels: [string, string],
): [string, string] {
  const a = first.trim();
  const b = second.trim();
  const fallback = input.trim();

  if (a && b) return [a, b];
  if (!a && b) {
    if (!fallback) throw new OperationError(`${labels[0]} must be defined.`);
    return [fallback, b];
  }
  if (a && !b) {
    if (!fallback) throw new OperationError(`${labels[1]} must be defined.`);
    return [a, fallback];
  }
  throw new OperationError(`${labels[0]} and ${labels[1]} must be defined.`);
}


function splitSamples(
  input: string,
  sampleDelim: string,
  itemDelim: string,
  minimum: number,
): string[][] {
  const samples = input.split(unescapeDelimiter(sampleDelim));
  if (samples.length < minimum) {
    throw new OperationError(
      `Expected at least ${minimum} sets but found ${samples.length}. Check the sample delimiter.`,
    );
  }
  const items = unescapeDelimiter(itemDelim);
  return samples.map((sample) => sample.split(items));
}

function twoSets(input: string, sampleDelim: string, itemDelim: string): [string[], string[]] {
  const samples = input.split(unescapeDelimiter(sampleDelim));
  if (samples.length !== 2) {
    throw new OperationError(
      `Expected two sets but found ${samples.length}. Check the sample delimiter.`,
    );
  }
  const items = unescapeDelimiter(itemDelim);
  return [samples[0]!.split(items), samples[1]!.split(items)];
}

const SET_ARGS: OperationArg[] = [
  { name: 'Sample delimiter', type: 'string', value: '\\n\\n', hint: 'Blank line by default' },
  { name: 'Item delimiter', type: 'string', value: ',' },
];

function setArgs(args: OperationArg[]): [string, string] {
  return [String(arg(args, 'Sample delimiter', '\\n\\n')), String(arg(args, 'Item delimiter', ','))];
}


function bitwise(input: string, key: Uint8Array, op: (a: number, b: number) => number): string {
  const data = asBytes(input);
  const repeating = key.length === 0 ? new Uint8Array([0]) : key;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = op(data[i]!, repeating[i % repeating.length]!) & 0xff;
  }
  return bytesToLatin1(out);
}

function keyArgument(args: OperationArg[]): Uint8Array {
  const found = args.find((a) => a.name === 'Key');
  return parseKey(String(found?.value ?? ''), found?.toggleValue ?? 'Hex');
}

const KEY_ARG: OperationArg = {
  name: 'Key',
  type: 'toggleString',
  value: '',
  toggleValues: KEY_FORMATS,
  toggleValue: 'Hex',
  hint: 'Repeated across the input',
};


export const arithmeticOperations: Operation[] = [
  {
    id: 'set-union',
    name: 'Set Union',
    category: 'Arithmetic / Logic',
    description: 'Every item appearing in either of two sets, without duplicates.',
    aliases: ['union', 'combine sets'],
    args: SET_ARGS,
    run: (input, args) => {
      const [sample, item] = setArgs(args);
      const [a, b] = twoSets(input, sample, item);
      return [...new Set([...a, ...b])].join(unescapeDelimiter(item));
    },
  },
  {
    id: 'set-intersection',
    name: 'Set Intersection',
    category: 'Arithmetic / Logic',
    description: 'Only the items appearing in both sets.',
    aliases: ['intersection', 'common items'],
    args: SET_ARGS,
    run: (input, args) => {
      const [sample, item] = setArgs(args);
      const [a, b] = twoSets(input, sample, item);
      const other = new Set(b);
      return [...new Set(a.filter((x) => other.has(x)))].join(unescapeDelimiter(item));
    },
  },
  {
    id: 'set-difference',
    name: 'Set Difference',
    category: 'Arithmetic / Logic',
    description: 'The items in the first set that are absent from the second.',
    aliases: ['difference', 'relative complement', 'subtract sets'],
    args: SET_ARGS,
    run: (input, args) => {
      const [sample, item] = setArgs(args);
      const [a, b] = twoSets(input, sample, item);
      const excluded = new Set(b);
      return [...new Set(a.filter((x) => !excluded.has(x)))].join(unescapeDelimiter(item));
    },
  },
  {
    id: 'symmetric-difference',
    name: 'Symmetric Difference',
    category: 'Arithmetic / Logic',
    description: 'The items in one set or the other, but not in both.',
    aliases: ['disjunctive union', 'exclusive sets'],
    args: SET_ARGS,
    run: (input, args) => {
      const [sample, item] = setArgs(args);
      const [a, b] = twoSets(input, sample, item);
      const inA = new Set(a);
      const inB = new Set(b);
      const only = [...a.filter((x) => !inB.has(x)), ...b.filter((x) => !inA.has(x))];
      return [...new Set(only)].join(unescapeDelimiter(item));
    },
  },
  {
    id: 'cartesian-product',
    name: 'Cartesian Product',
    category: 'Arithmetic / Logic',
    description: 'Every combination that takes one item from each set.',
    aliases: ['product of sets', 'combinations', 'cross join'],
    args: SET_ARGS,
    run: (input, args) => {
      const [sample, item] = setArgs(args);
      const sets = splitSamples(input, sample, item, 2);
      const total = sets.reduce((n, set) => n * set.length, 1);
      if (total > 50000) {
        throw new OperationError(`That is ${total} combinations — narrow the sets first.`);
      }

      let rows: string[][] = [[]];
      for (const set of sets) rows = rows.flatMap((row) => set.map((value) => [...row, value]));
      const delim = unescapeDelimiter(item);
      return rows.map((row) => `(${row.join(delim)})`).join(delim);
    },
  },
  {
    id: 'power-set',
    name: 'Power Set',
    category: 'Arithmetic / Logic',
    description: 'Every subset of a set, shortest first, one per line.',
    aliases: ['subsets', 'powerset'],
    args: [{ name: 'Item delimiter', type: 'string', value: ',' }],
    run: (input, args) => {
      const delim = unescapeDelimiter(String(arg(args, 'Item delimiter', ',')));
      const items = input.split(delim).filter((x) => x.length > 0);
      if (items.length === 0) return '';
      if (items.length > 20) {
        throw new OperationError(
          `${items.length} items would be ${2 ** items.length} subsets — too many to show.`,
        );
      }

      const subsets: string[] = [];
      for (let mask = 0; mask < 1 << items.length; mask++) {
        subsets.push(items.filter((_, index) => (mask >> index) & 1).join(delim));
      }
      return subsets.sort((a, b) => a.length - b.length).join('\n');
    },
  },

  {
    id: 'or',
    name: 'OR',
    category: 'Arithmetic / Logic',
    description: 'ORs every byte of the input with a repeating key.',
    aliases: ['bitwise or'],
    args: [KEY_ARG],
    run: (input, args) => bitwise(input, keyArgument(args), (a, b) => a | b),
  },
  {
    id: 'and',
    name: 'AND',
    category: 'Arithmetic / Logic',
    description: 'ANDs every byte of the input with a repeating key.',
    aliases: ['bitwise and', 'mask'],
    args: [KEY_ARG],
    run: (input, args) => bitwise(input, keyArgument(args), (a, b) => a & b),
  },
  {
    id: 'add',
    name: 'ADD',
    category: 'Arithmetic / Logic',
    description: 'Adds a repeating key to every byte, wrapping at 256.',
    aliases: ['byte add'],
    args: [KEY_ARG],
    run: (input, args) => bitwise(input, keyArgument(args), (a, b) => (a + b) % 256),
  },
  {
    id: 'sub',
    name: 'SUB',
    category: 'Arithmetic / Logic',
    description: 'Subtracts a repeating key from every byte, wrapping at 0.',
    aliases: ['byte subtract'],
    args: [KEY_ARG],
    run: (input, args) => bitwise(input, keyArgument(args), (a, b) => (a - b + 256) % 256),
  },

  {
    id: 'sum',
    name: 'Sum',
    category: 'Arithmetic / Logic',
    description: 'Adds every number in the input. Non-numeric items are ignored.',
    aliases: ['total', 'add up'],
    args: numberArgs(),
    run: (input, args) => {
      const list = requireNumbers(
        parseNumbers(input, String(arg(args, 'Delimiter', 'Space'))),
        'sum',
      );
      if (list.exact) return list.exact.reduce((a, b) => a + b, 0n).toString();
      return formatNumber(list.values.reduce((a, b) => a + b, 0));
    },
  },
  {
    id: 'subtract',
    name: 'Subtract',
    category: 'Arithmetic / Logic',
    description: 'Subtracts every later number from the first.',
    aliases: ['minus', 'take away'],
    args: numberArgs(),
    run: (input, args) => {
      const list = requireNumbers(
        parseNumbers(input, String(arg(args, 'Delimiter', 'Space'))),
        'subtract',
      );
      if (list.exact) return list.exact.reduce((a, b) => a - b).toString();
      return formatNumber(list.values.reduce((a, b) => a - b));
    },
  },
  {
    id: 'multiply',
    name: 'Multiply',
    category: 'Arithmetic / Logic',
    description: 'Multiplies every number in the input together.',
    aliases: ['product', 'times'],
    args: numberArgs(),
    run: (input, args) => {
      const list = requireNumbers(
        parseNumbers(input, String(arg(args, 'Delimiter', 'Space'))),
        'multiply',
      );
      if (list.exact) return list.exact.reduce((a, b) => a * b).toString();
      return formatNumber(list.values.reduce((a, b) => a * b));
    },
  },
  {
    id: 'divide',
    name: 'Divide',
    category: 'Arithmetic / Logic',
    description: 'Divides the first number by each of the others in turn.',
    aliases: ['quotient', 'over'],
    args: numberArgs(),
    run: (input, args) => {
      const list = requireNumbers(
        parseNumbers(input, String(arg(args, 'Delimiter', 'Space'))),
        'divide',
      );
      if (list.values.slice(1).some((value) => value === 0)) {
        throw new OperationError('Division by zero.');
      }
      return formatNumber(list.values.reduce((a, b) => a / b));
    },
  },
  {
    id: 'mean',
    name: 'Mean',
    category: 'Arithmetic / Logic',
    description: 'The arithmetic mean of every number in the input.',
    aliases: ['average', 'avg'],
    args: numberArgs(),
    run: (input, args) => {
      const list = requireNumbers(
        parseNumbers(input, String(arg(args, 'Delimiter', 'Space'))),
        'average',
      );
      return formatNumber(list.values.reduce((a, b) => a + b, 0) / list.values.length);
    },
  },
  {
    id: 'median',
    name: 'Median',
    category: 'Arithmetic / Logic',
    description: 'The middle value once the numbers are sorted.',
    aliases: ['middle value'],
    args: numberArgs(),
    run: (input, args) => {
      const list = requireNumbers(
        parseNumbers(input, String(arg(args, 'Delimiter', 'Space'))),
        'average',
      );
      const sorted = [...list.values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return formatNumber(
        sorted.length % 2 === 0 ? (sorted[middle]! + sorted[middle - 1]!) / 2 : sorted[middle]!,
      );
    },
  },
  {
    id: 'standard-deviation',
    name: 'Standard Deviation',
    category: 'Arithmetic / Logic',
    description: 'The population standard deviation of the numbers in the input.',
    aliases: ['stddev', 'sigma', 'spread'],
    args: numberArgs(),
    run: (input, args) => {
      const list = requireNumbers(
        parseNumbers(input, String(arg(args, 'Delimiter', 'Space'))),
        'measure',
      );
      const mean = list.values.reduce((a, b) => a + b, 0) / list.values.length;
      const variance =
        list.values.reduce((total, value) => total + (value - mean) ** 2, 0) / list.values.length;
      return formatNumber(Math.sqrt(variance));
    },
  },

  {
    id: 'mod',
    name: 'MOD',
    category: 'Arithmetic / Logic',
    description: 'Reduces every number in the input modulo a value.',
    aliases: ['modulo', 'remainder'],
    args: [
      { name: 'Modulus', type: 'number', value: 2 },
      ...numberArgs(),
    ],
    run: (input, args) => {
      const modulus = Number(arg(args, 'Modulus', 2));
      if (modulus === 0) throw new OperationError('The modulus cannot be zero.');
      const list = requireNumbers(
        parseNumbers(input, String(arg(args, 'Delimiter', 'Space'))),
        'reduce',
      );

      if (list.exact && Number.isInteger(modulus)) {
        const m = BigInt(modulus);
        return list.exact.map((value) => (value % m).toString()).join(' ');
      }
      return list.values.map((value) => formatNumber(value % modulus)).join(' ');
    },
  },
  {
    id: 'extended-gcd',
    name: 'Extended GCD',
    category: 'Arithmetic / Logic',
    description: 'Finds gcd(a, b) and the Bézout coefficients x and y where a·x + b·y = gcd.',
    aliases: ['egcd', 'euclidean algorithm', 'bezout'],
    args: [
      { name: 'Value a', type: 'string', value: '', hint: 'Blank takes the input' },
      { name: 'Value b', type: 'string', value: '', hint: 'Blank takes the input' },
    ],
    run: (input, args) => {
      const [a, b] = fromArgOrInput(
        String(arg(args, 'Value a', '')),
        String(arg(args, 'Value b', '')),
        input,
        ['Value a', 'Value b'],
      );
      const [g, x, y] = egcd(parseBigInt(a, 'Value a'), parseBigInt(b, 'Value b'));
      const gcd = g < 0n ? -g : g;
      return `gcd: ${gcd}\n\nBézout coefficients:\nx = ${x}\ny = ${y}`;
    },
  },
  {
    id: 'modular-exponentiation',
    name: 'Modular Exponentiation',
    category: 'Arithmetic / Logic',
    description: 'Computes base^exponent mod modulus, the arithmetic behind RSA and Diffie-Hellman.',
    aliases: ['modpow', 'powmod'],
    args: [
      { name: 'Base', type: 'string', value: '', hint: 'Blank takes the input' },
      { name: 'Modulus', type: 'string', value: '1' },
      { name: 'Exponent', type: 'string', value: '', hint: 'Blank takes the input' },
    ],
    run: (input, args) => {
      const modulus = String(arg(args, 'Modulus', '1')).trim();
      if (!modulus) throw new OperationError('Modulus must be defined.');
      const [base, exponent] = fromArgOrInput(
        String(arg(args, 'Base', '')),
        String(arg(args, 'Exponent', '')),
        input,
        ['Base', 'Exponent'],
      );

      const m = parseBigInt(modulus, 'Modulus');
      if (m === 0n) throw new OperationError('The modulus cannot be zero.');
      const e = parseBigInt(exponent, 'Exponent');
      if (e < 0n) throw new OperationError('A negative exponent needs a modular inverse instead.');
      return modPow(parseBigInt(base, 'Base'), e, m < 0n ? -m : m).toString();
    },
  },
  {
    id: 'modular-inverse',
    name: 'Modular Inverse',
    category: 'Arithmetic / Logic',
    description: 'Finds x where a·x ≡ 1 (mod m). Exists only when a and m are coprime.',
    aliases: ['modinv', 'inverse mod'],
    args: [
      { name: 'Value (a)', type: 'string', value: '', hint: 'Blank takes the input' },
      { name: 'Modulus (m)', type: 'string', value: '', hint: 'Blank takes the input' },
    ],
    run: (input, args) => {
      const [aStr, mStr] = fromArgOrInput(
        String(arg(args, 'Value (a)', '')),
        String(arg(args, 'Modulus (m)', '')),
        input,
        ['Value (a)', 'Modulus (m)'],
      );
      const m = parseBigInt(mStr, 'Modulus (m)');
      if (m <= 0n) throw new OperationError('The modulus must be greater than zero.');

      const a = parseBigInt(aStr, 'Value (a)');
      const normalised = ((a % m) + m) % m;
      const [g, x] = egcd(normalised, m);
      if (g !== 1n && g !== -1n) {
        throw new OperationError(`No inverse exists: gcd(a, m) is ${g < 0n ? -g : g}, not 1.`);
      }
      const inverse = g === -1n ? -x : x;
      return (((inverse % m) + m) % m).toString();
    },
  },
];
