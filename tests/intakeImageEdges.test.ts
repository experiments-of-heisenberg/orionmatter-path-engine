/**
 * Edge tests for validateImage: every accepted and refused format, malformed data URLs,
 * the exact size boundary, PNG dimension edges, and the shape of the error.
 */
import { describe, expect, it } from "vitest";
import { IntakeImageError, MAX_IMAGE_BYTES, validateImage } from "../src/lib/intake";

/** A data URL with the given label and raw bytes. */
function dataUrl(label: string, bytes: Buffer): string {
  return `data:${label};base64,${bytes.toString("base64")}`;
}

/** A PNG data URL of a given size (header only; the body is a stub, which the checks accept). */
function png(width: number, height: number): string {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return dataUrl("image/png", bytes);
}

/** A PNG data URL of an exact byte length, padded with zeros. */
function pngOfSize(width: number, height: number, size: number): string {
  const bytes = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return dataUrl("image/png", bytes);
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(100)]);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(100)]);

describe("validateImage formats", () => {
  it("accepts JPEG magic bytes with the JPEG label", () => {
    const url = dataUrl("image/jpeg", JPEG);
    expect(validateImage(url)).toBe(url);
  });

  it("accepts WebP (RIFF....WEBP) with the WebP label", () => {
    const url = dataUrl("image/webp", WEBP);
    expect(validateImage(url)).toBe(url);
  });

  it("refuses a WebP labelled PNG: the bytes must match the label", () => {
    expect(() => validateImage(dataUrl("image/png", WEBP))).toThrow("not a valid");
  });

  it("refuses GIF bytes and SVG data URLs", () => {
    expect(() => validateImage(dataUrl("image/png", GIF))).toThrow("not a valid");
    expect(() => validateImage(dataUrl("image/gif", GIF))).toThrow("must be a PNG, JPEG or WebP");
    expect(() => validateImage(dataUrl("image/svg+xml", Buffer.from("<svg/>")))).toThrow(
      "must be a PNG, JPEG or WebP",
    );
  });
});

describe("validateImage malformed data URLs", () => {
  it("refuses base64 with invalid characters", () => {
    expect(() => validateImage("data:image/png;base64,AB*C")).toThrow("must be a PNG, JPEG or WebP");
  });

  it("refuses a data URL without the base64 marker", () => {
    expect(() => validateImage("data:image/png,AAAA")).toThrow("must be a PNG, JPEG or WebP");
  });

  it("documents that an uppercase DATA: prefix is refused: the prefix match is case-sensitive", () => {
    expect(() => validateImage(png(64, 64).replace("data:", "DATA:"))).toThrow("must be a PNG, JPEG or WebP");
  });
});

describe("validateImage size cap", () => {
  it("accepts an image of exactly MAX_IMAGE_BYTES bytes", () => {
    const url = pngOfSize(64, 64, MAX_IMAGE_BYTES);
    expect(validateImage(url)).toBe(url);
  });

  it("refuses an image one byte over MAX_IMAGE_BYTES", () => {
    expect(() => validateImage(pngOfSize(64, 64, MAX_IMAGE_BYTES + 1))).toThrow("too large");
  });
});

describe("validateImage PNG dimensions", () => {
  it("accepts exactly 64x64", () => {
    const url = png(64, 64);
    expect(validateImage(url)).toBe(url);
  });

  it("refuses 63x64 and 64x63", () => {
    expect(() => validateImage(png(63, 64))).toThrow("too small to read (63x64");
    expect(() => validateImage(png(64, 63))).toThrow("too small to read (64x63");
  });

  it("documents that a PNG shorter than 24 bytes skips the dimension check", () => {
    // The check only runs when `bytes.length >= 24`, so an 8-byte PNG magic prefix is accepted
    // without any dimension check.
    const url = dataUrl("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(validateImage(url)).toBe(url);
  });
});

describe("validateImage error shape", () => {
  it("throws an IntakeImageError that is also an Error named 'IntakeImageError'", () => {
    try {
      validateImage("not a data url");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IntakeImageError);
      expect(error).toBeInstanceOf(Error);
      expect((error as IntakeImageError).name).toBe("IntakeImageError");
    }
  });
});
