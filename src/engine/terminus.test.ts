import { gzipSync } from 'node:zlib';
import type { Layer } from './index';
import { describe, expect, it } from 'vitest';
import {
  autoDecode,
  chainConfidence,
  describeChain,
  describeRuns,
  lastLayer,
  summariseChain,
  terminusOf,
  terminusName,
  toChain,
} from './index';
import { terminalIdentification } from './detection/identify';


const b64 = (text: string): string => Buffer.from(text, 'latin1').toString('base64');

describe('how a chain ends', () => {
  it('ends on plain content, and says so', async () => {
    const root = await autoDecode('The deployment failed twice last night and nobody was paged.');
    const end = terminusOf(root);
    expect(end?.reason).toBe('plain');
    expect(end?.complete).toBe(true);
    expect(describeChain(root)).toBe('Plain text');
  });

  it('ends on a digest by naming it rather than by running out', async () => {
    const digest = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';
    const root = await autoDecode(digest);
    const end = terminusOf(root);

    expect(end?.reason).toBe('identified');
    expect(end?.complete).toBe(true);
    expect(end?.identification?.oneWay).toBe(true);
    expect(end?.identification?.matches[0]?.name).toBe('SHA-256');
    expect(end?.note).toMatch(/one-way/);
    expect(describeChain(root)).toBe('SHA-256');
  });

  it('names the digest at the bottom of a multi-stage chain', async () => {
    const root = await autoDecode(b64(b64('098f6bcd4621d373cade4e832627b4f6')));

    expect(describeChain(root)).toBe('Base64 → Base64 → MD5');
    expect(terminusName(root)).toBe('MD5');
    expect(terminusOf(root)?.identification?.oneWay).toBe(true);
    expect(lastLayer(root).output).toBe('098f6bcd4621d373cade4e832627b4f6');
  });

  it('prefers a decode over an identification when the value does both', async () => {
    const hex = Buffer.from('Hello, world!!!!', 'latin1').toString('hex');
    expect(hex).toHaveLength(32);
    expect(terminalIdentification(hex)?.matches[0]?.name).toBe('MD5');

    const root = await autoDecode(hex);
    expect(lastLayer(root).output).toBe('Hello, world!!!!');
    expect(terminusOf(root)?.reason).toBe('plain');
  });

  it('ends a JWT on the signature rather than on the payload', async () => {
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
      'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

    const root = await autoDecode(token);
    const end = terminusOf(root);

    expect(describeChain(root)).toBe('JWT');
    expect(end?.complete).toBe(true);
    expect(end?.note).toMatch(/signature/i);
    expect(end?.note).toMatch(/never decoded|verified|JWT Verify/i);
  });

  it('admits when it stopped early instead of finishing', async () => {
    let nested = 'The flag is not here.';
    for (let i = 0; i < 8; i++) nested = b64(nested);

    const root = await autoDecode(nested, { maxDepth: 3 });
    const end = terminusOf(root);

    expect(end?.reason).toBe('depth');
    expect(end?.complete).toBe(false);
    expect(describeChain(root).endsWith('→ …')).toBe(true);
  });

  it('admits when the clock ran out', async () => {
    let nested = 'Something at the bottom.';
    for (let i = 0; i < 6; i++) nested = b64(nested);

    const root = await autoDecode(nested, { budgetMs: 0 });
    expect(terminusOf(root)?.reason).toBe('budget');
    expect(terminusOf(root)?.complete).toBe(false);
  });

  it('puts the ending on the last layer and nowhere else', async () => {
    const root = await autoDecode(b64(b64('d41d8cd98f00b204e9800998ecf8427e')));
    const chain: typeof root[] = [];
    for (let node: typeof root | undefined = root; node; node = node.children[0]) chain.push(node);

    expect(chain).toHaveLength(3);
    for (const node of chain.slice(0, -1)) expect(node.terminus).toBeUndefined();
    expect(chain[chain.length - 1]!.terminus).toBeDefined();
  });
});

describe('short layers', () => {
  const NESTED = 'VjFkNGFtVkhSak5RVkRBOQ==';

  it('does not stop on a short Base64 layer that carries its padding', async () => {
    const root = await autoDecode(NESTED);
    expect(describeChain(root)).toContain('Base64 → Base64 → Base64 → Base64');
  });

  it('follows the chain past the length floor when the chain is the evidence', async () => {
    const root = await autoDecode(NESTED);
    expect(lastLayer(root).output).toBe('mmd');
    expect(toChain(root)).toHaveLength(6);
  });

  /*
   * Four characters used to be left alone on the grounds that nothing above
   * them vouched for the decode. That was defensible and it was also wrong in
   * practice: `bW1k` is Base64 and the tool said nothing about it at all.
   *
   * What replaced it is a narrower rule — a whole group, a result that is
   * valid UTF-8 text, and something in the input an ordinary word would not
   * have — and the terminus still says plainly that the result is too short
   * to judge any further.
   */
  it('reads a short value that an ordinary word would not look like', async () => {
    const root = await autoDecode('bW1k');
    expect(lastLayer(root).output).toBe('mmd');
    expect(terminusOf(root)?.reason).toBe('tooShort');
  });

  it('leaves a short word that is only accidentally an encoding', async () => {
    expect(lastLayer(await autoDecode('test')).output).toBe('test');
    expect(lastLayer(await autoDecode('abcd')).output).toBe('abcd');
  });

  it('refuses to continue when the extra decode is not clean text', async () => {
    const root = await autoDecode('V1ZkS2FscEJQVDA9');
    expect(lastLayer(root).output).toBe('abcd');
    expect(terminusOf(root)?.reason).toBe('tooShort');
  });

  it('admits it cannot judge what is left rather than calling it content', async () => {
    const end = terminusOf(await autoDecode(NESTED));
    expect(end?.reason).toBe('tooShort');
    expect(end?.complete).toBe(false);
    expect(end?.note).not.toMatch(/this is the content/i);
  });

  it('still names something short when it can', async () => {
    const end = terminusOf(await autoDecode('550e8400-e29b-41d4-a716-446655440000'));
    expect(end?.reason).toBe('identified');
  });
});

describe('summarising a chain', () => {
  const SEVEN = (() => {
    let value = 'the flag is here';
    for (let i = 0; i < 7; i++) value = Buffer.from(value).toString('base64');
    return value;
  })();

  it('collapses a run of one format into a count', async () => {
    const root = await autoDecode(SEVEN, { maxDepth: 12 });
    const runs = summariseChain(root);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.format).toBe('Base64');
    expect(runs[0]?.count).toBe(7);
    expect(describeRuns(runs)).toBe('Base64 x7');
  });

  it('keeps separate formats separate, and only collapses neighbours', () => {
    const layer = (format: string, depth: number): Layer => ({
      id: `${format}-${depth}`,
      depth,
      format,
      confidence: 0.8,
      byteLength: 1,
      output: '',
      evidence: [],
      steps: [],
      children: [],
    });

    const root = layer('Input', 0);
    let node = root;
    for (const [format, depth] of [['A', 1], ['A', 2], ['B', 3], ['A', 4]] as const) {
      const child = layer(format, depth);
      node.children.push(child);
      node = child;
    }

    expect(describeRuns(summariseChain(root))).toBe('A x2 - B - A');
  });

  it('reports the weakest layer, not the average of them', async () => {
    const root = await autoDecode(SEVEN, { maxDepth: 12 });
    const confidences = toChain(root).slice(1).map((l) => l.confidence);

    expect(chainConfidence(root)).toBe(Math.min(...confidences));
  });

  it('says nothing about a chain that decoded nothing', async () => {
    const root = await autoDecode('just some ordinary words here');
    expect(summariseChain(root)).toEqual([]);
    expect(chainConfidence(root)).toBe(0);
  });

  it('goes further when allowed further', async () => {
    const shallow = await autoDecode(SEVEN, { maxDepth: 3 });
    const deep = await autoDecode(SEVEN, { maxDepth: 12 });

    expect(terminusOf(shallow)?.reason).toBe('depth');
    expect(terminusOf(shallow)?.complete).toBe(false);
    expect(toChain(shallow)).toHaveLength(4);

    expect(toChain(deep).length).toBeGreaterThan(toChain(shallow).length);
    expect(lastLayer(deep).output).toBe('the flag is here');
  });
});

describe('terminalIdentification', () => {
  it('accepts a one-way digest and a certain artefact', async () => {
    expect(terminalIdentification('$2b$12$' + 'a'.repeat(53))?.matches[0]?.name).toBe('bcrypt');
    expect(terminalIdentification('550e8400-e29b-41d4-a716-446655440000')?.matches[0]?.name).toBe(
      'UUID',
    );
  });

  it('refuses what merely looks structured', async () => {
    expect(terminalIdentification('{"user":"admin","role":"root"}')).toBeNull();
    expect(terminalIdentification('nothing in particular here')).toBeNull();
  });
});

describe('files', () => {
  const PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const PNG = Buffer.from(PNG_B64, 'base64').toString('latin1');

  it('names a file that was dropped in, rather than calling it plain text', async () => {
    const root = await autoDecode(PNG);
    expect(describeChain(root)).toBe('PNG image');
    expect(terminusOf(root)?.reason).toBe('identified');
    expect(terminusOf(root)?.identification?.matches[0]?.reason).toMatch(/89 50 4E 47/);
  });

  it('decodes the Base64 of a picture, because it sees the file inside', async () => {
    const root = await autoDecode(PNG_B64);
    expect(describeChain(root)).toBe('Base64 → PNG image');
    expect(lastLayer(root).output).toBe(PNG);
  });

  it('does not call a picture one-way', async () => {
    const found = terminalIdentification(PNG)!;
    expect(found.terminal).toBe(true);
    expect(found.oneWay).toBe(false);
    expect(terminusOf(await autoDecode(PNG))?.note).not.toMatch(/one-way/);
  });

  it('still unwraps a container rather than just naming it', async () => {
    const gzipped = gzipSync(Buffer.from('The quick brown fox jumps over the lazy dog.'));
    const root = await autoDecode(gzipped.toString('latin1'));
    expect(describeChain(root)).toMatch(/gzip/i);
    expect(lastLayer(root).output).toContain('quick brown fox');
  });
});
