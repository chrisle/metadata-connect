import type { ExtractedMetadata, FileReader, MetadataParser } from './types.js';
import { extractFromMp3 } from './parsers/id3.js';
import { extractFromMp4 } from './parsers/mp4.js';
import { extractFromFlac } from './parsers/flac.js';
import { extractFromAiff } from './parsers/aiff.js';

/**
 * Map of file extensions to their metadata parsers
 */
const PARSER_MAP: Record<string, MetadataParser> = {
  // MP3
  mp3: extractFromMp3,

  // MP4/M4A/AAC
  m4a: extractFromMp4,
  mp4: extractFromMp4,
  m4p: extractFromMp4,
  m4b: extractFromMp4,
  aac: extractFromMp4,

  // FLAC
  flac: extractFromFlac,

  // AIFF
  aiff: extractFromAiff,
  aif: extractFromAiff,
  aifc: extractFromAiff,
};

/**
 * Get the appropriate parser for a file extension
 */
export function getParserForExtension(extension: string): MetadataParser | null {
  const normalizedExt = extension.toLowerCase().replace(/^\./, '');
  return PARSER_MAP[normalizedExt] ?? null;
}

/**
 * Get list of supported file extensions
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(PARSER_MAP);
}

/**
 * Check if a file extension is supported
 */
export function isExtensionSupported(extension: string): boolean {
  return getParserForExtension(extension) !== null;
}

/**
 * Extract metadata from an audio file using the appropriate parser
 *
 * @param reader - FileReader interface for reading file data
 * @returns Extracted metadata, or null if extraction fails or format is unsupported
 *
 * @example
 * ```typescript
 * // Create a reader from your transport layer
 * const reader = createFileReader(device, path, fileSize);
 *
 * // Extract metadata
 * const metadata = await extractMetadata(reader);
 * if (metadata) {
 *   console.log(metadata.title, metadata.artist);
 *   if (metadata.artwork) {
 *     // Use artwork buffer
 *   }
 * }
 * ```
 */
export async function extractMetadata(reader: FileReader): Promise<ExtractedMetadata | null> {
  const parser = getParserForExtension(reader.extension);

  if (!parser) {
    return null;
  }

  try {
    return await parser(reader);
  } catch {
    // Return null on any parsing error
    return null;
  }
}
