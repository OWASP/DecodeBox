import type { Layer } from './types';
import type { AutoDecodeOptions } from './detection/autoDecode';
import type { Analysis, AnalyseOptions } from './analysis';
import { autoDecode } from './detection/autoDecode';
import { toChain } from './detection/chain';
import { analyse } from './analysis';

/*
 * Unwrapping and mapping, as one piece of work.
 *
 * These were two calls, started together, and they were deriving the same
 * chain twice from the same bytes. On a 1.9 MB file wrapped forty-four times
 * that cost about eight seconds of work between them, and because they were
 * interleaved on one thread each one's time budget was being spent by the
 * other: both gave up after six layers and reported that there might be more
 * underneath. There was — thirty-eight more.
 *
 * Run as one call, the decoder does the unwrapping and the analysis is handed
 * the result, so the same forty-four layers are decoded once. The chain never
 * crosses a thread boundary either, which matters because it is several
 * megabytes of strings by the time it is finished.
 */

export interface Inspection {
  root: Layer;
  analysis: Analysis;
}

export interface InspectOptions {
  decode?: Partial<AutoDecodeOptions>;
  analyse?: Partial<AnalyseOptions>;
}

export async function inspect(input: string, options: InspectOptions = {}): Promise<Inspection> {
  const root = await autoDecode(input, options.decode);
  const analysis = await analyse(input, options.analyse, toChain(root).slice(1));

  return { root, analysis };
}
