import type { ExtractedMetadata, FileReader, ArtworkMimeType } from '../types.js';
import { PictureType } from '../types.js';
import {
  detectImageType,
  readSyncsafe,
  getTextEncoding,
  readNullTerminatedString,
  parseBpm,
  parseYear,
  cleanText,
} from './utils.js';

/**
 * ID3v2 frame IDs for metadata extraction
 */
const FRAME_IDS = {
  // Text frames
  TITLE: ['TIT2', 'TT2'], // Title
  ARTIST: ['TPE1', 'TP1'], // Lead artist
  ALBUM: ['TALB', 'TAL'], // Album
  GENRE: ['TCON', 'TCO'], // Genre
  YEAR: ['TYER', 'TYE', 'TDRC'], // Year (TYER for v2.3, TDRC for v2.4)
  BPM: ['TBPM', 'TBP'], // BPM
  KEY: ['TKEY', 'TKE'], // Musical key
  // Picture frame
  PICTURE: ['APIC', 'PIC'],
} as const;

interface ParsedFrame {
  id: string;
  data: Buffer;
}

interface ArtworkResult {
  data: Buffer;
  mimeType: ArtworkMimeType;
  pictureType: PictureType;
}

/**
 * Parse an APIC (attached picture) frame
 */
function parseApicFrame(data: Buffer): ArtworkResult | null {
  if (data.length < 4) return null;

  let offset = 0;
  const encodingByte = data[offset++];
  let encoding = getTextEncoding(encodingByte);

  // Check for BOM in UTF-16
  if (encodingByte === 1 && data.length > offset + 2) {
    const bom = data.readUInt16BE(offset);
    if (bom === 0xfeff) encoding = 'utf16be';
    else if (bom === 0xfffe) encoding = 'utf16le';
  }

  const mimeResult = readNullTerminatedString(data, offset, 'latin1');
  const mimeType = mimeResult.value;
  offset += mimeResult.bytesConsumed;

  if (offset >= data.length) return null;

  const pictureType = data[offset++] as PictureType;
  if (offset >= data.length) return null;

  const descResult = readNullTerminatedString(data, offset, encoding);
  offset += descResult.bytesConsumed;

  if (offset >= data.length) return null;

  const imageData = data.subarray(offset);
  if (imageData.length === 0) return null;

  const detectedType = detectImageType(imageData);
  const finalMimeType: ArtworkMimeType =
    detectedType ?? (mimeType.includes('png') ? 'image/png' : 'image/jpeg');

  return { data: imageData, mimeType: finalMimeType, pictureType };
}

/**
 * Parse a text frame (TIT2, TPE1, etc.)
 */
function parseTextFrame(data: Buffer): string | undefined {
  if (data.length < 2) return undefined;

  const encodingByte = data[0];
  let encoding = getTextEncoding(encodingByte);
  let offset = 1;

  // Check for BOM in UTF-16
  if (encodingByte === 1 && data.length > offset + 2) {
    const bom = data.readUInt16BE(offset);
    if (bom === 0xfeff) {
      encoding = 'utf16be';
      offset += 2;
    } else if (bom === 0xfffe) {
      encoding = 'utf16le';
      offset += 2;
    }
  }

  // Read until null terminator or end of data
  const textData = data.subarray(offset);

  if (encoding === 'utf16le' || encoding === 'utf16be') {
    // Find null terminator (two zeros)
    let end = textData.length;
    for (let i = 0; i < textData.length - 1; i += 2) {
      if (textData[i] === 0 && textData[i + 1] === 0) {
        end = i;
        break;
      }
    }

    if (encoding === 'utf16be') {
      // Swap bytes for big-endian
      const swapped = Buffer.alloc(end);
      for (let i = 0; i < end; i += 2) {
        swapped[i] = textData[i + 1];
        swapped[i + 1] = textData[i];
      }
      return cleanText(swapped.toString('utf16le'));
    }
    return cleanText(textData.toString('utf16le', 0, end));
  }

  // Latin1 or UTF-8
  let end = textData.indexOf(0);
  if (end === -1) end = textData.length;
  return cleanText(textData.toString(encoding, 0, end));
}

/**
 * Check if a frame ID matches any of the target IDs
 */
function matchesFrameId(frameId: string, targets: readonly string[]): boolean {
  return targets.some((target) => frameId === target || frameId.startsWith(target));
}

/**
 * Extract metadata from an MP3 file with ID3v2 tags
 */
export async function extractFromMp3(reader: FileReader): Promise<ExtractedMetadata | null> {
  // Read ID3v2 header (10 bytes)
  const header = await reader.read(0, 10);
  if (header.length < 10 || header.toString('ascii', 0, 3) !== 'ID3') {
    return null;
  }

  const majorVersion = header[3];
  const flags = header[5];
  const tagSize = readSyncsafe(header, 6);

  // Handle extended header if present
  let extendedHeaderSize = 0;
  if (flags & 0x40) {
    const extHeader = await reader.read(10, 4);
    extendedHeaderSize =
      majorVersion === 4 ? readSyncsafe(extHeader, 0) : extHeader.readUInt32BE(0);
  }

  // Read all tag data
  const tagData = await reader.read(10 + extendedHeaderSize, tagSize - extendedHeaderSize);

  const metadata: ExtractedMetadata = {};
  let frontCover: ArtworkResult | null = null;
  let anyArtwork: ArtworkResult | null = null;

  // Parse frames
  let offset = 0;
  const frameHeaderSize = majorVersion >= 3 ? 10 : 6;

  while (offset < tagData.length - frameHeaderSize) {
    // End of frames (padding starts with zero)
    if (tagData[offset] === 0) break;

    let frameId: string;
    let frameSize: number;

    if (majorVersion >= 3) {
      // ID3v2.3 or ID3v2.4
      frameId = tagData.toString('ascii', offset, offset + 4);
      frameSize =
        majorVersion === 4
          ? readSyncsafe(tagData, offset + 4)
          : tagData.readUInt32BE(offset + 4);
    } else {
      // ID3v2.2
      frameId = tagData.toString('ascii', offset, offset + 3);
      frameSize =
        (tagData[offset + 3] << 16) | (tagData[offset + 4] << 8) | tagData[offset + 5];
    }

    if (frameSize <= 0 || frameSize > tagData.length - offset) break;

    const frameData = tagData.subarray(
      offset + frameHeaderSize,
      offset + frameHeaderSize + frameSize
    );

    // Normalize v2.2 frame IDs to v2.3/4 equivalents
    const normalizedId = majorVersion >= 3 ? frameId : normalizeV22FrameId(frameId);

    // Extract metadata from text frames
    if (matchesFrameId(normalizedId, FRAME_IDS.TITLE)) {
      metadata.title = metadata.title ?? parseTextFrame(frameData);
    } else if (matchesFrameId(normalizedId, FRAME_IDS.ARTIST)) {
      metadata.artist = metadata.artist ?? parseTextFrame(frameData);
    } else if (matchesFrameId(normalizedId, FRAME_IDS.ALBUM)) {
      metadata.album = metadata.album ?? parseTextFrame(frameData);
    } else if (matchesFrameId(normalizedId, FRAME_IDS.GENRE)) {
      metadata.genre = metadata.genre ?? parseGenre(parseTextFrame(frameData));
    } else if (matchesFrameId(normalizedId, FRAME_IDS.YEAR)) {
      metadata.year = metadata.year ?? parseYear(parseTextFrame(frameData) ?? '');
    } else if (matchesFrameId(normalizedId, FRAME_IDS.BPM)) {
      metadata.bpm = metadata.bpm ?? parseBpm(parseTextFrame(frameData) ?? '');
    } else if (matchesFrameId(normalizedId, FRAME_IDS.KEY)) {
      metadata.key = metadata.key ?? parseTextFrame(frameData);
    } else if (matchesFrameId(normalizedId, FRAME_IDS.PICTURE)) {
      const artwork = parseApicFrame(frameData);
      if (artwork) {
        if (artwork.pictureType === PictureType.FrontCover) {
          frontCover = artwork;
        } else if (!anyArtwork) {
          anyArtwork = artwork;
        }
      }
    }

    offset += frameHeaderSize + frameSize;
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

/**
 * Normalize ID3v2.2 frame IDs to v2.3/4 equivalents
 */
function normalizeV22FrameId(frameId: string): string {
  const mapping: Record<string, string> = {
    TT2: 'TIT2', // Title
    TP1: 'TPE1', // Artist
    TAL: 'TALB', // Album
    TCO: 'TCON', // Genre
    TYE: 'TYER', // Year
    TBP: 'TBPM', // BPM
    TKE: 'TKEY', // Key
    PIC: 'APIC', // Picture
  };
  return mapping[frameId] ?? frameId;
}

/**
 * Parse genre string, handling ID3v1 numeric references
 * Format: "(17)Rock" or "(17)" or "Rock"
 */
function parseGenre(genre: string | undefined): string | undefined {
  if (!genre) return undefined;

  // Check for ID3v1 numeric reference
  const match = genre.match(/^\((\d+)\)(.*)$/);
  if (match) {
    const id = parseInt(match[1], 10);
    const textGenre = match[2].trim();
    // If there's text after the number, use that
    if (textGenre) return textGenre;
    // Otherwise look up the ID3v1 genre
    return ID3V1_GENRES[id] ?? genre;
  }

  return genre;
}

/**
 * ID3v1 genre list
 */
const ID3V1_GENRES: Record<number, string> = {
  0: 'Blues',
  1: 'Classic Rock',
  2: 'Country',
  3: 'Dance',
  4: 'Disco',
  5: 'Funk',
  6: 'Grunge',
  7: 'Hip-Hop',
  8: 'Jazz',
  9: 'Metal',
  10: 'New Age',
  11: 'Oldies',
  12: 'Other',
  13: 'Pop',
  14: 'R&B',
  15: 'Rap',
  16: 'Reggae',
  17: 'Rock',
  18: 'Techno',
  19: 'Industrial',
  20: 'Alternative',
  21: 'Ska',
  22: 'Death Metal',
  23: 'Pranks',
  24: 'Soundtrack',
  25: 'Euro-Techno',
  26: 'Ambient',
  27: 'Trip-Hop',
  28: 'Vocal',
  29: 'Jazz+Funk',
  30: 'Fusion',
  31: 'Trance',
  32: 'Classical',
  33: 'Instrumental',
  34: 'Acid',
  35: 'House',
  36: 'Game',
  37: 'Sound Clip',
  38: 'Gospel',
  39: 'Noise',
  40: 'Alternative Rock',
  41: 'Bass',
  42: 'Soul',
  43: 'Punk',
  44: 'Space',
  45: 'Meditative',
  46: 'Instrumental Pop',
  47: 'Instrumental Rock',
  48: 'Ethnic',
  49: 'Gothic',
  50: 'Darkwave',
  51: 'Techno-Industrial',
  52: 'Electronic',
  53: 'Pop-Folk',
  54: 'Eurodance',
  55: 'Dream',
  56: 'Southern Rock',
  57: 'Comedy',
  58: 'Cult',
  59: 'Gangsta',
  60: 'Top 40',
  61: 'Christian Rap',
  62: 'Pop/Funk',
  63: 'Jungle',
  64: 'Native US',
  65: 'Cabaret',
  66: 'New Wave',
  67: 'Psychedelic',
  68: 'Rave',
  69: 'Showtunes',
  70: 'Trailer',
  71: 'Lo-Fi',
  72: 'Tribal',
  73: 'Acid Punk',
  74: 'Acid Jazz',
  75: 'Polka',
  76: 'Retro',
  77: 'Musical',
  78: 'Rock & Roll',
  79: 'Hard Rock',
};
