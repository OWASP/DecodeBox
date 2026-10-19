import type { Candidate, Layer, RecipeStep, Terminus, TerminusReason } from '../types';
import { getOperation } from '../operations';
import { byteLength } from '../core/bytes';
import { detect } from './detect';
import { findEmbedded } from './embedded';
import { terminalIdentification } from './identify';
import { SHORTEST_ORDINARY } from './short';

export interface AutoDecodeOptions {
  maxDepth: number;
  threshold: number;
  budgetMs: number;
}

/*
 * The depth limit is a safety catch, not a policy.
 *
 * It used to be six, and six is a number that real data walks straight past:
 * anything wrapped more than six times stopped with "there may be another
 * layer below this", which is the tool admitting it gave up rather than
 * finishing. Unwrapping is cheap — every layer of Base64 is a quarter smaller
 * than the one above it, and twenty-four layers of it cost about a tenth of a
 * second — so the limit can sit far out of the way and let the chain end for a
 * reason that means something: nothing left to decode, a cycle, or a format
 * that has been identified.
 *
 * What actually has to be bounded is time, and that is what `budgetMs` is for.
 */
export const MAX_AUTO_DEPTH = 256;

/*
 * The ceiling is how long someone will wait, not how long the page will
 * freeze: anything big enough to approach it is handed to a worker, so the
 * interface stays responsive while this runs. Four seconds was not enough for
 * a two-megabyte file wrapped forty-four times, which finishes in about three.
 */
export const DEFAULT_OPTIONS: AutoDecodeOptions = {
  maxDepth: 64,
  threshold: 0.55,
  budgetMs: 10000,
};

type PlainReason = Exclude<TerminusReason, 'identified' | 'remainder'>;

const NOTES: Record<PlainReason, string> = {
  plain: 'Nothing below this decodes any further — this is the content itself.',
  tooShort:
    'Too short to judge. A few characters can be read as almost any encoding, so this may still ' +
    'be wrapped in something — there is just no evidence either way.',
  depth: 'The depth limit was reached, so there may be another layer below this.',
  budget: 'The time budget ran out, so there may be another layer below this.',
  cycle: 'Decoding started repeating itself, so it was stopped here.',
  failed: 'The next layer looked decodable but the decode failed, so it stops here.',
};

function ending(reason: PlainReason): Terminus {
  return { reason, note: NOTES[reason], complete: reason === 'plain' };
}

function tooShortToJudge(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length < SHORTEST_ORDINARY;
}

function looksLikeText(value: string): boolean {
  if (value.length === 0) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const printable = code >= 0x20 && code <= 0x7e;
    const whitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!printable && !whitespace) return false;
  }
  return true;
}

async function continuation(
  value: string,
  lastStep: RecipeStep | undefined,
  format: string,
  seen: ReadonlySet<string>,
  depth: number,
): Promise<Candidate | undefined> {
  if (!lastStep || !tooShortToJudge(value)) return undefined;

  const operation = getOperation(lastStep.opId);
  if (!operation) return undefined;

  let output: string;
  try {
    output = await Promise.resolve(operation.run(value, lastStep.args));
  } catch {
    return undefined;
  }

  if (output === value || seen.has(output) || !looksLikeText(output)) return undefined;

  return {
    id: `continued-${depth}`,
    format,
    confidence: 0.5,
    evidence: [
      {
        label: `continues ${format}`,
        detail:
          `Too short for any detector to judge alone, but every layer above it is ${format} and ` +
          `decoding it once more gives clean text. The chain is the evidence, not the value.`,
        weight: 0.5,
      },
    ],
    preview: output.slice(0, 120),
    steps: [{ ...lastStep, uid: `${lastStep.opId}-continued-${depth}` }],
  };
}

function settle(value: string, lastStep: RecipeStep | undefined): Terminus {
  const found = terminalIdentification(value);
  if (!found) {
    const note = lastStep ? getOperation(lastStep.opId)?.detection?.terminalNote : undefined;
    if (note) return { reason: 'remainder', note, complete: true };
    return ending(tooShortToJudge(value) ? 'tooShort' : 'plain');
  }

  const best = found.matches[0]!;
  return {
    reason: 'identified',
    complete: true,
    note: found.oneWay
      ? `This is ${best.name}, which is one-way. There is nothing left to decode.`
      : `Identified as ${best.name}. It does not decode into anything further.`,
    identification: found,
  };
}

export async function autoDecode(
  input: string,
  options: Partial<AutoDecodeOptions> = {},
): Promise<Layer> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const limit = Math.max(1, Math.min(opts.maxDepth, MAX_AUTO_DEPTH));
  const deadline = performance.now() + opts.budgetMs;

  const root: Layer = {
    id: 'input',
    depth: 0,
    format: 'Input',
    confidence: 1,
    byteLength: byteLength(input),
    output: input,
    evidence: [],
    steps: [],
    children: [],
  };

  /*
   * Looked for on the input itself, because that is where a payload glued to
   * something else lives: `testbTRzaA==` has no layer wrapped around it, so
   * the chain below finds nothing, and the only true answer about it is that
   * part of it decodes.
   */
  const embedded = findEmbedded(input);
  if (embedded.length > 0) root.embedded = embedded;

  let node = root;
  let current = input;
  const chain: RecipeStep[] = [];
  const seen = new Set<string>([current]);

  for (let depth = 1; depth <= limit; depth++) {
    if (current.trim().length === 0) {
      node.terminus = ending('plain');
      return root;
    }
    if (performance.now() > deadline) {
      node.terminus = ending('budget');
      return root;
    }

    const candidates = await detect(current);
    const detected = candidates[0];
    const best =
      detected && detected.confidence >= opts.threshold
        ? detected
        : await continuation(current, chain[chain.length - 1], node.format, seen, depth);
    if (!best) {
      node.terminus = settle(current, chain[chain.length - 1]);
      return root;
    }

    const step = best.steps[0];
    const operation = step ? getOperation(step.opId) : undefined;
    if (!step || !operation) {
      node.terminus = ending('failed');
      return root;
    }

    let output: string;
    try {
      output = await Promise.resolve(operation.run(current, step.args));
    } catch {
      node.terminus = ending('failed');
      return root;
    }

    if (seen.has(output)) {
      node.terminus = ending('cycle');
      return root;
    }
    seen.add(output);

    chain.push(step);

    const child: Layer = {
      id: `${best.id}-${depth}`,
      depth,
      format: best.format,
      confidence: best.confidence,
      byteLength: byteLength(output),
      output,
      evidence: best.evidence,
      steps: chain.map((s) => ({ ...s })),
      children: [],
    };

    node.children.push(child);
    node = child;
    current = output;
  }

  node.terminus = ending('depth');
  return root;
}

export {
  toChain,
  describeChain,
  chainPreview,
  summariseChain,
  describeRuns,
  chainConfidence,
} from './chain';
