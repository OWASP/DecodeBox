import { OperationError } from '../types';
import { arg, type Operation } from './types';

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.length > 0));
}

function escapeCsv(value: string, delimiter: string): string {
  return /["\n\r]/.test(value) || value.includes(delimiter)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function beautifyXml(input: string, indent: string): string {
  const normalised = input.replace(/>\s*</g, '><').trim();
  let depth = 0;
  const lines: string[] = [];

  for (const token of normalised.split(/(<[^>]+>)/).filter((t) => t.trim().length > 0)) {
    if (!token.startsWith('<')) {
      lines.push(indent.repeat(depth) + token.trim());
      continue;
    }
    if (token.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      lines.push(indent.repeat(depth) + token);
    } else if (token.startsWith('<?') || token.startsWith('<!') || token.endsWith('/>')) {
      lines.push(indent.repeat(depth) + token);
    } else {
      lines.push(indent.repeat(depth) + token);
      depth++;
    }
  }

  return lines.join('\n');
}

function sortValue(value: unknown, descending = false): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item, descending));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (descending ? b.localeCompare(a) : a.localeCompare(b)))
        .map(([key, inner]) => [key, sortValue(inner, descending)]),
    );
  }
  return value;
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new OperationError(
      `Not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
    );
  }
}

const CSV_DELIMITERS: Record<string, string> = {
  Comma: ',',
  Semicolon: ';',
  Tab: '\t',
  Pipe: '|',
};

const BACKSLASH = String.fromCharCode(92);

export const structuredOperations: Operation[] = [
  {
    id: 'csv-to-json',
    name: 'CSV to JSON',
    category: 'Data format',
    description: 'Converts delimited rows into JSON, using the first row as keys.',
    aliases: ['csv', 'parse csv', 'tsv to json'],
    args: [
      { name: 'Delimiter', type: 'option', value: 'Comma', options: Object.keys(CSV_DELIMITERS) },
      { name: 'First row is a header', type: 'boolean', value: true },
    ],
    run: (input, args) => {
      const rows = parseCsv(input, CSV_DELIMITERS[String(arg(args, 'Delimiter', 'Comma'))] ?? ',');
      if (rows.length === 0) throw new OperationError('No rows found.');

      if (!arg(args, 'First row is a header', true)) {
        return JSON.stringify(rows, null, 2);
      }

      const [header, ...body] = rows;
      if (!header) throw new OperationError('No header row found.');

      return JSON.stringify(
        body.map((row) => Object.fromEntries(header.map((key, i) => [key, row[i] ?? '']))),
        null,
        2,
      );
    },
    detection: {
      formatName: 'CSV',
      pattern: /^[^\n,]*,[^\n,]*(,[^\n,]*)*(\r?\n[^\n]*,[^\n]*)+$/,
      minLength: 12,
    },
  },
  {
    id: 'json-to-csv',
    name: 'JSON to CSV',
    category: 'Data format',
    description: 'Converts an array of objects into delimited rows.',
    aliases: ['to csv', 'export csv'],
    args: [
      { name: 'Delimiter', type: 'option', value: 'Comma', options: Object.keys(CSV_DELIMITERS) },
    ],
    run: (input, args) => {
      const parsed = parseJson(input);
      if (!Array.isArray(parsed)) throw new OperationError('Expected a JSON array of objects.');
      if (parsed.length === 0) return '';

      const delimiter = CSV_DELIMITERS[String(arg(args, 'Delimiter', 'Comma'))] ?? ',';
      const keys = [
        ...new Set(
          parsed.flatMap((row) =>
            typeof row === 'object' && row !== null ? Object.keys(row as object) : [],
          ),
        ),
      ];
      if (keys.length === 0) throw new OperationError('The array holds no objects with keys.');

      const lines = [keys.map((k) => escapeCsv(k, delimiter)).join(delimiter)];
      for (const row of parsed) {
        const record = (row ?? {}) as Record<string, unknown>;
        lines.push(
          keys
            .map((key) => {
              const value = record[key];
              return escapeCsv(value === undefined || value === null ? '' : String(value), delimiter);
            })
            .join(delimiter),
        );
      }
      return lines.join('\n');
    },
  },
  {
    id: 'sort-json-keys',
    name: 'Sort JSON keys',
    category: 'Code tidy',
    description: 'Sorts every object key alphabetically, which makes two documents comparable.',
    aliases: ['normalise json', 'canonical json', 'json diff prep'],
    args: [
      { name: 'Order', type: 'option', value: 'Ascending', options: ['Ascending', 'Descending'] },
      {
        name: 'Indent',
        type: 'number',
        value: 2,
        min: 0,
        max: 8,
        hint: 'Zero writes it on one line, which is what a checksum of the canonical form needs.',
      },
    ],
    run: (input, args) => {
      const descending = arg(args, 'Order', 'Ascending') === 'Descending';
      const indent = Math.max(0, Math.min(8, Number(arg(args, 'Indent', 2))));
      const sorted = sortValue(parseJson(input), descending);
      return JSON.stringify(sorted, null, indent);
    },
  },
  {
    id: 'json-escape',
    name: 'JSON Escape',
    category: 'Data format',
    description: 'Escapes the input so it can be embedded as a JSON string.',
    aliases: ['escape json', 'stringify'],
    args: [
      {
        name: 'Include the quotes',
        type: 'boolean',
        value: true,
        hint: 'Off gives just the escaped body, for pasting between quotes you already typed.',
      },
      {
        name: 'Escape non-ASCII',
        type: 'boolean',
        value: false,
        hint: 'Writes every character above 127 as \\uXXXX, which survives a transport that is not UTF-8 clean.',
      },
    ],
    run: (input, args) => {
      let out = JSON.stringify(input);
      if (arg(args, 'Escape non-ASCII', false)) {
        out = Array.from(out)
          .map((c) => {
            const code = c.charCodeAt(0);
            if (code < 0x80) return c;
            return BACKSLASH + 'u' + code.toString(16).padStart(4, '0');
          })
          .join('');
      }
      return arg(args, 'Include the quotes', true) ? out : out.slice(1, -1);
    },
  },
  {
    id: 'json-unescape',
    name: 'JSON Unescape',
    category: 'Data format',
    description: 'Turns a JSON string literal back into its raw text.',
    aliases: ['unescape json', 'parse json string'],
    args: [],
    run: (input) => {
      const trimmed = input.trim();
      const wrapped = trimmed.startsWith('"') ? trimmed : JSON.stringify(trimmed);
      const value: unknown = parseJson(wrapped);
      if (typeof value !== 'string') throw new OperationError('Expected a JSON string.');
      return value;
    },
  },
  {
    id: 'xml-beautify',
    name: 'XML Beautify',
    category: 'Code tidy',
    description: 'Indents XML or HTML so the structure is readable.',
    aliases: ['format xml', 'pretty xml', 'indent html'],
    args: [{ name: 'Indent', type: 'number', value: 2, min: 0, max: 8 }],
    run: (input, args) => {
      if (!input.trim().startsWith('<')) throw new OperationError('This does not look like XML.');
      return beautifyXml(input, ' '.repeat(Number(arg(args, 'Indent', 2))));
    },
  },
  {
    id: 'xml-minify',
    name: 'XML Minify',
    category: 'Code tidy',
    description: 'Removes the whitespace between XML elements.',
    aliases: ['compact xml', 'minify html'],
    args: [
      {
        name: 'Preserve comments',
        type: 'boolean',
        value: true,
        hint: 'Turn this off to strip <!-- --> blocks, which is where XML payloads hide.',
      },
    ],
    run: (input, args) => {
      const text = arg(args, 'Preserve comments', true)
        ? input
        : input.replace(/<!--[\s\S]*?-->/g, '');
      return text.replace(/>\s+</g, '><').trim();
    },
  },
  {
    id: 'strip-comments',
    name: 'Strip comments',
    category: 'Code tidy',
    description: 'Removes comments in C, JavaScript, shell, SQL or XML style.',
    aliases: ['remove comments', 'uncomment'],
    args: [
      {
        name: 'Style',
        type: 'option',
        value: 'C / JavaScript',
        options: ['C / JavaScript', 'Shell / Python', 'SQL', 'XML / HTML'],
      },
    ],
    run: (input, args) => {
      switch (String(arg(args, 'Style', 'C / JavaScript'))) {
        case 'Shell / Python':
          return input.replace(/(^|\s)#.*$/gm, '$1').trimEnd();
        case 'SQL':
          return input.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trimEnd();
        case 'XML / HTML':
          return input.replace(/<!--[\s\S]*?-->/g, '').trimEnd();
        default:
          return input
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1')
            .trimEnd();
      }
    },
  },
  {
    id: 'jwt-verify-shape',
    name: 'JWT Inspect',
    category: 'Utils',
    description: 'Decodes a JWT and reports what the header claims, without verifying the signature.',
    aliases: ['inspect jwt', 'jwt claims', 'token claims'],
    args: [],
    run: (input) => {
      const parts = input.trim().split('.');
      if (parts.length < 2) throw new OperationError('A JWT has at least two segments.');

      const decode = (segment: string) => {
        const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
        try {
          return JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))) as Record<
            string,
            unknown
          >;
        } catch {
          throw new OperationError('A JWT segment is not valid Base64url JSON.');
        }
      };

      const header = decode(parts[0]!);
      const payload = decode(parts[1]!);
      const now = Math.floor(Date.now() / 1000);

      const lines = [
        `Algorithm:  ${String(header.alg ?? 'unstated')}`,
        `Type:       ${String(header.typ ?? 'unstated')}`,
        ...(header.kid ? [`Key ID:     ${String(header.kid)}`] : []),
        '',
      ];

      if (header.alg === 'none') {
        lines.push('The header declares alg "none": this token asserts it is unsigned.', '');
      }

      for (const [claim, label] of [
        ['exp', 'Expires'],
        ['nbf', 'Not before'],
        ['iat', 'Issued at'],
      ] as const) {
        const value = payload[claim];
        if (typeof value !== 'number') continue;
        const when = new Date(value * 1000).toISOString();
        const note =
          claim === 'exp'
            ? value < now
              ? '  (EXPIRED)'
              : `  (valid for another ${Math.round((value - now) / 60)} minutes)`
            : claim === 'nbf' && value > now
              ? '  (NOT YET VALID)'
              : '';
        lines.push(`${label.padEnd(11)} ${when}${note}`);
      }

      lines.push('', 'Claims:', JSON.stringify(payload, null, 2));
      lines.push(
        '',
        parts[2]
          ? 'The signature is present but NOT verified — that needs the key.'
          : 'No signature segment.',
      );
      return lines.join('\n');
    },
  },
];
