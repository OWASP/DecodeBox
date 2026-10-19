import { OperationError } from '../types';
import { arg, type Operation } from './types';


const A = 'A'.charCodeAt(0);

const ROTORS: Record<string, { wiring: string; notches: string }> = {
  I: { wiring: 'EKMFLGDQVZNTOWYHXUSPAIBRCJ', notches: 'Q' },
  II: { wiring: 'AJDKSIRUXBLHWTMCQGZNPYFVOE', notches: 'E' },
  III: { wiring: 'BDFHJLCPRTXVZNYEIWGAKMUSQO', notches: 'V' },
  IV: { wiring: 'ESOVPZJAYQUIRHXLNFTGKDCMWB', notches: 'J' },
  V: { wiring: 'VZBRGITYUPSDNHLXAWMJQOFECK', notches: 'Z' },
  VI: { wiring: 'JPGVOUMFYQBENHZRDKASXLICTW', notches: 'ZM' },
  VII: { wiring: 'NZJHGRCXMYSWBOUFAIVLPEKQDT', notches: 'ZM' },
  VIII: { wiring: 'FKQHTLXOCBJSPDZRAMEWNIUYGV', notches: 'ZM' },
  Beta: { wiring: 'LEYJVCNIXWPBQMDRTAKZGFUHOS', notches: '' },
  Gamma: { wiring: 'FSOKANUERHMBTIYCWLQPZXVGJD', notches: '' },
};

const REFLECTORS: Record<string, string> = {
  A: 'EJMZALYXVBWFCRQUONTSPIKHGD',
  B: 'YRUHQSLDPXNGOKMIEBFZCWVJAT',
  C: 'FVPJIAOYEDRZXWGCTKUQSBNMHL',
  'B thin': 'ENKQAUYWJICOPBLMDXZVFTHRGS',
  'C thin': 'RDOBJNTKVEHMLFCWZAXGYIPSUQ',
};

interface Rotor {
  forward: number[];
  backward: number[];
  notches: number[];
  ring: number;
  position: number;
}

function letter(value: string, what: string): number {
  const upper = value.trim().toUpperCase();
  if (!/^[A-Z]$/.test(upper)) throw new OperationError(`${what} must be a single letter A-Z.`);
  return upper.charCodeAt(0) - A;
}

function makeRotor(name: string, ring: string, position: string): Rotor {
  const spec = ROTORS[name];
  if (!spec) throw new OperationError(`There is no rotor called '${name}'.`);

  const forward = Array.from(spec.wiring, (c) => c.charCodeAt(0) - A);
  const backward = new Array<number>(26);
  forward.forEach((to, from) => {
    backward[to] = from;
  });

  return {
    forward,
    backward,
    notches: Array.from(spec.notches, (c) => c.charCodeAt(0) - A),
    ring: letter(ring, 'A ring setting'),
    position: letter(position, 'A rotor position'),
  };
}

function makePlugboard(text: string): number[] {
  const board = Array.from({ length: 26 }, (_, i) => i);
  const pairs = text.toUpperCase().match(/[A-Z]{2}/g) ?? [];
  const stripped = text.toUpperCase().replace(/[^A-Z]/g, '');

  if (stripped.length % 2 !== 0) {
    throw new OperationError('The plugboard needs letters in pairs; one is left over.');
  }
  for (const pair of pairs) {
    const a = pair.charCodeAt(0) - A;
    const b = pair.charCodeAt(1) - A;
    if (a === b) throw new OperationError(`A plug cannot join '${pair[0]}' to itself.`);
    if (board[a] !== a || board[b] !== b) {
      throw new OperationError(`'${pair}' uses a letter that is already plugged.`);
    }
    board[a] = b;
    board[b] = a;
  }
  return board;
}

function step(rotors: Rotor[]): void {
  const right = rotors[rotors.length - 1]!;
  const middle = rotors[rotors.length - 2];
  const left = rotors[rotors.length - 3];

  const onNotch = (rotor: Rotor | undefined): boolean =>
    rotor !== undefined && rotor.notches.includes(rotor.position);

  const middleSteps = onNotch(right) || onNotch(middle);
  const leftSteps = onNotch(middle);

  right.position = (right.position + 1) % 26;
  if (middle && middleSteps) middle.position = (middle.position + 1) % 26;
  if (left && leftSteps) left.position = (left.position + 1) % 26;
}

function through(rotor: Rotor, signal: number, reverse: boolean): number {
  const shift = rotor.position - rotor.ring;
  const entry = (((signal + shift) % 26) + 26) % 26;
  const wired = reverse ? rotor.backward[entry]! : rotor.forward[entry]!;
  return (((wired - shift) % 26) + 26) % 26;
}

function encipher(
  text: string,
  rotors: Rotor[],
  reflector: number[],
  plugboard: number[],
  keepOthers: boolean,
): string {
  let out = '';
  for (const character of text) {
    const upper = character.toUpperCase();
    if (upper < 'A' || upper > 'Z') {
      if (keepOthers) out += character;
      continue;
    }

    step(rotors);

    let signal = plugboard[upper.charCodeAt(0) - A]!;
    for (let i = rotors.length - 1; i >= 0; i--) signal = through(rotors[i]!, signal, false);
    signal = reflector[signal]!;
    for (let i = 0; i < rotors.length; i++) signal = through(rotors[i]!, signal, true);
    signal = plugboard[signal]!;

    out += String.fromCharCode(signal + A);
  }
  return out;
}

const ROTOR_NAMES = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export const enigmaOperations: Operation[] = [
  {
    id: 'enigma',
    name: 'Enigma',
    category: 'Encryption / Encoding',
    description:
      'The Enigma machine: three or four rotors, a reflector and a plugboard. Enciphering twice with the same settings returns the plaintext.',
    aliases: ['enigma machine', 'wehrmacht', 'kriegsmarine', 'm3', 'm4', 'rotor machine'],
    args: [
      {
        name: 'Model',
        type: 'option',
        value: '3-rotor (Enigma I / M3)',
        options: ['3-rotor (Enigma I / M3)', '4-rotor (M4)'],
      },
      { name: 'Fourth rotor', type: 'option', value: 'Beta', options: ['Beta', 'Gamma'] },
      { name: 'Left rotor', type: 'option', value: 'I', options: ROTOR_NAMES },
      { name: 'Middle rotor', type: 'option', value: 'II', options: ROTOR_NAMES },
      { name: 'Right rotor', type: 'option', value: 'III', options: ROTOR_NAMES },
      {
        name: 'Reflector',
        type: 'option',
        value: 'B',
        options: ['B', 'C', 'A', 'B thin', 'C thin'],
      },
      { name: 'Ring settings', type: 'string', value: 'AAA', hint: 'One letter per rotor, left to right' },
      { name: 'Rotor positions', type: 'string', value: 'AAA', hint: 'One letter per rotor, left to right' },
      { name: 'Plugboard', type: 'string', value: '', hint: 'Pairs, e.g. AM FI NV PS TU WZ' },
      { name: 'Keep other characters', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const fourRotors = String(arg(args, 'Model', '')).startsWith('4');
      const count = fourRotors ? 4 : 3;

      const rings = String(arg(args, 'Ring settings', 'AAA')).replace(/\s+/g, '');
      const positions = String(arg(args, 'Rotor positions', 'AAA')).replace(/\s+/g, '');
      if (rings.length !== count || positions.length !== count) {
        throw new OperationError(
          `This model has ${count} rotors, so it needs ${count} ring settings and ${count} positions.`,
        );
      }

      const names = [
        String(arg(args, 'Left rotor', 'I')),
        String(arg(args, 'Middle rotor', 'II')),
        String(arg(args, 'Right rotor', 'III')),
      ];
      if (fourRotors) names.unshift(String(arg(args, 'Fourth rotor', 'Beta')));

      const rotors = names.map((name, i) => makeRotor(name, rings[i]!, positions[i]!));

      const reflectorName = String(arg(args, 'Reflector', 'B'));
      const wiring = REFLECTORS[reflectorName];
      if (!wiring) throw new OperationError(`There is no reflector called '${reflectorName}'.`);
      if (fourRotors && !reflectorName.endsWith('thin')) {
        throw new OperationError(
          'A four-rotor M4 uses a thin reflector: choose B thin or C thin, which is what makes room for the fourth rotor.',
        );
      }
      const reflector = Array.from(wiring, (c) => c.charCodeAt(0) - A);

      return encipher(
        input,
        rotors,
        reflector,
        makePlugboard(String(arg(args, 'Plugboard', ''))),
        Boolean(arg(args, 'Keep other characters', false)),
      );
    },
  },
];

export { ROTORS, REFLECTORS, makeRotor, makePlugboard, step, through, encipher, ROTOR_NAMES };
export type { Rotor };
