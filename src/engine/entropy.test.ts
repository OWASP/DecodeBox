import { describe, expect, it } from 'vitest';
import { bandOf, entropyProfile, MIN_FOR_PROFILE, standoutRegions } from './index';


function bytesOf(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function noise(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

const PROSE = 'the quick brown fox jumps over the lazy dog. '.repeat(200);

describe('entropy profile', () => {
  it('separates prose from noise', () => {
    const text = entropyProfile(bytesOf(PROSE));
    const random = entropyProfile(noise(8192));

    const textMean = text.reduce((s, b) => s + b.entropy, 0) / text.length;
    const noiseMean = random.reduce((s, b) => s + b.entropy, 0) / random.length;

    expect(textMean).toBeLessThan(5);
    expect(noiseMean).toBeGreaterThan(7);
    expect(bandOf(textMean)).toBe('text');
    expect(bandOf(noiseMean)).toBe('dense');
  });

  it('covers the whole input, in order, without gaps', () => {
    const profile = entropyProfile(bytesOf(PROSE));

    expect(profile[0]?.start).toBe(0);
    expect(profile[profile.length - 1]?.end).toBe(PROSE.length);
    for (let i = 1; i < profile.length; i++) {
      expect(profile[i]?.start).toBe(profile[i - 1]?.end);
    }
  });

  it('says nothing about an input too small to measure', () => {
    expect(entropyProfile(bytesOf('short'))).toEqual([]);
    expect(entropyProfile(bytesOf('x'.repeat(MIN_FOR_PROFILE - 1)))).toEqual([]);
    expect(entropyProfile(bytesOf('x'.repeat(MIN_FOR_PROFILE))).length).toBeGreaterThan(0);
  });

  it('points at a dense block hidden inside ordinary text', () => {
    const buried = new Uint8Array(24576);
    buried.set(bytesOf(PROSE.slice(0, 8000)), 0);
    buried.set(noise(6000, 7), 9000);
    buried.set(bytesOf(PROSE.slice(0, 8000)), 16000);

    const regions = standoutRegions(entropyProfile(buried));

    expect(regions.length).toBeGreaterThan(0);
    const region = regions[0]!;
    expect(region.start).toBeGreaterThanOrEqual(8000);
    expect(region.end).toBeLessThanOrEqual(16400);
  });

  it('points at nothing in a payload that is uniformly dense', () => {
    expect(standoutRegions(entropyProfile(noise(8192)))).toEqual([]);
  });

  it('points at nothing in a payload that is uniformly plain', () => {
    expect(standoutRegions(entropyProfile(bytesOf(PROSE)))).toEqual([]);
  });

  it('merges neighbouring dense blocks into one region', () => {
    const buried = new Uint8Array(32768);
    buried.set(bytesOf(PROSE.slice(0, 8000)), 0);
    buried.set(noise(12000, 3), 10000);
    buried.set(bytesOf(PROSE.slice(0, 8000)), 23000);

    const regions = standoutRegions(entropyProfile(buried));
    expect(regions.length).toBe(1);
    expect(regions[0]!.end - regions[0]!.start).toBeGreaterThan(4000);
  });
});
