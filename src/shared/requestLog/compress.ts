import type { BodyEncoding } from './types';

/**
 * Gzip helpers built on the platform `CompressionStream`, with no library
 * dependency. This is the single reason a 30-day archive is affordable: panel
 * responses are HTML fragments that re-send the same inlined <style> block on
 * every request, which is close to the ideal case for DEFLATE's back-references.
 *
 * Availability is checked once rather than per call. Firefox has shipped
 * CompressionStream since 113 and the manifest requires 128+, so the fallback
 * path should never run in practice — it exists so that a platform surprise
 * costs disk space instead of silently dropping the archive.
 */
const SUPPORTS_COMPRESSION = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

export const BODY_ENCODING: BodyEncoding = SUPPORTS_COMPRESSION ? 'gzip' : 'identity';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function streamThrough(bytes: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Compresses text for storage. Returns raw UTF-8 bytes if gzip is unavailable. */
export async function compressText(text: string): Promise<Uint8Array> {
  const bytes = encoder.encode(text);
  if (!SUPPORTS_COMPRESSION) return bytes;
  return streamThrough(bytes, new CompressionStream('gzip'));
}

/**
 * Reverses `compressText`. The row's own `encoding` is passed in rather than
 * assumed from current platform support — rows written by an older install (or
 * during a fallback) must stay readable even once gzip is available again.
 */
export async function decompressText(bytes: Uint8Array, encoding: BodyEncoding): Promise<string> {
  if (encoding === 'identity') return decoder.decode(bytes);
  const out = await streamThrough(bytes, new DecompressionStream('gzip'));
  return decoder.decode(out);
}

/** UTF-8 byte length, which is what matters for storage — not `string.length`,
 *  which counts UTF-16 code units and undercounts any multi-byte character. */
export function byteLength(text: string): number {
  return encoder.encode(text).length;
}
