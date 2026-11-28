import { describe, expect, it } from 'vitest';
import sdk from './index';
import { browserProvider } from '../engine/runtime/browser';
import { argon2 } from '../engine/operations/argon2';

describe('public SDK v1', () => {
  it('returns detached definitions and accepts engine recipes returned by detection', async () => {
    const op = sdk.getOperation('to-base64')!;
    op.aliases.length = 0;
    expect(sdk.getOperation(op.id)!.aliases.length).toBeGreaterThan(0);
    const input = 'SGVsbG8gRGVjb2RlQm94IQ==';
    const candidates = await sdk.detect(input);
    const steps = candidates.find((c) => c.steps.some((s) => s.opId === 'from-base64'))!.steps;
    expect((await sdk.bake(input, { steps })).output).toBe('Hello DecodeBox!');
  });
  it('rejects invalid settings before executing a step', async () => {
    await expect(sdk.executeOperation('gzip', 'x', { extra: true })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(sdk.autoDecode('x', { budgetMs: Infinity })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(sdk.inspect('x', { analyse: { maxNodes: -1 } })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(sdk.bake('x', new Array(129).fill({ opId: 'comment' }))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect((await sdk.bake('x', [{ opId: 'reverse' }, { opId: 'gunzip' }])).error?.stepIndex).toBe(
      1,
    );
  });
  it('preserves a sliced binary input through compression', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 2).fill(0xff).subarray(1, -1);
    const result = await sdk.bake(bytes, [{ opId: 'gzip' }, { opId: 'gunzip' }]);
    expect(result.error).toBeUndefined();
    expect(result.output).toBe('\xff'.repeat(bytes.length));
  });
  it('limits expanded bytes while reading even if the consumer declares a smaller limit', async () => {
    const compressed = await browserProvider.transform(Uint8Array.of(1, 2, 3, 4), 'deflate', true);
    await expect(browserProvider.transform(compressed, 'deflate', false, 3)).rejects.toThrow(
      /limit/,
    );
    await expect(browserProvider.transform(compressed, 'deflate', false, 4)).resolves.toEqual(
      Uint8Array.of(1, 2, 3, 4),
    );
  });
  it('bounds memory parameters from encoded password hashes', () => {
    expect(() =>
      argon2({
        password: new Uint8Array(),
        salt: new Uint8Array(8),
        type: 2,
        passes: 1,
        parallelism: 1,
        tagLength: 32,
        memoryKiB: 2 ** 31,
      }),
    ).toThrow(/limit/);
  });
});
