/*
 * Removes every match of a pattern, repeating until nothing changes.
 *
 * One pass is not enough for markup. Removing the inner tag of `<scr<script></script>ipt>` joins
 * the outer one back together, and removing the inner comment of `<!-<!---->- x -->` leaves a
 * whole one behind. An operation that promises to strip tags or comments should leave none, so
 * it repeats. Every pass that changes anything makes the text shorter, so the loop ends.
 */
export function removeAll(text: string, pattern: RegExp): string {
  let previous: string;
  do {
    previous = text;
    text = text.replace(pattern, '');
  } while (text !== previous);
  return text;
}
