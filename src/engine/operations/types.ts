import type { OperationArg, OperationDef } from '../types';

export interface DetectionCriteria {
  entropy?: [number, number];
  pattern?: RegExp;
  magic?: string;
  lengthMultiple?: number;
  formatName?: string;
  minLength?: number;
  test?: (text: string, bytes: Uint8Array) => { label: string; detail: string } | null;
  terminalNote?: string;
}

export interface Operation extends OperationDef {
  run: (input: string, args: OperationArg[]) => string | Promise<string>;
  detection?: DetectionCriteria;
  isFlowControl?: boolean;
  budgetMs?: number;
}

export function arg(args: OperationArg[], name: string, fallback: string): string;
export function arg(args: OperationArg[], name: string, fallback: number): number;
export function arg(args: OperationArg[], name: string, fallback: boolean): boolean;
export function arg(
  args: OperationArg[],
  name: string,
  fallback: string | number | boolean,
): string | number | boolean {
  const found = args.find((a) => a.name === name);
  return found === undefined ? fallback : found.value;
}

export function toggle(args: OperationArg[], name: string, fallback: string): string {
  const found = args.find((a) => a.name === name);
  return found?.toggleValue ?? fallback;
}
