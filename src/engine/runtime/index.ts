import { browserProvider } from './browser';
import type { RuntimeProvider } from './provider';

export let runtime: RuntimeProvider = browserProvider;

// Called during SDK module initialization, before registry modules probe character sets.
export function installProvider(provider: RuntimeProvider): void {
  runtime = provider;
}
