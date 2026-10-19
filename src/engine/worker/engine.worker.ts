/// <reference lib="webworker" />

import { bake } from '../core/bake';
import { detect } from '../detection/detect';
import { autoDecode } from '../detection/autoDecode';
import { analyse } from '../analysis';
import { inspect } from '../inspect';
import { ctfHints } from '../ctf';
import type { Recipe } from '../types';
import type { AnalyseOptions } from '../analysis';
import type { AutoDecodeOptions } from '../detection/autoDecode';
import type { CtfOptions } from '../ctf';
import type { InspectOptions } from '../inspect';


export type WorkerRequest =
  | { id: number; kind: 'bake'; input: string; recipe: Recipe }
  | { id: number; kind: 'detect'; input: string }
  | { id: number; kind: 'autoDecode'; input: string; options?: Partial<AutoDecodeOptions> }
  | { id: number; kind: 'analyse'; input: string; options?: Partial<AnalyseOptions> }
  | { id: number; kind: 'inspect'; input: string; options?: InspectOptions }
  | { id: number; kind: 'hints'; input: string; options?: Partial<CtfOptions> };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.kind) {
    case 'bake':
      return bake(request.input, request.recipe);
    case 'detect':
      return detect(request.input);
    case 'autoDecode':
      return autoDecode(request.input, request.options);
    case 'analyse':
      return analyse(request.input, request.options);
    case 'inspect':
      return inspect(request.input, request.options);
    case 'hints':
      return ctfHints(request.input, request.options);
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  void handle(request)
    .then((result) => {
      const response: WorkerResponse = { id: request.id, ok: true, result };
      self.postMessage(response);
    })
    .catch((error: unknown) => {
      const response: WorkerResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : 'The engine failed.',
      };
      self.postMessage(response);
    });
});
