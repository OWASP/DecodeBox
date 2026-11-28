import { describe, expect, it } from 'vitest';
import { autoDecode, bake, detect, inspect, lastLayer, terminusOf, toChain } from '../index';
import { getOperation } from '../operations';
import type { Candidate, Layer } from '../types';

function addressCandidate(candidates: Candidate[]) {
  return candidates.find((candidate) => candidate.steps.at(-1)?.opId === 'change-ip-format');
}

function alternatives(root: Layer) {
  return toChain(root).flatMap((layer) => layer.alternatives ?? []);
}

async function replay(input: string, candidate: Candidate) {
  const result = await bake(input, { id: 'ip-test', name: 'IP interpretation', steps: candidate.steps });
  expect(result.error).toBeUndefined();
  return result.output;
}

describe('automatic numeric IPv4 detection', () => {
  it.each(['017700000001', '0x7f000001', '0X7F000001', '  0x7f000001\n'])('decodes %s without a manual recipe', async (input) => {
    const root = await autoDecode(input);
    expect(lastLayer(root).output).toBe('127.0.0.1');
    expect(terminusOf(root)?.identification?.matches[0]?.name).toBe('IPv4 address');
    expect(toChain(root)).toHaveLength(2);
    const candidate = addressCandidate(await detect(input))!;
    expect(candidate).toBeDefined();
    expect(candidate.evidence.map((item) => item.detail).join(' ')).toContain('127.0.0.1');
    expect(await replay(input, candidate)).toBe('127.0.0.1');
  });

  it('finds an IP inside Base64 and includes it in the analysis indicators', async () => {
    const input = btoa('017700000001');
    const { root, analysis } = await inspect(input);
    expect(lastLayer(root).output).toBe('127.0.0.1');
    expect(lastLayer(root).steps.map((step) => step.opId)).toEqual(['from-base64', 'change-ip-format']);
    expect(analysis.indicators.some((indicator) => indicator.kind === 'ipv4' && indicator.value === '127.0.0.1')).toBe(true);
  });

  it.each(['2130706433', '1700000000', '123', '0755', '0x41'])('offers %s without automatically treating it as an IP', async (input) => {
    const candidate = addressCandidate(await detect(input))!;
    expect(candidate).toBeDefined();
    expect(candidate.confidence).toBeLessThan(0.55);
    const root = await autoDecode(input);
    expect(lastLayer(root).steps.some((step) => step.opId === 'change-ip-format')).toBe(false);
    expect(addressCandidate(alternatives(root))).toBeDefined();
  });

  it('preserves timestamp and checksum interpretations alongside the address', async () => {
    const decimal = await autoDecode('2130706433');
    expect(alternatives(decimal).some((candidate) => candidate.format === 'Unix timestamp (seconds)')).toBe(true);
    const hex = await autoDecode('0x7f000001');
    expect(alternatives(hex).some((candidate) => candidate.format === 'CRC-32')).toBe(true);
  });

  it('keeps the preceding decode steps when an ambiguous inner number is selected', async () => {
    const input = btoa('2130706433');
    const candidate = addressCandidate(alternatives(await autoDecode(input)))!;
    expect(candidate).toBeDefined();
    expect(candidate.steps.map((step) => step.opId)).toEqual(['from-base64', 'change-ip-format']);
    expect(await replay(input, candidate)).toBe('127.0.0.1');
  });

  it.each([
    ['0', '0.0.0.0'],
    ['00', '0.0.0.0'],
    ['0x00000000', '0.0.0.0'],
    ['4294967295', '255.255.255.255'],
    ['0xffffffff', '255.255.255.255'],
    ['037777777777', '255.255.255.255'],
  ])('checks the IPv4 boundary %s', async (input, expected) => {
    const candidate = addressCandidate(await detect(input))!;
    expect(candidate?.preview).toBe(expected);
    expect(await replay(input, candidate)).toBe(expected);
  });

  it.each([
    '4294967296', '0x100000000', '040000000000', '-1', '+123', '1e9',
    '0x7f000001xyz', '017700000008', '08', '1.2.3.', '127.0.0.1',
    '755 644 600', 'ip=0x7f000001',
  ])('does not invent an IP interpretation for %s', async (input) => {
    expect(addressCandidate(await detect(input))).toBeUndefined();
  });

  it('rejects an oversized numeric input without an IP suggestion', async () => {
    expect(addressCandidate(await detect('0'.repeat(100_000)))).toBeUndefined();
  });

  it('leaves readable hex data and Base64 decoding intact', async () => {
    expect(lastLayer(await autoDecode('0x48656c6c')).output).toBe('Hell');
    expect(lastLayer(await autoDecode('SGVsbG8sIHdvcmxkIQ==')).output).toBe('Hello, world!');
  });

  it('does not change the converter default or mutate its argument definitions', async () => {
    const operation = getOperation('change-ip-format')!;
    await detect('0x7f000001');
    expect(operation.args.find((arg) => arg.name === 'To')?.value).toBe('Decimal');
    expect(operation.run('127.0.0.1', operation.args)).toBe('2130706433');
  });
});
