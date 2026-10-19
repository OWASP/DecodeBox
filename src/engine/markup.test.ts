import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
import type { Recipe } from './types';


const HTML = `<!DOCTYPE html>
<html lang="en">
  <head><title>Test page</title></head>
  <body>
    <ul id="menu" class="nav main">
      <li class="item"><a href="/one">One</a></li>
      <li class="item selected"><a href="/two">Two</a></li>
      <li class="item"><a href="https://example.org/three">Three</a></li>
    </ul>
    <p>Some <b>bold</b> text.</p>
    <script>var x = 1 < 2;</script>
  </body>
</html>`;

const XML = `<?xml version="1.0"?>
<catalogue>
  <book id="1" lang="en"><title>Moby Dick</title><price>8.99</price></book>
  <book id="2" lang="fr"><title>Le Corbeau</title><price>12.50</price></book>
</catalogue>`;

type Entry = string | [string, Record<string, string | number | boolean>];

function recipe(...entries: Entry[]): Recipe {
  return {
    id: 'test',
    name: 'test',
    steps: entries.map((entry, i) => {
      const [opId, overrides] = typeof entry === 'string' ? [entry, {}] : entry;
      const op = getOperation(opId);
      if (!op) throw new Error(`Unknown operation '${opId}'`);
      return {
        uid: `s${i}`,
        opId,
        args: op.args.map((a) => ({ ...a, value: overrides[a.name] ?? a.value })),
        disabled: false,
      };
    }),
  };
}

async function run(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (result.error) throw new Error(`${String(entries[0])}: ${result.error.message}`);
  return renderText(result.output);
}

describe('XPath', () => {
  it('walks an absolute path', async () => {
    expect(await run(XML, ['xpath-expression', { XPath: '/catalogue/book/title' }])).toBe(
      '<title>Moby Dick</title>\n<title>Le Corbeau</title>',
    );
  });

  it('descends with //', async () => {
    expect(await run(XML, ['xpath-expression', { XPath: '//price' }])).toBe(
      '<price>8.99</price>\n<price>12.50</price>',
    );
  });

  it('reads attributes and text', async () => {
    expect(await run(XML, ['xpath-expression', { XPath: '//book/@lang' }])).toBe('en\nfr');
    expect(await run(XML, ['xpath-expression', { XPath: '//title/text()' }])).toBe(
      'Moby Dick\nLe Corbeau',
    );
  });

  it('filters on position and attribute value', async () => {
    expect(await run(XML, ['xpath-expression', { XPath: '//book[2]/title/text()' }])).toBe(
      'Le Corbeau',
    );
    expect(
      await run(XML, ['xpath-expression', { XPath: "//book[@lang='fr']/title/text()" }]),
    ).toBe('Le Corbeau');
    expect(await run(XML, ['xpath-expression', { XPath: '//book[@id]/@id' }])).toBe('1\n2');
  });

  it('says what it cannot do rather than guessing', async () => {
    const result = await bake(XML, recipe(['xpath-expression', { XPath: '//book/ancestor::*' }]));
    expect(result.error?.message).toMatch(/Axes and unions are not supported/);
  });
});

describe('CSS selectors', () => {
  it('selects by tag, class and id', async () => {
    expect(await run(HTML, ['css-selector', { 'CSS selector': 'title', Output: 'Text' }])).toBe(
      'Test page',
    );
    expect(
      await run(HTML, ['css-selector', { 'CSS selector': '.selected a', Output: 'Text' }]),
    ).toBe('Two');
    expect(
      (await run(HTML, ['css-selector', { 'CSS selector': '#menu li', Output: 'Text' }])).split(
        '\n',
      ),
    ).toEqual(['One', 'Two', 'Three']);
  });

  it('selects by attribute, including prefix and substring forms', async () => {
    expect(
      await run(HTML, ['css-selector', { 'CSS selector': 'a[href^="https"]', Output: 'Text' }]),
    ).toBe('Three');
    expect(
      (await run(HTML, ['css-selector', { 'CSS selector': 'a[href]', Output: 'Text' }])).split('\n'),
    ).toHaveLength(3);
  });

  it('honours the child combinator', async () => {
    expect(
      (await run(HTML, ['css-selector', { 'CSS selector': 'ul > li', Output: 'Text' }])).split('\n'),
    ).toHaveLength(3);
    expect(await run(HTML, ['css-selector', { 'CSS selector': 'body > a', Output: 'Text' }])).toBe(
      '',
    );
  });

  it('leaves script contents as text rather than parsing them as markup', async () => {
    expect(await run(HTML, ['css-selector', { 'CSS selector': 'script', Output: 'Text' }])).toBe(
      'var x = 1 < 2;',
    );
  });

  it('returns the element itself when asked', async () => {
    expect(await run(HTML, ['css-selector', { 'CSS selector': 'b' }])).toBe('<b>bold</b>');
  });
});

describe('text extractors', () => {
  it('finds dates in the three numeric orders', async () => {
    const found = await run('Logged 2024-03-01, then 15/04/2024 and 04/16/2024.', 'extract-dates');
    expect(found.split('\n')).toEqual(['2024-03-01', '15/04/2024', '04/16/2024']);
    expect(await run('2024-03-01', ['extract-dates', { 'Display total': true }])).toContain(
      'Total found: 1',
    );
  });

  it('finds Windows and UNIX paths', async () => {
    const text = 'See C:\\Users\\test\\file.txt and /var/log/syslog for details.';
    expect((await run(text, 'extract-file-paths')).split('\n')).toEqual([
      'C:\\Users\\test\\file.txt',
      '/var/log/syslog',
    ]);
    expect(await run(text, ['extract-file-paths', { Windows: false }])).toBe('/var/log/syslog');
  });

  it('ranks the phrase that carries the meaning first', async () => {
    const text =
      'Compatibility of systems of linear constraints over the set of natural numbers. ' +
      'Criteria of compatibility of a system of linear Diophantine equations are considered.';
    const ranked = await run(text, 'rake');
    expect(ranked.split('\n')[0]).toContain('linear diophantine equations');
  });

  it('renders a template over JSON', async () => {
    const context = '{"host":"example.org","ports":[80,443],"safe":false}';
    const rendered = await run(context, [
      'template',
      { Template: '{{host}}:{{#ports}}{{.}} {{/ports}}{{^safe}}(insecure){{/safe}}' },
    ]);
    expect(rendered).toBe('example.org:80 443 (insecure)');
  });

  it('escapes values it renders', async () => {
    expect(
      await run('{"name":"<script>"}', ['template', { Template: '{{name}} / {{{name}}}' }]),
    ).toBe('&lt;script&gt; / <script>');
  });
});
