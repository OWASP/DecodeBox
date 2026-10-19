
const ENGLISH = [
  0.08167, 0.01492, 0.02782, 0.04253, 0.12702, 0.02228, 0.02015, 0.06094, 0.06966, 0.00153,
  0.00772, 0.04025, 0.02406, 0.06749, 0.07507, 0.01929, 0.00095, 0.05987, 0.06327, 0.09056,
  0.02758, 0.00978, 0.02360, 0.0015, 0.01974, 0.00074,
] as const;

export const ENGLISH_IC = 0.0667;
export const RANDOM_IC = 1 / 26;

export function letters(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 65 && code <= 90) out[n++] = code - 65;
    else if (code >= 97 && code <= 122) out[n++] = code - 97;
  }
  return out.subarray(0, n);
}

export function indexOfCoincidence(values: Uint8Array): number {
  if (values.length < 2) return 0;
  const counts = new Array<number>(26).fill(0);
  for (const value of values) counts[value]! += 1;

  let sum = 0;
  for (const count of counts) sum += count * (count - 1);
  return sum / (values.length * (values.length - 1));
}

function chiSquared(counts: number[], total: number, shift: number): number {
  let score = 0;
  for (let i = 0; i < 26; i++) {
    const expected = total * ENGLISH[(i + shift) % 26]!;
    const difference = counts[i]! - expected;
    score += expected === 0 ? 0 : (difference * difference) / expected;
  }
  return score;
}

function bestShift(values: Uint8Array): { shift: number; score: number } {
  const counts = new Array<number>(26).fill(0);
  for (const value of values) counts[value]! += 1;

  let shift = 0;
  let score = Infinity;
  for (let candidate = 0; candidate < 26; candidate++) {
    const fit = chiSquared(counts, values.length, candidate);
    if (fit < score) {
      score = fit;
      shift = candidate;
    }
  }
  return { shift, score };
}

const NOT_CLASSICAL = new Set('0123456789+/=@#$%^&*|<>~`\\');

const FOREIGN_LIMIT = 0.01;

export function isAlphabetic(text: string): boolean {
  const sample = text.slice(0, 4096);
  if (sample.length === 0) return false;

  let alpha = 0;
  let other = 0;
  let foreign = 0;
  for (let i = 0; i < sample.length; i++) {
    const char = sample[i]!;
    const code = sample.charCodeAt(i);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) alpha++;
    else if (code !== 32 && code !== 10 && code !== 13 && code !== 9) {
      other++;
      if (NOT_CLASSICAL.has(char)) foreign++;
    }
  }

  if (foreign / sample.length > FOREIGN_LIMIT) return false;
  return alpha >= 40 && alpha > other * 3;
}

export interface CaesarGuess {
  shift: number;
  ic: number;
  fit: number;
}

export function caesarShift(text: string): CaesarGuess | null {
  if (!isAlphabetic(text)) return null;
  const values = letters(text);
  if (values.length < 40) return null;

  const ic = indexOfCoincidence(values);
  if (ic < 0.055) return null;

  const { shift, score } = bestShift(values);
  if (shift === 0) return null;
  return { shift, ic, fit: score / values.length };
}

export interface VigenereGuess {
  key: string;
  keyLength: number;
  ic: number;
  columnIc: number;
}

const MAX_KEY_LENGTH = 16;

export function vigenereKey(text: string): VigenereGuess | null {
  if (!isAlphabetic(text)) return null;
  const values = letters(text);
  if (values.length < 100) return null;

  const ic = indexOfCoincidence(values);
  if (ic > 0.058) return null;

  let bestLength = 0;
  let bestColumnIc = 0;

  for (let length = 2; length <= MAX_KEY_LENGTH; length++) {
    if (values.length / length < 20) break;

    let total = 0;
    for (let offset = 0; offset < length; offset++) {
      const column = new Uint8Array(Math.ceil((values.length - offset) / length));
      let n = 0;
      for (let i = offset; i < values.length; i += length) column[n++] = values[i]!;
      total += indexOfCoincidence(column.subarray(0, n));
    }

    const average = total / length;
    if (average > bestColumnIc + 0.005) {
      bestColumnIc = average;
      bestLength = length;
    }
  }

  if (bestLength === 0 || bestColumnIc < 0.055) return null;

  let key = '';
  for (let offset = 0; offset < bestLength; offset++) {
    const column = new Uint8Array(Math.ceil((values.length - offset) / bestLength));
    let n = 0;
    for (let i = offset; i < values.length; i += bestLength) column[n++] = values[i]!;
    key += String.fromCharCode(65 + ((26 - bestShift(column.subarray(0, n)).shift) % 26));
  }

  return { key, keyLength: bestLength, ic, columnIc: bestColumnIc };
}
