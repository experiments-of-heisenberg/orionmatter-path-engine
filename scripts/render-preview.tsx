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
const phone = files[0]?.[1] ?? "";
writeFileSync(
  `${out}/phone.html`,
  `<!doctype html><html><body style="margin:0;background:#888;display:flex;justify-content:center"><iframe style="width:390px;height:1700px;border:0;background:#fff" srcdoc="${phone.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe></body></html>`,
);
console.log(`wrote ${files.length + 1} files to ${out}`);
