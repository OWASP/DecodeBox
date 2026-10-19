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

const BINARY_PLIST =
  '62706c6973743030d80102030405060708090a0b0c0d10111454626c6f625864697361626c' +
  '656457656e61626c6564546e616d65566e657374656455726174696f547461677357766572' +
  '73696f6e44deadbeef0809594465636f6465426f78d10e0f55696e6e65725576616c756523' +
  '3fe0000000000000a21213556f77617370587365637572697479100308191e272f343b4146' +
  '4e5354555f62686e777a808900000000000001010000000000000015000000000000000000' +
  '0000000000008b';

const XML_PLIST = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
  '<plist version="1.0">',
  '<dict>',
  '\t<key>blob</key>',
  '\t<data>',
  '\t3q2+7w==',
  '\t</data>',
  '\t<key>disabled</key>',
  '\t<false/>',
  '\t<key>enabled</key>',
  '\t<true/>',
  '\t<key>name</key>',
  '\t<string>DecodeBox</string>',
  '\t<key>nested</key>',
  '\t<dict>',
  '\t\t<key>inner</key>',
  '\t\t<string>value</string>',
  '\t</dict>',
  '\t<key>ratio</key>',
  '\t<real>0.5</real>',
  '\t<key>tags</key>',
  '\t<array>',
  '\t\t<string>owasp</string>',
  '\t\t<string>security</string>',
  '\t</array>',
  '\t<key>version</key>',
  '\t<integer>3</integer>',
  '</dict>',
  '</plist>',
].join('\n');

const EXPECTED = {
  blob: 'deadbeef',
  disabled: false,
  enabled: true,
  name: 'DecodeBox',
  nested: { inner: 'value' },
  ratio: 0.5,
  tags: ['owasp', 'security'],
  version: 3,
};

describe('P-list Viewer', () => {
  it('reads the binary form', async () => {
    const json = await run(BINARY_PLIST, 'from-hex', 'plist-viewer');
    expect(JSON.parse(json)).toEqual(EXPECTED);
  });

  it('reads the XML form to the same value', async () => {
    const json = await run(XML_PLIST, 'plist-viewer');
    expect(JSON.parse(json)).toEqual(EXPECTED);
  });

  it('reads an empty dictionary and an empty array', async () => {
    const xml = '<plist version="1.0"><dict><key>a</key><array/><key>b</key><dict/></dict></plist>';
    expect(JSON.parse(await run(xml, 'plist-viewer'))).toEqual({ a: [], b: {} });
  });

  it('refuses a dict whose value has no key', async () => {
    const xml = '<plist version="1.0"><dict><string>orphan</string></dict></plist>';
    const result = await bake(xml, recipe('plist-viewer'));
    expect(result.error?.message).toMatch(/without a key/);
  });

  it('refuses input that is neither form', async () => {
    const result = await bake('just some text', recipe('plist-viewer'));
    expect(result.error?.message).toMatch(/neither a binary property list/);
  });

  it('refuses a truncated binary list rather than reading rubbish', async () => {
    const result = await bake(BINARY_PLIST.slice(0, 60), recipe('from-hex', 'plist-viewer'));
    expect(result.error?.message).toBeDefined();
  });
});

const ELF =
  '7f454c4602010103000000000000000002003e000100000000104000000000004000000000' +
  '000000b0000000000000000000000040003800020040000300020001000000050000000000' +
  '000000000000000040000000000000004000000000009d010000000000009d010000000000' +
  '00001000000000000003000000040000007001000000000000000000000000000000000000' +
  '000000001c000000000000001c000000000000000100000000000000000000000000000000' +
  '00000000000000000000000000000000000000000000000000000000000000000000000000' +
  '0000000000000000000000000000000000000b000000010000000600000000000000001040' +
  '00000000000010000000000000200000000000000000000000000000001000000000000000' +
  '00000000000000000100000003000000000000000000000000000000000000008c01000000' +
  '00000011000000000000000000000000000000010000000000000000000000000000002f6c' +
  '696236342f6c642d6c696e75782d7838362d36342e736f2e3200002e736873747274616200' +
  '2e7465787400';

describe('ELF Info', () => {
  it('reads the header', async () => {
    const report = await run(ELF, 'from-hex', 'elf-info');
    expect(report).toContain('Class:        64-bit');
    expect(report).toContain('Byte order:   little-endian');
    expect(report).toContain('OS ABI:       Linux');
    expect(report).toContain('Type:         EXEC (executable)');
    expect(report).toContain('Machine:      x86-64');
    expect(report).toContain('Entry point:  0x401000');
  });

  it('names the sections from the string table', async () => {
    const report = await run(ELF, 'from-hex', ['elf-info', { Show: 'Sections' }]);
    expect(report).toContain('.text');
    expect(report).toContain('.shstrtab');
    expect(report).toContain('PROGBITS');
    expect(report).toContain('STRTAB');
  });

  it('reads the segments and the interpreter', async () => {
    const report = await run(ELF, 'from-hex', ['elf-info', { Show: 'Segments' }]);
    expect(report).toContain('LOAD');
    expect(report).toContain('INTERP');
    expect(report).toContain('r-x');
    expect(report).toContain('interpreter: /lib64/ld-linux-x86-64.so.2');
  });

  it('shows only the header when asked', async () => {
    const report = await run(ELF, 'from-hex', ['elf-info', { Show: 'Header only' }]);
    expect(report).toContain('ELF header');
    expect(report).not.toContain('Sections\n');
    expect(report).not.toContain('.text');
  });

  it('refuses something that is not an ELF', async () => {
    const result = await bake('MZ' + 'x'.repeat(80), recipe('elf-info'));
    expect(result.error?.message).toMatch(/Not an ELF file/);
  });
});
