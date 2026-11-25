import type { OperationArg, OperationDef, RecipeStep } from '../engine';
import type { ArgType } from '../engine/types';
import { randomId } from '../engine';

export interface SavedRecipe {
  id: string;
  name: string;
  steps: RecipeStep[];
  savedAt: number;
}

const KEY = 'decodebox-recipes';
const MAX = 100;

const ARG_TYPES = new Set<ArgType>(['string', 'number', 'boolean', 'option', 'toggleString', 'textarea']);

function fallbackFor(type: ArgType): string | number | boolean {
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  return '';
}

function normalizeValue(
  type: ArgType,
  value: unknown,
  fallback: string | number | boolean,
): string | number | boolean {
  if (type === 'string' || type === 'textarea' || type === 'toggleString' || type === 'option') {
    return typeof value === 'string' ? value : fallback;
  }
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  if (type === 'boolean') return typeof value === 'boolean' ? value : fallback;
  return fallback;
}

function readArg(value: unknown): OperationArg | null {
  if (typeof value !== 'object' || value === null) return null;
  const arg = value as Partial<OperationArg>;
  if (typeof arg.name !== 'string' || typeof arg.type !== 'string') return null;
  if (!ARG_TYPES.has(arg.type as ArgType)) return null;
  const type = arg.type as ArgType;

  const out: OperationArg = {
    name: arg.name,
    type,
    value: normalizeValue(type, arg.value, fallbackFor(type)),
  };

  if (Array.isArray(arg.options) && arg.options.every((o) => typeof o === 'string')) {
    out.options = arg.options;
  }
  if (arg.optionLabels && typeof arg.optionLabels === 'object' && !Array.isArray(arg.optionLabels)) {
    const labels: Record<string, string> = {};
    let ok = true;
    for (const [k, v] of Object.entries(arg.optionLabels)) {
      if (typeof v !== 'string') {
        ok = false;
        break;
      }
      labels[k] = v;
    }
    if (ok) out.optionLabels = labels;
  }
  if (Array.isArray(arg.toggleValues) && arg.toggleValues.every((v) => typeof v === 'string')) {
    out.toggleValues = arg.toggleValues;
  }
  if (typeof arg.toggleValue === 'string') out.toggleValue = arg.toggleValue;
  if (typeof arg.hint === 'string') out.hint = arg.hint;
  if (typeof arg.min === 'number' && Number.isFinite(arg.min)) out.min = arg.min;
  if (typeof arg.max === 'number' && Number.isFinite(arg.max)) out.max = arg.max;

  return out;
}

function readStep(value: unknown, operations?: OperationDef[]): RecipeStep | null {
  if (typeof value !== 'object' || value === null) return null;
  const step = value as Partial<RecipeStep>;
  if (typeof step.opId !== 'string' || !Array.isArray(step.args)) return null;

  const op = operations?.find((o) => o.id === step.opId);
  if (operations && !op) return null;
  const importedArgs = step.args;

  for (const raw of importedArgs) {
    if (!readArg(raw)) return null;
  }

  let args: OperationArg[];
  if (op) {
    args = op.args.map((def) => {
      const found = importedArgs.find(
        (a) => typeof a === 'object' && a !== null && (a as Partial<OperationArg>).name === def.name,
      ) as Partial<OperationArg> | undefined;
      let value = found ? normalizeValue(def.type, found.value, def.value) : def.value;
      if (def.type === 'option' && def.options && !def.options.includes(String(value))) value = def.value;
      // toggleValues are format selections, not value constraints; keep the user value.
      if (def.type === 'number') {
        if (def.min !== undefined && (value as number) < def.min) value = def.value;
        if (def.max !== undefined && (value as number) > def.max) value = def.value;
      }
      let toggleValue = def.toggleValue;
      if (found && typeof found.toggleValue === 'string') {
        if (!def.toggleValues || def.toggleValues.includes(found.toggleValue)) toggleValue = found.toggleValue;
      }
      return { ...def, value, toggleValue };
    });
  } else {
    args = [];
    for (const raw of importedArgs) {
      const arg = readArg(raw);
      if (!arg) return null;
      args.push(arg);
    }
  }

  return {
    uid: typeof step.uid === 'string' ? step.uid : `${step.opId}-restored`,
    opId: step.opId,
    args,
    disabled: step.disabled === true,
  };
}

function readRecipe(value: unknown, operations?: OperationDef[]): SavedRecipe | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<SavedRecipe>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null;
  if (!Array.isArray(candidate.steps)) return null;

  const steps: RecipeStep[] = [];
  for (const rawStep of candidate.steps) {
    const step = readStep(rawStep, operations);
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

export function normalizeRecipes(recipes: SavedRecipe[], operations: OperationDef[]): SavedRecipe[] {
  if (operations.length === 0) throw new Error('Operation catalogue not loaded.');

  const valid: SavedRecipe[] = [];
  for (const recipe of recipes) {
    const normalized = readRecipe(recipe, operations);
    if (normalized) valid.push(normalized);
  }
  if (valid.length > MAX || valid.length !== recipes.length || JSON.stringify(valid) !== JSON.stringify(recipes)) {
    const result = persist(valid);
    return result.ok ? result.recipes : recipes;
  }
  return valid;
}

export function importRecipes(raw: string, operations: OperationDef[] = []): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { imported: 0, skipped: 0, error: 'Invalid JSON file.' };
  }

  if (Array.isArray(parsed) || !parsed || typeof parsed !== 'object') {
    return { imported: 0, skipped: 0, error: 'Expected a versioned recipe export.' };
  }
  const obj = parsed as { version?: unknown; recipes?: unknown };
  if (obj.version !== 1) {
    return { imported: 0, skipped: 0, error: 'Unsupported export version.' };
  }
  const list = Array.isArray(obj.recipes) ? obj.recipes : null;

  if (!list) return { imported: 0, skipped: 0, error: 'Expected a recipe list.' };
  if (list.length > 1000) return { imported: 0, skipped: 0, error: 'Too many recipes in file.' };
  if (operations.length === 0) return { imported: 0, skipped: 0, error: 'Operation catalogue not loaded.' };

  const existing = loadRecipes();
  const existingIds = new Set(existing.map((r) => r.id));
  const merged = [...existing];
  let imported = 0;
  let skipped = 0;

  for (const entry of list) {
    const recipe = readRecipe(entry, operations);
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
