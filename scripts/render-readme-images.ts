/**
 * render-readme-images.ts: write the README's pictures to docs/images.
 *
 * Run: npm run docs:images   (offline: it replays the recorded plan, so no key is needed)
 */
import { writeFileSync } from "node:fs";
import { renderCardSvg, renderMapSvg } from "./lib/readmeImages";

writeFileSync("docs/images/map.svg", await renderMapSvg());
writeFileSync("docs/images/trail-card.svg", await renderCardSvg());
console.log("wrote docs/images/map.svg and docs/images/trail-card.svg");
