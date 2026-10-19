import type { OperationArg, RecipeStep } from '../types';
import { getOperation } from '../operations';
import type { Operation } from '../operations/types';

/*
 * Every detector that suggests a recipe has to build the same thing: a step
 * carrying the operation's own default arguments, with a handful overridden.
 * Doing that in one place keeps a suggestion runnable — a step whose arguments
 * do not match the operation's definition is silently ignored by the recipe
 * editor, which looks like a detector that found nothing.
 */

function uid(opId: string): string {
  return `${opId}-${Math.random().toString(36).slice(2, 9)}`;
}

type Overrides = Record<string, string | number | boolean>;

export function stepFor(op: Operation, overrides: Overrides = {}): RecipeStep {
  const args: OperationArg[] = op.args.map((a) => {
    const override = overrides[a.name];
    return override === undefined ? { ...a } : { ...a, value: override };
  });
  return { uid: uid(op.id), opId: op.id, args, disabled: false };
}

export function stepById(opId: string, overrides: Overrides = {}): RecipeStep | null {
  const op = getOperation(opId);
  return op ? stepFor(op, overrides) : null;
}
