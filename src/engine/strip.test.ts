import { describe, expect, it } from 'vitest';
import { removeAll } from './core/strip';
import { getOperation } from './operations';

async function runOp(id: string, input: string, overrides: Record<string, unknown> = {}) {
  const op = getOperation(id);
  if (!op) throw new Error(`no operation ${id}`);
  const args = op.args.map((a) => (a.name in overrides ? { ...a, value: overrides[a.name] } : a));
  return op.run(input, args as typeof op.args);
}

describe('removing markup leaves none behind', () => {
  it('repeats until a removal no longer rebuilds a match', () => {
    expect(removeAll('<scr<script></script>ipt>', /<script\b[^>]*>[\s\S]*?<\/script>/gi)).toBe(
      '<script>',
    );
    expect(removeAll('<<b>b>bold</b>', /<[^>]+>/g)).not.toMatch(/<[^>]+>/);
    expect(removeAll('plain text', /<[^>]+>/g)).toBe('plain text');
  });

  it('Strip HTML tags leaves no tag that one pass would have rebuilt', async () => {
    const out = String(await runOp('strip-html', '<p>Hi <scr<script>x</script>ipt>alert(1)</script> there</p>'));
    expect(out).not.toMatch(/<[^>]+>/);
    expect(out).toContain('Hi');
    expect(out).toContain('there');
  });

  it('Strip comments (XML / HTML) removes nested comment fragments', async () => {
    const out = String(await runOp('strip-comments', '<a/><!-<!---->- hidden --><b/>', { Style: 'XML / HTML' }));
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('hidden');
  });
});
