import { OperationError } from '../types';
import { arg, type Operation } from './types';


function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
}

function eachIdentifier(input: string, convert: (word: string) => string): string {
  return input.replace(/[A-Za-z0-9_$-]+/g, (token) =>
    /[A-Za-z]/.test(token) ? convert(token) : token,
  );
}

const LEET: Record<string, string> = {
  a: '4',
  e: '3',
  i: '1',
  o: '0',
  s: '5',
  t: '7',
};

const FROM_LEET: Record<string, string> = Object.fromEntries(
  Object.entries(LEET).map(([letter, digit]) => [digit, letter]),
);


const NAMED_ESCAPES: Record<string, string> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\v': '\\v',
  '\f': '\\f',
  '\r': '\\r',
  '\\': '\\\\',
};

const QUOTE_CHARS: Record<string, string> = {
  Single: "'",
  Double: '"',
  Backtick: '`',
};

interface EscapeOptions {
  level: string;
  quote: string;
  json: boolean;
  es6: boolean;
  upperHex: boolean;
}

function escapeCodePoint(code: number, options: EscapeOptions): string {
  const hex = (value: number, width: number) => {
    const digits = value.toString(16).padStart(width, '0');
    return options.upperHex ? digits.toUpperCase() : digits;
  };

  if (code > 0xffff) {
    if (options.es6 && !options.json) return `\\u{${hex(code, 1)}}`;
    const offset = code - 0x10000;
    return `\\u${hex(0xd800 + (offset >> 10), 4)}\\u${hex(0xdc00 + (offset & 0x3ff), 4)}`;
  }
  if (code > 0xff || options.json) return `\\u${hex(code, 4)}`;
  return `\\x${hex(code, 2)}`;
}

function escapeString(input: string, options: EscapeOptions): string {
  const quote = QUOTE_CHARS[options.quote] ?? "'";
  let out = '';

  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;

    if (char === quote) {
      out += `\\${quote}`;
      continue;
    }
    const named = NAMED_ESCAPES[char];
    if (named !== undefined) {
      out += options.json && char === '\v' ? '\\u000b' : named;
      continue;
    }
    if (options.level === 'Minimal') {
      out += char;
      continue;
    }
    if (options.level === 'Everything') {
      out += escapeCodePoint(code, options);
      continue;
    }
    out += code < 0x20 || code === 0x7f || code > 0x7e ? escapeCodePoint(code, options) : char;
  }
  return out;
}

const UNESCAPES: Record<string, string> = {
  b: '\b',
  t: '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  '0': '\0',
};

function unescapeString(input: string): string {
  return input.replace(
    /\\(u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|[0-7]{1,3}|.)/g,
    (_match, body: string, braced?: string, unit?: string, byte?: string) => {
      if (braced !== undefined) return String.fromCodePoint(parseInt(braced, 16));
      if (unit !== undefined) return String.fromCharCode(parseInt(unit, 16));
      if (byte !== undefined) return String.fromCharCode(parseInt(byte, 16));
      if (/^[0-7]{2,3}$/.test(body)) return String.fromCharCode(parseInt(body, 8));
      return UNESCAPES[body] ?? body;
    },
  );
}


function expandAlphabetRange(input: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const char = input[i] as string;
    const next = input[i + 1];
    const after = input[i + 2];

    if (char === '\\' && next !== undefined) {
      out.push(next);
      i++;
    } else if (next === '-' && after !== undefined && after !== '-') {
      const from = char.charCodeAt(0);
      const to = after.charCodeAt(0);
      const step = from <= to ? 1 : -1;
      for (let code = from; step > 0 ? code <= to : code >= to; code += step) {
        out.push(String.fromCharCode(code));
      }
      i += 2;
    } else {
      out.push(char);
    }
  }
  return out;
}

const MAX_CASINGS = 20;

export const casingOperations: Operation[] = [
  {
    id: 'swap-case',
    name: 'Swap case',
    category: 'Utils',
    description: 'Turns upper case into lower case and lower case into upper.',
    aliases: ['invert case', 'toggle case'],
    args: [],
    run: (input) =>
      Array.from(input, (char) => {
        const upper = char.toUpperCase();
        return char === upper ? char.toLowerCase() : upper;
      }).join(''),
  },
  {
    id: 'alternating-caps',
    name: 'Alternating Caps',
    category: 'Utils',
    description: 'Alternates the case of every letter, sarcasm-font style.',
    aliases: ['spongebob', 'mocking case'],
    args: [],
    run: (input) => {
      let upper = false;
      let out = '';
      for (const char of input) {
        if (!/\p{L}/u.test(char)) {
          out += char;
          continue;
        }
        out += upper ? char.toUpperCase() : char.toLowerCase();
        upper = !upper;
      }
      return out;
    },
  },
  {
    id: 'get-all-casings',
    name: 'Get All Casings',
    category: 'Utils',
    description: 'Lists every combination of upper and lower case for the input.',
    aliases: ['case permutations', 'all cases', 'wordlist'],
    args: [],
    run: (input) => {
      const letters = [...input].map((char, index) => ({ char, index })).filter((c) =>
        /[a-z]/i.test(c.char),
      );
      if (letters.length > MAX_CASINGS) {
        throw new OperationError(
          `${letters.length} letters would be ${2 ** letters.length} lines; ${MAX_CASINGS} is the limit.`,
        );
      }

      const base = [...input.toLowerCase()];
      const out: string[] = [];
      for (let mask = 0; mask < 1 << letters.length; mask++) {
        const candidate = [...base];
        letters.forEach((letter, bit) => {
          if ((mask >> bit) & 1) candidate[letter.index] = letter.char.toUpperCase();
        });
        out.push(candidate.join(''));
      }
      return out.join('\n');
    },
  },
  {
    id: 'to-case-insensitive-regex',
    name: 'To Case Insensitive Regex',
    category: 'Utils',
    description: 'Rewrites a regular expression so it matches either case without a flag.',
    aliases: ['case insensitive', 'regex both cases'],
    args: [],
    run: (input) => {
      try {
        new RegExp(input);
      } catch {
        throw new OperationError('Input is not a valid regular expression.');
      }

      const literals = input.replace(/[a-zA-Z]/g, (letter, offset: number) => {
        if (input[offset - 1] === '-' || input[offset + 1] === '-') return letter;
        return `[${letter.toLowerCase()}${letter.toUpperCase()}]`;
      });

      return literals
        .replace(
          /([A-Z]-[A-Z]|[a-z]-[a-z])/g,
          (m) =>
            `${(m[0] as string).toUpperCase()}-${(m[2] as string).toUpperCase()}` +
            `${(m[0] as string).toLowerCase()}-${(m[2] as string).toLowerCase()}`,
        )
        .replace(/[A-Z]-[a-z]/g, (m) => `A-${(m[2] as string).toUpperCase()}${m}${(m[0] as string).toLowerCase()}-z`)
        .replace(/\\?[ -@]-[A-Z]/g, (m) => `${m}a-${(m[2] as string).toLowerCase()}`)
        .replace(/\\?[ -@]-\\?[[-`]/g, (m) => `${m}a-z`)
        .replace(/[A-Z]-\\?[[-`]/g, (m) => `${m}${(m[0] as string).toLowerCase()}-z`)
        .replace(/\\?[[-`]-\\?[{-~]/g, (m) => `${m}A-Z`)
        .replace(/[a-z]-\\?[{-~]/g, (m) => `${m}${(m[0] as string).toUpperCase()}-Z`)
        .replace(/\\?[ -@]-[a-z]/g, (m) => `${m[0] as string}-z`)
        .replace(/\\?[[-`]-[a-z]/g, (m) => `A-${(m[2] as string).toUpperCase()}${m}`);
    },
  },
  {
    id: 'from-case-insensitive-regex',
    name: 'From Case Insensitive Regex',
    category: 'Utils',
    description: 'Collapses two-case character classes back into plain letters.',
    aliases: ['simplify regex', 'case sensitive'],
    args: [],
    run: (input) =>
      input.replace(/\[([a-z])([a-z])\]/gi, (match, first: string, second: string) =>
        first.toUpperCase() === second.toUpperCase() ? first : match,
      ),
  },
  {
    id: 'to-snake-case',
    name: 'To Snake case',
    category: 'Code tidy',
    description: 'Rewrites identifiers as lower case words joined by underscores.',
    aliases: ['snake_case', 'underscore case'],
    args: [{ name: 'Attempt to be context aware', type: 'boolean', value: false }],
    run: (input, args) => {
      const convert = (token: string) => words(token).join('_').toLowerCase();
      return arg(args, 'Attempt to be context aware', false)
        ? eachIdentifier(input, convert)
        : convert(input);
    },
  },
  {
    id: 'to-camel-case',
    name: 'To Camel case',
    category: 'Code tidy',
    description: 'Rewrites identifiers with each word after the first capitalised.',
    aliases: ['camelCase'],
    args: [{ name: 'Attempt to be context aware', type: 'boolean', value: false }],
    run: (input, args) => {
      const convert = (token: string) =>
        words(token)
          .map((word, i) =>
            i === 0
              ? word.toLowerCase()
              : word[0]?.toUpperCase() + word.slice(1).toLowerCase(),
          )
          .join('');
      return arg(args, 'Attempt to be context aware', false)
        ? eachIdentifier(input, convert)
        : convert(input);
    },
  },
  {
    id: 'to-kebab-case',
    name: 'To Kebab case',
    category: 'Code tidy',
    description: 'Rewrites identifiers as lower case words joined by hyphens.',
    aliases: ['kebab-case', 'dash case', 'slug'],
    args: [{ name: 'Attempt to be context aware', type: 'boolean', value: false }],
    run: (input, args) => {
      const convert = (token: string) => words(token).join('-').toLowerCase();
      return arg(args, 'Attempt to be context aware', false)
        ? eachIdentifier(input, convert)
        : convert(input);
    },
  },
  {
    id: 'convert-leet-speak',
    name: 'Convert Leet Speak',
    category: 'Language',
    description: 'Converts between ordinary text and the digit substitutions of leet.',
    aliases: ['1337', 'l33t', 'leetspeak'],
    args: [
      {
        name: 'Direction',
        type: 'option',
        value: 'To Leet Speak',
        options: ['To Leet Speak', 'From Leet Speak'],
      },
    ],
    run: (input, args) => {
      if (String(arg(args, 'Direction', 'To Leet Speak')) === 'From Leet Speak') {
        return input.replace(/[013457]/g, (char) => FROM_LEET[char] ?? char);
      }
      return input.replace(/[a-z]/gi, (char) => {
        const mapped = LEET[char.toLowerCase()];
        return mapped ?? char;
      });
    },
  },
  {
    id: 'unicode-text-format',
    name: 'Unicode Text Format',
    category: 'Language',
    description: 'Adds combining underline or strikethrough marks to every character.',
    aliases: ['underline', 'strikethrough', 'combining marks'],
    args: [
      { name: 'Underline', type: 'boolean', value: false },
      { name: 'Strikethrough', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      let marks = '';
      if (arg(args, 'Strikethrough', false)) marks += '\u0336';
      if (arg(args, 'Underline', false)) marks += '\u0332';
      if (marks === '') return input;
      return Array.from(input, (char) => char + marks).join('');
    },
  },
  {
    id: 'remove-ansi-escape-codes',
    name: 'Remove ANSI Escape Codes',
    category: 'Utils',
    description: 'Strips the colour and cursor codes a terminal leaves in captured output.',
    aliases: ['strip colour', 'decolourise', 'terminal codes'],
    args: [],
    // eslint-disable-next-line no-control-regex
    run: (input) => input.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''),
  },
  {
    id: 'escape-string',
    name: 'Escape string',
    category: 'Utils',
    description: 'Escapes the input so it can be pasted into source code as a literal.',
    aliases: ['string literal', 'jsesc', 'quote'],
    args: [
      {
        name: 'Escape level',
        type: 'option',
        value: 'Special chars',
        options: ['Special chars', 'Everything', 'Minimal'],
      },
      {
        name: 'Escape quote',
        type: 'option',
        value: 'Single',
        options: ['Single', 'Double', 'Backtick'],
      },
      { name: 'JSON compatible', type: 'boolean', value: false },
      { name: 'ES6 compatible', type: 'boolean', value: true },
      { name: 'Uppercase hex', type: 'boolean', value: false },
    ],
    run: (input, args) =>
      escapeString(input, {
        level: String(arg(args, 'Escape level', 'Special chars')),
        quote: String(arg(args, 'Escape quote', 'Single')),
        json: arg(args, 'JSON compatible', false),
        es6: arg(args, 'ES6 compatible', true),
        upperHex: arg(args, 'Uppercase hex', false),
      }),
  },
  {
    id: 'unescape-string',
    name: 'Unescape string',
    category: 'Utils',
    description: 'Turns backslash escapes in a string literal back into the characters.',
    aliases: ['unquote', 'decode escapes'],
    args: [],
    run: (input) => unescapeString(input),
  },
  {
    id: 'expand-alphabet-range',
    name: 'Expand alphabet range',
    category: 'Utils',
    description: 'Expands ranges such as a-z into every character between them.',
    aliases: ['character range', 'tr', 'alphabet'],
    args: [{ name: 'Delimiter', type: 'string', value: '' }],
    run: (input, args) =>
      expandAlphabetRange(input).join(String(arg(args, 'Delimiter', ''))),
  },
];
