import { installProvider } from '../engine/runtime';
import { createGraalProvider } from '../engine/runtime/graal';
declare const Java: { type: unknown } | undefined;
if (typeof Java !== 'undefined' && typeof Java.type === 'function')
  installProvider(createGraalProvider());
