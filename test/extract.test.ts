import { describe, it, expect } from 'vitest';
import {
  extractMetadata,
  createBufferReader,
  isExtensionSupported,
  getSupportedExtensions,
  getParserForExtension,
} from '../src/index.js';

describe('metadata-connect', () => {
  describe('isExtensionSupported', () => {
    it('returns true for supported extensions', () => {
      expect(isExtensionSupported('mp3')).toBe(true);
      expect(isExtensionSupported('m4a')).toBe(true);
      expect(isExtensionSupported('mp4')).toBe(true);
      expect(isExtensionSupported('aac')).toBe(true);
      expect(isExtensionSupported('flac')).toBe(true);
      expect(isExtensionSupported('aiff')).toBe(true);
      expect(isExtensionSupported('aif')).toBe(true);
    });

    it('returns false for unsupported extensions', () => {
      expect(isExtensionSupported('wav')).toBe(false);
      expect(isExtensionSupported('ogg')).toBe(false);
      expect(isExtensionSupported('txt')).toBe(false);
    });

    it('handles case insensitivity', () => {
      expect(isExtensionSupported('MP3')).toBe(true);
      expect(isExtensionSupported('FLAC')).toBe(true);
      expect(isExtensionSupported('M4A')).toBe(true);
    });
  });

  describe('getSupportedExtensions', () => {
    it('returns all supported extensions', () => {
      const extensions = getSupportedExtensions();
      expect(extensions).toContain('mp3');
      expect(extensions).toContain('m4a');
      expect(extensions).toContain('flac');
      expect(extensions).toContain('aiff');
      expect(extensions.length).toBeGreaterThan(0);
    });
  });

  describe('getParserForExtension', () => {
    it('returns a parser for supported extensions', () => {
      expect(getParserForExtension('mp3')).toBeTypeOf('function');
      expect(getParserForExtension('m4a')).toBeTypeOf('function');
      expect(getParserForExtension('flac')).toBeTypeOf('function');
    });

    it('returns null for unsupported extensions', () => {
      expect(getParserForExtension('wav')).toBeNull();
      expect(getParserForExtension('ogg')).toBeNull();
    });
  });

  describe('createBufferReader', () => {
    it('creates a reader with correct properties', () => {
      const buffer = Buffer.from('test data');
      const reader = createBufferReader(buffer, 'mp3');

      expect(reader.size).toBe(buffer.length);
      expect(reader.extension).toBe('mp3');
    });

    it('reads data at correct offset', async () => {
      const buffer = Buffer.from('Hello, World!');
      const reader = createBufferReader(buffer, 'mp3');

      const data = await reader.read(0, 5);
      expect(data.toString()).toBe('Hello');

      const data2 = await reader.read(7, 5);
      expect(data2.toString()).toBe('World');
    });

    it('handles reading past end of buffer', async () => {
      const buffer = Buffer.from('Short');
      const reader = createBufferReader(buffer, 'mp3');

      const data = await reader.read(0, 100);
      expect(data.length).toBe(5);
      expect(data.toString()).toBe('Short');
    });
  });

  describe('extractMetadata', () => {
    it('returns null for empty buffer', async () => {
      const reader = createBufferReader(Buffer.alloc(0), 'mp3');
      const metadata = await extractMetadata(reader);
      expect(metadata).toBeNull();
    });

    it('returns null for unsupported format', async () => {
      const reader = createBufferReader(Buffer.from('test'), 'wav');
      const metadata = await extractMetadata(reader);
      expect(metadata).toBeNull();
    });

    it('returns null for invalid MP3 data', async () => {
      const reader = createBufferReader(Buffer.from('not an mp3 file'), 'mp3');
      const metadata = await extractMetadata(reader);
      expect(metadata).toBeNull();
    });

    it('returns null for invalid FLAC data', async () => {
      const reader = createBufferReader(Buffer.from('not a flac file'), 'flac');
      const metadata = await extractMetadata(reader);
      expect(metadata).toBeNull();
    });

    it('returns null for invalid M4A data', async () => {
      const reader = createBufferReader(Buffer.from('not an m4a file'), 'm4a');
      const metadata = await extractMetadata(reader);
      expect(metadata).toBeNull();
    });
  });
});

describe('ID3v2 parsing', () => {
  it('parses valid ID3v2.3 header', async () => {
    // Create a minimal valid ID3v2.3 tag
    const id3Header = Buffer.from([
      0x49, 0x44, 0x33, // "ID3"
      0x03, 0x00, // Version 2.3
      0x00, // Flags
      0x00, 0x00, 0x00, 0x00, // Size (syncsafe, 0 bytes)
    ]);

    const reader = createBufferReader(id3Header, 'mp3');
    const metadata = await extractMetadata(reader);
    // Empty tag should return null (no metadata found)
    expect(metadata).toBeNull();
  });
});
