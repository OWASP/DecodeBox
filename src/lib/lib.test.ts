import { deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listOperations, type OperationDef, type RecipeStep } from '../engine';
import { decodeShare, encodeShare } from './share';
import { fromText, toText } from './recipeText';
import { loadRecipes } from './recipes';

let cached: OperationDef[] | null = null;
async function ops(): Promise<OperationDef[]> {
  cached ??= await listOperations();
  return cached;
}

async function steps(...opIds: string[]): Promise<RecipeStep[]> {
  const all = await ops();
  return opIds.map((opId, i) => {
    const definition = all.find((o) => o.id === opId);
    if (!definition) throw new Error(`Unknown operation '${opId}'`);
    return {
      uid: `s${i}`,
      opId,
      args: definition.args.map((a) => ({ ...a })),
      disabled: false,
    };
  });
}

function toFragment(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('share links', () => {
  it('round-trips a recipe', async () => {
    const all = await ops();
    const original = await steps('from-base64', 'gunzip', 'json-beautify');

    const fragment = await encodeShare(original, all);
    const restored = await decodeShare(fragment, all);

    expect(restored?.steps.map((s) => s.opId)).toEqual([
      'from-base64',
      'gunzip',
      'json-beautify',
    ]);
    expect(restored?.input).toBeUndefined();
  });

  it('carries changed arguments and disabled steps', async () => {
    const all = await ops();
    const original = await steps('to-hex', 'rot13');
    original[0]!.args[0]!.value = 'Comma';
    original[1]!.disabled = true;

    const restored = await decodeShare(await encodeShare(original, all), all);

    expect(restored?.steps[0]?.args[0]?.value).toBe('Comma');
    expect(restored?.steps[1]?.disabled).toBe(true);
  });

  it('omits the input unless it is explicitly included', async () => {
    const all = await ops();
    const recipe = await steps('from-base64');

    expect((await decodeShare(await encodeShare(recipe, all), all))?.input).toBeUndefined();

    const withInput = await decodeShare(await encodeShare(recipe, all, 'secret payload'), all);
    expect(withInput?.input).toBe('secret payload');
  });

  it('compresses well enough to stay linkable', async () => {
    const all = await ops();
    const long = await steps(
      'from-base64',
      'gunzip',
      'json-beautify',
      'to-hex',
      'from-hex',
      'rot13',
      'to-base32',
      'from-base32',
    );
    const fragment = await encodeShare(long, all);
    expect(fragment.length).toBeLessThan(220);
  });

  it('treats a malformed link as data, not as a crash', async () => {
    const all = await ops();
    expect(await decodeShare('#s=not-valid-base64!!!', all)).toBeNull();
    expect(await decodeShare('#s=', all)).toBeNull();
    expect(await decodeShare('#nothing', all)).toBeNull();
    expect(await decodeShare('', all)).toBeNull();
  });

  it('refuses a decompression bomb instead of allocating it', async () => {
    const all = await ops();
    const bomb = JSON.stringify({ v: 1, s: [], i: 'A'.repeat(64 * 1024 * 1024) });
    const fragment = '#s=' + toFragment(deflateRawSync(Buffer.from(bomb), { level: 9 }));

    expect(fragment.length).toBeLessThan(200_000);
    expect(await decodeShare(fragment, all)).toBeNull();
  });

  it('refuses an argument value that is not the primitive it claims to be', async () => {
    const all = await ops();
    const hostile = { v: 1, s: [{ op: 'to-base64', args: { Alphabet: { nested: [1, 2] } } }] };
    const fragment = '#s=' + toFragment(deflateRawSync(Buffer.from(JSON.stringify(hostile))));

    const restored = await decodeShare(fragment, all);
    expect(restored?.steps).toHaveLength(1);
    for (const arg of restored?.steps[0]?.args ?? []) {
      expect(['string', 'number', 'boolean']).toContain(typeof arg.value);
    }
  });

  it('drops operations this build does not have rather than failing entirely', async () => {
    const all = await ops();
    const fragment = await encodeShare(
      [
        ...(await steps('from-base64')),
        { uid: 'x', opId: 'operation-from-the-future', args: [], disabled: false },
      ],
      all,
    );
    const restored = await decodeShare(fragment, all);
    expect(restored?.steps.map((s) => s.opId)).toEqual(['from-base64']);
  });
});

describe('recipe as text', () => {
  it('round-trips through the text form', async () => {
    const all = await ops();
    const original = await steps('from-base64', 'gunzip');
    const parsed = fromText(toText(original, all), all);

    expect(parsed.error).toBeUndefined();
    expect(parsed.steps?.map((s) => s.opId)).toEqual(['from-base64', 'gunzip']);
  });

  it('writes out only arguments that differ from the default', async () => {
    const all = await ops();
    const recipe = await steps('to-hex');
    expect(toText(recipe, all)).not.toContain('Delimiter');

    recipe[0]!.args[0]!.value = 'Comma';
    expect(toText(recipe, all)).toContain('Comma');
  });

  it('explains what is wrong instead of throwing', async () => {
    const all = await ops();
    expect(fromText('{ not json', all).error).toBeTruthy();
    expect(fromText('{"op":"from-hex"}', all).error).toContain('array');
    expect(fromText('[{"op":"nope"}]', all).error).toContain('nope');
    expect(fromText('[{"nope":1}]', all).error).toContain('"op"');
    expect(fromText('[{"op":"to-hex","args":{"Nope":1}}]', all).error).toContain('Nope');
  });

  it('treats empty text as an empty recipe', async () => {
    const all = await ops();
    expect(fromText('   ', all)).toEqual({ steps: [] });
  });
});

describe('stored recipes', () => {
  const KEY = 'decodebox-recipes';

  function store(value: unknown): void {
    globalThis.localStorage.setItem(KEY, JSON.stringify(value));
  }

  beforeEach(() => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads back a well-formed recipe', () => {
    store([
      {
        id: 'r1',
        name: 'hex it',
        savedAt: 1,
        steps: [{ uid: 'u1', opId: 'to-hex', args: [{ name: 'Delimiter', type: 'option', value: 'Space' }], disabled: false }],
      },
    ]);
    const [recipe] = loadRecipes();
    expect(recipe?.name).toBe('hex it');
    expect(recipe?.steps[0]?.args[0]?.value).toBe('Space');
  });

  it('drops a recipe whose step arguments are not a list', () => {
    store([{ id: 'r1', name: 'malformed', savedAt: 1, steps: [{ opId: 'to-hex', args: { not: 'a list' } }] }]);
    expect(loadRecipes()).toEqual([]);
  });

  it('drops a recipe whole rather than loading part of it', () => {
    store([
      {
        id: 'r1',
        name: 'half readable',
        savedAt: 1,
        steps: [
          { uid: 'u1', opId: 'to-hex', args: [], disabled: false },
          { uid: 'u2', opId: 'to-base64', args: [{ noName: true }], disabled: false },
        ],
      },
    ]);
    expect(loadRecipes()).toEqual([]);
  });

  it('refuses an argument value that is not the primitive it claims to be', () => {
    store([
      {
        id: 'r1',
        name: 'nested',
        savedAt: 1,
        steps: [{ uid: 'u1', opId: 'to-base64', args: [{ name: 'Alphabet', type: 'string', value: { nested: [1] } }], disabled: false }],
      },
    ]);
    const value = loadRecipes()[0]?.steps[0]?.args[0]?.value;
    expect(['string', 'number', 'boolean']).toContain(typeof value);
  });

  it('survives storage that is not JSON at all', () => {
    globalThis.localStorage.setItem(KEY, 'not json {');
    expect(loadRecipes()).toEqual([]);
    store({ not: 'an array' });
    expect(loadRecipes()).toEqual([]);
  });
});
