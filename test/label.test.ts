import { describe, it, expect } from 'vitest';
import { extractMetadata, createBufferReader } from '../src/index.js';

/**
 * Record label extraction (NP3-364).
 *
 * The label is the one field a DJ cares about that no tag format agreed on:
 * ID3 has a frame for it, Vorbis has three competing field names, and MP4 has
 * no atom at all and stores it as a freeform field. Each of these fixtures is
 * the minimum valid file that carries a label in one of those ways.
 */

// ---------------------------------------------------------------- ID3 (mp3)

/** A v2.3/2.4 frame: 4-byte id, 4-byte big-endian size, 2 flag bytes. */
function id3v23Frame(id: string, value: string): Buffer {
  const body = Buffer.concat([Buffer.from([0x00]), Buffer.from(value, 'latin1')]);
  const header = Buffer.alloc(10);
  header.write(id, 0, 'ascii');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** A v2.2 frame: 3-byte id and 3-byte size, no flags. */
function id3v22Frame(id: string, value: string): Buffer {
  const body = Buffer.concat([Buffer.from([0x00]), Buffer.from(value, 'latin1')]);
  const header = Buffer.alloc(6);
  header.write(id, 0, 'ascii');
  header.writeUIntBE(body.length, 3, 3);
  return Buffer.concat([header, body]);
}

function id3Tag(majorVersion: number, frames: Buffer[]): Buffer {
  const body = Buffer.concat(frames);
  const header = Buffer.alloc(10);
  header.write('ID3', 0, 'ascii');
  header[3] = majorVersion;
  // Tag size is syncsafe: 7 bits per byte so it can never look like a frame sync
  header[6] = (body.length >> 21) & 0x7f;
  header[7] = (body.length >> 14) & 0x7f;
  header[8] = (body.length >> 7) & 0x7f;
  header[9] = body.length & 0x7f;
  return Buffer.concat([header, body]);
}

// --------------------------------------------------------------- FLAC

function vorbisComment(fields: string[]): Buffer {
  const vendor = Buffer.from('reference libFLAC', 'utf8');
  const parts = [Buffer.alloc(4), vendor, Buffer.alloc(4)];
  parts[0].writeUInt32LE(vendor.length, 0);
  parts[2].writeUInt32LE(fields.length, 0);

  for (const field of fields) {
    const encoded = Buffer.from(field, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32LE(encoded.length, 0);
    parts.push(length, encoded);
  }

  const body = Buffer.concat(parts);
  // Block header: last-block flag in the top bit, then type, then 24-bit length
  const blockHeader = Buffer.alloc(4);
  blockHeader[0] = 0x80 | 4; // last block, VORBIS_COMMENT
  blockHeader.writeUIntBE(body.length, 1, 3);

  return Buffer.concat([Buffer.from('fLaC', 'ascii'), blockHeader, body]);
}

// --------------------------------------------------------------- MP4

function atom(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
}

/** An iTunes freeform atom: the namespace, the field name, then the value. */
function freeformAtom(name: string, value: string): Buffer {
  return atom(
    '----',
    atom('mean', Buffer.alloc(4), Buffer.from('com.apple.iTunes', 'utf8')),
    atom('name', Buffer.alloc(4), Buffer.from(name, 'utf8')),
    // data atom: 4 bytes type, 4 bytes locale, then the value
    atom('data', Buffer.alloc(8), Buffer.from(value, 'utf8'))
  );
}

function mp4File(...items: Buffer[]): Buffer {
  return Buffer.concat([
    atom('ftyp', Buffer.from('M4A \0\0\0\0', 'latin1')),
    // meta carries 4 bytes of version/flags before its children, unlike every
    // other container atom
    atom('moov', atom('udta', atom('meta', Buffer.alloc(4), atom('ilst', ...items)))),
  ]);
}

// ----------------------------------------------------------------- tests

describe('record label extraction', () => {
  describe('ID3', () => {
    it('reads the label from a v2.3 TPUB frame', async () => {
      const file = id3Tag(3, [
        id3v23Frame('TIT2', 'Strobe'),
        id3v23Frame('TPUB', 'Anjunadeep'),
      ]);

      const metadata = await extractMetadata(createBufferReader(file, 'mp3'));

      expect(metadata?.title).toBe('Strobe');
      expect(metadata?.label).toBe('Anjunadeep');
    });

    it('reads the label from a v2.2 TPB frame', async () => {
      const file = id3Tag(2, [id3v22Frame('TPB', 'Drumcode')]);

      const metadata = await extractMetadata(createBufferReader(file, 'mp3'));

      expect(metadata?.label).toBe('Drumcode');
    });

    it('does not mistake the artist frame for the label', async () => {
      // TPE1 and TPUB share a prefix with the shorter v2.2 ids the matcher also
      // accepts, so a sloppy prefix match would read the artist as the label.
      const file = id3Tag(3, [id3v23Frame('TPE1', 'deadmau5')]);

      const metadata = await extractMetadata(createBufferReader(file, 'mp3'));

      expect(metadata?.artist).toBe('deadmau5');
      expect(metadata?.label).toBeUndefined();
    });

    it('leaves the label unset when the file has no publisher frame', async () => {
      const file = id3Tag(3, [id3v23Frame('TIT2', 'Untagged')]);

      const metadata = await extractMetadata(createBufferReader(file, 'mp3'));

      expect(metadata?.label).toBeUndefined();
    });

    it('reads the label from an AIFF file, which carries an ID3 chunk', async () => {
      const id3 = id3Tag(3, [id3v23Frame('TPUB', 'Hyperdub')]);
      const chunk = Buffer.alloc(8);
      chunk.write('ID3 ', 0, 'ascii');
      chunk.writeUInt32BE(id3.length, 4);

      const form = Buffer.concat([Buffer.from('AIFF', 'ascii'), chunk, id3]);
      const header = Buffer.alloc(8);
      header.write('FORM', 0, 'ascii');
      header.writeUInt32BE(form.length, 4);

      const metadata = await extractMetadata(
        createBufferReader(Buffer.concat([header, form]), 'aiff')
      );

      expect(metadata?.label).toBe('Hyperdub');
    });
  });

  describe('FLAC', () => {
    it.each(['LABEL', 'PUBLISHER', 'ORGANIZATION'])(
      'reads the label from the %s comment',
      async (field) => {
        const file = vorbisComment([`${field}=Kompakt`]);

        const metadata = await extractMetadata(createBufferReader(file, 'flac'));

        expect(metadata?.label).toBe('Kompakt');
      }
    );

    it('matches the field name case-insensitively', async () => {
      const file = vorbisComment(['label=Ostgut Ton']);

      const metadata = await extractMetadata(createBufferReader(file, 'flac'));

      expect(metadata?.label).toBe('Ostgut Ton');
    });

    it('prefers LABEL when a tagger has written more than one of them', async () => {
      const file = vorbisComment(['ORGANIZATION=Distributor', 'LABEL=Warp Records']);

      const metadata = await extractMetadata(createBufferReader(file, 'flac'));

      expect(metadata?.label).toBe('Warp Records');
    });

    it('leaves the label unset when no label comment is present', async () => {
      const file = vorbisComment(['ARTIST=Aphex Twin']);

      const metadata = await extractMetadata(createBufferReader(file, 'flac'));

      expect(metadata?.artist).toBe('Aphex Twin');
      expect(metadata?.label).toBeUndefined();
    });
  });

  describe('MP4', () => {
    it('reads the label from a freeform LABEL atom', async () => {
      const file = mp4File(freeformAtom('LABEL', 'Defected'));

      const metadata = await extractMetadata(createBufferReader(file, 'm4a'));

      expect(metadata?.label).toBe('Defected');
    });

    it('reads the label from a freeform PUBLISHER atom', async () => {
      const file = mp4File(freeformAtom('PUBLISHER', 'Toolroom'));

      const metadata = await extractMetadata(createBufferReader(file, 'm4a'));

      expect(metadata?.label).toBe('Toolroom');
    });

    it('ignores freeform atoms holding some other field', async () => {
      // Every freeform atom has the same '----' type, so the name atom is the
      // only thing separating the label from the dozens of other fields
      // taggers stash here.
      const file = mp4File(freeformAtom('MOOD', 'Peak Time'));

      const metadata = await extractMetadata(createBufferReader(file, 'm4a'));

      expect(metadata?.label).toBeUndefined();
    });

    it('finds the label among other freeform atoms', async () => {
      const file = mp4File(
        freeformAtom('MOOD', 'Peak Time'),
        freeformAtom('LABEL', 'Innervisions'),
        freeformAtom('ENERGY', '8')
      );

      const metadata = await extractMetadata(createBufferReader(file, 'm4a'));

      expect(metadata?.label).toBe('Innervisions');
    });
  });
});
