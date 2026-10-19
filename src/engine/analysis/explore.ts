import type { Layer, RecipeStep } from '../types';
import { getOperation } from '../operations';
import { byteLength, previewText } from '../core/bytes';
import { detect } from '../detection/detect';
import { findEmbedded } from '../detection/embedded';
import type { AnalysisNode, AnalyseOptions } from './types';


interface Decoded {
  output: string;
  format: string;
  confidence: number;
  step: RecipeStep;
}

/**
 * The chain the decoder already worked out, or null to work it out here.
 *
 * Deriving the same chain twice is the most expensive thing this tool does. On
 * a 1.9 MB file wrapped forty-four times, the decoder and the analysis were
 * each unwrapping all forty-four layers — the same work, on the same bytes, to
 * the same answer — and neither finished inside its time budget, because the
 * other was spending it.
 *
 * An empty array is not the same as null. It means the chain was supplied and
 * has run out, so there is nothing further down to look for.
 */
export type Spine = readonly Layer[] | null;

interface Budget {
  nodes: number;
  deadline: number;
  seen: Set<string>;
  truncated: boolean;
}

function exhausted(budget: Budget, options: AnalyseOptions): boolean {
  if (budget.nodes >= options.maxNodes || performance.now() > budget.deadline) {
    budget.truncated = true;
    return true;
  }
  return false;
}

async function decodeBest(text: string, options: AnalyseOptions): Promise<Decoded | null> {
  const candidates = await detect(text);
  const best = candidates[0];
  if (!best || best.confidence < options.threshold) return null;

  const step = best.steps[0];
  if (!step) return null;

  const operation = getOperation(step.opId);
  if (!operation) return null;

  try {
    const output = await Promise.resolve(operation.run(text, step.args));
    if (output === text || output.length === 0) return null;
    return { output, format: best.format, confidence: best.confidence, step };
  } catch {
    return null;
  }
}

/**
 * The parent's path with one more format on the end, repeats counted.
 *
 * Written out in full, forty-four layers of Base64 is six lines of the same
 * word in every finding, every search hit and every panel that shows where a
 * layer came from.
 */
function extendPath(parentPath: string, format: string): string {
  if (parentPath.length === 0) return format;

  const parts = parentPath.split(' → ');
  const last = parts[parts.length - 1] ?? '';
  const repeated = /^(.*) ×(\d+)$/.exec(last);

  if (repeated && repeated[1] === format) {
    parts[parts.length - 1] = `${format} ×${Number(repeated[2]) + 1}`;
  } else if (last === format) {
    parts[parts.length - 1] = `${format} ×2`;
  } else {
    parts.push(format);
  }

  return parts.join(' → ');
}

function makeNode(
  format: string,
  confidence: number,
  depth: number,
  parentPath: string,
  output: string,
  steps: RecipeStep[],
  origin?: { label: string; offset: number },
): AnalysisNode {
  const path = extendPath(parentPath, format);
  return {
    id: `${format}-${depth}-${Math.random().toString(36).slice(2, 8)}`,
    format,
    confidence,
    depth,
    path,
    byteLength: byteLength(output),
    output,
    preview: previewText(output, 120),
    steps,
    children: [],
    ...(origin ? { origin } : {}),
  };
}

function fromSpine(spine: Spine): Decoded | null {
  const next = spine?.[0];
  const step = next?.steps[next.steps.length - 1];
  if (!next || !step) return null;

  return { output: next.output, format: next.format, confidence: next.confidence, step };
}

async function walk(
  node: AnalysisNode,
  options: AnalyseOptions,
  budget: Budget,
  spine: Spine,
): Promise<void> {
  if (node.depth >= options.maxDepth) return;
  if (exhausted(budget, options)) return;

  const whole = spine === null ? await decodeBest(node.output, options) : fromSpine(spine);
  if (whole && !budget.seen.has(whole.output)) {
    budget.seen.add(whole.output);
    budget.nodes++;

    const child = makeNode(
      whole.format,
      whole.confidence,
      node.depth + 1,
      node.path,
      whole.output,
      [...node.steps, whole.step],
    );
    node.children.push(child);
    await walk(child, options, budget, spine === null ? null : spine.slice(1));
  }

  /*
   * Then the parts. A layer is rarely the whole story: a JSON body with one
   * Base64 field, a log line with a JWT in it, or plain text with a payload
   * glued to the end all decode in part and not in whole.
   *
   * These children carry the steps that cut the payload out before decoding
   * it, so a branch of the tree is a recipe that runs, not just a label.
   */
  for (const find of findEmbedded(node.output)) {
    if (exhausted(budget, options)) return;
    if (budget.seen.has(find.decoded)) continue;

    budget.seen.add(find.decoded);
    budget.nodes++;

    const child = makeNode(
      find.format,
      find.confidence,
      node.depth + 1,
      node.path,
      find.decoded,
      [...node.steps, ...find.steps],
      { label: find.format, offset: find.offset },
    );
    node.children.push(child);
    // A branch is nothing the decoder walked, so it is explored from here.
    await walk(child, options, budget, null);
  }
}

export async function explore(
  input: string,
  options: AnalyseOptions,
  spine: Spine = null,
): Promise<{ root: AnalysisNode; nodes: number; truncated: boolean }> {
  const root = makeNode('Input', 1, 0, '', input, []);
  root.path = 'Input';

  const budget: Budget = {
    nodes: 1,
    deadline: performance.now() + options.budgetMs,
    seen: new Set([input]),
    truncated: false,
  };

  if (input.trim().length > 0) await walk(root, options, budget, spine);

  return { root, nodes: budget.nodes, truncated: budget.truncated };
}

export { flatten } from './report';
