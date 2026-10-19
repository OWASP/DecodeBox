import type { HashIdentification, HashMatch } from '../types';
import { asBytes } from '../core/bytes';
import { matchSignature } from '../core/signatures';
import { identifyHash } from './hashes';
import { identifyArtefact, isTerminal } from './artefacts';

function identifyFile(input: string): HashMatch | null {
  const bytes = asBytes(input);
  if (bytes.length < 4) return null;

  const signature = matchSignature(bytes);
  if (!signature) return null;

  const spaced = signature.magic.toUpperCase().replace(/(..)/g, '$1 ').trim();
  return {
    name: signature.description,
    confidence: 0.97,
    reason: `The file signature ${spaced}${signature.offset ? ` at offset ${signature.offset}` : ''}`,
    context: `A .${signature.extension} file, identified by its bytes rather than by a name.`,
  };
}

export function identify(input: string): HashIdentification | null {
  const hash = identifyHash(input);
  const artefacts = identifyArtefact(input);
  const file = identifyFile(input);
  if (!hash && artefacts.length === 0 && !file) return null;

  const matches = [...(hash?.matches ?? []), ...artefacts, ...(file ? [file] : [])]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  const best = matches[0];
  return {
    matches,
    summary: file
      ? `${asBytes(input).length} bytes`
      : (hash?.summary ?? `${input.trim().length} characters`),
    oneWay: hash?.oneWay ?? false,
    terminal:
      (hash?.oneWay ?? false) || best === file || (best ? isTerminal(best.name) : false),
  };
}

const ONE_WAY_FLOOR = 0.6;
const ARTEFACT_FLOOR = 0.8;

export function terminalIdentification(input: string): HashIdentification | null {
  const found = identify(input);
  const best = found?.matches[0];
  if (!found || !best) return null;

  if (!found.terminal) return null;
  if (found.oneWay) return best.confidence >= ONE_WAY_FLOOR ? found : null;
  return best.confidence >= ARTEFACT_FLOOR ? found : null;
}
