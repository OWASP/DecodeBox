// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from './useStore';
import { OPERATIONS } from '../engine/operations';

describe('store recipe import', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ operations: OPERATIONS, savedRecipes: [], savedRecipesReady: true, steps: [] });
  });

  it('rejects unknown operation ids through the store flow', () => {
    const result = useStore.getState().importRecipes(JSON.stringify({
      version: 1,
      recipes: [{
        id: 'r1',
        name: 'unknown',
        steps: [{ uid: 'u1', opId: 'not-in-catalogue', args: [], disabled: false }],
      }],
    }));
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(useStore.getState().savedRecipes).toHaveLength(0);
  });

  it('does not load a saved recipe before catalogue normalization is complete', () => {
    const runRecipe = vi.fn(async () => {});
    useStore.setState({
      operations: [],
      savedRecipesReady: false,
      savedRecipes: [{
        id: 'r1',
        name: 'unvalidated',
        savedAt: 1,
        steps: [{ uid: 'u1', opId: 'unknown-op', args: [], disabled: false }],
      }],
      steps: [],
      dialog: 'library',
      runRecipe,
    });

    useStore.getState().loadSavedRecipe('r1');

    expect(useStore.getState().steps).toEqual([]);
    expect(useStore.getState().dialog).toBe('library');
    expect(runRecipe).not.toHaveBeenCalled();
  });
});
