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

const SBOXES = Array.from({ length: 8 }, (_, box) => {
  const values = Array.from({ length: 16 }, (_, i) => i);
  let state = box + 1;
  for (let i = 15; i > 0; i--) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = (state >> 16) % (i + 1);
    [values[i], values[j]] = [values[j]!, values[i]!];
  }
  return values.map((v) => v.toString(16)).join('');
}).join('\n');

const KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const IV = '0011223344556677';
const BLOCK = '0123456789abcdef';

describe('GOST Encrypt and Decrypt', () => {
  it('is a permutation of the block, in every mode', async () => {
    const base = { 'S-boxes': SBOXES, Key: KEY, IV, Input: 'Hex', Output: 'Hex', Padding: 'None' };
    for (const mode of ['ECB', 'CBC', 'CFB', 'OFB', 'CTR']) {
      const cipher = await run(BLOCK, ['gost-encrypt', { ...base, Mode: mode }]);
      expect(cipher, mode).not.toBe(BLOCK);
      expect(await run(cipher, ['gost-decrypt', { ...base, Mode: mode }]), mode).toBe(BLOCK);
    }
  });

  it('round-trips a longer message with padding', async () => {
    const settings = { 'S-boxes': SBOXES, Key: KEY, IV, Mode: 'CBC' };
    const plain = 'GOST is still in use, whatever anyone says about it.';
    const cipher = await run(plain, ['gost-encrypt', settings]);
    expect(await run(cipher, ['gost-decrypt', { ...settings, Input: 'Hex', Output: 'Raw' }])).toBe(
      plain,
    );
  });

  it('changes when any S-box changes', async () => {
    const base = { 'S-boxes': SBOXES, Key: KEY, IV, Input: 'Hex', Output: 'Hex', Padding: 'None', Mode: 'ECB' };
    const first = await run(BLOCK, ['gost-encrypt', base]);

    const lines = SBOXES.split('\n');
    for (let box = 0; box < 8; box++) {
      const swapped = [...lines];
      const line = swapped[box]!;
      swapped[box] = line[1]! + line[0]! + line.slice(2);
      const changed = await run(BLOCK, ['gost-encrypt', { ...base, 'S-boxes': swapped.join('\n') }]);
      expect(changed, `box ${box + 1}`).not.toBe(first);
    }
  });

  it('changes when one bit of the key changes', async () => {
    const base = { 'S-boxes': SBOXES, Key: KEY, IV, Input: 'Hex', Output: 'Hex', Padding: 'None', Mode: 'ECB' };
    const first = await run(BLOCK, ['gost-encrypt', base]);
    const other = await run(BLOCK, [
      'gost-encrypt',
      { ...base, Key: `01${KEY.slice(2)}` },
    ]);
    expect(other).not.toBe(first);
  });

  it('refuses a key of the wrong length', async () => {
    const result = await bake(
      BLOCK,
      recipe(['gost-encrypt', { 'S-boxes': SBOXES, Key: '0011', Input: 'Hex' }]),
    );
    expect(result.error?.message).toMatch(/GOST key is 32 bytes/);
  });

  it('refuses S-boxes that are not eight permutations', async () => {
    for (const [boxes, message] of [
      ['0123456789abcdef', /eight S-boxes/],
      [Array(8).fill('0123456789abcde').join('\n'), /sixteen digits/],
      [Array(8).fill('0123456789abcdee').join('\n'), /repeats a value/],
    ] as Array<[string, RegExp]>) {
      const result = await bake(BLOCK, recipe(['gost-encrypt', { 'S-boxes': boxes, Key: KEY }]));
      expect(result.error?.message).toMatch(message);
    }
  });
});

describe('GOST Key Wrap and Unwrap', () => {
  const KEK = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';
  const UKM = 'a1a2a3a4a5a6a7a8';
  const CEK = '0f0e0d0c0b0a09080706050403020100000102030405060708090a0b0c0d0e0f';
  const settings = { 'S-boxes': SBOXES, 'Key encryption key': KEK, UKM };

  it('wraps a key into the 44 bytes the format defines', async () => {
    const wrapped = await run(CEK, ['gost-key-wrap', settings]);
    expect(wrapped).toHaveLength(88); 
    expect(wrapped.startsWith(UKM)).toBe(true);
  });

  it('unwraps it back', async () => {
    const wrapped = await run(CEK, ['gost-key-wrap', settings]);
    expect(await run(wrapped, ['gost-key-unwrap', { 'S-boxes': SBOXES, 'Key encryption key': KEK }])).toBe(
      CEK,
    );
  });

  it('refuses the wrong key encryption key', async () => {
    const wrapped = await run(CEK, ['gost-key-wrap', settings]);
    const result = await bake(
      wrapped,
      recipe(['gost-key-unwrap', { 'S-boxes': SBOXES, 'Key encryption key': KEY }]),
    );
    expect(result.error?.message).toMatch(/MAC does not match/);
  });

  it('refuses a wrapped key whose MAC has been altered', async () => {
    const wrapped = await run(CEK, ['gost-key-wrap', settings]);
    const tampered = `${wrapped.slice(0, 86)}${wrapped.slice(86) === 'ff' ? '00' : 'ff'}`;
    const result = await bake(
      tampered,
      recipe(['gost-key-unwrap', { 'S-boxes': SBOXES, 'Key encryption key': KEK }]),
    );
    expect(result.error?.message).toMatch(/MAC does not match/);
  });

  it('refuses a UKM of the wrong length', async () => {
    const result = await bake(
      CEK,
      recipe(['gost-key-wrap', { ...settings, UKM: 'aabb' }]),
    );
    expect(result.error?.message).toMatch(/UKM is 8 bytes/);
  });
});
