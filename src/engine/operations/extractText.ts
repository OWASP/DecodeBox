import { OperationError } from '../types';
import { arg, type Operation } from './types';


function present(results: string[], total: boolean, sort: boolean, unique: boolean): string {
  let out = results;
  if (unique) out = [...new Set(out)];
  if (sort) out = [...out].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return total ? `Total found: ${out.length}\n\n${out.join('\n')}` : out.join('\n');
}


const RAKE_STOP_WORDS =
  "i,me,my,myself,we,our,ours,ourselves,you,you're,you've,you'll,you'd,your,yours,yourself," +
  "yourselves,he,him,his,himself,she,she's,her,hers,herself,it,it's,its,itself,they,them,their," +
  "theirs,themselves,what,which,who,whom,this,that,that'll,these,those,am,is,are,was,were,be," +
  "been,being,have,has,had,having,do,does,did,doing,a,an,the,and,but,if,or,because,as,until," +
  "while,of,at,by,for,with,about,against,between,into,through,during,before,after,above,below," +
  "to,from,up,down,in,out,on,off,over,under,again,further,then,once,here,there,when,where,why," +
  "how,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too," +
  "very,s,t,can,will,just,don,don't,should,should've,now,d,ll,m,o,re,ve,y,ain,aren,aren't," +
  "couldn,couldn't,didn,didn't,doesn,doesn't,hadn,hadn't,hasn,hasn't,haven,haven't,isn,isn't," +
  "ma,mightn,mightn't,mustn,mustn't,needn,needn't,shan,shan't,shouldn,shouldn't,wasn,wasn't," +
  "weren,weren't,won,won't,wouldn,wouldn't";

function rake(text: string, wordDelimiter: RegExp, sentenceDelimiter: RegExp, stopWords: Set<string>) {
  const phrases: string[][] = [];
  for (const sentence of text.split(sentenceDelimiter)) {
    let current: string[] = [];
    for (const raw of sentence.split(wordDelimiter)) {
      const word = raw.toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
      if (word === '' || stopWords.has(word)) {
        if (current.length > 0) phrases.push(current);
        current = [];
        continue;
      }
      current.push(word);
    }
    if (current.length > 0) phrases.push(current);
  }

  const frequency = new Map<string, number>();
  const degree = new Map<string, number>();
  for (const phrase of phrases) {
    for (const word of phrase) {
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
      degree.set(word, (degree.get(word) ?? 0) + phrase.length - 1);
    }
  }

  const score = new Map<string, number>();
  for (const [word, count] of frequency) {
    score.set(word, ((degree.get(word) ?? 0) + count) / count);
  }

  const results = new Map<string, number>();
  for (const phrase of phrases) {
    const key = phrase.join(' ');
    if (results.has(key)) continue;
    results.set(key, phrase.reduce((sum, word) => sum + (score.get(word) ?? 0), 0));
  }
  return [...results.entries()].sort((a, b) => b[1] - a[1]);
}


function renderTemplate(template: string, context: unknown, depth = 0): string {
  if (depth > 20) throw new OperationError('Template sections nested too deeply.');

  const lookup = (path: string, scope: unknown): unknown => {
    if (path === '.') return scope;
    let value: unknown = scope;
    for (const key of path.split('.')) {
      if (value === null || typeof value !== 'object') return undefined;
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  };

  const escape = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const section = /\{\{([#^])\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;
  let out = template;
  let match: RegExpExecArray | null;

  while ((match = section.exec(out)) !== null) {
    const [whole, kind, path = '', body = ''] = match;
    const value = lookup(path, context);
    const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);

    let rendered = '';
    if (kind === '#' && truthy) {
      rendered = Array.isArray(value)
        ? value.map((item) => renderTemplate(body, item, depth + 1)).join('')
        : renderTemplate(body, typeof value === 'object' ? value : context, depth + 1);
    } else if (kind === '^' && !truthy) {
      rendered = renderTemplate(body, context, depth + 1);
    }
    out = out.replace(whole, () => rendered);
  }

  return out
    .replace(/\{\{\{\s*([\w.]+|\.)\s*\}\}\}/g, (_m, path: string) => String(lookup(path, context) ?? ''))
    .replace(/\{\{\s*([\w.]+|\.)\s*\}\}/g, (_m, path: string) => escape(lookup(path, context)));
}

export const extractTextOperations: Operation[] = [
  {
    id: 'extract-dates',
    name: 'Extract dates',
    category: 'Extractors',
    description: 'Finds dates written in the common numeric formats.',
    aliases: ['dates', 'find dates', 'timestamps'],
    args: [{ name: 'Display total', type: 'boolean', value: false }],
    run: (input, args) => {
      const patterns = [
        '(?:19|20)\\d\\d[- /.](?:0[1-9]|1[012])[- /.](?:0[1-9]|[12][0-9]|3[01])',
        '(?:0[1-9]|[12][0-9]|3[01])[- /.](?:0[1-9]|1[012])[- /.](?:19|20)\\d\\d',
        '(?:0[1-9]|1[012])[- /.](?:0[1-9]|[12][0-9]|3[01])[- /.](?:19|20)\\d\\d',
      ];
      const found = input.match(new RegExp(patterns.join('|'), 'ig')) ?? [];
      return present(found, arg(args, 'Display total', false), false, false);
    },
  },
  {
    id: 'extract-file-paths',
    name: 'Extract file paths',
    category: 'Extractors',
    description: 'Finds Windows and UNIX file paths.',
    aliases: ['paths', 'filenames', 'directories'],
    args: [
      { name: 'Windows', type: 'boolean', value: true },
      { name: 'UNIX', type: 'boolean', value: true },
      { name: 'Display total', type: 'boolean', value: false },
      { name: 'Sort', type: 'boolean', value: false },
      { name: 'Unique', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const windows = "[A-Z]:\\\\(?:[A-Z\\d][A-Z\\d\\- '_()~]{0,61}\\\\?)*[A-Z\\d][A-Z\\d\\- '_()~]{0,61}(?:\\.[A-Z\\d]{1,6})?";
      const unix = '(?:/[A-Z\\d.][A-Z\\d\\-._]{0,61})+';

      const wanted = [
        arg(args, 'Windows', true) ? windows : '',
        arg(args, 'UNIX', true) ? unix : '',
      ].filter((pattern) => pattern !== '');
      if (wanted.length === 0) return '';

      const found = input.match(new RegExp(wanted.join('|'), 'ig')) ?? [];
      return present(
        found,
        arg(args, 'Display total', false),
        arg(args, 'Sort', false),
        arg(args, 'Unique', false),
      );
    },
  },
  {
    id: 'rake',
    name: 'RAKE',
    category: 'Extractors',
    description: 'Ranks the key phrases in a piece of text by how they co-occur.',
    aliases: ['keywords', 'key phrases', 'topics'],
    args: [
      { name: 'Word delimiter (regex)', type: 'string', value: '\\s' },
      { name: 'Sentence delimiter (regex)', type: 'string', value: '\\.\\s|\\n' },
      { name: 'Stop words', type: 'textarea', value: RAKE_STOP_WORDS },
    ],
    run: (input, args) => {
      let words: RegExp;
      let sentences: RegExp;
      try {
        words = new RegExp(String(arg(args, 'Word delimiter (regex)', '\\s')));
        sentences = new RegExp(String(arg(args, 'Sentence delimiter (regex)', '\\.\\s|\\n')));
      } catch {
        throw new OperationError('One of the delimiters is not a valid regular expression.');
      }

      const stopWords = new Set(
        String(arg(args, 'Stop words', RAKE_STOP_WORDS))
          .split(',')
          .map((word) => word.trim().toLowerCase())
          .filter((word) => word !== ''),
      );

      const ranked = rake(input, words, sentences, stopWords);
      if (ranked.length === 0) return '(no key phrases found)';
      return ranked.map(([phrase, score]) => `${score.toFixed(2)}  ${phrase}`).join('\n');
    },
  },
  {
    id: 'template',
    name: 'Template',
    category: 'Extractors',
    description: 'Renders JSON through a Mustache-style template.',
    aliases: ['handlebars', 'mustache', 'report'],
    args: [{ name: 'Template', type: 'textarea', value: '' }],
    run: (input, args) => {
      const template = String(arg(args, 'Template', ''));
      if (template === '') throw new OperationError('Enter a template.');
      let context: unknown;
      try {
        context = JSON.parse(input);
      } catch {
        throw new OperationError('The input must be JSON for the template to read.');
      }
      return renderTemplate(template, context);
    },
  },
];
