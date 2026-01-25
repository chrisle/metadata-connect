import type { FileReader } from './types.js';

/**
 * Create a FileReader from a Buffer (for testing or in-memory data)
 */
export function createBufferReader(buffer: Buffer, extension: string): FileReader {
  return {
    size: buffer.length,
    extension,
    read: (offset: number, length: number): Promise<Buffer> => {
      const end = Math.min(offset + length, buffer.length);
      return Promise.resolve(buffer.subarray(offset, end));
    },
  };
}
