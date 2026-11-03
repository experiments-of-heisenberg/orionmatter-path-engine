/**
 * testImage.ts — tiny dependency-free PNG builder for image-input probes.
 *
 * Why: image-capable endpoints reject corrupt payloads, and hand-typed base64
 * blobs are easy to get wrong. Building a PNG at runtime keeps the probe honest
 * and lets us pick the exact colour we then expect the model to describe.
 */
import { deflateSync } from "node:zlib";

/** Precomputed CRC-32 lookup table (PNG chunk checksums). */
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 of a buffer, as required by every PNG chunk. */
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Wrap data in a PNG chunk: length, type, data, CRC. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** Build a solid-colour RGB PNG and return its raw bytes. */
export function makePngBytes(width: number, height: number, rgb: [number, number, number]): Buffer {
  const rowLength = width * 3 + 1; // 1 filter byte + RGB pixels
  const raw = Buffer.alloc(rowLength * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLength] = 0; // filter type 0 = none
    for (let x = 0; x < width; x++) raw.set(rgb, y * rowLength + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Same as makePngBytes, returned as a data: URL ready for an image_url field. */
export function makePngDataUrl(width: number, height: number, rgb: [number, number, number]): string {
  return `data:image/png;base64,${makePngBytes(width, height, rgb).toString("base64")}`;
}
