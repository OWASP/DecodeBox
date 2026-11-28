import { OperationError } from '../types';
export const MAX_OUTPUT = 16 * 1024 * 1024;
export function checkSize(size: number, limit = MAX_OUTPUT): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > limit) {
    throw new OperationError('Output exceeds the processing limit of ' + limit + ' bytes.');
  }
}
