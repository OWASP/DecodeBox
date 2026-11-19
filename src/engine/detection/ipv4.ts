import type { Candidate, RecipeStep } from '../types';
import { getOperation } from '../operations/registryAccess';
import { stepFor } from './steps';
import { identify } from './identify';

const OPERATION = 'change-ip-format';

/** Whole-address numbers, rather than the byte groups handled by From Octal/Hex. */
export function ipv4Candidates(input: string): Candidate[] {
  const text = input.trim();
  if (text.length > 12) return [];

  let notation: string;
  let distinctive: boolean;
  let shape: string;
  if (/^0[xX][0-9a-fA-F]{1,8}$/.test(text)) {
    notation = 'hexadecimal';
    distinctive = text.length === 10;
    shape = 'An explicit 0x prefix followed by at most eight hexadecimal digits.';
  } else if (/^0[0-7]{1,11}$/.test(text)) {
    notation = 'octal';
    distinctive = /^0[1-7][0-7]{8,10}$/.test(text);
    shape = 'A leading zero followed entirely by octal digits, with no byte separators.';
  } else if (/^(?:0|[1-9][0-9]{0,9})$/.test(text)) {
    notation = 'decimal';
    distinctive = false;
    shape = 'A whole decimal number with no separators or sign.';
  } else {
    return [];
  }

  const operation = getOperation(OPERATION);
  if (!operation) return [];
  const step = stepFor(operation, { To: 'Dotted decimal' });
  let output: string;
  try {
    // Reuse the converter's range checks and radix rules; do not wrap modulo 2^32.
    const result = operation.run(text, step.args);
    if (typeof result !== 'string') return [];
    output = result;
  } catch {
    return [];
  }

  return [{
    id: `ipv4-${notation}`,
    format: `IPv4 (${notation})`,
    // Full prefixed forms can be previewed automatically. Bare numbers and
    // short literals stay below the default threshold: dates, IDs and Unix
    // permissions must not become IP addresses just because they fit 32 bits.
    confidence: distinctive ? 0.62 : 0.35,
    evidence: [
      {
        label: `valid 32-bit ${notation} value`,
        detail: `${shape} The value is in the IPv4 range 0–4294967295 and converts to ${output}.`,
        weight: 0.65,
      },
      {
        label: 'possible address, not proof of intent',
        detail: distinctive
          ? 'The prefix and width support an IPv4 interpretation, but the same number may be a checksum or another numeric value. Check the context before using it as an address.'
          : 'A number alone does not establish an IP address: it may be a timestamp, identifier, permission or ordinary integer. This interpretation is offered for explicit selection.',
        weight: 0.35,
      },
    ],
    preview: output,
    steps: [step],
  }];
}

/** Retain competing interpretations when a numeric IP is one of the possibilities. */
export function ipv4Alternatives(
  input: string,
  candidates: Candidate[],
  chosen: Candidate | undefined,
  preceding: RecipeStep[],
  threshold: number,
): Candidate[] {
  const ip = candidates.find((candidate) => candidate.steps[0]?.opId === OPERATION);
  if (!ip) return [];

  const alternatives = candidates
    .filter((candidate) => candidate !== chosen && (candidate === ip || candidate.confidence >= threshold))
    .map((candidate) => ({ ...candidate, steps: [...preceding, ...candidate.steps] }));

  // Identification is independent of decoding. In particular, an eight-digit
  // hex value can still be a checksum even when the address preview is useful.
  for (const match of identify(input)?.matches ?? []) {
    alternatives.push({
      id: `identified-${match.name}`,
      format: match.name,
      confidence: match.confidence,
      evidence: [{ label: match.reason, detail: match.context ?? match.reason, weight: match.confidence }],
      preview: input.trim(),
      steps: [],
    });
  }
  return alternatives.slice(0, 5);
}
