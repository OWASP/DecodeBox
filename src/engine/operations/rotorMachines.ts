import { OperationError } from '../types';
import { arg, type Operation } from './types';
import { makePlugboard, step, through, type Rotor } from './enigma';


const A = 'A'.charCodeAt(0);

interface Wiring {
  wiring: string;
  notches: string;
}

function parseRotors(text: string): Wiring[] {
  const rotors: Wiring[] = [];

  for (const raw of text.split(/[\r\n]+/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const parts = line.split(/[\s,;|]+/).filter((p) => p.length > 0);
    const wiring = (parts[0] ?? '').toUpperCase();
    const notches = (parts[1] ?? '').toUpperCase();

    if (wiring.length !== 26 || !/^[A-Z]{26}$/.test(wiring)) {
      throw new OperationError(`'${line}' is not a rotor: a wiring is 26 letters A-Z.`);
    }
    if (new Set(wiring).size !== 26) {
      throw new OperationError(`The wiring '${wiring}' uses a letter twice, so it is not a rotor.`);
    }
    if (notches.length > 0 && !/^[A-Z]+$/.test(notches)) {
      throw new OperationError(`'${notches}' is not a list of notch letters.`);
    }
    rotors.push({ wiring, notches });
  }

  if (rotors.length === 0) throw new OperationError('No rotors were given.');
  return rotors;
}

function buildRotor(spec: Wiring, ring: string, position: string): Rotor {
  const forward = Array.from(spec.wiring, (c) => c.charCodeAt(0) - A);
  const backward = new Array<number>(26);
  forward.forEach((to, from) => {
    backward[to] = from;
  });
  return {
    forward,
    backward,
    notches: Array.from(spec.notches, (c) => c.charCodeAt(0) - A),
    ring: ring.charCodeAt(0) - A,
    position: position.charCodeAt(0) - A,
  };
}

function parseReflector(text: string): number[] {
  const wiring = text.trim().toUpperCase().replace(/\s+/g, '');
  if (wiring.length !== 26 || !/^[A-Z]{26}$/.test(wiring)) {
    throw new OperationError('The reflector wiring must be 26 letters A-Z.');
  }
  const map = Array.from(wiring, (c) => c.charCodeAt(0) - A);
  for (let i = 0; i < 26; i++) {
    if (map[map[i]!] !== i) {
      throw new OperationError(
        `The reflector wiring is not reciprocal: ${String.fromCharCode(i + A)} goes to ` +
          `${String.fromCharCode(map[i]! + A)}, which does not come back.`,
      );
    }
    if (map[i] === i) {
      throw new OperationError(
        `The reflector maps ${String.fromCharCode(i + A)} to itself, which no reflector can do.`,
      );
    }
  }
  return map;
}

const DEFAULT_REFLECTOR = 'YRUHQSLDPXNGOKMIEBFZCWVJAT';

export const rotorMachineOperations: Operation[] = [
  {
    id: 'typex',
    name: 'Typex',
    category: 'Encryption / Encoding',
    description:
      'A five-rotor Typex, or any Enigma-style rotor machine: you supply the wirings, notches and reflector.',
    aliases: ['type x', 'rotor machine', 'custom enigma', 'mark ii'],
    args: [
      {
        name: 'Rotors',
        type: 'textarea',
        value: '',
        hint: 'One per line, left to right: 26-letter wiring, then the notch letters',
      },
      { name: 'Reflector', type: 'string', value: DEFAULT_REFLECTOR },
      { name: 'Ring settings', type: 'string', value: 'AAAAA' },
      { name: 'Rotor positions', type: 'string', value: 'AAAAA' },
      { name: 'Input plugboard', type: 'string', value: '', hint: 'Pairs, e.g. AB CD' },
      {
        name: 'Stepping rotors',
        type: 'number',
        value: 3,
        min: 1,
        max: 8,
        hint: 'How many of the rightmost rotors turn; a Typex steps three of five',
      },
      { name: 'Keep other characters', type: 'boolean', value: false },
    ],
    run: (input, args) => {
      const specs = parseRotors(String(arg(args, 'Rotors', '')));
      const rings = String(arg(args, 'Ring settings', '')).replace(/\s+/g, '').toUpperCase();
      const positions = String(arg(args, 'Rotor positions', '')).replace(/\s+/g, '').toUpperCase();

      if (rings.length !== specs.length || positions.length !== specs.length) {
        throw new OperationError(
          `${specs.length} rotors need ${specs.length} ring settings and ${specs.length} positions.`,
        );
      }
      if (!/^[A-Z]*$/.test(rings + positions)) {
        throw new OperationError('Ring settings and rotor positions are letters A-Z.');
      }

      const rotors = specs.map((spec, i) => buildRotor(spec, rings[i]!, positions[i]!));
      const reflector = parseReflector(String(arg(args, 'Reflector', DEFAULT_REFLECTOR)));
      const plugboard = makePlugboard(String(arg(args, 'Input plugboard', '')));

      const moving = Math.min(Number(arg(args, 'Stepping rotors', 3)), rotors.length);
      const keepOthers = Boolean(arg(args, 'Keep other characters', false));
      const stepping = rotors.slice(rotors.length - moving);

      let out = '';
      for (const character of input) {
        const upper = character.toUpperCase();
        if (upper < 'A' || upper > 'Z') {
          if (keepOthers) out += character;
          continue;
        }

        step(stepping);

        let signal = plugboard[upper.charCodeAt(0) - A]!;
        for (let i = rotors.length - 1; i >= 0; i--) signal = through(rotors[i]!, signal, false);
        signal = reflector[signal]!;
        for (let i = 0; i < rotors.length; i++) signal = through(rotors[i]!, signal, true);
        signal = plugboard[signal]!;

        out += String.fromCharCode(signal + A);
      }
      return out;
    },
  },
];
