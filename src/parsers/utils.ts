import type { ArtworkMimeType } from '../types.js';

/**
 * Detect image type from magic bytes
 */
export function detectImageType(data: Buffer): ArtworkMimeType | null {
  if (data.length < 4) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (data.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return null;
}

/**
 * Normalize a MIME type string to a supported artwork type
 */
export function normalizeMimeType(mimeType: string): ArtworkMimeType {
  const lower = mimeType.toLowerCase();
  if (lower.includes('png')) return 'image/png';
  if (lower.includes('gif')) return 'image/gif';
  return 'image/jpeg';
}

/**
 * Read a syncsafe integer (ID3v2 format)
 * Each byte only uses 7 bits
 */
export function readSyncsafe(buffer: Buffer, offset: number = 0): number {
  return (
    ((buffer[offset] & 0x7f) << 21) |
    ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) |
    (buffer[offset + 3] & 0x7f)
  );
}

/**
 * Get text encoding from ID3v2 encoding byte
 */
export function getTextEncoding(
  encodingByte: number
): 'latin1' | 'utf8' | 'utf16le' | 'utf16be' {
  switch (encodingByte) {
    case 0:
      return 'latin1';
    case 1:
      return 'utf16le';
    case 2:
      return 'utf16be';
    case 3:
      return 'utf8';
    default:
      return 'latin1';
  }
}

/**
 * Read a null-terminated string from a buffer
 */
export function readNullTerminatedString(
  buffer: Buffer,
  offset: number,
  encoding: 'latin1' | 'utf8' | 'utf16le' | 'utf16be'
): { value: string; bytesConsumed: number } {
  const isUtf16 = encoding === 'utf16le' || encoding === 'utf16be';
  let end = offset;

  if (isUtf16) {
    while (end < buffer.length - 1) {
      if (buffer[end] === 0 && buffer[end + 1] === 0) break;
      end += 2;
    }
  } else {
    while (end < buffer.length && buffer[end] !== 0) end++;
  }

  let value: string;
  if (encoding === 'utf16be') {
    const swapped = Buffer.alloc(end - offset);
    for (let i = 0; i < end - offset; i += 2) {
      swapped[i] = buffer[offset + i + 1];
      swapped[i + 1] = buffer[offset + i];
    }
    value = swapped.toString('utf16le');
  } else {
    value = buffer.toString(encoding === 'utf16le' ? 'utf16le' : encoding, offset, end);
  }

  return { value, bytesConsumed: end - offset + (isUtf16 ? 2 : 1) };
}

/**
 * Parse a BPM string to a number
 * Handles formats like "128", "128.5", "128 BPM"
 */
export function parseBpm(value: string): number | undefined {
  const match = value.match(/[\d.]+/);
  if (!match) return undefined;
  const num = parseFloat(match[0]);
  if (isNaN(num) || num <= 0 || num > 500) return undefined;
  return Math.round(num * 10) / 10; // Round to 1 decimal place
}

/**
 * Parse a year string to a number
 * Handles formats like "2024", "2024-01-15", "2024/01/15"
 */
export function parseYear(value: string): number | undefined {
  const match = value.match(/\d{4}/);
  if (!match) return undefined;
  const year = parseInt(match[0], 10);
  if (year < 1900 || year > 2100) return undefined;
  return year;
}

/**
 * Clean up text by removing null characters and trimming
 */
export function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Remove null characters and trim
  const cleaned = value.replace(/\0/g, '').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}
