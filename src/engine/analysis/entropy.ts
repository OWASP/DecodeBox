import { shannonEntropy } from '../core/bytes';


export interface EntropyBucket {
  start: number;
  end: number;
  entropy: number;
}

export type EntropyBand = 'sparse' | 'text' | 'encoded' | 'dense';

export function bandOf(entropy: number): EntropyBand {
  if (entropy >= 7.0) return 'dense';
  if (entropy >= 5.2) return 'encoded';
  if (entropy >= 2.5) return 'text';
  return 'sparse';
}

const MAX_SAMPLE = 1024 * 1024;

const MIN_BLOCK = 256;

export const MIN_FOR_PROFILE = MIN_BLOCK * 8;

export function entropyProfile(bytes: Uint8Array, buckets = 64): EntropyBucket[] {
  const length = Math.min(bytes.length, MAX_SAMPLE);
  if (length < MIN_FOR_PROFILE) return [];

  const size = Math.max(MIN_BLOCK, Math.ceil(length / buckets));
  const profile: EntropyBucket[] = [];

  for (let start = 0; start < length; start += size) {
    const end = Math.min(start + size, length);
    profile.push({ start, end, entropy: shannonEntropy(bytes.subarray(start, end)) });
  }

  return profile;
}

export function standoutRegions(profile: EntropyBucket[]): EntropyBucket[] {
  if (profile.length < 4) return [];

  const dense = profile.filter((bucket) => bandOf(bucket.entropy) === 'dense');
  if (dense.length === 0) return [];

  if (dense.length / profile.length > 0.6) return [];

  const regions: EntropyBucket[] = [];
  for (const bucket of dense) {
    const last = regions[regions.length - 1];
    if (last && last.end === bucket.start) last.end = bucket.end;
    else regions.push({ ...bucket });
  }

  return regions;
}
