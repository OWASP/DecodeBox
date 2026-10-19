import { OperationError } from '../types';
import { latin1ToBytes, toBytes } from '../core/bytes';

export function parseKey(value: string, format: string, allowEmpty = true): Uint8Array {
  if (format === 'Hex') {
    const cleaned = value.replace(/[^0-9a-fA-F]/g, '');
    if (cleaned.length === 0 && !allowEmpty) throw new OperationError('A key is required.');
    if (cleaned.length % 2 !== 0) {
      throw new OperationError('Hex key must have an even number of digits.');
    }
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
    return bytes;
  }

  if (format === 'Base64') {
    try {
      return latin1ToBytes(atob(value.trim()));
    } catch {
      throw new OperationError('Key is not valid Base64.');
    }
  }

  if (format === 'Latin1') return latin1ToBytes(value);
  if (format === 'Decimal') {
    const parts = value.split(/[^0-9]+/).filter((p) => p !== '');
    const bytes = new Uint8Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const n = Number(parts[i]);
      if (n > 255) throw new OperationError(`${n} is not a byte value.`);
      bytes[i] = n;
    }
    return bytes;
  }

  return toBytes(value);
}

export const KEY_FORMATS = ['UTF-8', 'Hex', 'Base64', 'Latin1', 'Decimal'];
