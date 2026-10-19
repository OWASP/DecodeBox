import type { Operation } from './types';

let lookup: ((id: string) => Operation | undefined) | null = null;
let detectable: Operation[] | null = null;

export function provideRegistry(
  fn: (id: string) => Operation | undefined,
  operations: Operation[],
): void {
  lookup = fn;
  detectable = operations;
}

export function getOperation(id: string): Operation | undefined {
  return lookup?.(id);
}

export function detectableOperations(): Operation[] {
  if (!detectable) {
    throw new Error('The operation registry has not been loaded, so detection cannot run.');
  }
  return detectable;
}
