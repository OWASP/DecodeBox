import { asBytes } from './bytes';
import { imageMime } from './imageSignature';

export function imageMimeOf(byteString: string): string | null {
  if (byteString.length === 0) return null;
  return imageMime(asBytes(byteString));
}
