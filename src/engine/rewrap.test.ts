import { describe, expect, it } from 'vitest';
import { OPERATIONS } from './operations/index';
import { INVERSES, carryArgs, rewrap, whyNotInvertible } from './core/rewrap';
import { bake } from './core/bake';
import type { RecipeStep } from './types';


const byId = new Map(OPERATIONS.map((o) => [o.id, o]));

let counter = 0;
const uid = () => `test-${(counter += 1)}`;

function step(opId: string, overrides: Record<string, string | number | boolean> = {}): RecipeStep {
  const op = byId.get(opId);
  if (!op) throw new Error(`no such operation: ${opId}`);
  return {
    uid: uid(),
    opId,
    args: op.args.map((a) => (a.name in overrides ? { ...a, value: overrides[a.name]! } : { ...a })),
    disabled: false,
  };
}

describe('the inverse table', () => {
  it('only names operations that exist', () => {
    const missing: string[] = [];
    for (const [id, rule] of Object.entries(INVERSES)) {
      if (!byId.has(id)) missing.push(`${id} (the key)`);
      if (!byId.has(rule.op)) missing.push(`${rule.op} (inverse of ${id})`);
    }
    expect(missing).toEqual([]);
  });

  it('is symmetric: if A undoes B then B undoes A', () => {
    const broken: string[] = [];
    for (const [id, rule] of Object.entries(INVERSES)) {
      const back = INVERSES[rule.op];
      if (!back) {
        broken.push(`${id} -> ${rule.op}, but ${rule.op} has no inverse`);
      } else if (back.op !== id) {
        broken.push(`${id} -> ${rule.op} -> ${back.op}, which is not ${id}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('never claims a hash can be undone', () => {
    const hashes = OPERATIONS.filter((o) => o.category === 'Hashing').map((o) => o.id);
    expect(hashes.filter((id) => INVERSES[id])).toEqual([]);
  });
});

describe('rewrap', () => {
  it('reverses the order of the steps', () => {
    const result = rewrap([step('from-base64'), step('gunzip')], OPERATIONS, uid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((s) => s.opId)).toEqual(['gzip', 'to-base64']);
  });

  it('carries an argument across to the inverse', () => {
    const result = rewrap([step('from-base64', { Alphabet: 'A-Za-z0-9-_' })], OPERATIONS, uid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const alphabet = result.steps[0]?.args.find((a) => a.name === 'Alphabet');
    expect(alphabet?.value).toBe('A-Za-z0-9-_');
  });

  it('leaves disabled steps out, because they never ran', () => {
    const disabled = { ...step('gunzip'), disabled: true };
    const result = rewrap([step('from-base64'), disabled], OPERATIONS, uid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((s) => s.opId)).toEqual(['to-base64']);
  });

  it('rotates the other way rather than repeating the rotation', () => {
    const result = rewrap([step('rot13', { Amount: 5 })], OPERATIONS, uid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0]?.opId).toBe('rot13');
    expect(result.steps[0]?.args.find((a) => a.name === 'Amount')?.value).toBe(21);
  });

  it('leaves ROT13 proper alone, since 13 is its own inverse', () => {
    const result = rewrap([step('rot13')], OPERATIONS, uid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps[0]?.args.find((a) => a.name === 'Amount')?.value).toBe(13);
  });

  it('refuses a hash, and says why', () => {
    const result = rewrap([step('from-base64'), step('sha-256')], OPERATIONS, uid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]?.position).toBe(2);
    expect(result.blockers[0]?.reason).toMatch(/one-way by design/);
  });

  it('reports every dead end at once, not just the first', () => {
    const result = rewrap([step('sha-256'), step('from-base64'), step('md5')], OPERATIONS, uid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers.map((b) => b.position)).toEqual([1, 3]);
  });

  it('names the step by its position in the recipe the user is looking at', () => {
    const off = { ...step('gunzip'), disabled: true };
    const result = rewrap([off, step('sha-1')], OPERATIONS, uid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockers[0]?.position).toBe(2);
  });

  it('is empty for an empty recipe rather than an error', () => {
    const result = rewrap([], OPERATIONS, uid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toEqual([]);
  });
});

describe('carryArgs', () => {
  it('does not force an option the target does not offer', () => {
    const target = [{ name: 'Mode', type: 'option' as const, value: 'A', options: ['A', 'B'] }];
    const source = [{ name: 'Mode', type: 'option' as const, value: 'Z', options: ['Z'] }];
    expect(carryArgs(target, source)[0]?.value).toBe('A');
  });

  it('does not match arguments that share a name but not a type', () => {
    const target = [{ name: 'Key', type: 'string' as const, value: '' }];
    const source = [{ name: 'Key', type: 'number' as const, value: 7 }];
    expect(carryArgs(target, source)[0]?.value).toBe('');
  });
});

describe('round trips', () => {
  async function roundTrip(input: string, steps: RecipeStep[]) {
    const forward = await bake(input, { id: 'r', name: 'forward', steps });
    expect(forward.error).toBeUndefined();
    const back = rewrap(steps, OPERATIONS, uid);
    expect(back.ok).toBe(true);
    if (!back.ok) throw new Error('not invertible');
    const reversed = await bake(forward.output, { id: 'r', name: 'back', steps: back.steps });
    expect(reversed.error).toBeUndefined();
    return reversed.output;
  }

  it('puts a Base64 payload back', async () => {
    expect(await roundTrip('aGVsbG8gd29ybGQ=', [step('from-base64')])).toBe('aGVsbG8gd29ybGQ=');
  });

  it('puts a two-layer payload back through both layers', async () => {
    const inner = btoa('{"role":"user"}');
    const outer = btoa(inner);
    expect(await roundTrip(outer, [step('from-base64'), step('from-base64')])).toBe(outer);
  });

  it('re-encodes with the alphabet it decoded with', async () => {
    const steps = [step('from-base64', { Alphabet: 'A-Za-z0-9-_' })];
    const payload = 'w7_Dvw';
    expect(await roundTrip(payload, steps)).toBe(payload);
  });

  it('round-trips hex', async () => {
    expect(await roundTrip('48 65 6c 6c 6f', [step('from-hex')])).toMatch(/48\s*65\s*6c\s*6c\s*6f/i);
  });

  it('round-trips URL encoding', async () => {
    expect(await roundTrip('a%20b%26c', [step('url-decode')])).toBe('a%20b%26c');
  });
});

describe('whyNotInvertible', () => {
  it('explains a lossy operation in terms of what it threw away', () => {
    expect(whyNotInvertible(byId.get('remove-whitespace'), 'remove-whitespace')).toMatch(
      /discards the whitespace/,
    );
  });

  it('does not pretend an unknown operation is known', () => {
    expect(whyNotInvertible(undefined, 'made-up')).toMatch(/not in the catalogue/);
  });
});
