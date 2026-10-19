import { OperationError } from '../types';
import { arg, type Operation } from './types';


interface Element {
  name: string;
  attributes: Record<string, string>;
  children: Node[];
  parent: Element | null;
}

type Node = Element | { text: string };

function isElement(node: Node): node is Element {
  return 'name' in node;
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

const MAX_MARKUP_DEPTH = 200;

function parseMarkup(source: string): Element {
  const root: Element = { name: '#document', attributes: {}, children: [], parent: null };
  let current = root;
  let depth = 0;
  let at = 0;

  const pushText = (text: string) => {
    if (text !== '') current.children.push({ text });
  };

  while (at < source.length) {
    const next = source.indexOf('<', at);
    if (next < 0) {
      pushText(source.slice(at));
      break;
    }
    pushText(source.slice(at, next));

    if (source.startsWith('<!--', next)) {
      const end = source.indexOf('-->', next);
      at = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', next)) {
      const end = source.indexOf(']]>', next);
      pushText(source.slice(next + 9, end < 0 ? source.length : end));
      at = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', next) || source.startsWith('<?', next)) {
      const end = source.indexOf('>', next);
      at = end < 0 ? source.length : end + 1;
      continue;
    }

    const end = source.indexOf('>', next);
    if (end < 0) {
      pushText(source.slice(next));
      break;
    }
    const tag = source.slice(next + 1, end).trim();
    at = end + 1;

    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim().toLowerCase();
      let candidate: Element | null = current;
      while (candidate && candidate.name !== name) candidate = candidate.parent;
      if (candidate?.parent) {
        current = candidate.parent;
        depth = Math.max(0, depth - 1);
      }
      continue;
    }

    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch) continue;
    const name = (nameMatch[1] as string).toLowerCase();

    const attributes: Record<string, string> = {};
    const attributePattern = /([^\s=/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
    attributePattern.lastIndex = (nameMatch[1] as string).length;
    let attribute: RegExpExecArray | null;
    while ((attribute = attributePattern.exec(body)) !== null) {
      const key = (attribute[1] as string).toLowerCase();
      attributes[key] = attribute[3] ?? attribute[4] ?? attribute[5] ?? '';
    }

    const element: Element = { name, attributes, children: [], parent: current };
    current.children.push(element);

    if (selfClosing || VOID_ELEMENTS.has(name)) continue;

    if (RAW_TEXT_ELEMENTS.has(name)) {
      const closing = source.toLowerCase().indexOf(`</${name}`, at);
      const stop = closing < 0 ? source.length : closing;
      if (stop > at) element.children.push({ text: source.slice(at, stop) });
      at = closing < 0 ? source.length : source.indexOf('>', closing) + 1;
      continue;
    }

    if (depth >= MAX_MARKUP_DEPTH) throw new OperationError('Markup nested too deeply.');
    current = element;
    depth++;
  }
  return root;
}

function textOf(node: Node): string {
  if (!isElement(node)) return node.text;
  return node.children.map(textOf).join('');
}

function serialise(node: Node): string {
  if (!isElement(node)) return node.text;
  const attributes = Object.entries(node.attributes)
    .map(([key, value]) => ` ${key}="${value}"`)
    .join('');
  const inner = node.children.map(serialise).join('');
  if (VOID_ELEMENTS.has(node.name)) return `<${node.name}${attributes}>`;
  return `<${node.name}${attributes}>${inner}</${node.name}>`;
}

function descendants(element: Element): Element[] {
  const out: Element[] = [];
  for (const child of element.children) {
    if (!isElement(child)) continue;
    out.push(child, ...descendants(child));
  }
  return out;
}


type Result = Element | string;

interface Step {
  descend: boolean;
  body: string;
}

function splitSteps(path: string): Step[] {
  const steps: Step[] = [];
  let at = 0;
  let descend = !path.startsWith('/');

  if (path.startsWith('//')) {
    descend = true;
    at = 2;
  } else if (path.startsWith('/')) {
    at = 1;
  }

  let body = '';
  let brackets = 0;
  for (; at < path.length; at++) {
    const char = path[at] as string;
    if (char === '[') brackets++;
    if (char === ']') brackets--;
    if (char === '/' && brackets === 0) {
      if (body !== '') steps.push({ descend, body });
      body = '';
      descend = path[at + 1] === '/';
      if (descend) at++;
      continue;
    }
    body += char;
  }
  if (body !== '') steps.push({ descend, body });
  return steps;
}

function evaluateXPath(root: Element, expression: string): Result[] {
  const path = expression.trim();
  if (path === '') throw new OperationError('Enter an XPath expression.');
  if (/\b(ancestor|following|preceding|namespace|self)::|\|/.test(path)) {
    throw new OperationError('Axes and unions are not supported; use a plain path.');
  }

  const steps = splitSteps(path);

  let current: Element[] = [root];
  let last: Result[] = current;

  for (const { descend, body } of steps) {
    const predicateMatch = /^([^[]*)((?:\[[^\]]*\])*)$/.exec(body);
    if (!predicateMatch) throw new OperationError(`Cannot read the step '${body}'.`);
    const test = (predicateMatch[1] as string).trim();
    const predicates = (predicateMatch[2] as string).match(/\[[^\]]*\]/g) ?? [];

    const pool = descend ? current.flatMap((node) => descendants(node)) : current.flatMap((node) => node.children.filter(isElement));

    if (test.startsWith('@')) {
      const name = test.slice(1);
      last = current.flatMap((node) => (name in node.attributes ? [node.attributes[name] as string] : []));
      current = [];
      continue;
    }
    if (test === 'text()') {
      last = current.map((node) => node.children.filter((c) => !isElement(c)).map(textOf).join(''));
      current = [];
      continue;
    }

    let matched = test === '*' || test === 'node()' ? pool : pool.filter((node) => node.name === test.toLowerCase());

    for (const predicate of predicates) {
      const inner = predicate.slice(1, -1).trim();
      const index = /^\d+$/.exec(inner);
      if (index) {
        const wanted = matched[Number(index[0]) - 1];
        matched = wanted ? [wanted] : [];
        continue;
      }
      const equality = /^@([\w:-]+)\s*=\s*['"](.*)['"]$/.exec(inner);
      if (equality) {
        matched = matched.filter((node) => node.attributes[equality[1] as string] === equality[2]);
        continue;
      }
      const exists = /^@([\w:-]+)$/.exec(inner);
      if (exists) {
        matched = matched.filter((node) => (exists[1] as string) in node.attributes);
        continue;
      }
      throw new OperationError(`Cannot read the predicate '${predicate}'.`);
    }
    current = matched;
    last = matched;
  }
  return last;
}


interface SimpleSelector {
  tag: string | null;
  id: string | null;
  classes: string[];
  attributes: Array<{ name: string; value: string | null; operator: string }>;
}

function parseSimple(text: string): SimpleSelector {
  const selector: SimpleSelector = { tag: null, id: null, classes: [], attributes: [] };
  const pattern = /([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[([\w:-]+)(?:([~^$*|]?=)['"]?([^\]'"]*)['"]?)?\]/g;
  let match: RegExpExecArray | null;
  let consumed = 0;

  while ((match = pattern.exec(text)) !== null) {
    consumed += match[0].length;
    if (match[1]) selector.tag = match[1] === '*' ? null : match[1].toLowerCase();
    else if (match[2]) selector.id = match[2];
    else if (match[3]) selector.classes.push(match[3]);
    else if (match[4]) {
      selector.attributes.push({
        name: match[4].toLowerCase(),
        operator: match[5] ?? '',
        value: match[6] ?? null,
      });
    }
  }
  if (consumed !== text.length) throw new OperationError(`Cannot read the selector '${text}'.`);
  return selector;
}

function matchesSimple(element: Element, selector: SimpleSelector): boolean {
  if (selector.tag && element.name !== selector.tag) return false;
  if (selector.id && element.attributes.id !== selector.id) return false;

  const classList = (element.attributes.class ?? '').split(/\s+/);
  if (!selector.classes.every((name) => classList.includes(name))) return false;

  return selector.attributes.every(({ name, operator, value }) => {
    const actual = element.attributes[name];
    if (actual === undefined) return false;
    if (value === null) return true;
    switch (operator) {
      case '^=':
        return actual.startsWith(value);
      case '$=':
        return actual.endsWith(value);
      case '*=':
        return actual.includes(value);
      case '~=':
        return actual.split(/\s+/).includes(value);
      case '|=':
        return actual === value || actual.startsWith(`${value}-`);
      default:
        return actual === value;
    }
  });
}

function selectCss(root: Element, selector: string): Element[] {
  const groups = selector.split(',').map((group) => group.trim()).filter((group) => group !== '');
  if (groups.length === 0) throw new OperationError('Enter a CSS selector.');

  const found: Element[] = [];
  for (const group of groups) {
    const pieces = group.split(/\s*(>|\+|~)\s*|\s+/).filter((piece) => piece !== undefined && piece !== '');
    let matched: Element[] = descendants(root);
    let combinator = ' ';
    let first = true;

    for (const piece of pieces) {
      if (piece === '>' || piece === '+' || piece === '~') {
        combinator = piece;
        continue;
      }
      const simple = parseSimple(piece);
      if (first) {
        matched = descendants(root).filter((node) => matchesSimple(node, simple));
        first = false;
      } else if (combinator === '>') {
        matched = matched.flatMap((node) =>
          node.children.filter(isElement).filter((child) => matchesSimple(child, simple)),
        );
      } else if (combinator === '+') {
        matched = matched.flatMap((node) => {
          const siblings = node.parent?.children.filter(isElement) ?? [];
          const next = siblings[siblings.indexOf(node) + 1];
          return next && matchesSimple(next, simple) ? [next] : [];
        });
      } else if (combinator === '~') {
        matched = matched.flatMap((node) => {
          const siblings = node.parent?.children.filter(isElement) ?? [];
          return siblings.slice(siblings.indexOf(node) + 1).filter((sibling) => matchesSimple(sibling, simple));
        });
      } else {
        matched = matched.flatMap((node) => descendants(node).filter((child) => matchesSimple(child, simple)));
      }
      combinator = ' ';
    }
    for (const node of matched) if (!found.includes(node)) found.push(node);
  }
  return found;
}

export const markupOperations: Operation[] = [
  {
    id: 'xpath-expression',
    name: 'XPath expression',
    category: 'Extractors',
    description: 'Selects nodes from XML or HTML with an XPath expression.',
    aliases: ['xpath', 'xml query', 'select nodes'],
    args: [
      { name: 'XPath', type: 'string', value: '' },
      { name: 'Result delimiter', type: 'string', value: '\\n' },
    ],
    run: (input, args) => {
      const results = evaluateXPath(parseMarkup(input), String(arg(args, 'XPath', '')));
      const delimiter = String(arg(args, 'Result delimiter', '\\n')).replace(/\\n/g, '\n');
      return results
        .map((result) => (typeof result === 'string' ? result : serialise(result)))
        .join(delimiter);
    },
  },
  {
    id: 'css-selector',
    name: 'CSS selector',
    category: 'Extractors',
    description: 'Selects elements from HTML with a CSS selector.',
    aliases: ['css', 'query selector', 'scrape'],
    args: [
      { name: 'CSS selector', type: 'string', value: '' },
      { name: 'Result delimiter', type: 'string', value: '\\n' },
      { name: 'Output', type: 'option', value: 'Element', options: ['Element', 'Text'] },
    ],
    run: (input, args) => {
      const matched = selectCss(parseMarkup(input), String(arg(args, 'CSS selector', '')));
      const delimiter = String(arg(args, 'Result delimiter', '\\n')).replace(/\\n/g, '\n');
      const text = String(arg(args, 'Output', 'Element')) === 'Text';
      return matched.map((node) => (text ? textOf(node) : serialise(node))).join(delimiter);
    },
  },
];
