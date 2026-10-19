import type { Candidate, Evidence, RecipeStep } from '../types';
import { asBytes, bytesToLatin1, previewText } from '../core/bytes';
import { containsMarker, readability } from './readability';


const SAMPLE = 2048;
const MIN_READABILITY = 0.62;

/*
 * How much more readable the best rotation has to be than the input itself.
 *
 * Beating the input by any margin at all is not evidence. A log line with a
 * Base64 blob in it reads poorly to begin with, so some rotation of it always
 * reads slightly better — that is how `2026-09-20 11:02:14 WARN auth: …` came
 * to be announced as ROT5 with seventy per cent confidence.
 *
 * A real rotation is not a close-run thing. Undoing one lifts readability by
 * about 0.27 on ordinary prose, while the best false positives manage 0.05.
 * The gap between those two is wide enough to put the line in the middle and
 * not agonise over it.
 */
const MIN_ROT_MARGIN = 0.15;

function xorAll(bytes: Uint8Array, key: number): string {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i]! ^ key;
  return bytesToLatin1(out);
}

function rotate(text: string, amount: number): string {
  return text.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= 'Z' ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + amount) % 26) + base);
  });
}

function evidenceFor(output: string, score: number, how: string): Evidence[] {
  const evidence: Evidence[] = [
    {
      label: `readability ${score.toFixed(2)}`,
      detail:
        `Of every key tried, this one produced the most text-like result: letter and space ` +
        `frequencies close to ordinary writing rather than the flat distribution of noise.`,
      weight: 0.8,
    },
    {
      label: how,
      detail:
        'Found by trying every possibility rather than by recognising a signature. ' +
        'Obfuscation of this kind leaves nothing to recognise.',
      weight: 0.5,
    },
  ];

  const marker = containsMarker(output);
  if (marker) {
    evidence.unshift({
      label: `contains "${marker.trim()}"`,
      detail:
        `The decoded text contains "${marker.trim()}", a sequence that essentially never appears ` +
        'by chance. This is what turns a plausible guess into a confident one.',
      weight: 0.95,
    });
  }

  return evidence;
}

function uid(opId: string): string {
  return `${opId}-${Math.random().toString(36).slice(2, 9)}`;
}

function xorStep(key: string): RecipeStep {
  return {
    uid: uid('xor'),
    opId: 'xor',
    args: [
      {
        name: 'Key',
        type: 'toggleString',
        value: key,
        toggleValues: ['UTF-8', 'Hex', 'Base64'],
        toggleValue: 'Hex',
      },
    ],
    disabled: false,
  };
}

function rotStep(amount: number): RecipeStep {
  if (amount === 13) {
    return { uid: uid('rot13'), opId: 'rot13', args: [], disabled: false };
  }
  return {
    uid: uid('rot'),
    opId: 'rot',
    args: [{ name: 'Amount', type: 'number', value: amount, min: 1, max: 25 }],
    disabled: false,
  };
}

export function bruteForce(input: string): Candidate[] {
  const sample = input.length > SAMPLE ? input.slice(0, SAMPLE) : input;
  if (sample.length < 8) return [];

  const bytes = asBytes(sample);
  const found: Candidate[] = [];

  let bestKey = -1;
  let bestScore = 0;
  let bestOutput = '';

  for (let key = 1; key < 256; key++) {
    const output = xorAll(bytes, key);
    const score = readability(output);
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
      bestOutput = output;
    }
  }

  if (bestKey !== -1 && bestScore >= MIN_READABILITY) {
    const hex = bestKey.toString(16).padStart(2, '0');
    found.push({
      id: 'brute-xor',
      format: `XOR (key 0x${hex.toUpperCase()})`,
      confidence: Math.min(0.82, 0.45 + bestScore * 0.45),
      evidence: evidenceFor(bestOutput, bestScore, `tried all 255 single-byte keys`),
      preview: previewText(bestOutput),
      steps: [xorStep(hex)],
    });
  }

  if (/[a-zA-Z]{4}/.test(sample)) {
    const asRead = readability(sample);

    let bestRot = 0;
    let bestRotScore = asRead;
    let bestRotOutput = '';

    for (let n = 1; n < 26; n++) {
      const output = rotate(sample, n);
      const score = readability(output);
      if (score > bestRotScore) {
        bestRotScore = score;
        bestRot = n;
        bestRotOutput = output;
      }
    }

    const convincing =
      bestRotScore >= MIN_READABILITY || containsMarker(bestRotOutput) !== null;

    if (bestRot !== 0 && convincing && bestRotScore - asRead >= MIN_ROT_MARGIN) {
      found.push({
        id: 'brute-rot',
        format: bestRot === 13 ? 'ROT13' : `ROT${bestRot}`,
        confidence: Math.min(0.8, 0.42 + bestRotScore * 0.45),
        evidence: evidenceFor(bestRotOutput, bestRotScore, `tried all 25 rotations`),
        preview: previewText(bestRotOutput),
        steps: [rotStep(bestRot)],
      });
    }
  }

  return found.sort((a, b) => b.confidence - a.confidence);
}
