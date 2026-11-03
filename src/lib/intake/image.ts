/**
 * image.ts: check an uploaded image BEFORE it is sent to a model.
 *
 * The data URL comes from a browser, so nothing about it is trusted: it must be a real PNG, JPEG or
 * WebP (checked by the bytes, not the label), under a size cap, and for PNG at least 64 pixels on a
 * side (we measured that both models misread smaller images, see docs/api-notes.md).
 */

/** Largest image accepted, in bytes. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Smallest side, in pixels, below which models misread images. Checked for PNG, where it is cheap to read. */
export const MIN_IMAGE_SIDE = 64;

/** Thrown for an image intake will not send to a model. */
export class IntakeImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeImageError";
  }
}

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Detect the real format from the first bytes. */
function sniff(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const tag = (from: number) => String.fromCharCode(...bytes.slice(from, from + 4));
  if (bytes.length >= 12 && tag(0) === "RIFF" && tag(8) === "WEBP") return "image/webp";
  return undefined;
}

/**
 * Validate an image data URL.
 *
 * @returns the same URL when it is acceptable
 * @throws IntakeImageError with a message a person can act on
 */
export function validateImage(dataUrl: string): string {
  if (dataUrl.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64) {
    throw new IntakeImageError(`The image is too large (the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`);
  }
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw new IntakeImageError("The image must be a PNG, JPEG or WebP file.");
  const bytes = Uint8Array.from(Buffer.from(match[2] ?? "", "base64"));
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new IntakeImageError(`The image is too large (the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`);
  }
  const real = sniff(bytes);
  if (real === undefined || real !== match[1]) {
    throw new IntakeImageError("The file is not a valid PNG, JPEG or WebP image.");
  }
  if (real === "image/png") {
    if (bytes.length < 24) throw new IntakeImageError("The PNG file is truncated.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE) {
      throw new IntakeImageError(
        `The image is too small to read (${width}x${height}; it must be at least ${MIN_IMAGE_SIDE} pixels on each side).`,
      );
    }
  }
  return dataUrl;
}
