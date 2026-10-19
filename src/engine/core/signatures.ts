
export interface Signature {
  magic: string;
  extension: string;
  description: string;
  offset?: number;
  mime?: string;
}

export type SignatureKind =
  | 'Images'
  | 'Video'
  | 'Audio'
  | 'Archives'
  | 'Documents'
  | 'Executables'
  | 'Fonts'
  | 'Other';

const KIND_BY_EXTENSION: Record<string, SignatureKind> = {
  png: 'Images', gif: 'Images', jpg: 'Images', bmp: 'Images', tiff: 'Images',
  ico: 'Images', psd: 'Images',
  mp4: 'Video', mkv: 'Video', riff: 'Video',
  ogg: 'Audio', flac: 'Audio', mp3: 'Audio',
  zip: 'Archives', rar: 'Archives', '7z': 'Archives', gz: 'Archives',
  bz2: 'Archives', xz: 'Archives', lz4: 'Archives', zst: 'Archives', tar: 'Archives',
  pdf: 'Documents', ole: 'Documents', xml: 'Documents', html: 'Documents',
  sqlite: 'Documents',
  exe: 'Executables', elf: 'Executables', class: 'Executables',
  macho: 'Executables', ser: 'Executables',
  woff2: 'Fonts', woff: 'Fonts', ttf: 'Fonts', otf: 'Fonts',
};

export const SIGNATURE_KINDS: SignatureKind[] = [
  'Images', 'Video', 'Audio', 'Archives', 'Documents', 'Executables', 'Fonts', 'Other',
];

export function kindOf(signature: Signature): SignatureKind {
  return KIND_BY_EXTENSION[signature.extension] ?? 'Other';
}

export const SIGNATURES: Signature[] = [
  { magic: '89504e470d0a1a0a', extension: 'png', description: 'PNG image', mime: 'image/png' },
  { magic: '474946383961', extension: 'gif', description: 'GIF image (89a)', mime: 'image/gif' },
  { magic: '474946383761', extension: 'gif', description: 'GIF image (87a)', mime: 'image/gif' },
  { magic: 'ffd8ffe0', extension: 'jpg', description: 'JPEG image (JFIF)', mime: 'image/jpeg' },
  { magic: 'ffd8ffe1', extension: 'jpg', description: 'JPEG image (Exif)', mime: 'image/jpeg' },
  { magic: 'ffd8ffdb', extension: 'jpg', description: 'JPEG image', mime: 'image/jpeg' },
  { magic: '52494646', extension: 'riff', description: 'RIFF container (WAV, AVI, WebP)' },
  { magic: '00000018667479706d703432', extension: 'mp4', description: 'MPEG-4 video' },
  { magic: '1a45dfa3', extension: 'mkv', description: 'Matroska / WebM' },
  { magic: '4f676753', extension: 'ogg', description: 'Ogg container' },
  { magic: '664c6143', extension: 'flac', description: 'FLAC audio' },
  { magic: '49443303', extension: 'mp3', description: 'MP3 audio (ID3v2)' },
  { magic: '25504446', extension: 'pdf', description: 'PDF document', mime: 'application/pdf' },
  { magic: '504b0304', extension: 'zip', description: 'ZIP archive (also docx, xlsx, jar, apk)' },
  { magic: '504b0506', extension: 'zip', description: 'Empty ZIP archive' },
  { magic: '526172211a07', extension: 'rar', description: 'RAR archive' },
  { magic: '377abcaf271c', extension: '7z', description: '7-Zip archive' },
  { magic: '1f8b08', extension: 'gz', description: 'gzip stream' },
  { magic: '425a68', extension: 'bz2', description: 'bzip2 archive' },
  { magic: 'fd377a585a00', extension: 'xz', description: 'XZ archive' },
  { magic: '04224d18', extension: 'lz4', description: 'LZ4 frame' },
  { magic: '28b52ffd', extension: 'zst', description: 'Zstandard frame' },
  { magic: '4d5a', extension: 'exe', description: 'Windows executable (PE/MZ)' },
  { magic: '7f454c46', extension: 'elf', description: 'ELF executable' },
  { magic: 'cafebabe', extension: 'class', description: 'Java class file' },
  { magic: 'feedface', extension: 'macho', description: 'Mach-O binary (32-bit)' },
  { magic: 'feedfacf', extension: 'macho', description: 'Mach-O binary (64-bit)' },
  { magic: 'd0cf11e0a1b11ae1', extension: 'ole', description: 'Microsoft OLE2 (legacy doc, xls, msi)' },
  { magic: '53514c69746520666f726d6174', extension: 'sqlite', description: 'SQLite database' },
  { magic: 'aced0005', extension: 'ser', description: 'Java serialized object' },
  { magic: '3c3f786d6c', extension: 'xml', description: 'XML document' },
  { magic: '3c21444f43545950452068746d6c', extension: 'html', description: 'HTML document' },
  { magic: '424d', extension: 'bmp', description: 'BMP image', mime: 'image/bmp' },
  { magic: '49492a00', extension: 'tiff', description: 'TIFF image (little-endian)' },
  { magic: '4d4d002a', extension: 'tiff', description: 'TIFF image (big-endian)' },
  { magic: '00000100', extension: 'ico', description: 'Windows icon' },
  { magic: '38425053', extension: 'psd', description: 'Photoshop document' },
  { magic: '774f4632', extension: 'woff2', description: 'WOFF2 font' },
  { magic: '774f4646', extension: 'woff', description: 'WOFF font' },
  { magic: '00010000', extension: 'ttf', description: 'TrueType font' },
  { magic: '4f54544f', extension: 'otf', description: 'OpenType font' },
  { magic: '7573746172', extension: 'tar', description: 'TAR archive', offset: 257 },
];

export function fileSignatureOf(byteString: string): Signature | null {
  if (byteString.length < 4) return null;
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i) & 0xff;
  return matchSignature(bytes);
}

export function hexAt(bytes: Uint8Array, offset: number, length: number): string {
  return Array.from(bytes.subarray(offset, offset + length))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function matchSignature(bytes: Uint8Array, offset = 0): Signature | null {
  for (const signature of SIGNATURES) {
    const at = signature.offset ?? offset;
    if (signature.offset !== undefined && offset !== 0) continue;
    if (hexAt(bytes, at, signature.magic.length / 2) === signature.magic) return signature;
  }
  return null;
}
