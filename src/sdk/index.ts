import './select';
import * as engine from '../engine/heavy';
import type { AutoDecodeOptions } from '../engine/detection/autoDecode';
import type { AnalyseOptions } from '../engine/analysis/types';
import type { CtfOptions } from '../engine/ctf/types';
import type { InspectOptions } from '../engine/inspect';
import type { OperationArg, Recipe, RecipeStep } from '../engine/types';
import { bytesToLatin1 } from '../engine/core/bytes';
import { CHARSET_NAMES } from '../engine/core/charsets';
import { runtime } from '../engine/runtime';
import { MAX_OUTPUT } from '../engine/runtime/limits';
import { version } from '../../package.json';

export type Input = string | Uint8Array | ArrayBuffer;
type Value = OperationArg['value'];
export type Arguments = Record<string, Value | { value: string; format: string }>;
export interface Step {
  opId: string;
  args?: Arguments;
  disabled?: boolean;
}

export class DecodeBoxError extends Error {
  readonly name = 'DecodeBoxError';
  constructor(
    readonly code: 'INVALID_INPUT' | 'UNKNOWN_OPERATION' | 'OPERATION_FAILED' | 'LIMIT_EXCEEDED',
    message: string,
  ) {
    super(message);
  }
}
const MAX_INPUT = 4 * 1024 * 1024;
const MAX_STEPS = 128;
const bad = (message: string): never => {
  throw new DecodeBoxError('INVALID_INPUT', message);
};
function checkLength(size: number, limit: number) {
  if (size > limit)
    throw new DecodeBoxError('LIMIT_EXCEEDED', 'Value exceeds limit of ' + limit + '.');
}
function inputOf(value: Input) {
  if (typeof value === 'string') {
    checkLength(value.length, MAX_INPUT);
    return value;
  }
  if (!(value instanceof Uint8Array || value instanceof ArrayBuffer))
    return bad('Expected a string, Uint8Array or ArrayBuffer.');
  checkLength(value.byteLength, MAX_INPUT);
  return bytesToLatin1(value instanceof Uint8Array ? value : new Uint8Array(value));
}
function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
type RecipeInput = readonly (Step | RecipeStep)[] | Pick<Recipe, 'steps'>;

function argumentValues(args: Arguments | OperationArg[] | undefined, maxArgs: number): Arguments {
  if (args === undefined) return {};
  if (!Array.isArray(args)) {
    if (!record(args)) return bad('Expected an argument map.');
    return args;
  }
  if (args.length > maxArgs) return bad('Too many recipe arguments.');
  const result: Arguments = Object.create(null);
  for (const item of args) {
    if (!record(item) || typeof item.name !== 'string' || Object.hasOwn(result, item.name)) {
      return bad('Invalid or duplicate recipe argument.');
    }
    result[item.name] =
      item.toggleValue === undefined
        ? item.value
        : { value: String(item.value), format: item.toggleValue };
  }
  return result;
}

function prepare(step: Step | RecipeStep, i: number): RecipeStep {
  if (!record(step) || typeof step.opId !== 'string') return bad('Expected a step with an opId.');
  const op = engine.getOperation(step.opId);
  if (!op) throw new DecodeBoxError('UNKNOWN_OPERATION', 'Unknown operation: ' + step.opId);
  if (step.disabled !== undefined && typeof step.disabled !== 'boolean')
    return bad('disabled must be boolean.');
  const values = argumentValues(step.args, op.args.length);
  if (!record(values) || Object.keys(values).some((key) => !op.args.some((a) => a.name === key)))
    return bad('Unknown or invalid arguments for ' + op.id);
  const args = op.args.map((a) => {
    if (!Object.hasOwn(values, a.name)) return { ...a };
    const raw = values[a.name];
    const v = record(raw) ? raw.value : raw;
    if (typeof v !== typeof a.value || v === undefined) return bad('Invalid type for ' + a.name);
    if (typeof v === 'string') checkLength(v.length, MAX_INPUT);
    if (
      typeof v === 'number' &&
      (!Number.isFinite(v) || v < (a.min ?? -Infinity) || v > (a.max ?? Infinity))
    )
      return bad('Out of range: ' + a.name);
    if (a.options && !a.options.includes(String(v))) return bad('Invalid option for ' + a.name);
    if (record(raw) && (a.type !== 'toggleString' || !a.toggleValues?.includes(raw.format)))
      return bad('Invalid format for ' + a.name);
    return { ...a, value: v as Value, ...(record(raw) ? { toggleValue: raw.format } : {}) };
  });
  return { uid: String(i), opId: op.id, disabled: step.disabled ?? false, args };
}
function options<T>(value: T | undefined, bounds: Record<string, number | string>): T | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) return bad('Expected an options object.');
  for (const [k, v] of Object.entries(value)) {
    const max = bounds[k];
    if (!Object.hasOwn(bounds, k)) return bad('Unknown option: ' + k);
    if (typeof max === 'string') {
      if (typeof v !== 'string' || v.length > 256) return bad('Invalid option: ' + k);
    } else if (
      typeof v !== 'number' ||
      !Number.isFinite(v) ||
      v < 0 ||
      v > max! ||
      (k !== 'threshold' && !Number.isSafeInteger(v))
    )
      return bad('Out of range: ' + k);
  }
  return value;
}
const decodeBounds = { maxDepth: 64, budgetMs: 60000, threshold: 1 };
const analysisBounds = { ...decodeBounds, maxNodes: 1024 };
export const apiVersion = '1.0.0';
export const engineVersion = version;
export const ready: Promise<void> = Promise.resolve();
export function capabilities() {
  return {
    runtime: runtime.name,
    cryptography: !!runtime.subtle,
    secureRandom: runtime.secureRandom,
    compressionFormats: runtime.compressionFormats(),
    charsets: [...CHARSET_NAMES],
    maxInputLength: MAX_INPUT,
    maxOutputLength: MAX_OUTPUT,
    maxSteps: MAX_STEPS,
  };
}
export function listOperations() {
  return engine.publicDefinitions();
}
export function getOperation(id: string) {
  const op = engine.getOperation(id);
  return op ? engine.publicDefinition(op) : null;
}
export async function bake(input: Input, recipe: RecipeInput) {
  const steps = Array.isArray(recipe) ? recipe : (recipe as Pick<Recipe, 'steps'> | null)?.steps;
  if (!Array.isArray(steps) || steps.length > MAX_STEPS)
    return bad('Expected an array of at most 128 recipe steps.');
  const value = inputOf(input);
  let argumentLength = 0;
  const prepared = Array.from(steps, (step, i) => {
    const checked = prepare(step, i);
    for (const arg of checked.args) {
      if (typeof arg.value === 'string') argumentLength += arg.value.length;
    }
    checkLength(argumentLength, MAX_INPUT);
    return checked;
  });
  return engine.bake(value, { id: 'sdk', name: 'SDK', steps: prepared });
}
export async function executeOperation(
  opId: string,
  input: Input,
  args?: Arguments,
): Promise<string> {
  const result = await bake(input, [{ opId, args }]);
  if (result.error) throw new DecodeBoxError('OPERATION_FAILED', result.error.message);
  return result.output;
}
export async function detect(input: Input) {
  return engine.detect(inputOf(input));
}
export async function autoDecode(input: Input, opts?: Partial<AutoDecodeOptions>) {
  return engine.autoDecode(inputOf(input), options(opts, decodeBounds));
}
export async function identify(input: Input) {
  return engine.identify(inputOf(input));
}
export async function analyse(input: Input, opts?: Partial<AnalyseOptions>) {
  return engine.analyse(inputOf(input), options(opts, analysisBounds));
}
export async function inspect(input: Input, opts: InspectOptions = {}) {
  if (!record(opts) || Object.keys(opts).some((k) => k !== 'decode' && k !== 'analyse'))
    return bad('Invalid inspection options.');
  return engine.inspect(inputOf(input), {
    decode: options((opts as InspectOptions).decode, decodeBounds),
    analyse: options((opts as InspectOptions).analyse, analysisBounds),
  });
}
export async function hints(input: Input, opts?: Partial<CtfOptions>) {
  return engine.ctfHints(
    inputOf(input),
    options(opts, { maxDepth: 64, budgetMs: 60000, format: '' }),
  );
}

export const DecodeBox = Object.freeze({
  ready,
  apiVersion,
  engineVersion,
  capabilities,
  listOperations,
  getOperation,
  executeOperation,
  bake,
  detect,
  autoDecode,
  identify,
  analyse,
  inspect,
  hints,
});
export default DecodeBox;
