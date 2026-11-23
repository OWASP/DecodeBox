import type { OperationArg, RecipeStep } from '../engine';
import { randomId } from '../engine';
import { safeArgValue } from './share';

export interface SavedRecipe {
  id: string;
  name: string;
  steps: RecipeStep[];
  savedAt: number;
}

const KEY = 'decodebox-recipes';
const MAX = 100;

function readArg(value: unknown): OperationArg | null {
  if (typeof value !== 'object' || value === null) return null;
  const arg = value as Partial<OperationArg>;
  if (typeof arg.name !== 'string' || typeof arg.type !== 'string') return null;
  return { ...(arg as OperationArg), value: safeArgValue(arg.value, '') };
}

function readStep(value: unknown): RecipeStep | null {
  if (typeof value !== 'object' || value === null) return null;
  const step = value as Partial<RecipeStep>;
  if (typeof step.opId !== 'string' || !Array.isArray(step.args)) return null;

  const args: OperationArg[] = [];
  for (const raw of step.args) {
    const arg = readArg(raw);
    if (!arg) return null;
    args.push(arg);
  }

  return {
    uid: typeof step.uid === 'string' ? step.uid : `${step.opId}-restored`,
    opId: step.opId,
    args,
    disabled: step.disabled === true,
  };
}

function readRecipe(value: unknown): SavedRecipe | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<SavedRecipe>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null;
  if (!Array.isArray(candidate.steps)) return null;

  const steps: RecipeStep[] = [];
  for (const rawStep of candidate.steps) {
    const step = readStep(rawStep);
    if (!step) return null;
    steps.push(step);
  }

  return {
    id: candidate.id,
    name: candidate.name,
    steps,
    savedAt: typeof candidate.savedAt === 'number' ? candidate.savedAt : 0,
  };
}

export function loadRecipes(): SavedRecipe[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const recipes: SavedRecipe[] = [];
    for (const entry of parsed) {
      const recipe = readRecipe(entry);
      if (recipe) recipes.push(recipe);
    }
    return recipes;
  } catch {
    return [];
  }
}

export interface ImportResult {
  imported: number;
  skipped: number;
  error?: string;
}

export function exportRecipes(recipes: SavedRecipe[] = loadRecipes()): string {
  return JSON.stringify({ version: 1, recipes }, null, 2);
}

export function importRecipes(raw: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { imported: 0, skipped: 0, error: 'Invalid JSON file.' };
  }

  let list: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as { version?: unknown; recipes?: unknown };
    if (obj.version !== undefined && obj.version !== 1) {
      return { imported: 0, skipped: 0, error: 'Unsupported export version.' };
    }
    if (Array.isArray(obj.recipes)) list = obj.recipes;
  }

  if (!list) return { imported: 0, skipped: 0, error: 'Expected a recipe list.' };
  if (list.length > 1000) return { imported: 0, skipped: 0, error: 'Too many recipes in file.' };

  const existing = loadRecipes();
  const existingIds = new Set(existing.map((r) => r.id));
  const merged = [...existing];
  let imported = 0;
  let skipped = 0;

  for (const entry of list) {
    const recipe = readRecipe(entry);
    if (!recipe) {
      skipped += 1;
      continue;
    }
    if (existingIds.has(recipe.id)) {
      skipped += 1;
      continue;
    }
    if (merged.length >= MAX) {
      skipped += 1;
      continue;
    }
    existingIds.add(recipe.id);
    merged.push(recipe);
    imported += 1;
  }

  const { ok } = persist(merged);
  if (!ok) return { imported: 0, skipped, error: 'Could not save recipes to browser storage.' };
  return { imported, skipped };
}

function persist(recipes: SavedRecipe[]): { recipes: SavedRecipe[]; ok: boolean } {
  const trimmed = recipes.slice(0, MAX);
  let ok = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    ok = false;
  }
  return { recipes: trimmed, ok };
}

export function saveRecipe(name: string, steps: RecipeStep[]): SavedRecipe[] {
  const recipe: SavedRecipe = {
    id: randomId('r'),
    name: name.trim() || 'Untitled recipe',
    steps: steps.map((s) => ({ ...s, args: s.args.map((a) => ({ ...a })) })),
    savedAt: Date.now(),
  };
  return persist([recipe, ...loadRecipes()]).recipes;
}

export function deleteRecipe(id: string): SavedRecipe[] {
  return persist(loadRecipes().filter((r) => r.id !== id)).recipes;
}

export function instantiate(recipe: SavedRecipe): RecipeStep[] {
  return recipe.steps.map((step) => ({
    ...step,
    uid: randomId(step.opId),
    args: step.args.map((a) => ({ ...a })),
  }));
}
