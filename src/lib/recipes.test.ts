// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importRecipes, exportRecipes, loadRecipes, saveRecipe } from './recipes';

describe('recipe import/export', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('exports and re-imports recipes', () => {
    saveRecipe('A', []);
    const json = exportRecipes();
    localStorage.clear();
    const result = importRecipes(json);
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
    const result = importRecipes(json);
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
    const result = importRecipes(JSON.stringify({ version: 1, recipes: [{ id: 'b', name: 'B', steps: [] }] }));
    expect(result.error).toBeTruthy();
    spy.mockRestore();
  });
});