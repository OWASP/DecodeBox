import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
import type { Recipe } from './types';


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

describe('PHP serialization', () => {
  it('reads the published examples', async () => {
    expect(JSON.parse(await run('a:0:{}', 'php-deserialize'))).toEqual({});
    expect(JSON.parse(await run('i:10;', 'php-deserialize'))).toBe(10);
    expect(JSON.parse(await run('s:17:"PHP Serialization";', 'php-deserialize'))).toBe(
      'PHP Serialization',
    );
    expect(
      JSON.parse(await run('a:2:{s:1:"a";i:10;i:0;a:1:{s:2:"ab";b:1;}}', 'php-deserialize')),
    ).toEqual({ a: 10, '0': { ab: true } });
  });

  it('writes what PHP would write', async () => {
    expect(await run('{"a":10}', 'php-serialize')).toBe('a:1:{s:1:"a";i:10;}');
    expect(await run('[1,2]', 'php-serialize')).toBe('a:2:{i:0;i:1;i:1;i:2;}');
    expect(await run('null', 'php-serialize')).toBe('N;');
    expect(await run('true', 'php-serialize')).toBe('b:1;');
    expect(await run('1.5', 'php-serialize')).toBe('d:1.5;');
  });

  it('round-trips a nested structure', async () => {
    const value = '{"name":"test","items":[1,2,3],"ok":true}';
    expect(JSON.parse(await run(value, 'php-serialize', 'php-deserialize'))).toEqual(
      JSON.parse(value),
    );
  });
});

describe('Microsoft encoded script', () => {
  it('decodes the published sample', async () => {
    const encoded =
      '#@~^RQAAAA==-mD~sX|:/TP{~J:+dYbxL~@!F@*@!+@*@!&@*eEI@#@&@#@&' +
      String.fromCharCode(0x7f) +
      'jm.raY 214Wv:zms/obI0xEAAA==^#~@';
    expect(await run(encoded, 'microsoft-script-decoder')).toBe(
      'var my_msg = "Testing <1><2><3>!";\r\n\r\nWScript.Echo(my_msg);',
    );
  });

  it('says so when there is no encoded block', async () => {
    const result = await bake('plain text', recipe('microsoft-script-decoder'));
    expect(result.error?.message).toMatch(/No .* encoded block/);
  });
});

describe('formatting', () => {
  it('minifies JavaScript without touching literals', async () => {
    const source = 'function f( a ) {\n  // a comment\n  return a + " spaced string ";\n}';
    const minified = await run(source, 'javascript-minify');
    expect(minified).toContain('" spaced string "');
    expect(minified).not.toContain('a comment');
    expect(minified).not.toContain('\n');
  });

  it('leaves a regular expression alone', async () => {
    const source = 'const re = /a\\/b[/]c/g; const d = 4 / 2;';
    expect(await run(source, 'javascript-minify')).toContain('/a\\/b[/]c/g');
  });

  it('re-indents by brace depth', async () => {
    const beautified = await run('if(a){b();if(c){d();}}', [
      'javascript-beautify',
      { 'Indent string': '  ' },
    ]);
    expect(beautified).toBe('if(a) {\n  b();\n  if(c) {\n    d();\n  }\n}');
  });

  it('formats and minifies CSS', async () => {
    expect(await run('a{color:red;background:blue}', ['css-beautify', { 'Indent string': '  ' }])).toBe(
      'a {\n  color: red;\n  background: blue\n}',
    );
    expect(await run('a {\n  color: red;\n}\n', 'css-minify')).toBe('a{color:red}');
    expect(await run('/* keep */ a { color: red }', ['css-minify', { 'Preserve comments': true }])).toContain(
      'keep',
    );
  });

  it('breaks a query at its clauses', async () => {
    const sql = 'SELECT a, b FROM t WHERE a = 1 AND b = 2 ORDER BY a';
    const pretty = await run(sql, ['sql-beautify', { 'Indent string': '  ' }]);
    expect(pretty.split('\n')[0]).toBe('SELECT a, b');
    expect(pretty).toContain('\nFROM t');
    expect(pretty).toContain('\n  AND b = 2');
    expect(await run(pretty, 'sql-minify')).toBe(sql);
  });

  it('renders Markdown as escaped HTML', async () => {
    const html = await run('# Title\n\nSome **bold** and `code`.\n\n- one\n- two', 'render-markdown');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
  });

  it('escapes markup inside the Markdown it renders', async () => {
    expect(await run('<script>alert(1)</script>', 'render-markdown')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });
});
