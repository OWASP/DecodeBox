import { Fragment, useMemo } from 'react';

type Token = { text: string; kind: 'key' | 'string' | 'number' | 'literal' | 'punct' };

function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],])|(\s+)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: source.slice(lastIndex, match.index), kind: 'punct' });
    }
    const [full, str, colon, num, literal, punct, space] = match;
    if (str !== undefined) {
      tokens.push({ text: str, kind: colon ? 'key' : 'string' });
      if (colon) tokens.push({ text: colon, kind: 'punct' });
    } else if (num !== undefined) tokens.push({ text: num, kind: 'number' });
    else if (literal !== undefined) tokens.push({ text: literal, kind: 'literal' });
    else if (punct !== undefined) tokens.push({ text: punct, kind: 'punct' });
    else if (space !== undefined) tokens.push({ text: space, kind: 'punct' });
    lastIndex = match.index + full.length;
  }

  if (lastIndex < source.length) {
    tokens.push({ text: source.slice(lastIndex), kind: 'punct' });
  }
  return tokens;
}

const COLORS: Record<Token['kind'], string> = {
  key: 'var(--accent-text)',
  string: 'var(--green)',
  number: 'var(--blue)',
  literal: 'var(--amber)',
  punct: 'var(--text-muted)',
};

export function JsonView({ source }: { source: string }) {
  const tokens = useMemo(() => tokenise(source), [source]);
  return (
    <>
      {tokens.map((token, i) => (
        <Fragment key={i}>
          <span style={{ color: COLORS[token.kind] }}>{token.text}</span>
        </Fragment>
      ))}
    </>
  );
}
