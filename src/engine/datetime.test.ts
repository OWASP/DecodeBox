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

describe('Translate DateTime Format', () => {
  it('matches the published vectors', async () => {
    expect(await run('01/04/1999 22:33:01', 'translate-datetime-format')).toBe(
      'Thursday 1st April 1999 22:33:01 +00:00 UTC',
    );
    expect(
      await run('01/04/1999 22:33:01', [
        'translate-datetime-format',
        { 'Output timezone': 'US/Eastern' },
      ]),
    ).toBe('Thursday 1st April 1999 17:33:01 -05:00 EST');
  });

  it('uses the offset a zone had at that date, not the one it has now', async () => {
    expect(
      await run('01/07/1999 22:33:01', [
        'translate-datetime-format',
        { 'Output timezone': 'US/Eastern' },
      ]),
    ).toBe('Thursday 1st July 1999 18:33:01 -04:00 EDT');
  });

  it('reads a time in one zone and writes it in another', async () => {
    expect(
      await run('2024-06-01 12:00:00', [
        'translate-datetime-format',
        {
          'Input format string': 'YYYY-MM-DD HH:mm:ss',
          'Input timezone': 'Europe/London',
          'Output format string': 'YYYY-MM-DD HH:mm:ss',
          'Output timezone': 'UTC',
        },
      ]),
    ).toBe('2024-06-01 11:00:00');
  });

  it('reads and writes Unix timestamps', async () => {
    expect(
      await run('1000000000', [
        'translate-datetime-format',
        { 'Input format string': 'X', 'Output format string': 'YYYY-MM-DDTHH:mm:ssZ' },
      ]),
    ).toBe('2001-09-09T01:46:40+00:00');
  });

  it('says plainly when the input does not match the format', async () => {
    const result = await bake('1234567890', recipe('translate-datetime-format'));
    expect(result.error?.message).toMatch(/does not match the format/);
  });
});

describe('DateTime Delta', () => {
  it('adds and subtracts an interval', async () => {
    expect(
      await run('01/04/1999 22:33:01', ['datetime-delta', { Days: 1, Hours: 2 }]),
    ).toBe('03/04/1999 00:33:01');
    expect(
      await run('01/04/1999 22:33:01', [
        'datetime-delta',
        { 'Time operation': 'Subtract', Hours: 23 },
      ]),
    ).toBe('31/03/1999 23:33:01');
  });
});
