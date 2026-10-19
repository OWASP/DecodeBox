import { OperationError } from '../types';
import { arg, type Operation } from './types';


const DECODE_TABLE: Record<number, string> = {
  9: '\x57\x6e\x7b',
  10: '\x4a\x4c\x41',
  11: '\x0b\x0b\x0b',
  12: '\x0c\x0c\x0c',
  13: '\x4a\x4c\x41',
  14: '\x0e\x0e\x0e',
  15: '\x0f\x0f\x0f',
  16: '\x10\x10\x10',
  17: '\x11\x11\x11',
  18: '\x12\x12\x12',
  19: '\x13\x13\x13',
  20: '\x14\x14\x14',
  21: '\x15\x15\x15',
  22: '\x16\x16\x16',
  23: '\x17\x17\x17',
  24: '\x18\x18\x18',
  25: '\x19\x19\x19',
  26: '\x1a\x1a\x1a',
  27: '\x1b\x1b\x1b',
  28: '\x1c\x1c\x1c',
  29: '\x1d\x1d\x1d',
  30: '\x1e\x1e\x1e',
  31: '\x1f\x1f\x1f',
  32: '\x2e\x2d\x32',
  33: '\x47\x75\x30',
  34: '\x7a\x52\x21',
  35: '\x56\x60\x29',
  36: '\x42\x71\x5b',
  37: '\x6a\x5e\x38',
  38: '\x2f\x49\x33',
  39: '\x26\x5c\x3d',
  40: '\x49\x62\x58',
  41: '\x41\x7d\x3a',
  42: '\x34\x29\x35',
  43: '\x32\x36\x65',
  44: '\x5b\x20\x39',
  45: '\x76\x7c\x5c',
  46: '\x72\x7a\x56',
  47: '\x43\x7f\x73',
  48: '\x38\x6b\x66',
  49: '\x39\x63\x4e',
  50: '\x70\x33\x45',
  51: '\x45\x2b\x6b',
  52: '\x68\x68\x62',
  53: '\x71\x51\x59',
  54: '\x4f\x66\x78',
  55: '\x09\x76\x5e',
  56: '\x62\x31\x7d',
  57: '\x44\x64\x4a',
  58: '\x23\x54\x6d',
  59: '\x75\x43\x71',
  60: '\x4a\x4c\x41',
  61: '\x7e\x3a\x60',
  62: '\x4a\x4c\x41',
  63: '\x5e\x7e\x53',
  64: '\x40\x4c\x40',
  65: '\x77\x45\x42',
  66: '\x4a\x2c\x27',
  67: '\x61\x2a\x48',
  68: '\x5d\x74\x72',
  69: '\x22\x27\x75',
  70: '\x4b\x37\x31',
  71: '\x6f\x44\x37',
  72: '\x4e\x79\x4d',
  73: '\x3b\x59\x52',
  74: '\x4c\x2f\x22',
  75: '\x50\x6f\x54',
  76: '\x67\x26\x6a',
  77: '\x2a\x72\x47',
  78: '\x7d\x6a\x64',
  79: '\x74\x39\x2d',
  80: '\x54\x7b\x20',
  81: '\x2b\x3f\x7f',
  82: '\x2d\x38\x2e',
  83: '\x2c\x77\x4c',
  84: '\x30\x67\x5d',
  85: '\x6e\x53\x7e',
  86: '\x6b\x47\x6c',
  87: '\x66\x34\x6f',
  88: '\x35\x78\x79',
  89: '\x25\x5d\x74',
  90: '\x21\x30\x43',
  91: '\x64\x23\x26',
  92: '\x4d\x5a\x76',
  93: '\x52\x5b\x25',
  94: '\x63\x6c\x24',
  95: '\x3f\x48\x2b',
  96: '\x7b\x55\x28',
  97: '\x78\x70\x23',
  98: '\x29\x69\x41',
  99: '\x28\x2e\x34',
  100: '\x73\x4c\x09',
  101: '\x59\x21\x2a',
  102: '\x33\x24\x44',
  103: '\x7f\x4e\x3f',
  104: '\x6d\x50\x77',
  105: '\x55\x09\x3b',
  106: '\x53\x56\x55',
  107: '\x7c\x73\x69',
  108: '\x3a\x35\x61',
  109: '\x5f\x61\x63',
  110: '\x65\x4b\x50',
  111: '\x46\x58\x67',
  112: '\x58\x3b\x51',
  113: '\x31\x57\x49',
  114: '\x69\x22\x4f',
  115: '\x6c\x6d\x46',
  116: '\x5a\x4d\x68',
  117: '\x48\x25\x7c',
  118: '\x27\x28\x36',
  119: '\x5c\x46\x70',
  120: '\x3d\x4a\x6e',
  121: '\x24\x32\x7a',
  122: '\x79\x41\x2f',
  123: '\x37\x3d\x5f',
  124: '\x60\x5f\x4b',
  125: '\x51\x4f\x5a',
  126: '\x20\x42\x2c',
  127: '\x36\x65\x57',
};

const COMBINATION = [
  0, 1, 2, 0, 1, 2, 1, 2, 2, 1, 2, 1, 0, 2, 1, 2, 0, 2, 1, 2, 0, 0, 1, 2, 2, 1, 0, 2, 1, 2, 2, 1, 0, 0, 2, 1, 2, 1, 2, 0, 2, 0, 0, 1, 2, 0, 2, 1, 0, 2, 1, 2, 0, 0, 1, 2, 2, 0, 0, 1, 2, 0, 2, 1,
];


interface Token {
  text: string;
  literal: boolean;
  comment: boolean;
}

function tokeniseJs(source: string): Token[] {
  const tokens: Token[] = [];
  let plain = '';
  const flush = () => {
    if (plain !== '') tokens.push({ text: plain, literal: false, comment: false });
    plain = '';
  };

  const regexAllowedAfter = /[({[,;:=!&|?+\-*/%~^<>]\s*$|\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)\s*$/;

  for (let i = 0; i < source.length; i++) {
    const char = source[i] as string;
    const next = source[i + 1];

    if (char === '/' && next === '/') {
      flush();
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      tokens.push({ text: source.slice(i, stop), literal: true, comment: true });
      i = stop - 1;
      continue;
    }
    if (char === '/' && next === '*') {
      flush();
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      tokens.push({ text: source.slice(i, stop), literal: true, comment: true });
      i = stop - 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      flush();
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') j += 2;
        else if (source[j] === char) break;
        else j++;
      }
      tokens.push({ text: source.slice(i, j + 1), literal: true, comment: false });
      i = j;
      continue;
    }
    if (char === '/' && regexAllowedAfter.test(plain)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length) {
        const c = source[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === '/' && !inClass) break;
        if (c === '\n') break;
        if (c === '[') inClass = true;
        if (c === ']') inClass = false;
        j++;
      }
      if (source[j] === '/') {
        flush();
        let end = j + 1;
        while (end < source.length && /[a-z]/i.test(source[end] as string)) end++;
        tokens.push({ text: source.slice(i, end), literal: true, comment: false });
        i = end - 1;
        continue;
      }
    }
    plain += char;
  }
  flush();
  return tokens;
}

function unescapeIndent(value: string): string {
  return value.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\s/g, ' ');
}


function indentBraces(tokens: Token[], indent: string, keepComments: boolean): string {
  let out = '';
  let depth = 0;
  let atLineStart = true;

  const newline = () => {
    out = out.replace(/[ \t]+$/, '');
    out += '\n';
    atLineStart = true;
  };
  const write = (text: string) => {
    if (atLineStart) {
      out += indent.repeat(Math.max(0, depth));
      atLineStart = false;
    }
    out += text;
  };

  for (const token of tokens) {
    if (token.comment) {
      if (!keepComments) continue;
      write(token.text);
      if (token.text.startsWith('//')) newline();
      continue;
    }
    if (token.literal) {
      write(token.text);
      continue;
    }

    for (const char of token.text) {
      if (char === '\n' || char === '\r') continue;
      if (/\s/.test(char)) {
        if (!atLineStart && !out.endsWith(' ')) write(' ');
        continue;
      }
      if (char === '}' || char === ']' || char === ')') {
        if (char === '}') {
          depth--;
          if (!atLineStart) newline();
        }
        write(char);
        continue;
      }
      if (char === '{') {
        if (out.endsWith(' ')) out = out.slice(0, -1);
        write(' {');
        depth++;
        newline();
        continue;
      }
      if (char === ';') {
        write(';');
        newline();
        continue;
      }
      write(char);
    }
  }
  return out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}


function beautifyCss(source: string, indent: string): string {
  let out = '';
  let depth = 0;
  let i = 0;

  while (i < source.length) {
    const char = source[i] as string;
    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += `${indent.repeat(depth)}${source.slice(i, stop)}\n`;
      i = stop;
      continue;
    }
    if (char === '{') {
      out = `${out.replace(/\s+$/, '')} {\n`;
      depth++;
      i++;
      continue;
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1);
      out = `${out.replace(/\s+$/, '')}\n${indent.repeat(depth)}}\n`;
      i++;
      continue;
    }
    if (char === ';') {
      out = `${out.replace(/\s+$/, '')};\n`;
      i++;
      continue;
    }
    if (char === ':' && depth > 0) {
      out = `${out.replace(/\s+$/, '')}: `;
      i++;
      continue;
    }
    if (/\s/.test(char)) {
      if (!/\s$/.test(out) && out !== '') out += ' ';
      i++;
      continue;
    }
    if (out === '' || out.endsWith('\n')) out += indent.repeat(depth);
    out += char;
    i++;
  }
  return out
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
    .trim();
}

function minifyCss(source: string, keepComments: boolean): string {
  let out = source;
  if (!keepComments) out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};:,>~+])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}


const SQL_BREAK_BEFORE = [
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP BY',
  'HAVING',
  'ORDER BY',
  'LIMIT',
  'OFFSET',
  'UNION ALL',
  'UNION',
  'INSERT INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE FROM',
  'INNER JOIN',
  'LEFT OUTER JOIN',
  'RIGHT OUTER JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'FULL JOIN',
  'CROSS JOIN',
  'JOIN',
  'ON',
  'AND',
  'OR',
];

function beautifySql(source: string, indent: string): string {
  const collapsed = source.replace(/\s+/g, ' ').trim();
  let out = collapsed;
  for (const keyword of SQL_BREAK_BEFORE) {
    out = out.replace(new RegExp(`\\s+${keyword}\\s+`, 'gi'), `\n${keyword} `);
  }
  return out
    .split('\n')
    .map((line) => (/^(AND|OR|ON)\b/i.test(line) ? indent + line : line))
    .join('\n')
    .replace(/\s*;\s*/g, ';\n')
    .trim();
}


function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inCode = false;
  let listType: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const closeParagraph = () => {
    if (paragraph.length > 0) {
      out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      closeParagraph();
      closeList();
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const level = (heading[1] as string).length;
      out.push(`<h${level}>${renderInline(heading[2] as string)}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeParagraph();
      closeList();
      out.push('<hr>');
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeParagraph();
      closeList();
      out.push(`<blockquote>${renderInline(quote[1] as string)}</blockquote>`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      closeParagraph();
      const wanted = bullet ? 'ul' : 'ol';
      if (listType !== wanted) {
        closeList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      out.push(`<li>${renderInline((bullet ?? numbered)?.[1] ?? '')}</li>`);
      continue;
    }
    if (line.trim() === '') {
      closeParagraph();
      closeList();
      continue;
    }
    paragraph.push(line.trim());
  }
  closeParagraph();
  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}


function phpSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'N;';
  if (typeof value === 'boolean') return `b:${value ? 1 : 0};`;
  if (typeof value === 'number') {
    return Number.isInteger(value) ? `i:${value};` : `d:${value};`;
  }
  if (typeof value === 'string') return `s:${value.length}:"${value}";`;
  if (Array.isArray(value)) {
    const body = value.map((item, i) => phpSerialize(i) + phpSerialize(item)).join('');
    return `a:${value.length}:{${body}}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const body = entries.map(([key, item]) => phpSerialize(key) + phpSerialize(item)).join('');
    return `a:${entries.length}:{${body}}`;
  }
  throw new OperationError(`PHP has no serialised form for a ${typeof value}.`);
}

function phpDeserialize(source: string, at: { i: number }): unknown {
  const expect = (char: string) => {
    if (source[at.i] !== char) {
      throw new OperationError(`Expected '${char}' at position ${at.i}.`);
    }
    at.i++;
  };
  const readUntil = (char: string) => {
    const end = source.indexOf(char, at.i);
    if (end === -1) throw new OperationError(`Expected '${char}' before the end.`);
    const text = source.slice(at.i, end);
    at.i = end + 1;
    return text;
  };

  const type = source[at.i];
  at.i++;
  switch (type) {
    case 'N':
      expect(';');
      return null;
    case 'b': {
      expect(':');
      const value = readUntil(';');
      return value === '1';
    }
    case 'i': {
      expect(':');
      return parseInt(readUntil(';'), 10);
    }
    case 'd': {
      expect(':');
      return parseFloat(readUntil(';'));
    }
    case 's': {
      expect(':');
      const length = parseInt(readUntil(':'), 10);
      expect('"');
      const text = source.substr(at.i, length);
      at.i += length;
      expect('"');
      expect(';');
      return text;
    }
    case 'a': {
      expect(':');
      const count = parseInt(readUntil(':'), 10);
      expect('{');
      const out: Record<string, unknown> = {};
      for (let i = 0; i < count; i++) {
        const key = phpDeserialize(source, at);
        out[String(key)] = phpDeserialize(source, at);
      }
      expect('}');
      const keys = Object.keys(out);
      if (keys.length === 0) return out;
      const isList = keys.every((key, i) => key === String(i));
      return isList ? keys.map((key) => out[key]) : out;
    }
    default:
      throw new OperationError(`'${type ?? ''}' is not a PHP serialised type.`);
  }
}

export const codeTidyOperations: Operation[] = [
  {
    id: 'generic-code-beautify',
    name: 'Generic Code Beautify',
    category: 'Code tidy',
    description: 'Re-indents any brace-and-semicolon language by its structure.',
    aliases: ['format code', 'indent', 'pretty print'],
    args: [{ name: 'Indent string', type: 'string', value: '    ' }],
    run: (input, args) =>
      indentBraces(tokeniseJs(input), unescapeIndent(String(arg(args, 'Indent string', '    '))), true),
  },
  {
    id: 'javascript-beautify',
    name: 'JavaScript Beautify',
    category: 'Code tidy',
    description: 'Re-indents JavaScript, leaving strings and regular expressions alone.',
    aliases: ['format javascript', 'js beautify', 'unminify'],
    args: [
      { name: 'Indent string', type: 'string', value: '\\t' },
      { name: 'Include comments', type: 'boolean', value: true },
    ],
    run: (input, args) =>
      indentBraces(
        tokeniseJs(input),
        unescapeIndent(String(arg(args, 'Indent string', '\\t'))),
        arg(args, 'Include comments', true),
      ),
  },
  {
    id: 'javascript-minify',
    name: 'JavaScript Minify',
    category: 'Code tidy',
    description: 'Removes comments and needless whitespace from JavaScript.',
    aliases: ['js minify', 'compress javascript'],
    args: [],
    run: (input) => {
      const tokens = tokeniseJs(input);
      let out = '';
      for (const token of tokens) {
        if (token.comment) continue;
        if (token.literal) {
          out += token.text;
          continue;
        }
        out += token.text
          .replace(/\s+/g, ' ')
          .replace(/ ?([{}()[\];,:<>=+\-*/%!&|?~^]) ?/g, '$1');
      }
      return out.trim();
    },
  },
  {
    id: 'css-beautify',
    name: 'CSS Beautify',
    category: 'Code tidy',
    description: 'Puts one declaration on each line and indents nested rules.',
    aliases: ['format css', 'pretty css'],
    args: [{ name: 'Indent string', type: 'string', value: '\\t' }],
    run: (input, args) =>
      beautifyCss(input, unescapeIndent(String(arg(args, 'Indent string', '\\t')))),
  },
  {
    id: 'css-minify',
    name: 'CSS Minify',
    category: 'Code tidy',
    description: 'Strips whitespace and comments from a stylesheet.',
    aliases: ['compress css', 'minify stylesheet'],
    args: [{ name: 'Preserve comments', type: 'boolean', value: false }],
    run: (input, args) => minifyCss(input, arg(args, 'Preserve comments', false)),
  },
  {
    id: 'sql-beautify',
    name: 'SQL Beautify',
    category: 'Code tidy',
    description: 'Breaks a query at its clauses so the shape of it is readable.',
    aliases: ['format sql', 'pretty sql'],
    args: [{ name: 'Indent string', type: 'string', value: '\\t' }],
    run: (input, args) =>
      beautifySql(input, unescapeIndent(String(arg(args, 'Indent string', '\\t')))),
  },
  {
    id: 'sql-minify',
    name: 'SQL Minify',
    category: 'Code tidy',
    description: 'Collapses a query onto one line.',
    aliases: ['compress sql', 'one line sql'],
    args: [],
    run: (input) =>
      input
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .trim(),
  },
  {
    id: 'render-markdown',
    name: 'Render Markdown',
    category: 'Code tidy',
    description: 'Converts Markdown into HTML, with every value escaped.',
    aliases: ['markdown to html', 'md'],
    args: [],
    run: (input) => renderMarkdown(input),
  },
  {
    id: 'microsoft-script-decoder',
    name: 'Microsoft Script Decoder',
    category: 'Code tidy',
    description: 'Decodes a JScript.Encode or VBScript.Encode block back to source.',
    aliases: ['jscript.encode', 'vbscript.encode', 'screnc'],
    args: [],
    run: (input) => {
      const match = /#@~\^.{6}==(.+).{6}==\^#~@/s.exec(input);
      if (!match) throw new OperationError('No #@~^ encoded block found.');

      const data = (match[1] as string)
        .replace(/@&/g, '\n')
        .replace(/@#/g, '\r')
        .replace(/@\*/g, '>')
        .replace(/@!/g, '<')
        .replace(/@\$/g, '@');

      const out: string[] = [];
      let index = -1;
      for (let i = 0; i < data.length; i++) {
        const byte = data.charCodeAt(i);
        let char = data.charAt(i);
        if (byte < 128) index++;
        if (
          (byte === 9 || (byte > 31 && byte < 128)) &&
          byte !== 60 &&
          byte !== 62 &&
          byte !== 64
        ) {
          char = (DECODE_TABLE[byte] ?? char).charAt(COMBINATION[index % 64] ?? 0);
        }
        out.push(char);
      }
      return out.join('');
    },
    detection: {
      pattern: /#@~\^[A-Za-z0-9+/]{6}==/,
      minLength: 20,
      formatName: 'Microsoft encoded script',
    },
  },
  {
    id: 'php-serialize',
    name: 'PHP Serialize',
    category: 'Code tidy',
    description: 'Turns JSON into the format PHP serialize() produces.',
    aliases: ['php', 'serialize'],
    args: [],
    run: (input) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(input);
      } catch {
        throw new OperationError('Input must be JSON.');
      }
      return phpSerialize(parsed);
    },
  },
  {
    id: 'php-deserialize',
    name: 'PHP Deserialize',
    category: 'Code tidy',
    description: 'Reads PHP serialized data and prints it as JSON.',
    aliases: ['unserialize', 'php decode'],
    args: [{ name: 'Output valid JSON', type: 'boolean', value: true }],
    run: (input, args) => {
      const value = phpDeserialize(input.trim(), { i: 0 });
      return arg(args, 'Output valid JSON', true)
        ? JSON.stringify(value, null, 2)
        : String(JSON.stringify(value));
    },
    detection: {
      pattern: /^[aOsibdN]:\d*[:;]/,
      minLength: 6,
      formatName: 'PHP serialized',
    },
  },
];
