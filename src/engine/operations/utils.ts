import { OperationError } from '../types';
import { latin1ToBytes } from '../core/bytes';
import { DELIMITER_OPTIONS, delimiterFor } from '../core/delimiters';
import { arg, type Operation } from './types';

function decodeJwtSegment(segment: string): string {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const full = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  try {
    return new TextDecoder().decode(latin1ToBytes(atob(full)));
  } catch {
    throw new OperationError('JWT segment is not valid Base64url.');
  }
}

const CASE_SCOPES = ['All', 'Word', 'Sentence', 'Paragraph'] as const;

function applyCase(input: string, scope: string, upper: boolean): string {
  if (scope === 'All') return upper ? input.toUpperCase() : input.toLowerCase();

  const flat = upper ? input.toLowerCase() : input.toUpperCase();
  const cased = (c: string) => (upper ? c.toUpperCase() : c.toLowerCase());

  if (scope === 'Word') return flat.replace(/\b\w/g, cased);
  const boundary = scope === 'Sentence' ? /(^|[.!?]\s+)(\w)/g : /(^|\n\s*)(\w)/g;
  return flat.replace(boundary, (_m, lead: string, letter: string) => lead + cased(letter));
}

export const utilOperations: Operation[] = [
  {
    id: 'jwt-decode',
    name: 'JWT Decode',
    category: 'Utils',
    description: 'Splits a JSON Web Token and decodes its header and payload.',
    aliases: ['jwt', 'json web token', 'decode jwt'],
    args: [],
    run: (input) => {
      const parts = input.trim().split('.');
      if (parts.length < 2) {
        throw new OperationError('A JWT has at least two dot-separated segments.');
      }
      const asJson = (segment: string, which: string): Record<string, unknown> => {
        try {
          return JSON.parse(decodeJwtSegment(segment)) as Record<string, unknown>;
        } catch {
          throw new OperationError(`The ${which} is not JSON. This is not a JWT.`);
        }
      };
      const header = asJson(parts[0]!, 'header');
      const payload = asJson(parts[1]!, 'payload');

      const annotated: Record<string, unknown> = { ...payload };
      for (const claim of ['exp', 'iat', 'nbf'] as const) {
        const value = payload[claim];
        if (typeof value === 'number') {
          annotated[`${claim}_readable`] = new Date(value * 1000).toISOString();
        }
      }

      return JSON.stringify(
        {
          header,
          payload: annotated,
          signature: parts[2] ? `${parts[2].slice(0, 24)}… (not verified)` : '(none)',
        },
        null,
        2,
      );
    },
    detection: {
      formatName: 'JWT',
      pattern: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]*)?$/,
      minLength: 20,
      terminalNote:
        'The header and payload are all of the decodable content. The third segment is a ' +
        'signature or a MAC: it is checked against a key, never decoded — use JWT Verify.',
    },
  },
  {
    id: 'json-beautify',
    name: 'JSON Beautify',
    category: 'Code tidy',
    description: 'Formats JSON with consistent indentation.',
    aliases: ['pretty json', 'format json', 'prettify'],
    args: [{ name: 'Indent', type: 'number', value: 2 }],
    run: (input, args) => {
      try {
        return JSON.stringify(JSON.parse(input), null, Number(arg(args, 'Indent', 2)));
      } catch (error) {
        throw new OperationError(
          `Not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
        );
      }
    },
    detection: {
      formatName: 'JSON',
      pattern: /^\s*[[{][\s\S]*[\]}]\s*$/,
      minLength: 2,
    },
  },
  {
    id: 'json-minify',
    name: 'JSON Minify',
    category: 'Code tidy',
    description: 'Removes all optional whitespace from JSON.',
    aliases: ['compact json', 'minify json'],
    args: [
      {
        name: 'On invalid JSON',
        type: 'option',
        value: 'Fail',
        options: ['Fail', 'Strip whitespace anyway'],
        hint: 'A payload with a trailing comma is still worth compacting. Stripping does not validate.',
      },
    ],
    run: (input, args) => {
      try {
        return JSON.stringify(JSON.parse(input));
      } catch {
        if (arg(args, 'On invalid JSON', 'Fail') === 'Strip whitespace anyway') {
          let out = '';
          let inString = false;
          let escaped = false;
          for (const char of input) {
            if (escaped) {
              out += char;
              escaped = false;
              continue;
            }
            if (char === '\\' && inString) {
              out += char;
              escaped = true;
              continue;
            }
            if (char === '"') inString = !inString;
            if (!inString && /\s/.test(char)) continue;
            out += char;
          }
          return out;
        }
        throw new OperationError('Not valid JSON.');
      }
    },
  },
  {
    id: 'to-upper-case',
    name: 'To Upper case',
    category: 'Utils',
    description: 'Converts the input to upper case.',
    aliases: ['uppercase', 'upper'],
    args: [{ name: 'Scope', type: 'option', value: 'All', options: [...CASE_SCOPES] }],
    run: (input, args) => applyCase(input, String(arg(args, 'Scope', 'All')), true),
  },
  {
    id: 'to-lower-case',
    name: 'To Lower case',
    category: 'Utils',
    description: 'Converts the input to lower case.',
    aliases: ['lowercase', 'lower'],
    args: [{ name: 'Scope', type: 'option', value: 'All', options: [...CASE_SCOPES] }],
    run: (input, args) => applyCase(input, String(arg(args, 'Scope', 'All')), false),
  },
  {
    id: 'reverse',
    name: 'Reverse',
    category: 'Utils',
    description: 'Reverses the order of characters or lines.',
    aliases: ['flip', 'backwards'],
    args: [{ name: 'By', type: 'option', value: 'Character', options: ['Character', 'Line'] }],
    run: (input, args) =>
      arg(args, 'By', 'Character') === 'Line'
        ? input.split('\n').reverse().join('\n')
        : Array.from(input).reverse().join(''),
  },
  {
    id: 'remove-whitespace',
    name: 'Remove whitespace',
    category: 'Utils',
    description: 'Strips spaces, tabs, and line breaks.',
    aliases: ['strip whitespace', 'trim all'],
    args: [
      { name: 'Spaces', type: 'boolean', value: true },
      { name: 'Carriage returns', type: 'boolean', value: true },
      { name: 'Line feeds', type: 'boolean', value: true },
      { name: 'Tabs', type: 'boolean', value: true },
      { name: 'Form feeds', type: 'boolean', value: true },
      {
        name: 'Full stops',
        type: 'boolean',
        value: false,
        hint: 'Not whitespace, but hex dumps and defanged addresses use it as a separator.',
      },
    ],
    run: (input, args) => {
      let chars = '';
      if (arg(args, 'Spaces', true)) chars += '  ';
      if (arg(args, 'Carriage returns', true)) chars += '\r';
      if (arg(args, 'Line feeds', true)) chars += '\n';
      if (arg(args, 'Tabs', true)) chars += '\t\v';
      if (arg(args, 'Form feeds', true)) chars += '\f';
      if (arg(args, 'Full stops', false)) chars += '.';
      if (chars === '') return input;
      return input.replace(new RegExp(`[${chars}]`, 'g'), '');
    },
  },
  {
    id: 'remove-null-bytes',
    name: 'Remove null bytes',
    category: 'Utils',
    description: 'Strips 0x00 bytes, which often pad UTF-16 data.',
    aliases: ['strip nulls'],
    args: [],
    run: (input) => input.replace(/\0/g, ''),
  },
  {
    id: 'sort',
    name: 'Sort',
    category: 'Utils',
    description: 'Sorts the lines of the input.',
    aliases: ['order lines'],
    args: [
      { name: 'Order', type: 'option', value: 'Alphabetical', options: ['Alphabetical', 'Length'] },
      { name: 'Reverse', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const lines = input.split('\n');
      const sorted =
        arg(args, 'Order', 'Alphabetical') === 'Length'
          ? lines.sort((a, b) => a.length - b.length)
          : lines.sort((a, b) => a.localeCompare(b));
      return (arg(args, 'Reverse', false) ? sorted.reverse() : sorted).join('\n');
    },
  },
  {
    id: 'unique',
    name: 'Unique',
    category: 'Utils',
    description: 'Removes duplicate lines, keeping the first occurrence.',
    aliases: ['dedupe', 'distinct', 'uniq'],
    args: [
      { name: 'Delimiter', type: 'option', value: 'Line feed', options: DELIMITER_OPTIONS },
      {
        name: 'Display count',
        type: 'boolean',
        value: false,
        hint: 'Prefixes each entry with how many times it appeared, as uniq -c does.',
      },
    ],
    run: (input, args) => {
      const delimiter = delimiterFor(String(arg(args, 'Delimiter', 'Line feed'))) || '\n';
      const parts = input.split(delimiter);
      if (!arg(args, 'Display count', false)) return [...new Set(parts)].join(delimiter);

      const counts = new Map<string, number>();
      for (const part of parts) counts.set(part, (counts.get(part) ?? 0) + 1);
      return [...counts.entries()].map(([value, n]) => `${n} ${value}`).join(delimiter);
    },
  },
  {
    id: 'parse-timestamp',
    name: 'Parse Timestamp',
    category: 'Date / Time',
    description: 'Interprets a number as a Unix timestamp in seconds or milliseconds.',
    aliases: ['unix time', 'epoch', 'from timestamp'],
    args: [
      {
        name: 'Units',
        type: 'option',
        value: 'Show every plausible reading',
        options: [
          'Show every plausible reading',
          'Seconds',
          'Milliseconds',
          'Microseconds',
          'Nanoseconds',
        ],
        hint: 'Naming the unit gives one ISO timestamp instead of a list to choose from.',
      },
    ],
    run: (input, args) => {
      const value = Number(input.trim());
      if (!Number.isFinite(value)) throw new OperationError('Not a number.');

      const divisor: Record<string, number> = {
        Seconds: 1 / 1000,
        Milliseconds: 1,
        Microseconds: 1000,
        Nanoseconds: 1000000,
      };
      const unit = String(arg(args, 'Units', 'Show every plausible reading'));
      const scale = divisor[unit];
      if (scale !== undefined) {
        const date = new Date(value / scale);
        if (Number.isNaN(date.getTime())) {
          throw new OperationError(`${value} is not a valid timestamp in ${unit.toLowerCase()}.`);
        }
        return date.toISOString();
      }
      const asSeconds = new Date(value * 1000);
      const asMillis = new Date(value);
      const lines = [`Input: ${value}`, ''];
      if (!Number.isNaN(asSeconds.getTime()) && Math.abs(asSeconds.getUTCFullYear() - 2025) < 80) {
        lines.push(`As seconds:      ${asSeconds.toISOString()}`);
      }
      if (!Number.isNaN(asMillis.getTime()) && Math.abs(asMillis.getUTCFullYear() - 2025) < 80) {
        lines.push(`As milliseconds: ${asMillis.toISOString()}`);
      }
      if (lines.length === 2) throw new OperationError('Not a plausible Unix timestamp.');
      return lines.join('\n');
    },
  },
];
