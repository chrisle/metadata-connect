import type { ExtractedMetadata, FileReader, ArtworkMimeType } from '../types.js';
import { PictureType } from '../types.js';
import { normalizeMimeType, parseBpm, parseYear, cleanText } from './utils.js';

/**
 * FLAC metadata block types
 */
const enum MetadataBlockType {
  STREAMINFO = 0,
  PADDING = 1,
  APPLICATION = 2,
  SEEKTABLE = 3,
  VORBIS_COMMENT = 4,
  CUESHEET = 5,
  PICTURE = 6,
}

/**
 * Vorbis comment field names (case-insensitive)
 */
const VORBIS_FIELDS = {
  TITLE: ['TITLE'],
  ARTIST: ['ARTIST'],
  ALBUM: ['ALBUM'],
  GENRE: ['GENRE'],
  DATE: ['DATE', 'YEAR'],
  BPM: ['BPM', 'TEMPO'],
  KEY: ['KEY', 'INITIALKEY'],
} as const;

interface ArtworkResult {
  data: Buffer;
  mimeType: ArtworkMimeType;
  pictureType: PictureType;
  width?: number;
  height?: number;
}

/**
 * Parse a FLAC PICTURE metadata block
 */
function parsePictureBlock(data: Buffer): ArtworkResult | null {
  if (data.length < 32) return null;

  let offset = 0;

  const pictureType = data.readUInt32BE(offset) as PictureType;
  offset += 4;

  const mimeLength = data.readUInt32BE(offset);
  offset += 4;

  if (offset + mimeLength > data.length) return null;

  const mimeType = data.toString('utf8', offset, offset + mimeLength);
  offset += mimeLength;

  const descLength = data.readUInt32BE(offset);
  offset += 4 + descLength;

  if (offset + 16 > data.length) return null;

  const width = data.readUInt32BE(offset);
  offset += 4;

  const height = data.readUInt32BE(offset);
  offset += 4 + 8; // Skip depth and colors

  const imageLength = data.readUInt32BE(offset);
  offset += 4;

  if (offset + imageLength > data.length) return null;

  const imageData = data.subarray(offset, offset + imageLength);
  if (imageData.length === 0) return null;

  return {
    data: imageData,
    mimeType: normalizeMimeType(mimeType),
    width: width > 0 ? width : undefined,
    height: height > 0 ? height : undefined,
    pictureType,
  };
}

/**
 * Parse a Vorbis comment block
 * Format: vendor string length (32-bit LE) + vendor string + comment count (32-bit LE) + comments
 * Each comment: length (32-bit LE) + "FIELD=value"
 */
function parseVorbisCommentBlock(data: Buffer): Record<string, string> {
  const comments: Record<string, string> = {};

  if (data.length < 8) return comments;

  let offset = 0;

  // Skip vendor string
  const vendorLength = data.readUInt32LE(offset);
  offset += 4 + vendorLength;

  if (offset + 4 > data.length) return comments;

  // Read comment count
  const commentCount = data.readUInt32LE(offset);
  offset += 4;

  // Read each comment
  for (let i = 0; i < commentCount && offset + 4 <= data.length; i++) {
    const commentLength = data.readUInt32LE(offset);
    offset += 4;

    if (offset + commentLength > data.length) break;

    const comment = data.toString('utf8', offset, offset + commentLength);
    offset += commentLength;

    // Split on first '='
    const eqIndex = comment.indexOf('=');
    if (eqIndex > 0) {
      const field = comment.substring(0, eqIndex).toUpperCase();
      const value = comment.substring(eqIndex + 1);
      // Only store first value for each field
      if (!comments[field]) {
        comments[field] = value;
      }
    }
  }

  return comments;
}

/**
 * Match a Vorbis comment field name against known field names
 */
function getFieldValue(
  comments: Record<string, string>,
  fieldNames: readonly string[]
): string | undefined {
  for (const name of fieldNames) {
    const value = comments[name];
    if (value) return cleanText(value);
  }
  return undefined;
}

/**
 * Extract metadata from a FLAC file
 */
export async function extractFromFlac(reader: FileReader): Promise<ExtractedMetadata | null> {
  // Verify FLAC signature
  const signature = await reader.read(0, 4);
  if (signature.toString('ascii') !== 'fLaC') {
    return null;
  }

  const metadata: ExtractedMetadata = {};
  let frontCover: ArtworkResult | null = null;
  let anyArtwork: ArtworkResult | null = null;

  let offset = 4;
  let isLastBlock = false;

  while (!isLastBlock && offset < reader.size) {
    // Read metadata block header (4 bytes)
    const blockHeader = await reader.read(offset, 4);
    if (blockHeader.length < 4) break;

    isLastBlock = (blockHeader[0] & 0x80) !== 0;
    const blockType = blockHeader[0] & 0x7f;
    const blockLength = (blockHeader[1] << 16) | (blockHeader[2] << 8) | blockHeader[3];

    if (blockLength <= 0 || offset + 4 + blockLength > reader.size) break;

    // Process metadata blocks
    if (blockType === MetadataBlockType.VORBIS_COMMENT) {
      const commentData = await reader.read(offset + 4, blockLength);
      const comments = parseVorbisCommentBlock(commentData);

      // Extract metadata from Vorbis comments
      metadata.title = metadata.title ?? getFieldValue(comments, VORBIS_FIELDS.TITLE);
      metadata.artist = metadata.artist ?? getFieldValue(comments, VORBIS_FIELDS.ARTIST);
      metadata.album = metadata.album ?? getFieldValue(comments, VORBIS_FIELDS.ALBUM);
      metadata.genre = metadata.genre ?? getFieldValue(comments, VORBIS_FIELDS.GENRE);

      const dateValue = getFieldValue(comments, VORBIS_FIELDS.DATE);
      if (dateValue && !metadata.year) {
        metadata.year = parseYear(dateValue);
      }

      const bpmValue = getFieldValue(comments, VORBIS_FIELDS.BPM);
      if (bpmValue && !metadata.bpm) {
        metadata.bpm = parseBpm(bpmValue);
      }

      metadata.key = metadata.key ?? getFieldValue(comments, VORBIS_FIELDS.KEY);
    } else if (blockType === MetadataBlockType.PICTURE) {
      const pictureData = await reader.read(offset + 4, blockLength);
      const artwork = parsePictureBlock(pictureData);

      if (artwork) {
        if (artwork.pictureType === PictureType.FrontCover) {
          frontCover = artwork;
        } else if (!anyArtwork) {
          anyArtwork = artwork;
        }
      }
    }

    offset += 4 + blockLength;
  }

  // Use front cover if available, otherwise any artwork
  const artwork = frontCover ?? anyArtwork;
  if (artwork) {
    metadata.artwork = artwork.data;
    metadata.artworkMimeType = artwork.mimeType;
  }

  // Return null if no metadata was found
  if (Object.keys(metadata).length === 0) {
    return null;
  }

  return metadata;
}
