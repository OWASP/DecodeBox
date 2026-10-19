import type { Candidate, Evidence } from '../types';
import { detectableOperations } from '../operations/registryAccess';
import { matchSignature } from '../core/signatures';
import { utf16leRatio } from '../operations/dataFormat';
import { bruteForce } from './bruteForce';
import { shortCandidates } from './short';
import { stepFor } from './steps';
import type { Operation } from '../operations/types';
import {
  asBytes,
  describeCharset,
  previewText,
  printableRatio,
  renderText,
  shannonEntropy,
  tryDecodeUtf8,
} from '../core/bytes';
import { printableTextRatio } from './readability';


const MAX_DETECT_BYTES = 512 * 1024;

interface Measurements {
  text: string;
  /*
   * The same input read as characters instead of bytes.
   *
   * Operations are handed UTF-8 as a byte string, so a format whose alphabet
   * lives outside ASCII never matched its own pattern: braille arrived as
   * three bytes per dot cell and `/^[⠀-⠿]+$/` saw none of them.
   */
  rendered: string;
  bytes: Uint8Array;
  entropy: number;
  printable: number;
  charset: string;
  length: number;
}

function measure(input: string): Measurements {
  const text = input.length > MAX_DETECT_BYTES ? input.slice(0, MAX_DETECT_BYTES) : input;
  const bytes = asBytes(text);
  return {
    text,
    rendered: renderText(text),
    bytes,
    entropy: shannonEntropy(bytes),
    printable: printableRatio(bytes),
    charset: describeCharset(text),
    length: text.replace(/\s/g, '').length,
  };
}

function hexPrefix(text: string, length: number): string {
  return Array.from(asBytes(text.slice(0, length)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function magicMatches(text: string, magic: string): boolean {
  return hexPrefix(text, magic.length).startsWith(magic.toLowerCase());
}

function passesCriteria(op: Operation, m: Measurements): Evidence[] | null {
  const criteria = op.detection;
  if (!criteria) return null;

  const evidence: Evidence[] = [];

  if (criteria.minLength !== undefined && m.length < criteria.minLength) return null;

  if (criteria.magic !== undefined) {
    if (!magicMatches(m.text, criteria.magic)) return null;
    const spaced = criteria.magic.toUpperCase().replace(/(..)/g, '$1 ').trim();
    evidence.push({
      label: `magic bytes ${spaced}`,
      detail: `The data begins with the byte signature ${spaced}, which identifies this format unambiguously.`,
      weight: 0.95,
    });
  }

  if (criteria.pattern !== undefined) {
    const matches =
      criteria.pattern.test(m.text.trim()) ||
      (m.rendered !== m.text && criteria.pattern.test(m.rendered.trim()));
    if (!matches) return null;
    evidence.push({
      label: `charset ${m.charset}`,
      detail: `Every character in the input belongs to this format's alphabet (${m.charset}).`,
      weight: 0.4,
    });
  }

  if (criteria.entropy !== undefined) {
    const [min, max] = criteria.entropy;
    if (m.entropy < min || m.entropy > max) return null;
    evidence.push({
      label: `entropy ${m.entropy.toFixed(2)}`,
      detail:
        `${m.entropy.toFixed(2)} bits of randomness per byte. This format normally lands between ` +
        `${min} and ${max}; plain text sits lower, compressed or encrypted data higher.`,
      weight: 0.3,
    });
  }

  if (criteria.lengthMultiple !== undefined) {
    if (m.length % criteria.lengthMultiple !== 0) return null;
    evidence.push({
      label: `length ÷ ${criteria.lengthMultiple}`,
      detail: `${m.length} characters, a whole multiple of ${criteria.lengthMultiple}, as this format requires.`,
      weight: 0.25,
    });
  }

  if (criteria.test !== undefined) {
    const result = criteria.test(m.text, m.bytes);
    if (!result) return null;
    evidence.push({ ...result, weight: 0.85 });
  }

  return evidence;
}

function lookahead(output: string, excludeId: string, bytes: Uint8Array): Evidence | null {
  for (const op of detectableOperations()) {
    if (op.id === excludeId) continue;
    const magic = op.detection?.magic;
    if (magic && magicMatches(output, magic)) {
      const spaced = magic.toUpperCase().replace(/(..)/g, '$1 ').trim();
      return {
        label: `contains ${op.detection?.formatName ?? op.name} data`,
        detail:
          `The decoded bytes begin with ${spaced}, the signature for ${op.name}. Finding a known ` +
          `format inside the result is strong evidence this layer was decoded correctly.`,
        weight: 0.95,
      };
    }
  }

  const signature = matchSignature(bytes);
  if (signature) {
    const spaced = signature.magic.toUpperCase().replace(/(..)/g, '$1 ').trim();
    return {
      label: `contains a ${signature.description}`,
      detail:
        `The decoded bytes begin with ${spaced}, the file signature for ${signature.description}. ` +
        'Finding a whole file inside the result is about as strong as evidence gets that this ' +
        'layer was decoded correctly.',
      weight: 0.97,
    };
  }

  const trimmed = output.trim();
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(trimmed) && excludeId !== 'jwt-decode') {
    return {
      label: 'contains a JWT',
      detail: 'The decoded output has the three-segment shape of a JSON Web Token.',
      weight: 0.85,
    };
  }

  if (excludeId !== 'from-utf16le' && utf16leRatio(bytes) > 0.8) {
    return {
      label: 'contains UTF-16LE text',
      detail:
        'The decoded bytes are ASCII characters padded with nulls — readable text stored as ' +
        'UTF-16 little-endian, which is what Windows tooling produces.',
      weight: 0.9,
    };
  }

  return null;
}

function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

function scoreOutput(
  output: string,
  before: Measurements,
  opId: string,
): { score: number; evidence: Evidence[] } {
  const evidence: Evidence[] = [];

  if (output.length === 0) {
    return {
      score: 0,
      evidence: [{ label: 'empty result', detail: 'Decoding produced nothing.', weight: 0 }],
    };
  }

  const bytes = asBytes(output);
  const printable = printableRatio(bytes);
  const entropy = shannonEntropy(bytes);

  /*
   * Judged as characters as well as bytes. Scoring on printable ASCII alone
   * declared every language that needs more than one byte per character to be
   * binary noise: Base64 of Persian, of Chinese, of anything with an accent in
   * it decoded perfectly and then scored as a failure.
   */
  const asText = tryDecodeUtf8(bytes);
  const textRatio = asText === null ? 0 : printableTextRatio(asText);
  const beyondAscii = asText !== null && hasNonAscii(asText);

  let primary = 0;

  const trimmed = output.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const keys = typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).length : 0;
      primary = Math.max(primary, 0.88);
      evidence.push({
        label: `valid JSON${keys ? `, ${keys} keys` : ''}`,
        detail:
          'The decoded output parses as JSON. Random bytes essentially never do, so this is very ' +
          'strong evidence the interpretation is correct.',
        weight: 0.95,
      });
    } catch {
    }
  }

  const ahead = lookahead(output, opId, bytes);
  if (ahead) {
    primary = Math.max(primary, 0.88);
    evidence.push(ahead);
  }

  if (beyondAscii && textRatio > 0.95) {
    primary = Math.max(primary, 0.8);
    evidence.push({
      label: 'decodes to UTF-8 text',
      detail:
        'Every byte forms valid UTF-8 and the characters it spells are all printable. Multi-byte ' +
        'UTF-8 has a strict shape that random bytes almost never satisfy by accident, so this is ' +
        'stronger evidence than plain ASCII would be, not weaker.',
      weight: 0.85,
    });
  } else if (printable > 0.95 || textRatio > 0.95) {
    primary = Math.max(primary, 0.72);
    evidence.push({
      label: 'decodes to readable text',
      detail: `${Math.round(Math.max(printable, textRatio) * 100)}% of the decoded bytes are printable characters. A wrong guess usually produces binary noise.`,
      weight: 0.75,
    });
  } else if (printable > 0.75) {
    primary = Math.max(primary, 0.3);
    evidence.push({
      label: `${Math.round(printable * 100)}% printable`,
      detail: 'Mostly readable, with some binary. Possibly text with an encoding mismatch.',
      weight: 0.35,
    });
  } else if (!ahead) {
    evidence.push({
      label: 'decodes to binary',
      detail:
        'The result is mostly non-printable bytes and no known format signature was found in it. ' +
        'That is normal for encrypted data, and a warning sign for anything else.',
      weight: 0.1,
    });
  }

  let bonus = 0;
  if (entropy < before.entropy - 0.3) {
    bonus = 0.08;
    evidence.push({
      label: `entropy ${before.entropy.toFixed(2)} → ${entropy.toFixed(2)}`,
      detail:
        'Randomness dropped after decoding, which is what happens when a real encoding layer is ' +
        'removed rather than bytes being reinterpreted at random.',
      weight: 0.5,
    });
  }

  return { score: Math.min(primary + bonus, 1), evidence };
}

export async function detect(input: string): Promise<Candidate[]> {
  if (input.trim().length === 0) return [];

  const m = measure(input);
  const candidates: Candidate[] = [];

  for (const op of detectableOperations()) {
    const criteriaEvidence = passesCriteria(op, m);
    if (!criteriaEvidence) continue;

    let output: string;
    try {
      output = await Promise.resolve(op.run(m.text, op.args));
    } catch {
      continue;
    }

    if (output === m.text) continue;

    const { score, evidence: outputEvidence } = scoreOutput(output, m, op.id);

    const shape =
      criteriaEvidence.reduce((sum, e) => sum + e.weight, 0) / Math.max(criteriaEvidence.length, 1);
    const confidence = Math.min(0.99, shape * 0.25 + score * 0.75);

    candidates.push({
      id: op.id,
      format: op.detection?.formatName ?? op.name.replace(/^From /, ''),
      confidence,
      evidence: [...criteriaEvidence, ...outputEvidence],
      preview: previewText(output),
      steps: [stepFor(op)],
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  if ((candidates[0]?.confidence ?? 0) < 0.55) {
    candidates.push(...shortCandidates(m.text), ...bruteForce(m.text));
    candidates.sort((a, b) => b.confidence - a.confidence);
  }

  return candidates;
}
