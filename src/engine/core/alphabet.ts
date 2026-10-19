import { OperationError } from '../types';


export function expandAlphabet(spec: string): string {
  const source = spec.replace(/\[space\]/gi, ' ');
  let out = '';

  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\' && i + 1 < source.length) {
      out += source[i + 1];
      i += 1;
      continue;
    }

    const isRange = source[i + 1] === '-' && i + 2 < source.length && source[i + 2] !== '\\';
    if (!isRange) {
      out += source[i];
      continue;
    }
    const from = source.charCodeAt(i);
    const to = source.charCodeAt(i + 2);
    if (to < from) throw new OperationError(`'${source[i]}-${source[i + 2]}' is not a range.`);
    for (let code = from; code <= to; code++) out += String.fromCharCode(code);
    i += 2;
  }

  return out;
}

interface Alphabet {
  chars: string;
  pad: string | null;
}

export function readAlphabet(spec: string, expected = 64): Alphabet {
  const chars = expandAlphabet(spec);

  if (chars.length === expected) return { chars, pad: null };
  if (chars.length === expected + 1) {
    return { chars: chars.slice(0, expected), pad: chars[expected] ?? null };
  }

  throw new OperationError(
    `An alphabet for this needs ${expected} characters, or ${expected + 1} with padding. This one has ${chars.length}.`,
  );
}

function widthFor(size: number): number {
  return Math.log2(size);
}

export function encodeBaseN(bytes: Uint8Array, spec: string, size = 64): string {
  const { chars, pad } = readAlphabet(spec, size);
  const width = widthFor(size);

  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= width) {
      out += chars[(value >>> (bits - width)) & (size - 1)];
      bits -= width;
    }
  }
  if (bits > 0) out += chars[(value << (width - bits)) & (size - 1)];

  if (pad) {
    const group = 8 / gcd(8, width);
    while (out.length % group !== 0) out += pad;
  }

  return out;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export interface DecodeOptions {
  removeNonAlphabet?: boolean;
  strict?: boolean;
}

/*
 * A lookup table from character code to digit value, or null when this
 * alphabet cannot be read one code unit at a time.
 *
 * The loop below has to work for any alphabet at all, and the general way of
 * writing it — spread the string to filter it, then look each character up in
 * a Map — costs more than everything else in a decode put together. On a
 * megabyte of Base64 it is most of a second, and the auto-decoder pays it once
 * for every layer it unwraps.
 *
 * Every alphabet in the catalogue is plain single-code-unit text, and for
 * those a table indexed by character code answers the same question without
 * allocating anything at all. Anything stranger falls back to the general
 * path, which still works exactly as it did.
 */
const ASCII = 128;

function digitTable(chars: string, pad: string | null): Int16Array | null {
  if (pad !== null && (pad.length !== 1 || pad.charCodeAt(0) >= ASCII)) return null;

  const table = new Int16Array(ASCII).fill(-1);
  for (let i = 0; i < chars.length; i++) {
    const code = chars.charCodeAt(i);
    // An alphabet reaching outside ASCII is rare enough to leave to the
    // general path rather than carry a table sixty-four thousand wide.
    if (code >= ASCII) return null;
    table[code] = i;
  }
  return table;
}

function digitOf(table: Int16Array, code: number): number {
  return code < ASCII ? table[code]! : -1;
}

/** Whether every character is one the alphabet accepts. */
function allAccepted(text: string, table: Int16Array, padCode: number): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (digitOf(table, code) === -1 && code !== padCode) return false;
  }
  return true;
}

/**
 * The input with everything outside the alphabet removed.
 *
 * Copied in runs rather than character by character, so text that is already
 * clean — which is the usual case — is returned without being rebuilt.
 */
function keepAlphabet(text: string, table: Int16Array, padCode: number): string {
  const parts: string[] = [];
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const accepted = digitOf(table, code) !== -1 || code === padCode;
    if (accepted) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      parts.push(text.slice(start, i));
      start = -1;
    }
  }
  if (start !== -1) parts.push(text.slice(start));

  return parts.join('');
}

export function decodeBaseN(
  text: string,
  spec: string,
  size = 64,
  options: DecodeOptions = {},
): Uint8Array {
  const { removeNonAlphabet = true, strict = false } = options;
  const { chars, pad } = readAlphabet(spec, size);
  const width = widthFor(size);
  const group = 8 / gcd(8, width);
  const table = digitTable(chars, pad);
  const padCode = pad === null ? -1 : pad.charCodeAt(0);

  let body = text;
  if (removeNonAlphabet) {
    if (table === null) {
      const allowed = new Set(chars + (pad ?? ''));
      body = [...body].filter((c) => allowed.has(c)).join('');
    } else if (!allAccepted(body, table, padCode)) {
      body = keepAlphabet(body, table, padCode);
    }
  } else if (table === null || !allAccepted(body, table, padCode)) {
    // Slow, but only ever reached when there is a stray character to name.
    const stray = [...body].find((c) => !chars.includes(c) && c !== pad);
    if (stray !== undefined) {
      throw new OperationError(
        `'${stray}' is not in this alphabet. Turn on 'Remove non-alphabet chars' to ignore it.`,
      );
    }
  }

  if (pad) {
    if (strict) {
      if (body.length % group !== 0) {
        throw new OperationError(`Strict mode: the input is not a whole number of ${group}-character groups.`);
      }
      const firstPad = body.indexOf(pad);
      if (firstPad !== -1 && [...body.slice(firstPad)].some((c) => c !== pad)) {
        throw new OperationError('Strict mode: padding appears before the end of the input.');
      }
    }
    body = body.split(pad).join('');
  } else if (strict && body.length % group !== 0) {
    throw new OperationError(`Strict mode: the input is not a whole number of ${group}-character groups.`);
  }

  let bits = 0;
  let value = 0;

  if (table !== null) {
    // The most it can produce, so the buffer is allocated once and never grown.
    const out = new Uint8Array(Math.ceil((body.length * width) / 8) + 1);
    let n = 0;

    for (let i = 0; i < body.length; i++) {
      const digit = digitOf(table, body.charCodeAt(i));
      if (digit === -1) {
        throw new OperationError(`'${body[i]!}' is not in this alphabet.`);
      }
      value = (value << width) | digit;
      bits += width;
      if (bits >= 8) {
        bits -= 8;
        out[n++] = (value >>> bits) & 0xff;
      }
    }

    return out.slice(0, n);
  }

  const index = new Map<string, number>();
  for (let i = 0; i < chars.length; i++) index.set(chars[i]!, i);

  const bytes: number[] = [];

  for (const char of body) {
    const digit = index.get(char);
    if (digit === undefined) throw new OperationError(`'${char}' is not in this alphabet.`);
    value = (value << width) | digit;
    bits += width;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}
