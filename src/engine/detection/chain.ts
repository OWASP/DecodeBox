import type { Layer, Terminus } from '../types';
import { previewText } from '../core/bytes';


export function toChain(root: Layer): Layer[] {
  const chain: Layer[] = [root];
  let node = root;
  while (node.children.length > 0) {
    const next = node.children[0]!;
    chain.push(next);
    node = next;
  }
  return chain;
}

export function lastLayer(root: Layer): Layer {
  const chain = toChain(root);
  return chain[chain.length - 1]!;
}

export function terminusOf(root: Layer): Terminus | null {
  return lastLayer(root).terminus ?? null;
}

export function terminusName(root: Layer): string | null {
  return terminusOf(root)?.identification?.matches[0]?.name ?? null;
}

export function describeChain(root: Layer): string {
  const decoded = toChain(root).slice(1);
  const terminus = terminusOf(root);
  const named = terminus?.identification?.matches[0]?.name;

  const parts = decoded.map((layer) => layer.format);
  if (named) parts.push(named);

  if (parts.length === 0) return named ?? 'Plain text';
  return parts.join(' → ') + (terminus && !terminus.complete ? ' → …' : '');
}

export interface ChainRun {
  format: string;
  count: number;
}

export function summariseChain(root: Layer): ChainRun[] {
  const runs: ChainRun[] = [];
  for (const layer of toChain(root).slice(1)) {
    const last = runs[runs.length - 1];
    if (last && last.format === layer.format) last.count += 1;
    else runs.push({ format: layer.format, count: 1 });
  }
  return runs;
}

export function describeRuns(runs: ChainRun[]): string {
  return runs.map((run) => (run.count > 1 ? `${run.format} x${run.count}` : run.format)).join(' - ');
}

/**
 * A path through the layers, with repeats counted rather than listed.
 *
 * Forty-four layers of Base64 written out in full is six lines of the same
 * word, which tells the reader nothing they could not have got from the
 * number.
 */
export function describePath(formats: readonly string[]): string {
  const runs: ChainRun[] = [];
  for (const format of formats) {
    const last = runs[runs.length - 1];
    if (last && last.format === format) last.count += 1;
    else runs.push({ format, count: 1 });
  }

  return runs
    .map((run) => (run.count > 1 ? `${run.format} ×${run.count}` : run.format))
    .join(' → ');
}

export function chainConfidence(root: Layer): number {
  const decoded = toChain(root).slice(1);
  if (decoded.length === 0) return 0;
  return Math.min(...decoded.map((layer) => layer.confidence));
}

export function chainPreview(root: Layer): string {
  return previewText(lastLayer(root).output);
}
