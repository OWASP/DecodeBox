import { OperationError } from '../types';
import type { BlockCipher } from './blockModes';


const { SBOX, INVERSE_SBOX } = (() => {
  const sbox = new Uint8Array(256);
  const inverse = new Uint8Array(256);

  let p = 1;
  let q = 1;
  do {
    p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;

    const value = (q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^ ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4))) & 0xff;
    sbox[p] = value ^ 0x63;
  } while (p !== 1);
  sbox[0] = 0x63;

  for (let i = 0; i < 256; i++) inverse[sbox[i] as number] = i;
  return { SBOX: sbox, INVERSE_SBOX: inverse };
})();

function gmul(a: number, b: number): number {
  let result = 0;
  let x = a;
  let y = b;
  for (let i = 0; i < 8; i++) {
    if (y & 1) result ^= x;
    const high = x & 0x80;
    x = (x << 1) & 0xff;
    if (high) x ^= 0x1b;
    y >>= 1;
  }
  return result;
}

const RCON = (() => {
  const values = new Uint8Array(15);
  let value = 1;
  for (let i = 1; i < 15; i++) {
    values[i] = value;
    value = gmul(value, 2);
  }
  return values;
})();

function expandKey(key: Uint8Array): Uint8Array[] {
  const words = key.length / 4;
  const rounds = words + 6;
  const schedule = new Uint8Array(16 * (rounds + 1));
  schedule.set(key);

  for (let i = words; i < 4 * (rounds + 1); i++) {
    const previous = schedule.subarray((i - 1) * 4, i * 4);
    const temp = new Uint8Array(previous);

    if (i % words === 0) {
      const first = temp[0] as number;
      temp[0] = (SBOX[temp[1] as number] as number) ^ (RCON[i / words] as number);
      temp[1] = SBOX[temp[2] as number] as number;
      temp[2] = SBOX[temp[3] as number] as number;
      temp[3] = SBOX[first] as number;
    } else if (words > 6 && i % words === 4) {
      for (let j = 0; j < 4; j++) temp[j] = SBOX[temp[j] as number] as number;
    }

    for (let j = 0; j < 4; j++) {
      schedule[i * 4 + j] = (schedule[(i - words) * 4 + j] as number) ^ (temp[j] as number);
    }
  }

  return Array.from({ length: rounds + 1 }, (_, round) =>
    schedule.subarray(round * 16, round * 16 + 16),
  );
}

export function aes(key: Uint8Array): BlockCipher {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new OperationError(`AES takes a 16, 24 or 32-byte key; this one is ${key.length}.`);
  }
  const roundKeys = expandKey(key);
  const rounds = roundKeys.length - 1;

  const addRoundKey = (state: Uint8Array, round: number) => {
    const roundKey = roundKeys[round] as Uint8Array;
    for (let i = 0; i < 16; i++) state[i] = (state[i] as number) ^ (roundKey[i] as number);
  };

  const shiftRows = (state: Uint8Array, inverse: boolean) => {
    const copy = new Uint8Array(state);
    for (let row = 1; row < 4; row++) {
      for (let column = 0; column < 4; column++) {
        const from = inverse ? (column - row + 4) % 4 : (column + row) % 4;
        state[column * 4 + row] = copy[from * 4 + row] as number;
      }
    }
  };

  const mixColumns = (state: Uint8Array, inverse: boolean) => {
    const matrix = inverse ? [14, 11, 13, 9] : [2, 3, 1, 1];
    for (let column = 0; column < 4; column++) {
      const a = state.subarray(column * 4, column * 4 + 4);
      const copy = new Uint8Array(a);
      for (let row = 0; row < 4; row++) {
        let value = 0;
        for (let i = 0; i < 4; i++) {
          value ^= gmul(copy[(row + i) % 4] as number, matrix[i] as number);
        }
        a[row] = value;
      }
    }
  };

  return {
    blockSize: 16,
    encryptBlock(block) {
      const state = new Uint8Array(block);
      addRoundKey(state, 0);
      for (let round = 1; round <= rounds; round++) {
        for (let i = 0; i < 16; i++) state[i] = SBOX[state[i] as number] as number;
        shiftRows(state, false);
        if (round !== rounds) mixColumns(state, false);
        addRoundKey(state, round);
      }
      return state;
    },
    decryptBlock(block) {
      const state = new Uint8Array(block);
      addRoundKey(state, rounds);
      for (let round = rounds - 1; round >= 0; round--) {
        shiftRows(state, true);
        for (let i = 0; i < 16; i++) state[i] = INVERSE_SBOX[state[i] as number] as number;
        addRoundKey(state, round);
        if (round !== 0) mixColumns(state, true);
      }
      return state;
    },
  };
}
