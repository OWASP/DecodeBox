// Java bytes are signed. Reinterpret exactly the addressed view, including its offset.
export function javaBytes(value) {
  const view = ArrayBuffer.isView(value)
    ? new Int8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Int8Array(value);
  return Java.to(view, 'byte[]');
}
export function jsBytes(value) {
  const bytes = new Uint8Array(value.length);
  bytes.set(value);
  return bytes;
}
