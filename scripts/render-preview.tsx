/**
 * render-preview.tsx: render the screen to static HTML files for a visual check, with no browser server.
 *
 * Usage: npx tsx scripts/render-preview.tsx [outputDirectory]
 * It writes one HTML file per state (map, compare, why, a time-limited map, a phone-width map). Each file is
 * self-contained: the real CSS and the real markup, from the same components the app uses.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PathView, type Tab } from "../src/components/PathApp";
import { handleExplore } from "../src/lib/api/handlers";
import { PlanRequest } from "../src/lib/api/schemas";
import { SAMPLE_PERSON, type Person } from "../src/ui/sample";

const out = process.argv[2] ?? "/tmp/preview";
mkdirSync(out, { recursive: true });
const css = readFileSync("src/app/globals.css", "utf8").replace(/var\(--font-geist-sans\)/g, '"Inter"');

function page(person: Person, tab: Tab, selected: "climb" | "jump" | "pivot"): string {
  const data = handleExplore(PlanRequest.parse(person));
  const body = renderToStaticMarkup(
    <PathView
      person={person}
      data={data}
      error={undefined}
      tab={tab}
      selected={selected}
      onTab={() => undefined}
      onSelect={() => undefined}
      onRetry={() => undefined}
    />,
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`;
}

const limited: Person = { ...SAMPLE_PERSON, constraints: { ...SAMPLE_PERSON.constraints, maxMonths: 24 } };
const files: [string, string][] = [
  ["map", page(SAMPLE_PERSON, "map", "climb")],
  ["compare", page(SAMPLE_PERSON, "compare", "climb")],
  ["why", page(SAMPLE_PERSON, "why", "climb")],
  ["limited", page(limited, "map", "jump")],
];
for (const [name, html] of files) writeFileSync(`${out}/${name}.html`, html);
// Phone view: a 390px column with the small-screen rules switched on unconditionally, because a static page
// cannot resize its own viewport and a nested frame would not be allowed to load here.
const phoneCss = css.replace(/@media \(max-width: (?:720|860)px\) \{/g, "@media all {");
const phoneBody = (files[0]?.[1] ?? "").replace(
  /<style>[\s\S]*?<\/style>/,
  `<style>${phoneCss}</style><style>body{max-width:390px;margin:0 auto;box-shadow:0 0 0 1px #ccc}</style>`,
);
writeFileSync(`${out}/phone.html`, phoneBody);
console.log(`wrote ${files.length + 1} files to ${out}`);
