
export type Span = { top: number; height: number };

export function seamAt(y: number, spans: readonly Span[]): number {
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    if (!span) continue;
    if (y < span.top + span.height / 2) return i;
  }
  return spans.length;
}

export function finalIndex(seam: number, from: number): number {
  return seam > from ? seam - 1 : seam;
}

export function dropTarget(y: number, spans: readonly Span[], from: number): number {
  return finalIndex(seamAt(y, spans), from);
}
