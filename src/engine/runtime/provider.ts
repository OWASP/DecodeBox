import type { OperationError } from '../types';

export type Compression = 'gzip' | 'deflate' | 'deflate-raw';
export type EngineCrypto = Pick<
  SubtleCrypto,
  | 'digest'
  | 'importKey'
  | 'exportKey'
  | 'generateKey'
  | 'encrypt'
  | 'decrypt'
  | 'deriveBits'
  | 'sign'
  | 'verify'
>;
export type EngineUrl = Pick<
  URL,
  'protocol' | 'hostname' | 'port' | 'username' | 'password' | 'pathname' | 'hash'
> & { searchParams: Iterable<[string, string]> };
export interface RuntimeProvider {
  readonly name: string;
  readonly secureRandom: boolean;
  timeZones(): string[];
  zoneOffset(zone: string, instant: number): number;
  zoneAbbreviation(zone: string, instant: number): string;
  compressionFormats(): Compression[];
  readonly subtle: EngineCrypto | undefined;
  decoder(label?: string, options?: TextDecoderOptions): { decode(input: Uint8Array): string };
  encode(text: string): Uint8Array<ArrayBuffer>;
  toBase64(binary: string): string;
  fromBase64(base64: string): string;
  parseUrl(url: string): EngineUrl;
  query(text: string): Iterable<[string, string]>;
  random<T extends Uint8Array | Uint32Array>(target: T): T;
  uuid(): string;
  transform(
    bytes: Uint8Array,
    format: Compression,
    compress: boolean,
    limit?: number,
  ): Promise<Uint8Array>;
  now(): number;
  delay(ms: number): Promise<void>;
  timed<T>(work: () => T | Promise<T>, ms: number, timeout: () => OperationError): Promise<T>;
}
