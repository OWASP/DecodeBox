// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importRecipes, exportRecipes, loadRecipes, saveRecipe, normalizeRecipes } from './recipes';
import { OPERATIONS } from '../engine/operations';

describe('recipe import/export', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('exports and re-imports recipes', () => {
    saveRecipe('A', []);
    const json = exportRecipes();
    localStorage.clear();
    const result = importRecipes(json, OPERATIONS);
    expect(result).toEqual({ imported: 1, skipped: 0 });
    expect(loadRecipes()).toHaveLength(1);
    expect(loadRecipes()[0]!.name).toBe('A');
  });

  it('rejects invalid JSON', () => {
    const result = importRecipes('{bad');
    expect(result.error).toBeTruthy();
    expect(loadRecipes()).toHaveLength(0);
  });

  it('skips duplicate ids without overwriting', () => {
    saveRecipe('A', []);
    const json = exportRecipes();
    const result = importRecipes(json, OPERATIONS);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(loadRecipes()).toHaveLength(1);
  });

  it('rejects unsupported versions', () => {
    const result = importRecipes(JSON.stringify({ version: 2, recipes: [] }));
    expect(result.error).toBeTruthy();
  });

  it('rejects too many recipes', () => {
    const result = importRecipes(JSON.stringify({ version: 1, recipes: Array(1001).fill({ id: 'x', name: 'x', steps: [] }) }));
    expect(result.error).toBeTruthy();
  });

  it('reports failure when storage write fails', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('no'); });
    const result = importRecipes(JSON.stringify({ version: 1, recipes: [{ id: 'b', name: 'B', steps: [] }] }), OPERATIONS);
    expect(result.error).toBeTruthy();
    spy.mockRestore();
  });

  it('preserves valid toggle values', () => {
    const op = OPERATIONS.find((o) => o.id === 'add')!;
    const json = JSON.stringify({
      version: 1,
      recipes: [{ id: 'r1', name: 'x', savedAt: 1, steps: [{ uid: 'u1', opId: 'add', args: [{ name: 'Key', type: 'toggleString', value: 'secret', toggleValue: 'Base64' }], disabled: false }] }],
    });
    const result = importRecipes(json, [op]);
    expect(result.imported).toBe(1);
    expect(loadRecipes()[0]!.steps[0]!.args[0]!.value).toBe('secret');
    expect(loadRecipes()[0]!.steps[0]!.args[0]!.toggleValue).toBe('Base64');
  });

  it('preserves arbitrary toggleString values and resets invalid formats', () => {
    const op = OPERATIONS.find((o) => o.id === 'add')!;
    const json = JSON.stringify({
      version: 1,
      recipes: [{ id: 'r2', name: 'x', savedAt: 1, steps: [{ uid: 'u1', opId: 'add', args: [{ name: 'Key', type: 'toggleString', value: 'my-secret-key', toggleValue: 'Nope' }], disabled: false }] }],
    });
    const result = importRecipes(json, [op]);
    expect(result.imported).toBe(1);
    expect(loadRecipes()[0]!.steps[0]!.args[0]!.value).toBe('my-secret-key');
    expect(loadRecipes()[0]!.steps[0]!.args[0]!.toggleValue).toBe('Hex');
  });

  it('resets out-of-range numeric values', () => {
    const op = OPERATIONS.find((o) => o.id === 'to-hex')!;
    const json = JSON.stringify({
      version: 1,
      recipes: [{ id: 'r1', name: 'x', savedAt: 1, steps: [{ uid: 'u1', opId: 'to-hex', args: [{ name: 'Bytes per line', type: 'number', value: 99999 }], disabled: false }] }],
    });
    const result = importRecipes(json, [op]);
    expect(result.imported).toBe(1);
    expect(loadRecipes()[0]!.steps[0]!.args[1]!.value).toBe(0);
  });

  it('drops recipes with unknown operation ids when operations are provided', () => {
    const result = importRecipes(JSON.stringify({ version: 1, recipes: [{ id: 'r1', name: 'x', savedAt: 1, steps: [{ uid: 'u1', opId: 'nope', args: [], disabled: false }] }] }), OPERATIONS);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('rejects missing versions and raw arrays', () => {
    expect(importRecipes(JSON.stringify({ recipes: [] })).error).toBeTruthy();
    expect(importRecipes(JSON.stringify([])).error).toBeTruthy();
  });

  it('rejects import when the operation catalogue is unavailable', () => {
    const result = importRecipes(JSON.stringify({
      version: 1,
      recipes: [{
        id: 'unknown-op',
        name: 'Unknown operation',
        steps: [{ uid: 'u1', opId: 'not-in-catalogue', args: [], disabled: false }],
      }],
    }));
    expect(result.error).toMatch(/catalogue/i);
    expect(result.imported).toBe(0);
    expect(loadRecipes()).toHaveLength(0);
  });

  it('does not normalize recipes without an operation catalogue', () => {
    saveRecipe('Unknown', [{ uid: 'u1', opId: 'not-in-catalogue', args: [], disabled: false }]);
    const before = loadRecipes();
    expect(() => normalizeRecipes(before, [])).toThrow(/catalogue/i);
    expect(loadRecipes()).toEqual(before);
  });

  it('round-trips real operation steps with custom arguments', () => {
    saveRecipe('Real', [
      { uid: 'u1', opId: 'add', args: [{ name: 'Key', type: 'toggleString', value: 'my-secret-key', toggleValue: 'Base64', toggleValues: ['UTF-8', 'Hex', 'Base64', 'Latin1', 'Decimal'] }], disabled: false },
      { uid: 'u2', opId: 'to-hex', args: [{ name: 'Bytes per line', type: 'number', value: 8, min: 0, max: 1024 }], disabled: false },
    ]);
    const json = exportRecipes();
    localStorage.clear();
    const result = importRecipes(json, OPERATIONS);
    expect(result.imported).toBe(1);
    const steps = loadRecipes()[0]!.steps;
    expect(steps[0]!.args[0]!.value).toBe('my-secret-key');
    expect(steps[0]!.args[0]!.toggleValue).toBe('Base64');
    expect(steps[1]!.args[1]!.value).toBe(8);
  });

  it('persists normalized arguments even when the recipe count is unchanged', () => {
    saveRecipe('A', [{ uid: 'u1', opId: 'to-hex', args: [{ name: 'Bytes per line', type: 'number', value: 99999 }], disabled: false }]);
    const hex = OPERATIONS.find((o) => o.id === 'to-hex')!;
    normalizeRecipes(loadRecipes(), [hex]);
    expect(loadRecipes()[0]!.steps[0]!.args[1]!.value).toBe(0);
  });

  it('fails closed when normalizing without an operation catalogue', () => {
    expect(() => normalizeRecipes([{ id: 'r1', name: 'x', steps: [{ uid: 'u1', opId: 'nope', args: [], disabled: false }], savedAt: 1 }], [])).toThrow();
  });

  it('returns the old recipes when normalization cannot be persisted', () => {
    const hex = OPERATIONS.find((o) => o.id === 'to-hex')!;
    const recipes = [{ id: 'r1', name: 'x', steps: [{ uid: 'u1', opId: 'to-hex', args: [{ name: 'Bytes per line', type: 'number', value: 99999 }], disabled: false }], savedAt: 1 }];
    localStorage.setItem('decodebox-recipes', JSON.stringify(recipes));
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('no'); });
    const result = normalizeRecipes(loadRecipes(), [hex]);
    expect(result).toEqual(recipes);
    spy.mockRestore();
  });

  it('trims normalized recipes to 100', () => {
    const recipes = Array.from({ length: 101 }, (_, i) => ({ id: `r${i}`, name: 'x', steps: [], savedAt: 1 }));
    localStorage.setItem('decodebox-recipes', JSON.stringify(recipes));
    const result = normalizeRecipes(loadRecipes(), OPERATIONS);
    expect(result).toHaveLength(100);
    expect(loadRecipes()).toHaveLength(100);
  });

  it('keeps store data aligned with storage when normalization cannot persist', () => {
    saveRecipe('A', [{ uid: 'u1', opId: 'to-hex', args: [{ name: 'Bytes per line', type: 'number', value: 99999 }], disabled: false }]);
    const before = loadRecipes();
    const hex = OPERATIONS.find((o) => o.id === 'to-hex')!;
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('no'); });

    const normalized = normalizeRecipes(before, [hex]);

    expect(normalized).toEqual(before);
    expect(loadRecipes()).toEqual(before);
    spy.mockRestore();
  });

  it('returns the same capped recipe list that was persisted', () => {
    const recipes = Array.from({ length: 101 }, (_, i) => ({
      id: `r${i}`,
      name: `Recipe ${i}`,
      steps: [],
      savedAt: i,
    }));

    const normalized = normalizeRecipes(recipes, OPERATIONS);

    expect(normalized).toHaveLength(100);
    expect(loadRecipes()).toEqual(normalized);
  });

  it('coerces wrong primitive types to operation defaults', () => {
    const hex = OPERATIONS.find((o) => o.id === 'to-hex')!;
    const add = OPERATIONS.find((o) => o.id === 'add')!;
    const bech = OPERATIONS.find((o) => o.id === 'to-bech32')!;
    const avro = OPERATIONS.find((o) => o.id === 'avro-to-json')!;
    const template = OPERATIONS.find((o) => o.id === 'template')!;
    const json = JSON.stringify({
      version: 1,
      recipes: [{
        id: 'r1', name: 'x', savedAt: 1,
        steps: [
          { uid: 'u1', opId: 'to-hex', args: [{ name: 'Bytes per line', type: 'number', value: 'nope' }], disabled: false },
          { uid: 'u2', opId: 'add', args: [{ name: 'Key', type: 'toggleString', value: 123 }], disabled: false },
          { uid: 'u3', opId: 'to-bech32', args: [{ name: 'Human-readable part', type: 'string', value: 123 }], disabled: false },
          { uid: 'u4', opId: 'avro-to-json', args: [{ name: 'Include schema', type: 'boolean', value: 'yes' }], disabled: false },
          { uid: 'u5', opId: 'template', args: [{ name: 'Template', type: 'textarea', value: 42 }], disabled: false },
        ],
      }],
    });
    const result = importRecipes(json, [hex, add, bech, avro, template]);
    expect(result.imported).toBe(1);
    const steps = loadRecipes()[0]!.steps;
    expect(steps[0]!.args[1]!.value).toBe(0);
    expect(steps[1]!.args[0]!.value).toBe('');
    expect(steps[2]!.args[0]!.value).toBe('bc');
    expect(steps[3]!.args[1]!.value).toBe(false);
    expect(steps[4]!.args[0]!.value).toBe('');
  });
});
