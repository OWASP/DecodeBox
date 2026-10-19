import type { WorkerRequest, WorkerResponse } from './engine.worker';


type Unposted<T> = T extends unknown ? Omit<T, 'id'> : never;
export type WorkerCall = Unposted<WorkerRequest>;

export const WORKER_THRESHOLD = 64 * 1024;

let worker: Worker | null = null;
let unavailable = false;
let nextId = 1;

const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();

function ensureWorker(): Worker | null {
  if (unavailable) return null;
  if (worker) return worker;

  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    unavailable = true;
    return null;
  }

  try {
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const waiting = pending.get(response.id);
      if (!waiting) return;
      pending.delete(response.id);
      if (response.ok) waiting.resolve(response.result);
      else waiting.reject(new Error(response.error));
    });

    worker.addEventListener('error', () => {
      for (const waiting of pending.values()) waiting.reject(new Error('The engine worker stopped.'));
      pending.clear();
      unavailable = true;
      worker = null;
    });

    return worker;
  } catch {
    unavailable = true;
    return null;
  }
}

export async function offload<T>(
  input: string,
  request: WorkerCall,
  local: () => Promise<T>,
): Promise<T> {
  if (input.length < WORKER_THRESHOLD) return local();

  const instance = ensureWorker();
  if (!instance) return local();

  const id = nextId++;
  try {
    return await new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      instance.postMessage({ ...request, id } as WorkerRequest);
    });
  } catch {
    pending.delete(id);
    return local();
  }
}

export function workerActive(): boolean {
  return worker !== null && !unavailable;
}
