// @vitest-environment jsdom
/** Saving the card from the browser: serialising, downloading, converting, copying, and saying so when it cannot. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, saveBlob, saveSvg, serializeSvg, svgToPng } from "../src/ui/exportCard";
import { CARD_HEIGHT, CARD_WIDTH } from "../src/ui/trailCard";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function svgElement(): SVGSVGElement {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = '<svg viewBox="0 0 1200 630" width="100%"><text>Hello &amp; goodbye</text></svg>';
  return wrapper.firstElementChild as SVGSVGElement;
}

describe("serializeSvg", () => {
  it("adds the namespace and the real size, keeps the content, and leaves the original alone", () => {
    const svg = svgElement();
    const text = serializeSvg(svg);
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(text).toContain(`width="${CARD_WIDTH}"`);
    expect(text).toContain(`height="${CARD_HEIGHT}"`);
    expect(text).toContain("Hello &amp; goodbye");
    expect(svg.getAttribute("width")).toBe("100%");
    expect(svg.hasAttribute("xmlns")).toBe(false);
  });
});

describe("saveBlob", () => {
  it("clicks a temporary link with the file name, removes it, and releases the address afterwards", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:fake");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    saveBlob(new Blob(["x"]), "card.png");
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith("blob:fake");
    vi.unstubAllGlobals();
  });
  it("saveSvg downloads an SVG file", () => {
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: (b: Blob) => (blobs.push(b), "blob:x"),
      revokeObjectURL: () => undefined,
    });
    const links: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      links.push(this.download);
    });
    saveSvg(svgElement(), "my-card.svg");
    expect(links).toEqual(["my-card.svg"]);
    expect(blobs[0]?.type).toBe("image/svg+xml;charset=utf-8");
    vi.unstubAllGlobals();
  });
});

describe("svgToPng", () => {
  it("says plainly when the browser has no canvas, instead of throwing", async () => {
    const result = await svgToPng(svgElement());
    expect(result).toEqual({
      ok: false,
      message: "This browser cannot make a PNG here. Save it as an SVG instead.",
    });
  });
  it("draws at twice the size and returns the PNG when everything works", async () => {
    const drawn: number[][] = [];
    const png = new Blob(["png"], { type: "image/png" });
    const context = { drawImage: (...args: unknown[]) => drawn.push(args.slice(1) as number[]) };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(png));
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: vi.fn() });
    class FakeImage {
      onload: (() => void) | undefined;
      onerror: (() => void) | undefined;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FakeImage);
    const result = await svgToPng(svgElement());
    expect(result).toEqual({ ok: true, blob: png });
    expect(drawn[0]).toEqual([0, 0, CARD_WIDTH * 2, CARD_HEIGHT * 2]);
    vi.unstubAllGlobals();
  });
  it("reports a picture that cannot be drawn, and one the canvas cannot encode, and releases the address either way", async () => {
    const revoke = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: () => undefined,
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: revoke });
    class BrokenImage {
      onload: (() => void) | undefined;
      onerror: (() => void) | undefined;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", BrokenImage);
    const broken = await svgToPng(svgElement());
    expect(broken.ok).toBe(false);
    expect(revoke).toHaveBeenCalledTimes(1);
    class FineImage extends BrokenImage {
      override set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FineImage);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(null));
    const unsaved = await svgToPng(svgElement());
    expect(unsaved).toEqual({
      ok: false,
      message: "The picture could not be saved. Save it as an SVG instead.",
    });
    expect(revoke).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

describe("copyText", () => {
  it("copies, and says false when there is no clipboard or the browser refuses", async () => {
    const written: string[] = [];
    expect(await copyText("hi", { writeText: (t) => (written.push(t), Promise.resolve()) })).toBe(true);
    expect(written).toEqual(["hi"]);
    expect(await copyText("hi", { writeText: () => Promise.reject(new Error("denied")) })).toBe(false);
    expect(await copyText("hi", undefined)).toBe(false);
  });
});
