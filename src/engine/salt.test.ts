import { describe, expect, it } from 'vitest';
import { identify } from './index';


const MD5 = '5d41402abc4b2a76b9719d911017c592';
const SHA1 = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d';

describe('salt awareness', () => {
  it('says a bare digest is unsalted', async () => {
    const best = (await identify(MD5))?.matches[0];
    expect(best?.salt?.present).toBe(false);
    expect(best?.salt?.note).toMatch(/same password always produces/i);
  });

  it('says bcrypt carries its salt inside itself', async () => {
    const best = (await identify('$2b$12$' + 'a'.repeat(53)))?.matches[0];
    expect(best?.name).toBe('bcrypt');
    expect(best?.salt?.present).toBe(true);
    expect(best?.salt?.note).toMatch(/inside the hash string/i);
  });

  it('reads a digest with its salt beside it', async () => {
    const found = await identify(`${MD5}:sodium`);

    expect(found).not.toBeNull();
    expect(found?.matches[0]?.name).toMatch(/with a salt$/);
    expect(found?.matches[0]?.salt?.present).toBe(true);
    expect(found?.matches[0]?.salt?.value).toBe('sodium');
    expect(found?.matches[0]?.reason).toContain('128-bit digest');
  });

  it('reads the salt when it comes first', async () => {
    const found = await identify(`sodium:${SHA1}`);
    expect(found?.matches[0]?.salt?.value).toBe('sodium');
    expect(found?.matches[0]?.reason).toContain('salt:hash');
  });

  it('accepts the other separators dumps use', async () => {
    for (const sep of [':', '$', '*', '#']) {
      const found = await identify(`${MD5}${sep}NaCl`);
      expect(found?.matches[0]?.salt?.value, `separator ${sep}`).toBe('NaCl');
    }
  });

  it('still reports the candidates a digest of that length could be', async () => {
    const names = (await identify(`${MD5}:sodium`))?.matches.map((m) => m.name) ?? [];
    expect(names.length).toBeGreaterThan(1);
    expect(names.every((n) => n.endsWith('with a salt'))).toBe(true);
  });

  it('does not read an LM:NTLM pair as a salted hash', async () => {
    const pair = `${'a'.repeat(32)}:${'b'.repeat(32)}`;
    const best = (await identify(pair))?.matches[0];
    expect(best?.name).toBe('LM:NTLM pair');
  });

  it('does not invent a salt out of two things that are not a digest', async () => {
    expect(await identify('username:password')).toBeNull();
    expect(await identify('not-a-hash:either')).toBeNull();
  });

  it('is less sure about a salted pair than about the prefix formats', async () => {
    const pair = (await identify(`${MD5}:sodium`))?.matches[0]?.confidence ?? 1;
    const bcrypt = (await identify('$2b$12$' + 'a'.repeat(53)))?.matches[0]?.confidence ?? 0;
    expect(pair).toBeLessThan(bcrypt);
  });
});
