import { OperationError } from '../types';
import { asBytes } from '../core/bytes';
import { arg, type Operation } from './types';



interface Pattern {
  name: string;
  kind: 'text' | 'hex' | 'regex';
  value: string;
  modifiers: Set<string>;
}

interface Rule {
  name: string;
  tags: string[];
  meta: Record<string, string>;
  patterns: Pattern[];
  condition: string;
  isPrivate: boolean;
}

function stripComments(source: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quote) {
      out += c;
      if (c === '\\' && quote === '"') {
        out += source[++i] ?? '';
        continue;
      }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === '/') {
      if (c === '/' && source[i + 1] === '/') {
        while (i < source.length && source[i] !== '\n') i++;
        out += '\n';
        continue;
      }
      if (c === '/' && source[i + 1] === '*') {
        i += 2;
        while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
        i++;
        out += ' ';
        continue;
      }
      if (c === '"') quote = c;
    }
    out += c;
  }
  return out;
}

function parseRules(source: string): Rule[] {
  const text = stripComments(source);
  const rules: Rule[] = [];
  const header = /(?:^|\s)(private\s+|global\s+)*rule\s+([A-Za-z_]\w*)\s*(?::\s*([^{]*))?\{/g;

  let match: RegExpExecArray | null;
  while ((match = header.exec(text)) !== null) {
    const name = match[2]!;
    const tags = (match[3] ?? '').trim().split(/\s+/).filter((t) => t.length > 0);

    let depth = 1;
    let at = header.lastIndex;
    let quote = '';
    while (at < text.length && depth > 0) {
      const c = text[at]!;
      if (quote) {
        if (c === '\\') at++;
        else if (c === quote) quote = '';
      } else if (c === '"') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      at++;
    }
    if (depth !== 0) throw new OperationError(`Rule '${name}' is not closed.`);

    const body = text.slice(header.lastIndex, at - 1);
    rules.push({
      name,
      tags,
      meta: parseMeta(body),
      patterns: parseStrings(body, name),
      condition: parseCondition(body, name),
      isPrivate: (match[1] ?? '').trim() === 'private',
    });
    header.lastIndex = at;
  }

  if (rules.length === 0) {
    throw new OperationError("No rules found: a YARA rule reads 'rule Name { condition: ... }'.");
  }
  return rules;
}

function sectionOf(body: string, name: string): string {
  const start = new RegExp(`(?:^|\\s)${name}\\s*:`, 'm').exec(body);
  if (!start) return '';
  const from = start.index + start[0].length;
  const next = /(?:^|\s)(meta|strings|condition)\s*:/m.exec(body.slice(from));
  return next ? body.slice(from, from + next.index) : body.slice(from);
}

function parseMeta(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const section = sectionOf(body, 'meta');
  for (const line of section.split('\n')) {
    const found = /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(line);
    if (found) out[found[1]!] = found[2]!.replace(/^"|"$/g, '');
  }
  return out;
}

function parseStrings(body: string, rule: string): Pattern[] {
  const section = sectionOf(body, 'strings');
  const patterns: Pattern[] = [];

  const entry = /\$(\w*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|\{([^}]*)\}|\/((?:[^/\\]|\\.)+)\/(\w*))([^\n$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(section)) !== null) {
    const [, name, quoted, hex, regex, regexFlags, trailing] = match;
    const modifiers = new Set(
      `${trailing ?? ''} ${regexFlags ?? ''}`
        .toLowerCase()
        .split(/\s+/)
        .filter((m) => m.length > 0),
    );

    if (quoted !== undefined) {
      patterns.push({ name: `$${name}`, kind: 'text', value: unescapeText(quoted), modifiers });
    } else if (hex !== undefined) {
      patterns.push({ name: `$${name}`, kind: 'hex', value: hex.trim(), modifiers });
    } else if (regex !== undefined) {
      patterns.push({ name: `$${name}`, kind: 'regex', value: regex, modifiers });
    }
  }

  if (patterns.length === 0 && /\bstrings\s*:/.test(body)) {
    throw new OperationError(`Rule '${rule}' has a strings section with nothing readable in it.`);
  }
  return patterns;
}

function unescapeText(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1');
}

function parseCondition(body: string, rule: string): string {
  const condition = sectionOf(body, 'condition').trim();
  if (condition.length === 0) throw new OperationError(`Rule '${rule}' has no condition.`);
  return condition;
}


function hexToRegex(pattern: string): RegExp {
  let source = '';
  const tokens = pattern.replace(/\s+/g, ' ').trim().split(' ');

  for (const token of tokens) {
    if (token === '') continue;
    if (/^\[\d+(-\d+)?\]$/.test(token)) {
      const [low, high] = token.slice(1, -1).split('-');
      source += high === undefined ? `[\\s\\S]{${low}}` : `[\\s\\S]{${low},${high}}`;
      continue;
    }
    if (token === '??') {
      source += '[\\s\\S]';
      continue;
    }
    if (/^[0-9a-fA-F]\?$/.test(token)) {
      const high = Number.parseInt(token[0]!, 16);
      const from = high * 16;
      source += `[\\u${(from).toString(16).padStart(4, '0')}-\\u${(from + 15).toString(16).padStart(4, '0')}]`;
      continue;
    }
    if (/^\?[0-9a-fA-F]$/.test(token)) {
      const low = Number.parseInt(token[1]!, 16);
      const options: string[] = [];
      for (let high = 0; high < 16; high++) {
        options.push(`\\u${(high * 16 + low).toString(16).padStart(4, '0')}`);
      }
      source += `[${options.join('')}]`;
      continue;
    }
    if (!/^[0-9a-fA-F]{2}$/.test(token)) {
      throw new OperationError(`'${token}' is not a hexadecimal byte, a wildcard or a jump.`);
    }
    source += `\\u${Number.parseInt(token, 16).toString(16).padStart(4, '0')}`;
  }
  return new RegExp(source, 'g');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
}

function findMatches(pattern: Pattern, data: string): number[] {
  const offsets: number[] = [];
  const nocase = pattern.modifiers.has('nocase');
  const fullword = pattern.modifiers.has('fullword');
  const wide = pattern.modifiers.has('wide');
  const ascii = pattern.modifiers.has('ascii') || !wide;

  const forms: string[] = [];
  if (pattern.kind === 'text') {
    if (ascii) forms.push(escapeRegex(pattern.value));
    if (wide) forms.push(escapeRegex(pattern.value).split('').join('\\u0000') + '\\u0000');
  } else if (pattern.kind === 'regex') {
    forms.push(pattern.value);
  }

  const expressions =
    pattern.kind === 'hex'
      ? [hexToRegex(pattern.value)]
      : forms.map((form) => new RegExp(form, nocase ? 'gi' : 'g'));

  for (const expression of expressions) {
    expression.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = expression.exec(data)) !== null) {
      if (match[0].length === 0) {
        expression.lastIndex++;
        continue;
      }
      if (fullword) {
        const before = data[match.index - 1];
        const after = data[match.index + match[0].length];
        const isWord = (c: string | undefined): boolean => c !== undefined && /\w/.test(c);
        if (isWord(before) || isWord(after)) continue;
      }
      offsets.push(match.index);
    }
  }
  return offsets.sort((a, b) => a - b);
}


interface Context {
  data: Uint8Array;
  matches: Map<string, number[]>;
  names: string[];
}

const UNSUPPORTED = /\b(pe|elf|math|hash|cuckoo|magic|dotnet|time)\s*\./;

function evaluate(condition: string, context: Context): boolean {
  if (UNSUPPORTED.test(condition)) {
    const module = UNSUPPORTED.exec(condition)![1];
    throw new OperationError(
      `This condition uses the '${module}' module, which DecodeBox does not carry.`,
    );
  }
  if (/\bfor\s+(any|all|\d+)\b/.test(condition)) {
    throw new OperationError('This condition uses a `for` loop, which is not supported.');
  }

  const tokens = condition.match(/\$\w*\*?|[#@!]\w+|\w+|[<>=!]=|[()<>+\-*/,]|\S/g) ?? [];
  let at = 0;

  const peek = (): string => tokens[at] ?? '';
  const next = (): string => tokens[at++] ?? '';
  const expect = (token: string): void => {
    if (next().toLowerCase() !== token) throw new OperationError(`Expected '${token}' in the condition.`);
  };

  const countOf = (name: string): number => (context.matches.get(name) ?? []).length;

  const namesIn = (): string[] => {
    if (peek().toLowerCase() === 'them') {
      next();
      return context.names;
    }
    expect('(');
    const chosen: string[] = [];
    for (;;) {
      const token = next();
      if (token.endsWith('*')) {
        const prefix = token.slice(0, -1);
        chosen.push(...context.names.filter((name) => name.startsWith(prefix)));
      } else if (token.startsWith('$')) {
        chosen.push(token);
      }
      const separator = peek();
      if (separator === ',') {
        next();
        continue;
      }
      expect(')');
      return chosen;
    }
  };

  function primary(): number | boolean {
    const token = next();
    const lower = token.toLowerCase();

    if (token === '(') {
      const value = expression();
      expect(')');
      return value;
    }
    if (lower === 'not') return !truth(primary());
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (lower === 'filesize') return context.data.length;
    if (lower === 'entrypoint') {
      throw new OperationError('`entrypoint` needs the pe module, which DecodeBox does not carry.');
    }

    if (lower === 'any' || lower === 'all' || /^\d+$/.test(lower)) {
      if (peek().toLowerCase() === 'of') {
        next();
        const chosen = namesIn();
        const found = chosen.filter((name) => countOf(name) > 0).length;
        if (lower === 'any') return found > 0;
        if (lower === 'all') return found === chosen.length && chosen.length > 0;
        return found >= Number(lower);
      }
      if (/^\d+$/.test(lower)) return Number(lower);
      throw new OperationError(`'${token}' needs to be followed by 'of'.`);
    }

    if (/^0x[0-9a-fA-F]+$/.test(token)) return Number.parseInt(token, 16);
    if (/^\d+kb$/i.test(token)) return Number.parseInt(token, 10) * 1024;
    if (/^\d+mb$/i.test(token)) return Number.parseInt(token, 10) * 1024 * 1024;

    if (token.startsWith('#')) return countOf(`$${token.slice(1)}`);
    if (token.startsWith('@')) {
      const offsets = context.matches.get(`$${token.slice(1)}`) ?? [];
      return offsets[0] ?? -1;
    }
    if (token.startsWith('!')) {
      throw new OperationError('String lengths (`!a`) are not supported.');
    }

    if (token.startsWith('$')) {
      const name = token;
      if (peek().toLowerCase() === 'at') {
        next();
        const where = Number(primary());
        return (context.matches.get(name) ?? []).includes(where);
      }
      if (name === '$') {
        throw new OperationError('A bare `$` is only meaningful inside a loop.');
      }
      return countOf(name) > 0;
    }

    if (/^(u?int)(8|16|32)(be)?$/i.test(lower)) {
      expect('(');
      const offset = Number(expression());
      expect(')');
      return readInteger(context.data, lower, offset);
    }

    throw new OperationError(`'${token}' is not something the condition parser knows.`);
  }

  const truth = (value: number | boolean): boolean =>
    typeof value === 'boolean' ? value : value !== 0;

  function comparison(): number | boolean {
    let left = primary();
    for (;;) {
      const token = peek();
      if (!['<', '>', '<=', '>=', '==', '!='].includes(token)) return left;
      next();
      const right = Number(primary());
      const value = Number(left);
      left =
        token === '<'
          ? value < right
          : token === '>'
            ? value > right
            : token === '<='
              ? value <= right
              : token === '>='
                ? value >= right
                : token === '=='
                  ? value === right
                  : value !== right;
    }
  }

  function andExpression(): number | boolean {
    let left = comparison();
    while (peek().toLowerCase() === 'and') {
      next();
      const right = comparison();
      left = truth(left) && truth(right);
    }
    return left;
  }

  function expression(): number | boolean {
    let left = andExpression();
    while (peek().toLowerCase() === 'or') {
      next();
      const right = andExpression();
      left = truth(left) || truth(right);
    }
    return left;
  }

  const result = expression();
  if (at < tokens.length) {
    throw new OperationError(`The condition has '${tokens[at]}' left over after it.`);
  }
  return truth(result);
}

function readInteger(data: Uint8Array, kind: string, offset: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bits = Number(kind.replace(/\D/g, ''));
  const signed = !kind.startsWith('u');
  const big = kind.endsWith('be');
  const size = bits / 8;

  if (offset < 0 || offset + size > data.length) return 0;
  if (bits === 8) return signed ? view.getInt8(offset) : view.getUint8(offset);
  if (bits === 16) return signed ? view.getInt16(offset, !big) : view.getUint16(offset, !big);
  return signed ? view.getInt32(offset, !big) : view.getUint32(offset, !big);
}


export const yaraOperations: Operation[] = [
  {
    id: 'yara-rules',
    name: 'YARA Rules',
    category: 'Forensics',
    description: 'Runs YARA rules against the input and reports which matched and where.',
    aliases: ['yara', 'signature match', 'malware rules'],
    budgetMs: 30000,
    args: [
      { name: 'Rules', type: 'textarea', value: '', hint: 'rule Name { strings: … condition: … }' },
      { name: 'Show the offsets', type: 'boolean', value: true },
      { name: 'Show rules that did not match', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const source = String(arg(args, 'Rules', '')).trim();
      if (source.length === 0) throw new OperationError('There are no rules to run.');

      const rules = parseRules(source);
      const data = asBytes(input);
      let text = '';
      for (const byte of data) text += String.fromCharCode(byte);

      const showOffsets = arg(args, 'Show the offsets', true);
      const showMisses = arg(args, 'Show rules that did not match', false);
      const lines: string[] = [];
      let matched = 0;

      for (const rule of rules) {
        const matches = new Map<string, number[]>();
        for (const pattern of rule.patterns) {
          matches.set(pattern.name, findMatches(pattern, text));
        }

        const context = { data, matches, names: rule.patterns.map((p) => p.name) };
        let hit: boolean;
        try {
          hit = evaluate(rule.condition, context);
        } catch (error) {
          lines.push(
            `${rule.name}: could not be run — ${error instanceof Error ? error.message : 'bad condition'}`,
          );
          continue;
        }

        if (!hit) {
          if (showMisses) lines.push(`${rule.name}: no match`);
          continue;
        }
        matched++;

        const tags = rule.tags.length > 0 ? ` [${rule.tags.join(', ')}]` : '';
        lines.push(`${rule.name}${tags}: match`);
        for (const [key, value] of Object.entries(rule.meta)) lines.push(`  ${key} = ${value}`);

        if (showOffsets) {
          for (const pattern of rule.patterns) {
            const offsets = matches.get(pattern.name) ?? [];
            if (offsets.length === 0) continue;
            const shown = offsets.slice(0, 12).map((o) => `0x${o.toString(16)}`);
            lines.push(
              `  ${pattern.name} × ${offsets.length} at ${shown.join(', ')}` +
                (offsets.length > shown.length ? ', …' : ''),
            );
          }
        }
      }

      const summary = `${matched} of ${rules.length} rule${rules.length === 1 ? '' : 's'} matched.`;
      return lines.length > 0 ? `${summary}\n\n${lines.join('\n')}` : summary;
    },
  },
];
