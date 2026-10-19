import { OperationError } from '../types';
import { previewText } from '../core/bytes';
import { arg, type Operation } from './types';
import { getOperation } from './registryAccess';
import { detect } from '../detection/detect';
import { containsMarker, readability } from '../detection/readability';


interface Chain {
  labels: string[];
  output: string;
  score: number;
}

const MAX_NODES = 400;
const BUDGET_MS = 3000;

export const magicOperations: Operation[] = [
  {
    id: 'magic',
    name: 'Magic',
    category: 'Flow control',
    description: 'Searches for chains of decodings that turn the input into something readable.',
    aliases: ['what is this', 'auto detect', 'brute force decode', 'identify'],
    args: [
      { name: 'Depth', type: 'number', value: 3, min: 1, max: 6 },
      { name: 'Minimum confidence %', type: 'number', value: 40, min: 0, max: 99 },
      {
        name: 'Crib',
        type: 'string',
        value: '',
        hint: 'Only report chains whose result contains this',
      },
      { name: 'Show previews', type: 'boolean', value: true },
    ],
    run: async (input, args) => {
      if (input.trim().length === 0) throw new OperationError('Magic needs some input to work on.');

      const depth = Math.min(6, Math.max(1, Number(arg(args, 'Depth', 3))));
      const threshold = Math.min(99, Math.max(0, Number(arg(args, 'Minimum confidence %', 40)))) / 100;
      const crib = String(arg(args, 'Crib', ''));
      const withPreviews = Boolean(arg(args, 'Show previews', true));

      const deadline = performance.now() + BUDGET_MS;
      const seen = new Set<string>([input]);
      const found: Chain[] = [];
      let nodes = 0;

      let frontier: Array<{ value: string; labels: string[] }> = [{ value: input, labels: [] }];

      for (let level = 0; level < depth && frontier.length > 0; level++) {
        const next: Array<{ value: string; labels: string[] }> = [];

        for (const node of frontier) {
          if (performance.now() > deadline || nodes >= MAX_NODES) break;

          for (const candidate of await detect(node.value)) {
            if (candidate.confidence < threshold) break; 
            if (++nodes >= MAX_NODES) break;

            const step = candidate.steps[0];
            const operation = step && getOperation(step.opId);
            if (!step || !operation) continue;

            let output: string;
            try {
              output = await Promise.resolve(operation.run(node.value, step.args));
            } catch {
              continue;
            }
            if (seen.has(output)) continue;
            seen.add(output);

            const labels = [...node.labels, candidate.format];
            const marker = containsMarker(output);
            const score = readability(output) + (marker ? 0.5 : 0);
            found.push({ labels, output, score });
            next.push({ value: output, labels });
          }
        }

        frontier = next;
      }

      const matching = crib.length > 0 ? found.filter((c) => c.output.includes(crib)) : found;
      matching.sort((a, b) => b.score - a.score || a.labels.length - b.labels.length);

      if (matching.length === 0) {
        const why =
          found.length > 0
            ? `${found.length} chains decoded, but none contained '${crib}'.`
            : 'Nothing decoded above the confidence threshold.';
        return `Magic found no readable decoding.\n${why}`;
      }

      const lines = [
        `Magic searched ${nodes} decodings and found ${matching.length}.`,
        '',
      ];
      for (const chain of matching.slice(0, 20)) {
        lines.push(`${chain.labels.join(' → ')}  (readable ${chain.score.toFixed(2)})`);
        if (withPreviews) lines.push(`  ${previewText(chain.output, 120)}`);
      }
      return lines.join('\n');
    },
  },
];
