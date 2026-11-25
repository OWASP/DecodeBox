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
    const result = importRecipes(JSON.stringify({ version: 1, recipes: [] }));
    expect(result.error).toMatch(/catalogue/i);
  });

  it('persists normalized arguments even when the recipe count is unchanged', () => {
    saveRecipe('A', [{ uid: 'u1', opId: 'to-hex', args: [{ name: 'Bytes per line', type: 'number', value: 99999 }], disabled: false }]);
    const hex = OPERATIONS.find((o) => o.id === 'to-hex')!;
    normalizeRecipes(loadRecipes(), [hex]);
    expect(loadRecipes()[0]!.steps[0]!.args[1]!.value).toBe(0);
  });

  it('coerces wrong primitive types to operation defaults', () => {
    const hex = OPERATIONS.find((o) => o.id === 'to-hex')!;
    const add = OPERATIONS.find((o) => o.id === 'add')!;
    const bech = OPERATIONS.find((o) => o.id === 'to-bech32')!;
    const avro = OPERATIONS.find((o) => o.id === 'avro-to-json')!;
    const json = JSON.stringify({
      version: 1,
      recipes: [{
        id: 'r1', name: 'x', savedAt: 1,
        steps: [
          { uid: 'u1', opId: 'to-hex', args: [{ name: 'Bytes per line', type: 'number', value: 'nope' }], disabled: false },
          { uid: 'u2', opId: 'add', args: [{ name: 'Key', type: 'toggleString', value: 123 }], disabled: false },
          { uid: 'u3', opId: 'to-bech32', args: [{ name: 'Human-readable part', type: 'string', value: 123 }], disabled: false },
          { uid: 'u4', opId: 'avro-to-json', args: [{ name: 'Include schema', type: 'boolean', value: 'yes' }], disabled: false },
        ],
      }],
    });
    const result = importRecipes(json, [hex, add, bech, avro]);
    expect(result.imported).toBe(1);
    const steps = loadRecipes()[0]!.steps;
    expect(steps[0]!.args[1]!.value).toBe(0);
    expect(steps[1]!.args[0]!.value).toBe('');
    expect(steps[2]!.args[0]!.value).toBe('bc');
    expect(steps[3]!.args[1]!.value).toBe(false);
  });
});