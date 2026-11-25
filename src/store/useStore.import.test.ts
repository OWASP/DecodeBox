// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './useStore';
import { OPERATIONS } from '../engine/operations';

describe('store recipe import', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ operations: OPERATIONS, savedRecipes: [] });
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
});