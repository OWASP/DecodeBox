import { OperationError } from '../types';
import { arg, type Operation } from './types';

function buildRegex(pattern: string, flags: string): RegExp {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    throw new OperationError(
      `Not a valid regular expression: ${error instanceof Error ? error.message : 'parse failed'}`,
    );
  }
}

const DELIMITERS: Record<string, string> = {
  'Line feed': '\n',
  'CRLF': '\r\n',
  Space: ' ',
  Comma: ',',
  Semicolon: ';',
  Tab: '\t',
  Nothing: '',
};

function delimiter(name: string): string {
  return DELIMITERS[name] ?? '\n';
}

const DELIMITER_OPTIONS = Object.keys(DELIMITERS);

const SMART_CHARACTERS: Record<string, string> = {
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '--',
  '―': '--',
  '…': '...',
  '©': '(c)',
  '®': '(r)',
  '™': '(tm)',
  '←': '<--',
  '→': '-->',
  '↑': '^',
  '↓': 'v',
  '↔': '<->',
  '⇐': '<==',
  '⇒': '==>',
  '⇔': '<=>',
  '«': '<<',
  '»': '>>',
  '‹': '<',
  '›': '>',
  '×': 'x',
  '÷': '/',
  '±': '+/-',
  '•': '*',
  '·': '.',
  '\u00a0': ' ',
  '\u2002': ' ',
  '\u2003': ' ',
  '\u2009': ' ',
  '\u200a': ' ',
};

export const textOperations: Operation[] = [
  {
    id: 'find-replace',
    name: 'Find / Replace',
    category: 'Utils',
    description: 'Replaces matches of a string or regular expression.',
    aliases: ['replace', 'substitute', 'sed', 'search and replace'],
    args: [
      { name: 'Find', type: 'string', value: '' },
      { name: 'Replace', type: 'string', value: '' },
      { name: 'Type', type: 'option', value: 'Regex', options: ['Regex', 'Simple string'] },
      { name: 'Case insensitive', type: 'boolean', value: false },
      { name: 'Global', type: 'boolean', value: true },
    ],
    run: (input, args) => {
      const find = String(arg(args, 'Find', ''));
      if (find.length === 0) throw new OperationError('Nothing to find.');
      const replace = String(arg(args, 'Replace', ''));

      let flags = '';
      if (arg(args, 'Global', true)) flags += 'g';
      if (arg(args, 'Case insensitive', false)) flags += 'i';

      if (arg(args, 'Type', 'Regex') === 'Simple string') {
        const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return input.replace(buildRegex(escaped, flags), () => replace);
      }
      return input.replace(buildRegex(find, flags), replace);
    },
  },
  {
    id: 'regular-expression',
    name: 'Regular expression',
    category: 'Extractors',
    description: 'Lists everything matching a regular expression, or a chosen capture group.',
    aliases: ['regex', 'grep', 'match', 'pattern'],
    args: [
      { name: 'Pattern', type: 'string', value: '' },
      { name: 'Capture group', type: 'number', value: 0, min: 0, max: 20 },
      { name: 'Case insensitive', type: 'boolean', value: false },
      { name: 'Unique', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const pattern = String(arg(args, 'Pattern', ''));
      if (pattern.length === 0) throw new OperationError('Enter a pattern.');

      const group = Number(arg(args, 'Capture group', 0));
      const regex = buildRegex(pattern, arg(args, 'Case insensitive', false) ? 'gi' : 'g');

      const found: string[] = [];
      for (const match of input.matchAll(regex)) {
        const value = match[group];
        if (value !== undefined) found.push(value);
      }

      const result = arg(args, 'Unique', false) ? [...new Set(found)] : found;
      return result.length > 0 ? result.join('\n') : '(no matches)';
    },
  },
  {
    id: 'filter-lines',
    name: 'Filter lines',
    category: 'Utils',
    description: 'Keeps or drops the lines matching a pattern.',
    aliases: ['grep lines', 'select lines', 'exclude'],
    args: [
      { name: 'Pattern', type: 'string', value: '' },
      { name: 'Invert', type: 'boolean', value: false },
      { name: 'Case insensitive', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const regex = buildRegex(
        String(arg(args, 'Pattern', '')),
        arg(args, 'Case insensitive', false) ? 'i' : '',
      );
      const invert = arg(args, 'Invert', false);
      return input
        .split('\n')
        .filter((line) => regex.test(line) !== invert)
        .join('\n');
    },
  },
  {
    id: 'split',
    name: 'Split',
    category: 'Utils',
    description: 'Splits the input on a delimiter and puts each piece on its own line.',
    aliases: ['tokenise', 'explode'],
    args: [
      { name: 'Split on', type: 'option', value: 'Comma', options: DELIMITER_OPTIONS },
      { name: 'Join with', type: 'option', value: 'Line feed', options: DELIMITER_OPTIONS },
    ],
    run: (input, args) =>
      input
        .split(delimiter(String(arg(args, 'Split on', 'Comma'))))
        .join(delimiter(String(arg(args, 'Join with', 'Line feed')))),
  },
  {
    id: 'head',
    name: 'Head',
    category: 'Utils',
    description: 'Keeps only the first lines.',
    aliases: ['first lines', 'take'],
    args: [{ name: 'Lines', type: 'number', value: 10, min: 1, max: 100000 }],
    run: (input, args) => input.split('\n').slice(0, Number(arg(args, 'Lines', 10))).join('\n'),
  },
  {
    id: 'tail',
    name: 'Tail',
    category: 'Utils',
    description: 'Keeps only the last lines.',
    aliases: ['last lines'],
    args: [{ name: 'Lines', type: 'number', value: 10, min: 1, max: 100000 }],
    run: (input, args) => input.split('\n').slice(-Number(arg(args, 'Lines', 10))).join('\n'),
  },
  {
    id: 'count-occurrences',
    name: 'Count occurrences',
    category: 'Utils',
    description: 'Counts how many times a string or pattern appears.',
    aliases: ['count', 'tally', 'how many'],
    args: [
      { name: 'Search', type: 'string', value: '' },
      { name: 'Type', type: 'option', value: 'Simple string', options: ['Simple string', 'Regex'] },
    ],
    run: (input, args) => {
      const search = String(arg(args, 'Search', ''));
      if (search.length === 0) throw new OperationError('Enter something to count.');
      const pattern =
        arg(args, 'Type', 'Simple string') === 'Regex'
          ? search
          : search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return String((input.match(buildRegex(pattern, 'g')) ?? []).length);
    },
  },
  {
    id: 'pad-lines',
    name: 'Pad lines',
    category: 'Utils',
    description: 'Adds padding to the start or end of every line.',
    aliases: ['indent', 'prefix lines', 'suffix lines'],
    args: [
      { name: 'Position', type: 'option', value: 'Start', options: ['Start', 'End'] },
      { name: 'Length', type: 'number', value: 2, min: 0, max: 200 },
      { name: 'Character', type: 'string', value: ' ' },
    ],
    run: (input, args) => {
      const pad = String(arg(args, 'Character', ' ')).repeat(
        Math.max(0, Number(arg(args, 'Length', 2))),
      );
      const start = arg(args, 'Position', 'Start') === 'Start';
      return input
        .split('\n')
        .map((line) => (start ? pad + line : line + pad))
        .join('\n');
    },
  },
  {
    id: 'strip-html',
    name: 'Strip HTML tags',
    category: 'Utils',
    description: 'Removes markup, leaving the text content.',
    aliases: ['remove tags', 'html to text', 'untag'],
    args: [{ name: 'Remove scripts and styles', type: 'boolean', value: true }],
    run: (input, args) => {
      let text = input;
      if (arg(args, 'Remove scripts and styles', true)) {
        text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
      }
      return text
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    },
  },
  {
    id: 'to-case',
    name: 'Change case',
    category: 'Utils',
    description: 'Converts between naming conventions.',
    aliases: ['camel case', 'snake case', 'kebab case', 'pascal case', 'title case'],
    args: [
      {
        name: 'Style',
        type: 'option',
        value: 'snake_case',
        options: ['snake_case', 'camelCase', 'PascalCase', 'kebab-case', 'Title Case', 'CONSTANT_CASE'],
      },
    ],
    run: (input, args) => {
      const words = input
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[\s_\-.]+/)
        .filter(Boolean)
        .map((w) => w.toLowerCase());

      if (words.length === 0) return input;

      switch (String(arg(args, 'Style', 'snake_case'))) {
        case 'camelCase':
          return words
            .map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
            .join('');
        case 'PascalCase':
          return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
        case 'kebab-case':
          return words.join('-');
        case 'Title Case':
          return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
        case 'CONSTANT_CASE':
          return words.join('_').toUpperCase();
        default:
          return words.join('_');
      }
    },
  },
  {
    id: 'wrap-lines',
    name: 'Wrap lines',
    category: 'Utils',
    description: 'Hard-wraps long lines at a chosen width.',
    aliases: ['word wrap', 'fold'],
    args: [{ name: 'Width', type: 'number', value: 80, min: 8, max: 500 }],
    run: (input, args) => {
      const width = Number(arg(args, 'Width', 80));
      return input
        .split('\n')
        .flatMap((line) => line.match(new RegExp(`.{1,${width}}`, 'g')) ?? [''])
        .join('\n');
    },
  },
  {
    id: 'to-table',
    name: 'To table',
    category: 'Utils',
    description: 'Aligns delimited data into readable columns.',
    aliases: ['align columns', 'csv table', 'columnise'],
    args: [
      { name: 'Delimiter', type: 'option', value: 'Comma', options: DELIMITER_OPTIONS },
      { name: 'First row is a header', type: 'boolean', value: true },
    ],
    run: (input, args) => {
      const sep = delimiter(String(arg(args, 'Delimiter', 'Comma')));
      const rows = input
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => line.split(sep).map((cell) => cell.trim()));

      if (rows.length === 0) return '';
      const columns = Math.max(...rows.map((r) => r.length));
      const widths = Array.from({ length: columns }, (_, c) =>
        Math.max(...rows.map((r) => (r[c] ?? '').length)),
      );

      const render = (row: string[]) =>
        row.map((cell, c) => cell.padEnd(widths[c] ?? 0)).join('  ').trimEnd();

      const lines = rows.map(render);
      if (arg(args, 'First row is a header', true) && lines.length > 1) {
        lines.splice(1, 0, widths.map((w) => '-'.repeat(w)).join('  '));
      }
      return lines.join('\n');
    },
  },
  {
    id: 'take-bytes',
    name: 'Take bytes',
    category: 'Utils',
    description: 'Keeps a slice of the input by byte offset.',
    aliases: ['slice', 'substring', 'cut'],
    args: [
      { name: 'Start', type: 'number', value: 0, min: 0, max: 100000000 },
      { name: 'Length', type: 'number', value: 100, min: 1, max: 100000000 },
    ],
    run: (input, args) => {
      const start = Number(arg(args, 'Start', 0));
      return input.slice(start, start + Number(arg(args, 'Length', 100)));
    },
  },
  {
    id: 'drop-bytes',
    name: 'Drop bytes',
    category: 'Utils',
    description: 'Removes a slice of the input by byte offset.',
    aliases: ['remove bytes', 'delete range'],
    args: [
      { name: 'Start', type: 'number', value: 0, min: 0, max: 100000000 },
      { name: 'Length', type: 'number', value: 10, min: 1, max: 100000000 },
    ],
    run: (input, args) => {
      const start = Number(arg(args, 'Start', 0));
      return input.slice(0, start) + input.slice(start + Number(arg(args, 'Length', 10)));
    },
  },
  {
    id: 'trim-lines',
    name: 'Trim lines',
    category: 'Utils',
    description: 'Removes leading and trailing whitespace from every line.',
    aliases: ['strip lines', 'trim'],
    args: [{ name: 'Drop empty lines', type: 'boolean', value: false }],
    run: (input, args) => {
      const lines = input.split('\n').map((line) => line.trim());
      return (arg(args, 'Drop empty lines', false) ? lines.filter(Boolean) : lines).join('\n');
    },
  },
  {
    id: 'add-line-numbers',
    name: 'Add line numbers',
    category: 'Utils',
    description: 'Prefixes every line with its number.',
    aliases: ['number lines', 'nl'],
    args: [
      {
        name: 'Start at',
        type: 'number',
        value: 1,
        hint: 'Match the first line of an excerpt taken out of a larger file.',
      },
      { name: 'Separator', type: 'string', value: ' ' },
      { name: 'Pad with zeros', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const start = Number(arg(args, 'Start at', 1));
      const separator = String(arg(args, 'Separator', ' '));
      const zeros = Boolean(arg(args, 'Pad with zeros', false));
      const lines = input.split('\n');
      const width = String(start + lines.length - 1).length;
      return lines
        .map((line, i) => {
          const n = String(start + i);
          return (zeros ? n.padStart(width, '0') : n.padStart(width)) + separator + line;
        })
        .join('\n');
    },
  },
  {
    id: 'remove-line-numbers',
    name: 'Remove line numbers',
    category: 'Utils',
    description: 'Strips a leading line number from every line.',
    aliases: ['unnumber lines'],
    args: [],
    run: (input) => input.replace(/^\s*\d+[:.)\s]\s?/gm, ''),
  },
  {
    id: 'escape-smart-characters',
    name: 'Escape Smart Characters',
    category: 'Data format',
    description: 'Replaces typographic quotes, dashes and symbols with their ASCII equivalents.',
    aliases: ['smart quotes', 'curly quotes', 'asciify'],
    args: [
      {
        name: 'Unmappable characters',
        type: 'option',
        value: 'Include',
        options: ['Include', 'Remove', "Replace with '.'"],
      },
    ],
    run: (input, args) => {
      const unmappable = String(arg(args, 'Unmappable characters', 'Include'));
      let out = '';
      for (const char of input) {
        const mapped = SMART_CHARACTERS[char];
        if ((char.codePointAt(0) ?? 0) < 128) out += char;
        else if (mapped !== undefined) out += mapped;
        else if (unmappable === 'Remove') continue;
        else if (unmappable === "Replace with '.'") out += '.';
        else out += char;
      }
      return out;
    },
  },
];
