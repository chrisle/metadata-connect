import type { ExtractedMetadata, FileReader, MetadataParser } from './types.js';
import type { Logger } from './types/logger.js';
import { noopLogger } from './types/logger.js';
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
 * Options for extractMetadata
 */
export interface ExtractMetadataOptions {
  /** Optional logger instance. If omitted, logging is silently disabled. */
  logger?: Logger;
}

/**
 * Extract metadata from an audio file using the appropriate parser
 *
 * @param reader - FileReader interface for reading file data
 * @param options - Optional configuration including logger
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
export async function extractMetadata(
  reader: FileReader,
  options?: ExtractMetadataOptions,
): Promise<ExtractedMetadata | null> {
  const logger = options?.logger ?? noopLogger;
  const parser = getParserForExtension(reader.extension);

  if (!parser) {
    logger.debug('No parser found for extension: %s', reader.extension);
    return null;
  }

  try {
    logger.debug('Extracting metadata from %s file (%d bytes)', reader.extension, reader.size);
    const result = await parser(reader);
    if (result) {
      logger.debug('Extracted metadata: title=%s, artist=%s', result.title ?? '(none)', result.artist ?? '(none)');
    } else {
      logger.debug('Parser returned null for %s file', reader.extension);
    }
    return result;
  } catch (err) {
    logger.warn('Failed to extract metadata from %s file: %s', reader.extension, err);
    return null;
  }
}
