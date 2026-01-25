# metadata-connect

Extract audio metadata from MP3, M4A, FLAC, and AIFF files with support for partial file reads - perfect for extracting metadata from remote files over the network without downloading entire files.

[![npm version](https://badge.fury.io/js/metadata-connect.svg)](https://www.npmjs.com/package/metadata-connect)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Partial file reading** - Extract metadata by reading only file headers (10-200KB instead of entire files)
- **Multiple format support** - MP3 (ID3v2), M4A/MP4/AAC, FLAC, AIFF
- **Complete metadata extraction** - Title, artist, album, genre, year, BPM, key, and artwork
- **FileReader abstraction** - Works with any data source (local files, NFS, HTTP range requests, custom protocols)
- **Zero runtime dependencies** - Pure TypeScript implementation
- **TypeScript first** - Full type definitions included

## Installation

```bash
npm install metadata-connect
```

## Quick Start

### Extract from a local file

```typescript
import { extractMetadata, createBufferReader } from 'metadata-connect';
import { readFile } from 'fs/promises';

const buffer = await readFile('song.mp3');
const reader = createBufferReader(buffer, 'mp3');
const metadata = await extractMetadata(reader);

if (metadata) {
  console.log(metadata.title);   // "Song Title"
  console.log(metadata.artist);  // "Artist Name"
  console.log(metadata.bpm);     // 128
  console.log(metadata.key);     // "Am"

  if (metadata.artwork) {
    // metadata.artwork is a Buffer
    // metadata.artworkMimeType is 'image/jpeg' | 'image/png' | 'image/gif'
  }
}
```

### Extract from a remote file (partial read)

The real power of metadata-connect is extracting metadata from remote files without downloading them entirely:

```typescript
import { extractMetadata } from 'metadata-connect';
import type { FileReader } from 'metadata-connect';

// Create a FileReader that fetches only the requested bytes
const reader: FileReader = {
  size: fileSize, // Total file size (get from HEAD request or file stat)
  extension: 'mp3',
  async read(offset: number, length: number): Promise<Buffer> {
    // Use HTTP Range requests, NFS, or any protocol
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` }
    });
    return Buffer.from(await response.arrayBuffer());
  }
};

const metadata = await extractMetadata(reader);
```

## API Reference

### `extractMetadata(reader: FileReader): Promise<ExtractedMetadata | null>`

Main extraction function. Returns metadata or null if the format is not supported or parsing fails.

### `createBufferReader(buffer: Buffer, extension: string): FileReader`

Create a FileReader from a Buffer for in-memory extraction.

### `isExtensionSupported(extension: string): boolean`

Check if a file extension is supported.

### `getSupportedExtensions(): string[]`

Get list of supported extensions: `['mp3', 'm4a', 'mp4', 'aac', 'flac', 'aiff', 'aif']`

### `getParserForExtension(extension: string): MetadataParser | null`

Get the parser function for a specific extension.

## Types

### `FileReader`

```typescript
interface FileReader {
  /** Total file size in bytes */
  readonly size: number;
  /** File extension (without dot), e.g., 'mp3', 'flac' */
  readonly extension: string;
  /** Read bytes from the file at a given offset */
  read(offset: number, length: number): Promise<Buffer>;
}
```

### `ExtractedMetadata`

```typescript
interface ExtractedMetadata {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  bpm?: number;
  key?: string;
  artwork?: Buffer;
  artworkMimeType?: 'image/jpeg' | 'image/png' | 'image/gif';
}
```

## Format Support

| Format | Extension | Metadata Source |
|--------|-----------|-----------------|
| MP3 | `.mp3` | ID3v2.2, ID3v2.3, ID3v2.4 tags |
| M4A/MP4 | `.m4a`, `.mp4`, `.aac` | iTunes metadata atoms |
| FLAC | `.flac` | Vorbis comments + PICTURE blocks |
| AIFF | `.aiff`, `.aif` | ID3 chunk |

### Extracted Fields

| Field | MP3 | M4A | FLAC | AIFF |
|-------|-----|-----|------|------|
| Title | TIT2 | ©nam | TITLE | ID3 |
| Artist | TPE1 | ©ART | ARTIST | ID3 |
| Album | TALB | ©alb | ALBUM | ID3 |
| Genre | TCON | ©gen/gnre | GENRE | ID3 |
| Year | TYER/TDRC | ©day | DATE | ID3 |
| BPM | TBPM | tmpo | BPM/TEMPO | ID3 |
| Key | TKEY | - | KEY/INITIALKEY | ID3 |
| Artwork | APIC | covr | PICTURE | ID3 |

## Network Efficiency

The library is designed to minimize network transfer when reading from remote sources:

| Format | Typical Bytes Read |
|--------|-------------------|
| MP3 | 10-50 KB (ID3v2 tag at file start) |
| FLAC | 10 KB (metadata blocks at file start) |
| M4A/MP4 | 50-200 KB (atom tree traversal) |
| AIFF | 10-50 KB (ID3 chunk location varies) |

## Use Cases

- **DJ Software** - Extract track info from CDJs/controllers over network protocols
- **Media Servers** - Index large music libraries without reading entire files
- **Streaming Services** - Quick metadata lookup for remote storage
- **Browser Applications** - Extract metadata using fetch with Range headers

## Advanced Usage

### Using Individual Parsers

```typescript
import { extractFromMp3, extractFromMp4, extractFromFlac } from 'metadata-connect';

// Use specific parser directly
const metadata = await extractFromMp3(reader);
```

### Detecting Image Types

```typescript
import { detectImageType } from 'metadata-connect';

const mimeType = detectImageType(imageBuffer);
// Returns 'image/jpeg' | 'image/png' | 'image/gif' | null
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Related Projects

- [music-metadata](https://github.com/borewit/music-metadata) - Full-featured audio metadata library (requires full file access)
- [node-id3](https://github.com/Zazama/node-id3) - ID3 tag reader/writer for Node.js
