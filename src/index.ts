// Main extraction function
export {
  extractMetadata,
  getParserForExtension,
  getSupportedExtensions,
  isExtensionSupported,
} from './extract.js';
export type { ExtractMetadataOptions } from './extract.js';

// Types
export type {
  FileReader,
  ExtractedMetadata,
  ArtworkMimeType,
  MetadataParser,
} from './types.js';
export { PictureType } from './types.js';

// Logger
export type { Logger } from './types/logger.js';
export { noopLogger } from './types/logger.js';

// Reader utilities
export { createBufferReader } from './reader.js';

// Individual parsers (for advanced use cases)
export {
  extractFromMp3,
  extractFromMp4,
  extractFromFlac,
  extractFromAiff,
  detectImageType,
  normalizeMimeType,
} from './parsers/index.js';
