/**
 * exportCard.ts: saving the trail card from the browser.
 *
 * Everything happens on the person's own device: the card's SVG is turned into a picture with a canvas, or saved as the
 * SVG itself, or copied as text. Nothing is uploaded. Each function takes what it needs from the browser as an argument
 * (document, canvas factory, clipboard) so it can be tested, and each one says plainly when the browser cannot do it.
 */
import { CARD_HEIGHT, CARD_WIDTH } from "./trailCard";

/** The SVG as text, with the namespace a file needs. */
export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(CARD_WIDTH));
  clone.setAttribute("height", String(CARD_HEIGHT));
  return new XMLSerializer().serializeToString(clone);
}

/** Start a download of a blob under a file name. */
export function saveBlob(blob: Blob, filename: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  doc.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the address is released.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save the SVG itself. */
export function saveSvg(svg: SVGSVGElement, filename: string, doc: Document = document): void {
  saveBlob(new Blob([serializeSvg(svg)], { type: "image/svg+xml;charset=utf-8" }), filename, doc);
}

export type PngResult = { ok: true; blob: Blob } | { ok: false; message: string };

/** Draw the SVG onto a canvas at twice its size and return a PNG. Resolves with a reason when the browser cannot. */
export async function svgToPng(svg: SVGSVGElement, scale = 2, doc: Document = document): Promise<PngResult> {
  const canvas = doc.createElement("canvas");
  const context = canvas.getContext?.("2d");
  if (!context)
    return { ok: false, message: "This browser cannot make a PNG here. Save it as an SVG instead." };
  canvas.width = CARD_WIDTH * scale;
  canvas.height = CARD_HEIGHT * scale;
  const url = URL.createObjectURL(new Blob([serializeSvg(svg)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The picture could not be drawn."));
      image.src = url;
    });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob
      ? { ok: true, blob }
      : { ok: false, message: "The picture could not be saved. Save it as an SVG instead." };
  } catch {
    return { ok: false, message: "The picture could not be made. Save it as an SVG instead." };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Copy text to the clipboard. Resolves false when the browser will not allow it. */
export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = navigator.clipboard,
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
