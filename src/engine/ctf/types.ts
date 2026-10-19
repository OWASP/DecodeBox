import type { RecipeStep } from '../types';

export type HintKind = 'flag' | 'decode' | 'crack' | 'shape' | 'identify' | 'inspect';

export const KIND_ORDER: Record<HintKind, number> = {
  flag: 0,
  decode: 1,
  crack: 2,
  shape: 3,
  identify: 4,
  inspect: 5,
};

export interface Hint {
  id: string;
  kind: HintKind;
  title: string;
  reason: string;
  confidence: number;
  depth: number;
  path: string;
  preview: string;
  steps: RecipeStep[];
}

export interface FoundFlag {
  text: string;
  depth: number;
  path: string;
  known: boolean;
}

export interface CtfReport {
  flags: FoundFlag[];
  hints: Hint[];
  layers: number;
  truncated: boolean;
  durationMs: number;
}

export interface CtfOptions {
  format: string;
  maxDepth: number;
  budgetMs: number;
}

export const DEFAULT_CTF_OPTIONS: CtfOptions = {
  format: '',
  /*
   * The same limit the ordinary detector uses. A CTF flag is the one thing
   * most likely to be wrapped more than six times on purpose, so this is the
   * last place that should stop early.
   */
  maxDepth: 64,
  /*
   * Longer than it looks like it needs, because this pass unwraps the input
   * itself rather than reusing what the workspace already decoded. On a 1.9 MB
   * file wrapped forty-four times it needs about four and a half seconds, and
   * at the old ceiling of four it stopped short and said so.
   */
  budgetMs: 10000,
};
