
import type { BakeResult, HashIdentification, Layer, Candidate, OperationDef, Recipe } from './types';
import type { AutoDecodeOptions } from './detection/autoDecode';
import type { Analysis, AnalyseOptions } from './analysis';
import type { Inspection, InspectOptions } from './inspect';
import type { CtfOptions, CtfReport } from './ctf/types';
import { bytesToLatin1 } from './core/bytes';
import { encodeCharsetLossy, ENCODABLE_CHARSET_NAMES } from './core/charsets';
import { offload } from './worker/client';

const engine = () => import('./heavy');

export async function listOperations(): Promise<OperationDef[]> {
  return (await engine()).publicDefinitions();
}

export async function bake(input: string, recipe: Recipe): Promise<BakeResult> {
  return offload(input, { kind: 'bake', input, recipe }, async () =>
    (await engine()).bake(input, recipe),
  );
}

export async function detect(input: string): Promise<Candidate[]> {
  return offload(input, { kind: 'detect', input }, async () => (await engine()).detect(input));
}

export async function autoDecode(
  input: string,
  options?: Partial<AutoDecodeOptions>,
): Promise<Layer> {
  return offload(input, { kind: 'autoDecode', input, options }, async () =>
    (await engine()).autoDecode(input, options),
  );
}

export async function identify(input: string): Promise<HashIdentification | null> {
  return (await engine()).identify(input);
}

export async function analyse(input: string, options?: Partial<AnalyseOptions>): Promise<Analysis> {
  return offload(input, { kind: 'analyse', input, options }, async () =>
    (await engine()).analyse(input, options),
  );
}

/**
 * Unwraps the input and maps it in one call, so the chain is derived once.
 *
 * Kept as a single call rather than two because the decoded layers are several
 * megabytes of strings for a large input, and handing them from one call to
 * the next across the worker boundary would cost more than it saves.
 */
export async function inspect(input: string, options?: InspectOptions): Promise<Inspection> {
  return offload(input, { kind: 'inspect', input, options }, async () =>
    (await engine()).inspect(input, options),
  );
}

export async function hints(input: string, options?: Partial<CtfOptions>): Promise<CtfReport> {
  return offload(input, { kind: 'hints', input, options }, async () =>
    (await engine()).ctfHints(input, options),
  );
}


export const INPUT_ENCODINGS: string[] = ['Raw bytes', ...ENCODABLE_CHARSET_NAMES];

export { asBytes } from './core/bytes';
export { hexdumpOf } from './core/views';
export { rewrap, INVERSES, whyNotInvertible } from './core/rewrap';
export type { RewrapResult, RewrapBlocker } from './core/rewrap';

export function encodeInput(text: string, encoding: string): string {
  if (encoding === 'Raw bytes' || !INPUT_ENCODINGS.includes(encoding)) return text;
  return bytesToLatin1(encodeCharsetLossy(encoding, text));
}

export { CATEGORY_ORDER } from './operations/categories';
export { workerActive, WORKER_THRESHOLD } from './worker/client';
export {
  toChain,
  describeChain,
  summariseChain,
  describeRuns,
  chainConfidence,
  chainPreview,
  terminusOf,
  terminusName,
  lastLayer,
} from './detection/chain';
export { toMarkdown, flatten } from './analysis/report';
export { findInLayers, isValidQuery, DEFAULT_FIND_OPTIONS } from './analysis/find';
export type { LayerMatch, FindOptions } from './analysis/find';
export { explain } from './analysis/explain';
export {
  entropyProfile,
  standoutRegions,
  bandOf,
  MIN_FOR_PROFILE,
} from './analysis/entropy';
export type { EntropyBucket, EntropyBand } from './analysis/entropy';
export type { Explanation } from './analysis/explain';
export { defang } from './analysis/indicators';
export { RULE_COUNT } from './analysis/findings';
export { KIND_ORDER } from './ctf/types';
export { formatBytes, truncate, renderText } from './core/bytes';
export { imageMimeOf } from './core/imageMime';
export { fileSignatureOf } from './core/signatures';
export type { Signature } from './core/signatures';
export { CHARSET_NAMES, ENCODABLE_CHARSET_NAMES } from './core/charsets';

export type { Inspection, InspectOptions } from './inspect';
export type { AutoDecodeOptions } from './detection/autoDecode';
export { MAX_AUTO_DEPTH } from './detection/autoDecode';
export type { ChainRun } from './detection/chain';
export type { CtfOptions, CtfReport, FoundFlag, Hint, HintKind } from './ctf/types';
export type {
  Analysis,
  AnalyseOptions,
  AnalysisNode,
  Finding,
  Indicator,
  IndicatorKind,
  Severity,
} from './analysis/types';
export type {
  BakeResult,
  Candidate,
  EmbeddedFind,
  Evidence,
  HashIdentification,
  HashMatch,
  Layer,
  OperationArg,
  OperationDef,
  OutputType,
  Recipe,
  RecipeStep,
  Terminus,
  TerminusReason,
} from './types';
