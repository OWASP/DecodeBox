import type { OperationDef, RecipeStep } from '../engine';
import { safeArgValue } from './share';


interface TextStep {
  op: string;
  args?: Record<string, string | number | boolean>;
  disabled?: boolean;
}

export function toText(steps: RecipeStep[], operations: OperationDef[]): string {
  const plain: TextStep[] = steps.map((step) => {
    const definition = operations.find((op) => op.id === step.opId);
    const entry: TextStep = { op: step.opId };

    for (const arg of step.args) {
      const original = definition?.args.find((a) => a.name === arg.name);
      if (original && original.value !== arg.value) {
        entry.args ??= {};
        entry.args[arg.name] = arg.value;
      }
    }

    if (step.disabled) entry.disabled = true;
    return entry;
  });

  return JSON.stringify(plain, null, 2);
}

export interface ParseResult {
  steps?: RecipeStep[];
  error?: string;
}

export function fromText(text: string, operations: OperationDef[]): ParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { steps: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Not valid JSON' };
  }

  if (!Array.isArray(parsed)) return { error: 'The recipe must be an array of steps.' };

  const steps: RecipeStep[] = [];

  for (const [index, raw] of parsed.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      return { error: `Step ${index + 1} is not an object.` };
    }

    const entry = raw as TextStep;
    if (typeof entry.op !== 'string') {
      return { error: `Step ${index + 1} has no "op" name.` };
    }

    const definition = operations.find((op) => op.id === entry.op);
    if (!definition) {
      return { error: `Step ${index + 1}: no operation called "${entry.op}".` };
    }

    if (entry.args !== undefined) {
      if (typeof entry.args !== 'object' || entry.args === null) {
        return { error: `Step ${index + 1}: "args" must be an object.` };
      }
      for (const name of Object.keys(entry.args)) {
        if (!definition.args.some((a) => a.name === name)) {
          return { error: `Step ${index + 1}: "${definition.name}" has no argument "${name}".` };
        }
      }
    }

    steps.push({
      uid: `${entry.op}-${Math.random().toString(36).slice(2, 9)}`,
      opId: entry.op,
      args: definition.args.map((arg) => ({
        ...arg,
        value: safeArgValue(entry.args?.[arg.name], arg.value),
      })),
      disabled: entry.disabled === true,
    });
  }

  return { steps };
}
