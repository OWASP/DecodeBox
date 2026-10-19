/*
 * Identifiers for recipe steps, analysis nodes and saved recipes. They only have to be unique
 * within one browser, never secret, but drawing them from the platform's CSPRNG costs nothing and
 * leaves no Math.random in anything that looks like an identifier. getRandomValues, unlike
 * randomUUID, also works outside a secure context, which the single-file build opened from disk
 * may be.
 */
export function randomId(prefix: string): string {
  const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}-${high.toString(36)}${low.toString(36)}`;
}
