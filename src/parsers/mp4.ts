import type { ExtractedMetadata, FileReader, ArtworkMimeType } from '../types.js';
import { PictureType } from '../types.js';
import { detectImageType, parseBpm, cleanText } from './utils.js';

/**
 * MP4 atom header information
 */
interface AtomHeader {
  size: number;
  type: string;
  headerSize: number;
}

/**
 * MP4 atom location
 */
interface AtomLocation {
  dataOffset: number;
  dataSize: number;
}

/**
 * iTunes metadata atom types
 */
const ATOM_TYPES = {
  TITLE: '\xa9nam', // Title
  ARTIST: '\xa9ART', // Artist
  ALBUM: '\xa9alb', // Album
  GENRE: '\xa9gen', // Genre (text)
  GENRE_ID: 'gnre', // Genre (ID3v1 numeric)
  YEAR: '\xa9day', // Release date/year
  BPM: 'tmpo', // BPM (tempo)
  COVER: 'covr', // Cover artwork
  // Additional useful atoms
  ALBUM_ARTIST: 'aART', // Album artist
  COMPOSER: '\xa9wrt', // Composer
  COMMENT: '\xa9cmt', // Comment
} as const;

/**
 * Read an MP4 atom header
 */
async function readAtomHeader(
  reader: FileReader,
  offset: number
): Promise<AtomHeader | null> {
  if (offset + 8 > reader.size) return null;

  const header = await reader.read(offset, 8);
  const size = header.readUInt32BE(0);
  const type = header.toString('ascii', 4, 8);

  // Extended size (64-bit)
  if (size === 1) {
    if (offset + 16 > reader.size) return null;
    const extHeader = await reader.read(offset + 8, 8);
    const extSize = Number(extHeader.readBigUInt64BE(0));
    return { size: extSize, type, headerSize: 16 };
  }

  // Size 0 means atom extends to end of file
  if (size === 0) {
    return { size: reader.size - offset, type, headerSize: 8 };
  }

  return { size, type, headerSize: 8 };
}

/**
 * Find an atom within a range
 */
async function findAtom(
  reader: FileReader,
  startOffset: number,
  endOffset: number,
  targetType: string
): Promise<AtomLocation | null> {
  let offset = startOffset;

  while (offset < endOffset) {
    const header = await readAtomHeader(reader, offset);
    if (!header || header.size <= 0) break;

    if (header.type === targetType) {
      return {
        dataOffset: offset + header.headerSize,
        dataSize: header.size - header.headerSize,
      };
    }

    offset += header.size;
  }

  return null;
}

/**
 * Find the moov atom (contains all metadata)
 */
async function findMoovAtom(reader: FileReader): Promise<AtomLocation | null> {
  return findAtom(reader, 0, reader.size, 'moov');
}

/**
 * Navigate to ilst (iTunes metadata list) atom
 * Path: moov -> udta -> meta -> ilst
 */
async function findIlstAtom(
  reader: FileReader,
  moovOffset: number,
  moovSize: number
): Promise<AtomLocation | null> {
  const udta = await findAtom(reader, moovOffset, moovOffset + moovSize, 'udta');
  if (!udta) return null;

  const meta = await findAtom(reader, udta.dataOffset, udta.dataOffset + udta.dataSize, 'meta');
  if (!meta) return null;

  // meta atom has 4 bytes of version/flags before child atoms
  const metaDataStart = meta.dataOffset + 4;
  const metaDataEnd = meta.dataOffset + meta.dataSize;

  const ilst = await findAtom(reader, metaDataStart, metaDataEnd, 'ilst');
  return ilst;
}

/**
 * Read a text data atom value
 */
async function readTextDataAtom(
  reader: FileReader,
  atomOffset: number,
  atomSize: number
): Promise<string | undefined> {
  const data = await findAtom(reader, atomOffset, atomOffset + atomSize, 'data');
  if (!data || data.dataSize < 8) return undefined;

  // data atom: 4 bytes type + 4 bytes locale + actual data
  const content = await reader.read(data.dataOffset + 8, data.dataSize - 8);
  return cleanText(content.toString('utf8'));
}

/**
 * Read a numeric data atom value (for BPM, genre ID)
 */
async function readNumericDataAtom(
  reader: FileReader,
  atomOffset: number,
  atomSize: number
): Promise<number | undefined> {
  const data = await findAtom(reader, atomOffset, atomOffset + atomSize, 'data');
  if (!data || data.dataSize < 10) return undefined;

  // data atom: 4 bytes type + 4 bytes locale + actual data
  const content = await reader.read(data.dataOffset + 8, data.dataSize - 8);

  // BPM is typically stored as 16-bit big-endian
  if (content.length >= 2) {
    return content.readUInt16BE(0);
  }

  return undefined;
}

/**
 * Read cover artwork from covr atom
 */
async function readCoverArtwork(
  reader: FileReader,
  atomOffset: number,
  atomSize: number
): Promise<{ data: Buffer; mimeType: ArtworkMimeType } | null> {
  const data = await findAtom(reader, atomOffset, atomOffset + atomSize, 'data');
  if (!data || data.dataSize < 8) return null;

  const imageData = await reader.read(data.dataOffset + 8, data.dataSize - 8);
  if (imageData.length === 0) return null;

  const mimeType = detectImageType(imageData) ?? 'image/jpeg';
  return { data: imageData, mimeType };
}

/**
 * Extract metadata from an MP4/M4A file
 */
export async function extractFromMp4(reader: FileReader): Promise<ExtractedMetadata | null> {
  // Verify this is an MP4 file by checking for ftyp atom
  const ftypHeader = await reader.read(0, 8);
  if (ftypHeader.length < 8 || ftypHeader.toString('ascii', 4, 8) !== 'ftyp') {
    return null;
  }

  // Find moov atom
  const moov = await findMoovAtom(reader);
  if (!moov) return null;

  // Find ilst atom (iTunes metadata)
  const ilst = await findIlstAtom(reader, moov.dataOffset, moov.dataSize);
  if (!ilst) return null;

  const metadata: ExtractedMetadata = {};

  // Iterate through ilst child atoms
  let offset = ilst.dataOffset;
  const endOffset = ilst.dataOffset + ilst.dataSize;

  while (offset < endOffset) {
    const header = await readAtomHeader(reader, offset);
    if (!header || header.size <= 0) break;

    const atomType = header.type;
    const atomDataOffset = offset + header.headerSize;
    const atomDataSize = header.size - header.headerSize;

    // Extract metadata based on atom type
    switch (atomType) {
      case ATOM_TYPES.TITLE:
        metadata.title = metadata.title ?? (await readTextDataAtom(reader, atomDataOffset, atomDataSize));
        break;

      case ATOM_TYPES.ARTIST:
        metadata.artist = metadata.artist ?? (await readTextDataAtom(reader, atomDataOffset, atomDataSize));
        break;

      case ATOM_TYPES.ALBUM:
        metadata.album = metadata.album ?? (await readTextDataAtom(reader, atomDataOffset, atomDataSize));
        break;

      case ATOM_TYPES.GENRE: {
        const genre = await readTextDataAtom(reader, atomDataOffset, atomDataSize);
        metadata.genre = metadata.genre ?? genre;
        break;
      }

      case ATOM_TYPES.GENRE_ID: {
        const genreId = await readNumericDataAtom(reader, atomDataOffset, atomDataSize);
        if (genreId !== undefined && !metadata.genre) {
          metadata.genre = ID3V1_GENRES[genreId - 1]; // MP4 genre IDs are 1-based
        }
        break;
      }

      case ATOM_TYPES.YEAR: {
        const yearStr = await readTextDataAtom(reader, atomDataOffset, atomDataSize);
        if (yearStr && !metadata.year) {
          const match = yearStr.match(/\d{4}/);
          if (match) {
            metadata.year = parseInt(match[0], 10);
          }
        }
        break;
      }

      case ATOM_TYPES.BPM: {
        const bpm = await readNumericDataAtom(reader, atomDataOffset, atomDataSize);
        if (bpm !== undefined && bpm > 0 && bpm < 500) {
          metadata.bpm = metadata.bpm ?? bpm;
        }
        break;
      }

      case ATOM_TYPES.COVER: {
        if (!metadata.artwork) {
          const artwork = await readCoverArtwork(reader, atomDataOffset, atomDataSize);
          if (artwork) {
            metadata.artwork = artwork.data;
            metadata.artworkMimeType = artwork.mimeType;
          }
        }
        break;
      }
    }

    offset += header.size;
  }

  // Return null if no metadata was found
  if (Object.keys(metadata).length === 0) {
    return null;
  }

  return metadata;
}

/**
 * ID3v1 genre list (used for gnre atom)
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
