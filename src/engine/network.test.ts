import { describe, expect, it } from 'vitest';
import { bake } from './index';
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
  return result.output;
}

async function failure(input: string, ...entries: Entry[]): Promise<string> {
  const result = await bake(input, recipe(...entries));
  if (!result.error) throw new Error(`expected a failure, got '${result.output}'`);
  return result.error.message;
}

const format = (to: string): Entry => ['change-ip-format', { To: to }];

describe('change-ip-format', () => {
  it('reads back every form it writes', async () => {
    const decimal = await run('127.0.0.1', format('Decimal'));
    const hex = await run('127.0.0.1', format('Hexadecimal'));
    const octal = await run('127.0.0.1', format('Octal'));

    expect(decimal).toBe('2130706433');
    expect(hex).toBe('0x7f000001');
    expect(octal).toBe('017700000001');

    expect(await run(decimal, format('Dotted decimal'))).toBe('127.0.0.1');
    expect(await run(hex, format('Dotted decimal'))).toBe('127.0.0.1');
    expect(await run(octal, format('Dotted decimal'))).toBe('127.0.0.1');
  });

  it('refuses a number above the largest address instead of truncating it', async () => {
    expect(await failure('4294967296', format('Dotted decimal'))).toContain('above the largest');
    expect(await failure('99999999999', format('Dotted decimal'))).toContain('above the largest');
    expect(await run('4294967295', format('Dotted decimal'))).toBe('255.255.255.255');
  });

  it('refuses a dotted address whose octets are not decimal numbers', async () => {
    expect(await failure('1.2.3.', format('Decimal'))).toContain('not a decimal number');
    expect(await failure('...', format('Decimal'))).toContain('not a decimal number');
    expect(await failure('1e2.0.0.1', format('Decimal'))).toContain('not a decimal number');
    expect(await failure('256.0.0.1', format('Decimal'))).toContain('outside 0-255');
  });
});

describe('cidr-range', () => {
  it('still summarises a block unchanged', async () => {
    const summary = await run('10.0.0.0/24', 'cidr-range');
    expect(summary).toContain('Network:    10.0.0.0/24');
    expect(summary).toContain('Netmask:    255.255.255.0');
    expect(summary).toContain('Broadcast:  10.0.0.255');
    expect(summary).toContain('First host: 10.0.0.1');
    expect(summary).toContain('Last host:  10.0.0.254');
  });
});
