import { describe, expect, it } from 'vitest';
import { bake, renderText } from './index';
import { getOperation } from './operations';
import { makeRotor, step } from './operations/enigma';
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

describe('Enigma', () => {
  it('matches the standard I-II-III reflector-B vector', async () => {
    expect(await run('AAAAA', 'enigma')).toBe('BDZGO');
    expect(await run('A'.repeat(25), 'enigma')).toBe('BDZGOWCXLTKSBTMCDLPBMUQOF');
  });

  it('double-steps the middle rotor', () => {
    const rotors = ['I', 'II', 'III'].map((name, i) => makeRotor(name, 'A', 'ADU'[i]!));
    const window = () => rotors.map((r) => String.fromCharCode(r.position + 65)).join('');

    const seen = [window()];
    for (let i = 0; i < 4; i++) {
      step(rotors);
      seen.push(window());
    }
    expect(seen).toEqual(['ADU', 'ADV', 'AEW', 'BFX', 'BFY']);
  });

  it('is its own inverse, which is how a whole army used it', async () => {
    const settings = {
      'Left rotor': 'IV',
      'Middle rotor': 'I',
      'Right rotor': 'V',
      'Ring settings': 'BUL',
      'Rotor positions': 'XYZ',
      Plugboard: 'AV BS CG DL FU HZ IN KM OW RX',
    };
    const plain = 'ATTACKATDAWNONTHEEASTERNFRONT';
    const cipher = await run(plain, ['enigma', settings]);
    expect(cipher).not.toBe(plain);
    expect(await run(cipher, ['enigma', settings])).toBe(plain);
  });

  it('never enciphers a letter to itself', async () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const out = await run(alphabet.repeat(4), 'enigma');
    for (let i = 0; i < out.length; i++) {
      expect(out[i], `position ${i}`).not.toBe(alphabet.repeat(4)[i]);
    }
  });

  it('agrees with the M3 when the M4 is set up to imitate one', async () => {
    expect(
      await run('A'.repeat(25), [
        'enigma',
        {
          Model: '4-rotor (M4)',
          'Fourth rotor': 'Beta',
          Reflector: 'B thin',
          'Ring settings': 'AAAA',
          'Rotor positions': 'AAAA',
        },
      ]),
    ).toBe('BDZGOWCXLTKSBTMCDLPBMUQOF');
  });

  it('honours the ring setting separately from the rotor position', async () => {
    const withRing = await run('AAAAA', ['enigma', { 'Ring settings': 'BBB' }]);
    const withPosition = await run('AAAAA', ['enigma', { 'Rotor positions': 'BBB' }]);
    expect(withRing).not.toBe('BDZGO');
    expect(withRing).not.toBe(withPosition);
  });

  it('drops or keeps the characters that have no key on the machine', async () => {
    expect(await run('AA AA', 'enigma')).toBe('BDZG');
    expect(await run('AA AA', ['enigma', { 'Keep other characters': true }])).toBe('BD ZG');
  });

  it('refuses a plugboard that could not be wired', async () => {
    for (const [board, message] of [
      ['AB AC', /already plugged/],
      ['AA', /cannot join/],
      ['ABC', /pairs/],
    ] as Array<[string, RegExp]>) {
      const result = await bake('AAA', recipe(['enigma', { Plugboard: board }]));
      expect(result.error?.message, board).toMatch(message);
    }
  });

  it('refuses a four-rotor machine with a wide reflector', async () => {
    const result = await bake(
      'AAA',
      recipe([
        'enigma',
        { Model: '4-rotor (M4)', 'Ring settings': 'AAAA', 'Rotor positions': 'AAAA' },
      ]),
    );
    expect(result.error?.message).toMatch(/thin reflector/);
  });

  it('refuses settings of the wrong length', async () => {
    const result = await bake('AAA', recipe(['enigma', { 'Ring settings': 'AA' }]));
    expect(result.error?.message).toMatch(/3 ring settings/);
  });
});

describe('Typex', () => {
  const ENIGMA_ROTORS = [
    'EKMFLGDQVZNTOWYHXUSPAIBRCJ Q',
    'AJDKSIRUXBLHWTMCQGZNPYFVOE E',
    'BDFHJLCPRTXVZNYEIWGAKMUSQO V',
  ].join('\n');

  it('reproduces the Enigma vector when it is wired as one', async () => {
    expect(
      await run('A'.repeat(25), [
        'typex',
        {
          Rotors: ENIGMA_ROTORS,
          'Ring settings': 'AAA',
          'Rotor positions': 'AAA',
          'Stepping rotors': 3,
        },
      ]),
    ).toBe('BDZGOWCXLTKSBTMCDLPBMUQOF');
  });

  it('holds the left-hand rotors still, the way a Typex does', async () => {
    const five = [
      'MCYLPQUVRXGSAOWNBJEZDTFKHI',
      'KHWENRCBISXJQGOFMAPVYZDLTU',
      'BDFHJLCPRTXVZNYEIWGAKMUSQO V',
      'AJDKSIRUXBLHWTMCQGZNPYFVOE E',
      'EKMFLGDQVZNTOWYHXUSPAIBRCJ Q',
    ].join('\n');
    const settings = {
      Rotors: five,
      'Ring settings': 'AAAAA',
      'Rotor positions': 'AAAAA',
      'Stepping rotors': 3,
    };

    const plain = 'THEQUICKBROWNFOX';
    const cipher = await run(plain, ['typex', settings]);
    expect(cipher).not.toBe(plain);
    expect(await run(cipher, ['typex', settings])).toBe(plain);

    const moved = await run(plain, [
      'typex',
      { ...settings, 'Rotor positions': 'BAAAA' },
    ]);
    expect(moved).not.toBe(cipher);
  });

  it('refuses a reflector that is not reciprocal', async () => {
    const result = await bake(
      'AAA',
      recipe([
        'typex',
        {
          Rotors: ENIGMA_ROTORS,
          Reflector: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
          'Ring settings': 'AAA',
          'Rotor positions': 'AAA',
        },
      ]),
    );
    expect(result.error?.message).toMatch(/maps A to itself/);
  });

  it('refuses a wiring that is not a permutation', async () => {
    const result = await bake(
      'AAA',
      recipe([
        'typex',
        { Rotors: 'AAKMFLGDQVZNTOWYHXUSPAIBRC', 'Ring settings': 'A', 'Rotor positions': 'A' },
      ]),
    );
    expect(result.error?.message).toMatch(/uses a letter twice/);
  });

  it('says so when no rotors were given at all', async () => {
    const result = await bake('AAA', recipe('typex'));
    expect(result.error?.message).toMatch(/No rotors were given/);
  });
});

describe('Bombe', () => {
  const SETTINGS = { 'Ring settings': 'AAA', 'Rotor positions': 'ABC', Plugboard: 'AB CD EF' };
  const PLAIN = 'WETTERVORHERSAGEBISKAYABEDECKTREGEN';
  const CRIB = 'WETTERVORHERSAGE';

  it('recovers the rotor position from a crib', async () => {
    const cipher = await run(PLAIN, ['enigma', SETTINGS]);
    const report = await run(cipher, [
      'bombe',
      { 'Rotor order': 'I II III', Crib: CRIB, 'Crib offset': 0 },
    ]);

    expect(report).toMatch(/^1 stops/);
    expect(report).toContain('I II III');
    expect(report).toContain('ABC');
  }, 60000);

  it('deduces plugboard pairs at the stop', async () => {
    const cipher = await run(PLAIN, ['enigma', SETTINGS]);
    const report = await run(cipher, ['bombe', { 'Rotor order': 'I II III', Crib: CRIB }]);
    expect(report).toContain('AB');
    expect(report).toContain('EF');
  }, 60000);

  it('finds nothing when the rotor order is wrong', async () => {
    const cipher = await run(PLAIN, ['enigma', SETTINGS]);
    const report = await run(cipher, [
      'bombe',
      { 'Rotor order': 'III II I', Crib: CRIB, 'Crib offset': 0 },
    ]);
    expect(report).toMatch(/No stops|stops in/);
  }, 60000);

  it('picks the right order out of several', async () => {
    const cipher = await run(PLAIN, ['enigma', SETTINGS]);
    const report = await run(cipher, [
      'multiple-bombe',
      { 'Rotor orders': 'III II I\nI II III', Crib: CRIB },
    ]);
    expect(report).toContain('I II III    ABC');
  }, 120000);

  it('refuses a crib that would encipher a letter to itself', async () => {
    const result = await bake('ABCDEF', recipe(['bombe', { Crib: 'AXX' }]));
    expect(result.error?.message).toMatch(/encipher 'A' to itself/);
  });

  it('refuses a crib longer than the message', async () => {
    const result = await bake('XYZ', recipe(['bombe', { Crib: 'LONGERTHANTHAT' }]));
    expect(result.error?.message).toMatch(/runs past the end/);
  });

  it('refuses a rotor order that is not one', async () => {
    for (const [order, message] of [
      ['I II', /three rotors are needed/],
      ['I II IX', /no rotor called 'IX'/],
      ['I I II', /same rotor twice/],
    ] as Array<[string, RegExp]>) {
      const result = await bake('ABCDEF', recipe(['bombe', { 'Rotor order': order, Crib: 'BC' }]));
      expect(result.error?.message, order).toMatch(message);
    }
  });
});
