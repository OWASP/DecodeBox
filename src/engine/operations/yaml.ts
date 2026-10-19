import { OperationError } from '../types';
import { arg, type Operation } from './types';


type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface Line {
  indent: number;
  text: string;
  number: number;
}

function stripComment(text: string): string {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]!))) {
      return text.slice(0, i);
    }
  }
  return text;
}

function readLines(source: string): Line[] {
  const lines: Line[] = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    const withoutComment = stripComment(raw);
    if (withoutComment.trim().length === 0) return;
    lines.push({
      indent: withoutComment.length - withoutComment.trimStart().length,
      text: withoutComment.trimEnd(),
      number: i + 1,
    });
  });
  return lines;
}

function scalar(raw: string, line: number): Json {
  const text = raw.trim();
  if (text.length === 0) return null;

  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) {
      throw new OperationError(`Unterminated double-quoted string on line ${line}.`);
    }
    try {
      return JSON.parse(text) as Json;
    } catch {
      throw new OperationError(`Bad escape in the string on line ${line}.`);
    }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) {
      throw new OperationError(`Unterminated single-quoted string on line ${line}.`);
    }
    return text.slice(1, -1).replace(/''/g, "'");
  }

  if (text.startsWith('&') || text.startsWith('*')) {
    throw new OperationError(
      `Anchors and aliases are not supported (line ${line}). Expand '${text}' by hand first.`,
    );
  }
  if (text.startsWith('!')) {
    throw new OperationError(`Tags are not supported (line ${line}): '${text}'.`);
  }

  if (text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null;
  if (text === 'true' || text === 'True' || text === 'TRUE') return true;
  if (text === 'false' || text === 'False' || text === 'FALSE') return false;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return Number(text);
  if (/^[-+]?0x[0-9a-fA-F]+$/.test(text)) return Number.parseInt(text, 16);
  if (text === '.inf' || text === '.Inf') return Infinity;
  if (text === '-.inf' || text === '-.Inf') return -Infinity;
  if (text === '.nan' || text === '.NaN') return NaN;

  return text;
}

function parseFlow(text: string, line: number): Json {
  let at = 0;

  function skip(): void {
    while (at < text.length && /\s/.test(text[at]!)) at++;
  }

  function value(): Json {
    skip();
    const ch = text[at];
    if (ch === '[') return sequence();
    if (ch === '{') return mapping();

    const start = at;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      at++;
      while (at < text.length && text[at] !== quote) {
        if (text[at] === '\\' && quote === '"') at++;
        at++;
      }
      at++;
      return scalar(text.slice(start, at), line);
    }

    while (at < text.length && !',]}:'.includes(text[at]!)) at++;
    return scalar(text.slice(start, at), line);
  }

  function sequence(): Json[] {
    at++; 
    const out: Json[] = [];
    skip();
    if (text[at] === ']') {
      at++;
      return out;
    }
    for (;;) {
      out.push(value());
      skip();
      if (text[at] === ',') {
        at++;
        continue;
      }
      if (text[at] === ']') {
        at++;
        return out;
      }
      throw new OperationError(`Expected ',' or ']' in the flow sequence on line ${line}.`);
    }
  }

  function mapping(): { [key: string]: Json } {
    at++; 
    const out: { [key: string]: Json } = {};
    skip();
    if (text[at] === '}') {
      at++;
      return out;
    }
    for (;;) {
      const key = value();
      skip();
      if (text[at] !== ':') {
        throw new OperationError(`Expected ':' after a key in the flow mapping on line ${line}.`);
      }
      at++;
      out[String(key)] = value();
      skip();
      if (text[at] === ',') {
        at++;
        continue;
      }
      if (text[at] === '}') {
        at++;
        return out;
      }
      throw new OperationError(`Expected ',' or '}' in the flow mapping on line ${line}.`);
    }
  }

  const result = value();
  skip();
  if (at < text.length) throw new OperationError(`Trailing text after the value on line ${line}.`);
  return result;
}

function blockScalar(lines: Line[], from: number, header: string, parentIndent: number): [string, number] {
  const folded = header.startsWith('>');
  const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';

  let i = from;
  const body: string[] = [];
  let indent = -1;
  while (i < lines.length && lines[i]!.indent > parentIndent) {
    const line = lines[i]!;
    if (indent === -1) indent = line.indent;
    body.push(line.text.slice(Math.min(indent, line.indent)));
    i++;
  }

  let text = folded
    ? body
        .reduce<string[]>((acc, piece) => {
          const last = acc[acc.length - 1];
          if (last !== undefined && !/^\s/.test(piece) && !/^\s/.test(last) && last.length > 0) {
            acc[acc.length - 1] = `${last} ${piece}`;
          } else {
            acc.push(piece);
          }
          return acc;
        }, [])
        .join('\n')
    : body.join('\n');

  if (chomp !== 'strip') text += '\n';
  if (chomp === 'strip') text = text.replace(/\n+$/, '');
  return [text, i];
}

function splitKey(text: string): [string, string] | null {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') return null; 
    if (ch === ':' && (i + 1 === text.length || /\s/.test(text[i + 1]!))) {
      return [text.slice(0, i), text.slice(i + 1)];
    }
  }
  return null;
}

function parseBlock(lines: Line[], from: number, indent: number): [Json, number] {
  const first = lines[from];
  if (!first) return [null, from];

  if (first.text.trimStart().startsWith('- ') || first.text.trim() === '-') {
    const out: Json[] = [];
    let i = from;
    while (i < lines.length && lines[i]!.indent === indent && /^-(\s|$)/.test(lines[i]!.text.trim())) {
      const line = lines[i]!;
      const rest = line.text.trim().slice(1).trim();
      const itemIndent = line.indent + (line.text.trim().length > 1 ? 2 : 0);

      if (rest.length === 0) {
        if (i + 1 < lines.length && lines[i + 1]!.indent > indent) {
          const [value, next] = parseBlock(lines, i + 1, lines[i + 1]!.indent);
          out.push(value);
          i = next;
        } else {
          out.push(null);
          i++;
        }
        continue;
      }

      const pair = splitKey(rest);
      if (pair) {
        const nested: Line[] = [
          { indent: itemIndent, text: ' '.repeat(itemIndent) + rest, number: line.number },
        ];
        let j = i + 1;
        while (j < lines.length && lines[j]!.indent > indent) {
          nested.push(lines[j]!);
          j++;
        }
        const [value] = parseBlock(nested, 0, itemIndent);
        out.push(value);
        i = j;
        continue;
      }

      out.push(parseValue(rest, lines, i, indent).value);
      i = parseValue(rest, lines, i, indent).next;
    }
    return [out, i];
  }

  const out: { [key: string]: Json } = {};
  let i = from;
  while (i < lines.length && lines[i]!.indent >= indent) {
    const line = lines[i]!;
    if (line.indent > indent) {
      throw new OperationError(`Unexpected indentation on line ${line.number}.`);
    }
    if (line.text.trim() === '---' || line.text.trim() === '...') break;

    const pair = splitKey(line.text.trim());
    if (!pair) throw new OperationError(`Expected 'key: value' on line ${line.number}.`);

    const [rawKey, rawValue] = pair;
    const key = String(scalar(rawKey, line.number));
    const rest = rawValue.trim();

    if (rest.length === 0) {
      if (i + 1 < lines.length && lines[i + 1]!.indent > indent) {
        const [value, next] = parseBlock(lines, i + 1, lines[i + 1]!.indent);
        out[key] = value;
        i = next;
      } else if (
        i + 1 < lines.length &&
        lines[i + 1]!.indent === indent &&
        /^-(\s|$)/.test(lines[i + 1]!.text.trim())
      ) {
        const [value, next] = parseBlock(lines, i + 1, indent);
        out[key] = value;
        i = next;
      } else {
        out[key] = null;
        i++;
      }
      continue;
    }

    const parsed = parseValue(rest, lines, i, indent);
    out[key] = parsed.value;
    i = parsed.next;
  }
  return [out, i];
}

function parseValue(
  rest: string,
  lines: Line[],
  i: number,
  indent: number,
): { value: Json; next: number } {
  if (rest.startsWith('|') || rest.startsWith('>')) {
    const [text, next] = blockScalar(lines, i + 1, rest, indent);
    return { value: text, next };
  }
  if (rest.startsWith('[') || rest.startsWith('{')) {
    return { value: parseFlow(rest, lines[i]!.number), next: i + 1 };
  }
  return { value: scalar(rest, lines[i]!.number), next: i + 1 };
}

function parseYaml(source: string): Json[] {
  const documents: Json[] = [];
  const all = readLines(source);

  let start = 0;
  const breaks: number[] = [];
  all.forEach((line, i) => {
    if (line.text.trim() === '---') breaks.push(i);
  });

  const bounds = [...breaks, all.length];
  for (const end of bounds) {
    const slice = all.slice(start, end).filter((l) => l.text.trim() !== '...');
    if (slice.length > 0) {
      const base = Math.min(...slice.map((l) => l.indent));
      documents.push(parseBlock(slice, 0, base)[0]);
    }
    start = end + 1;
  }
  if (start < all.length) {
    const slice = all.slice(start).filter((l) => l.text.trim() !== '...');
    if (slice.length > 0) {
      const base = Math.min(...slice.map((l) => l.indent));
      documents.push(parseBlock(slice, 0, base)[0]);
    }
  }

  if (documents.length === 0) throw new OperationError('No YAML document found.');
  return documents;
}


const PLAIN = /^[A-Za-z_][\w .\-/@]*$/;

function needsQuotes(text: string): boolean {
  if (text.length === 0) return true;
  if (!PLAIN.test(text)) return true;
  return ['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~'].includes(text.toLowerCase());
}

function emitScalar(value: Json): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '.nan';
  const text = String(value);
  if (text.includes('\n')) return `|-\n${text.replace(/\n$/, '').replace(/^/gm, '  ')}`;
  return needsQuotes(text) ? JSON.stringify(text) : text;
}

function emit(value: Json, indent: number): string {
  const pad = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object') {
          const body = emit(item, indent + 2);
          return `${pad}- ${body.slice(indent + 2)}`;
        }
        return `${pad}- ${emitScalar(item)}`;
      })
      .join('\n');
  }

  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return keys
      .map((key) => {
        const child = value[key]!;
        const name = needsQuotes(key) ? JSON.stringify(key) : key;
        if (child !== null && typeof child === 'object') {
          const empty = Array.isArray(child) ? child.length === 0 : Object.keys(child).length === 0;
          if (empty) return `${pad}${name}: ${Array.isArray(child) ? '[]' : '{}'}`;
          const childIndent = Array.isArray(child) ? indent : indent + 2;
          return `${pad}${name}:\n${emit(child, childIndent)}`;
        }
        const rendered = emitScalar(child);
        return rendered.startsWith('|-')
          ? `${pad}${name}: ${rendered.replace(/\n/g, `\n${pad}`)}`
          : `${pad}${name}: ${rendered}`;
      })
      .join('\n');
  }

  return `${pad}${emitScalar(value)}`;
}

export const yamlOperations: Operation[] = [
  {
    id: 'yaml-to-json',
    name: 'YAML to JSON',
    category: 'Data format',
    description: 'Reads a YAML document and writes the same data as JSON.',
    aliases: ['from yaml', 'parse yaml', 'yml'],
    args: [
      { name: 'Indent', type: 'number', value: 2, min: 0, max: 8 },
      { name: 'All documents', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const documents = parseYaml(input);
      const indent = Number(arg(args, 'Indent', 2));
      const value =
        arg(args, 'All documents', false) || documents.length > 1 ? documents : documents[0]!;
      return JSON.stringify(value, (_key, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v), indent);
    },
  },
  {
    id: 'json-to-yaml',
    name: 'JSON to YAML',
    category: 'Data format',
    description: 'Writes JSON as a YAML document.',
    aliases: ['to yaml', 'yml'],
    args: [],
    run: (input) => {
      let value: Json;
      try {
        value = JSON.parse(input) as Json;
      } catch (error) {
        throw new OperationError(
          `Not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
        );
      }
      return emit(value, 0);
    },
  },
];
