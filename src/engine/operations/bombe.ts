import { OperationError } from '../types';
import { arg, type Operation } from './types';
import { ROTORS, REFLECTORS, makeRotor, through, type Rotor } from './enigma';


const A = 'A'.charCodeAt(0);
const POSITIONS = 26 * 26 * 26;

interface Tables {
  perm: Uint8Array;
  next: Uint16Array;
}

function buildTables(names: string[], rings: string, reflectorName: string): Tables {
  const wiring = REFLECTORS[reflectorName];
  if (!wiring) throw new OperationError(`There is no reflector called '${reflectorName}'.`);
  const reflector = Array.from(wiring, (c) => c.charCodeAt(0) - A);

  const notches = names.map((name) => {
    const spec = ROTORS[name];
    if (!spec) throw new OperationError(`There is no rotor called '${name}'.`);
    return Array.from(spec.notches, (c) => c.charCodeAt(0) - A);
  });

  const perm = new Uint8Array(POSITIONS * 26);
  const next = new Uint16Array(POSITIONS);
  const rotors: Rotor[] = names.map((name, i) => makeRotor(name, rings[i]!, 'A'));

  for (let index = 0; index < POSITIONS; index++) {
    const left = Math.floor(index / 676);
    const middle = Math.floor(index / 26) % 26;
    const right = index % 26;
    rotors[0]!.position = left;
    rotors[1]!.position = middle;
    rotors[2]!.position = right;

    const base = index * 26;
    for (let c = 0; c < 26; c++) {
      let signal = c;
      for (let i = 2; i >= 0; i--) signal = through(rotors[i]!, signal, false);
      signal = reflector[signal]!;
      for (let i = 0; i < 3; i++) signal = through(rotors[i]!, signal, true);
      perm[base + c] = signal;
    }

    const rightOnNotch = notches[2]!.includes(right);
    const middleOnNotch = notches[1]!.includes(middle);
    const nextRight = (right + 1) % 26;
    const nextMiddle = rightOnNotch || middleOnNotch ? (middle + 1) % 26 : middle;
    const nextLeft = middleOnNotch ? (left + 1) % 26 : left;
    next[index] = nextLeft * 676 + nextMiddle * 26 + nextRight;
  }

  return { perm, next };
}

interface Menu {
  edges: Array<{ from: number; to: number; at: number }>;
  test: number;
  span: number;
}

function buildMenu(crib: string, cipher: string, offset: number): Menu {
  const plain = crib.toUpperCase().replace(/[^A-Z]/g, '');
  const text = cipher.toUpperCase().replace(/[^A-Z]/g, '');

  if (plain.length === 0) throw new OperationError('The crib is empty.');
  if (offset < 0 || offset + plain.length > text.length) {
    throw new OperationError(
      `A ${plain.length}-letter crib at offset ${offset} runs past the end of ${text.length} letters of ciphertext.`,
    );
  }

  const edges: Menu['edges'] = [];
  const degree = new Array<number>(26).fill(0);

  for (let i = 0; i < plain.length; i++) {
    const from = plain.charCodeAt(i) - A;
    const to = text.charCodeAt(offset + i) - A;
    if (from === to) {
      throw new OperationError(
        `The crib cannot sit here: position ${offset + i + 1} would encipher ` +
          `'${plain[i]}' to itself, which Enigma never does.`,
      );
    }
    edges.push({ from, to, at: offset + i });
    degree[from]!++;
    degree[to]!++;
  }

  let test = 0;
  for (let c = 1; c < 26; c++) if (degree[c]! > degree[test]!) test = c;

  return { edges, test, span: offset + plain.length };
}

function letters(index: number): string {
  return (
    String.fromCharCode(Math.floor(index / 676) + A) +
    String.fromCharCode((Math.floor(index / 26) % 26) + A) +
    String.fromCharCode((index % 26) + A)
  );
}

interface Stop {
  start: number;
  steckers: string[];
  live: number;
}

function search(tables: Tables, menu: Menu, limit: number): Stop[] {
  const stops: Stop[] = [];
  const live = new Uint8Array(676);
  const stack = new Uint16Array(676);
  const scramblers = new Int32Array(menu.span);

  for (let start = 0; start < POSITIONS; start++) {
    let index = start;
    for (let i = 0; i < menu.span; i++) {
      index = tables.next[index]!;
      scramblers[i] = index * 26;
    }

    live.fill(0);
    let top = 0;
    stack[top++] = menu.test * 26 + menu.test;
    let testWires = 0;

    while (top > 0) {
      const wire = stack[--top]!;
      if (live[wire]) continue;
      live[wire] = 1;

      const node = Math.floor(wire / 26);
      const value = wire % 26;
      if (node === menu.test && ++testWires === 26) break;

      if (!live[value * 26 + node]) stack[top++] = value * 26 + node;

      for (const edge of menu.edges) {
        if (edge.from === node) {
          const out = tables.perm[scramblers[edge.at]! + value]!;
          if (!live[edge.to * 26 + out]) stack[top++] = edge.to * 26 + out;
        }
        if (edge.to === node) {
          const out = tables.perm[scramblers[edge.at]! + value]!;
          if (!live[edge.from * 26 + out]) stack[top++] = edge.from * 26 + out;
        }
      }
    }

    if (testWires === 26) continue;

    const wanted = testWires === 1 ? 1 : testWires === 25 ? 0 : -1;
    const steckers: string[] = [];

    if (wanted >= 0) {
      for (let node = 0; node < 26; node++) {
        let found = -1;
        let count = 0;
        for (let v = 0; v < 26; v++) {
          if (live[node * 26 + v] === wanted) {
            found = v;
            count++;
          }
        }
        if (count === 1 && found >= node) {
          steckers.push(
            found === node
              ? `${String.fromCharCode(node + A)}(unsteckered)`
              : `${String.fromCharCode(node + A)}${String.fromCharCode(found + A)}`,
          );
        }
      }
    }

    stops.push({ start, steckers, live: testWires });
    if (stops.length >= limit) break;
  }

  return stops;
}

const ROTOR_LIST = Object.keys(ROTORS).filter((name) => name !== 'Beta' && name !== 'Gamma');

function orders(text: string): string[][] {
  const out: string[][] = [];
  for (const line of text.split(/[\r\n,;]+/)) {
    const names = line.trim().split(/[\s-]+/).filter((n) => n.length > 0);
    if (names.length === 0) continue;
    if (names.length !== 3) {
      throw new OperationError(`'${line.trim()}' is not a rotor order: three rotors are needed.`);
    }
    for (const name of names) {
      if (!ROTOR_LIST.includes(name)) throw new OperationError(`There is no rotor called '${name}'.`);
    }
    if (new Set(names).size !== 3) {
      throw new OperationError(`'${line.trim()}' uses the same rotor twice.`);
    }
    out.push(names);
  }
  if (out.length === 0) throw new OperationError('No rotor orders were given.');
  return out;
}

function report(found: Array<{ order: string[]; stop: Stop }>, scanned: number, limit: number): string {
  if (found.length === 0) {
    return [
      `No stops in ${scanned.toLocaleString()} rotor positions.`,
      '',
      'Either the crib does not belong under this part of the message, or the',
      'rotor order is wrong. Try another offset or another order.',
    ].join('\n');
  }

  const lines = [
    `${found.length}${found.length >= limit ? '+' : ''} stops in ${scanned.toLocaleString()} rotor positions.`,
    '',
    'Rotors      Position  Register  Steckers deduced',
  ];
  for (const { order, stop } of found) {
    lines.push(
      `${order.join(' ').padEnd(11)} ${letters(stop.start).padEnd(9)} ${`${stop.live}/26`.padEnd(9)} ${
        stop.steckers.join(' ') || '(none forced)'
      }`,
    );
  }
  lines.push(
    '',
    'A stop is a position the crib does not contradict, not a solution: decipher',
    'the message at each one and read which is German.',
  );
  return lines.join('\n');
}

function bombe(input: string, args: Parameters<Operation['run']>[1], rotorOrders: string[][]): string {
  const crib = String(arg(args, 'Crib', ''));
  const offset = Number(arg(args, 'Crib offset', 0));
  const rings = String(arg(args, 'Ring settings', 'AAA')).replace(/\s+/g, '').toUpperCase();
  const reflector = String(arg(args, 'Reflector', 'B'));
  const limit = Math.max(1, Number(arg(args, 'Maximum stops', 40)));

  if (!/^[A-Z]{3}$/.test(rings)) throw new OperationError('Ring settings are three letters A-Z.');

  const menu = buildMenu(crib, input, offset);
  const found: Array<{ order: string[]; stop: Stop }> = [];

  for (const order of rotorOrders) {
    const tables = buildTables(order, rings, reflector);
    for (const stop of search(tables, menu, limit - found.length)) {
      found.push({ order, stop });
    }
    if (found.length >= limit) break;
  }

  return report(found, POSITIONS * rotorOrders.length, limit);
}

const SHARED_ARGS = [
  { name: 'Crib', type: 'string' as const, value: '', hint: 'Plaintext you believe is in the message' },
  { name: 'Crib offset', type: 'number' as const, value: 0, min: 0, max: 500 },
  { name: 'Reflector', type: 'option' as const, value: 'B', options: ['B', 'C', 'A'] },
  { name: 'Ring settings', type: 'string' as const, value: 'AAA' },
  { name: 'Maximum stops', type: 'number' as const, value: 40, min: 1, max: 500 },
];

export const bombeOperations: Operation[] = [
  {
    id: 'bombe',
    name: 'Bombe',
    category: 'Encryption / Encoding',
    description:
      'Attacks an Enigma message from a crib, reporting the rotor positions the crib does not contradict.',
    aliases: ['enigma attack', 'crib drag', 'turing', 'welchman'],
    budgetMs: 60000,
    args: [
      {
        name: 'Rotor order',
        type: 'string',
        value: 'I II III',
        hint: 'Left to right, e.g. II V III',
      },
      ...SHARED_ARGS,
    ],
    run: (input, args) => bombe(input, args, orders(String(arg(args, 'Rotor order', '')))),
  },
  {
    id: 'multiple-bombe',
    name: 'Multiple Bombe',
    category: 'Encryption / Encoding',
    description: 'Runs the Bombe over several rotor orders, one per line.',
    aliases: ['bombe run', 'enigma attack all rotors'],
    budgetMs: 240000,
    args: [
      {
        name: 'Rotor orders',
        type: 'textarea',
        value: 'I II III\nI III II\nII I III\nII III I\nIII I II\nIII II I',
        hint: 'One order per line',
      },
      ...SHARED_ARGS,
    ],
    run: (input, args) => bombe(input, args, orders(String(arg(args, 'Rotor orders', '')))),
  },
];
