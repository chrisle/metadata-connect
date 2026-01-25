/**
 * Interface for reading file data at arbitrary offsets.
 * This allows extracting metadata from remote files by reading only the necessary bytes.
 */
export interface FileReader {
  /** Total file size in bytes */
  readonly size: number;
  /** File extension (without dot), e.g., 'mp3', 'flac', 'm4a' */
  readonly extension: string;
  /** Read bytes from the file at a given offset */
  read(offset: number, length: number): Promise<Buffer>;
}

/**
 * Standard picture types from ID3v2 / FLAC specs
 */
export enum PictureType {
  Other = 0,
  FileIcon32x32 = 1,
  OtherFileIcon = 2,
  FrontCover = 3,
  BackCover = 4,
  LeafletPage = 5,
  Media = 6,
  LeadArtist = 7,
  Artist = 8,
  Conductor = 9,
  Band = 10,
  Composer = 11,
  Lyricist = 12,
  RecordingLocation = 13,
  DuringRecording = 14,
  DuringPerformance = 15,
  MovieScreenCapture = 16,
  BrightColoredFish = 17,
  Illustration = 18,
  BandLogotype = 19,
  PublisherLogotype = 20,
}

/**
 * MIME types supported for artwork
 */
export type ArtworkMimeType = 'image/jpeg' | 'image/png' | 'image/gif';

/**
 * Extracted metadata from an audio file
 */
export interface ExtractedMetadata {
  /** Track title */
  title?: string;
  /** Artist name */
  artist?: string;
  /** Album name */
  album?: string;
  /** Genre */
  genre?: string;
  /** Release year */
  year?: number;
  /** Beats per minute */
  bpm?: number;
  /** Musical key (e.g., "Am", "C#m", "5A") */
  key?: string;
  /** Artwork image data */
  artwork?: Buffer;
  /** MIME type of the artwork */
  artworkMimeType?: ArtworkMimeType;
}

/**
 * Parser function signature
 */
export type MetadataParser = (reader: FileReader) => Promise<ExtractedMetadata | null>;
