/**
 * display.ts: how the app talks to a person about levels and pay.
 *
 * Inside, the data and the agents use short codes: levels `L3` to `L7`, `EM1`, `EM2` and pay bands `B1` to `B5`. They are
 * exact and compact, and the recorded demo answers and the evaluations are written in them, so they are left alone. A
 * person does not think in them, though: "B4" means nothing and "L5" means different things at different companies. This
 * module turns the codes into words at the last moment, on the way to the screen:
 *
 *   L5     -> Senior Engineer
 *   B4     -> a pay range in the person's currency, for the person's region, with a US dollar figure when it is not dollars
 *   B4-B5  -> "at least" that lower figure, because the top band has no ceiling
 *
 * The pay ranges are indicative market figures (data/pay-bands.json says where they come from); the synthetic cohort
 * itself only knows the order of the bands. Nothing here changes a number or a verdict: it only changes words.
 *
 * `h(text)` is the one function components call on a string they are about to show. It does nothing until the app has
 * told this module which region the person is in, so a component rendered on its own, and every test of the engine, sees
 * the unchanged codes.
 */
import payBands from "../../data/pay-bands.json";

/** The words for each level (a display name only; the data uses the level). */
export const LEVEL_TITLE: Readonly<Record<string, string>> = {
  L3: "Engineer",
  L4: "Mid-level Engineer",
  L5: "Senior Engineer",
  L6: "Staff Engineer",
  L7: "Principal Engineer",
  EM1: "Engineering Manager",
  EM2: "Senior Engineering Manager",
};

interface RegionBands {
  currency: "INR" | "USD" | "EUR";
  unit: "lakh" | "k";
  /** The four cut points between the five bands, in the region's own unit (lakh or thousands). */
  cuts: number[];
}
const REGIONS = payBands.regions as Record<string, RegionBands>;
const RATES = payBands.rates;

/** Where the person is. Set by the app; unset means "leave every code as it is". */
let region: string | undefined;

/** Tell this module which region's money to speak. Pass undefined to switch the translation off. */
export function setDisplayRegion(next: string | undefined): void {
  region = next !== undefined && next in REGIONS ? next : undefined;
}

/** True when words are being spoken in a region's money, so a screen can drop the codes' own labels. */
export function displayActive(): boolean {
  return region !== undefined;
}

/** The currently set region (for tests). */
export function displayRegion(): string | undefined {
  return region;
}

/** The title for a level code, or the code itself when it is not one we know. */
export function levelTitle(code: string): string {
  return LEVEL_TITLE[code] ?? code;
}

/** Round to the nearest 5, which is as precise as these ranges deserve. */
function nearestFive(value: number): number {
  return Math.round(value / 5) * 5;
}

/** One amount in the region's own unit: "₹70 lakh", "₹1.2 crore", "$350k", "€110k". */
function amount(spec: RegionBands, value: number): string {
  if (spec.currency === "INR") {
    if (value >= 100) return `\u20b9${trim(value / 100)} crore`;
    return `\u20b9${value} lakh`;
  }
  return `${spec.currency === "EUR" ? "\u20ac" : "$"}${value}k`;
}
function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

/** An amount in US dollars from the region's unit, or undefined when the region already speaks dollars. */
function usd(spec: RegionBands, value: number): number | undefined {
  if (spec.currency === "USD") return undefined;
  if (spec.currency === "INR") return nearestFive((value * 100_000 * RATES.usdPerInr) / 1000);
  return nearestFive(value * RATES.usdPerEur);
}

/** The lower and upper edge of a band in the region's unit; the lowest has no floor and the highest no ceiling. */
function edges(spec: RegionBands, band: number): { low?: number; high?: number } {
  const low = band === 1 ? undefined : spec.cuts[band - 2];
  const high = band === 5 ? undefined : spec.cuts[band - 1];
  return { ...(low !== undefined ? { low } : {}), ...(high !== undefined ? { high } : {}) };
}

/** The dollar figures in brackets: " (about $80k to $140k)", " (about $140k+)", " (under about $25k)", or "" when the region speaks dollars. */
function dollars(spec: RegionBands, low?: number, high?: number): string {
  if (spec.currency === "USD") return "";
  const a = low === undefined ? undefined : usd(spec, low);
  const b = high === undefined ? undefined : usd(spec, high);
  if (a !== undefined && b !== undefined) return ` (about\u00a0$${a}k to $${b}k)`;
  if (a !== undefined) return ` (about\u00a0$${a}k+)`;
  if (b !== undefined) return ` (under about\u00a0$${b}k)`;
  return "";
}

/**
 * The words for pay between two bands. `from` and `to` are 1 to 5; one band is the same number twice.
 * "₹70 lakh to ₹1.2 crore (about $80k to $140k)", "₹1.2 crore or more (about $140k or more)", "under ₹20 lakh (about $25k)".
 */
export function payWords(
  from: number,
  to: number,
  spec: RegionBands | undefined = region ? REGIONS[region] : undefined,
): string {
  if (!spec) return from === to ? `B${from}` : `B${from}\u2013B${to}`;
  const low = edges(spec, Math.min(from, to)).low;
  const high = edges(spec, Math.max(from, to)).high;
  const money =
    low === undefined && high === undefined
      ? "any pay"
      : low === undefined
        ? `under ${amount(spec, high as number)}`
        : high === undefined
          ? `${amount(spec, low)} or more`
          : `${amount(spec, low)} to ${amount(spec, high)}`;
  return `${money}${dollars(spec, low, high)}`;
}

/** A short label for "at least this band": "₹70 lakh+". Used where space is tight. */
export function floorLabel(band: number): string {
  const spec = region ? REGIONS[region] : undefined;
  if (!spec) return `B${band}`;
  const low = edges(spec, band).low;
  return low === undefined
    ? "Any pay"
    : `${amount(spec, low).replace(" lakh", "L").replace(" crore", " Cr")}+`;
}

/** The pay range for a pair of band codes from the data, such as ["B4", "B5"] ("-" means no data). */
export function bandWords(range: readonly [string, string]): string {
  const a = bandNumber(range[0]);
  const b = bandNumber(range[1]);
  if (a === undefined && b === undefined) return "\u2014";
  if (!region) return range[0] === range[1] ? range[0] : `${range[0]}\u2013${range[1]}`;
  return payWords(a ?? (b as number), b ?? (a as number));
}

function bandNumber(code: string): number | undefined {
  return /^B[1-5]$/.test(code) ? Number(code.slice(1)) : undefined;
}

const DASHES = "[-\\u2013\\u2014]";
// "pay band B4 or higher", "B4 or above", "band B4 and up"
const FLOOR = new RegExp(
  String.raw`(?:(?:pay )?bands? )?\bB([1-5])\b(?: or (?:higher|above|more|better)| and (?:above|up|higher))`,
  "gi",
);
// "B4-B5", "B4 – B5", "B4 to B5"
const RANGE = new RegExp(String.raw`\bB([1-5])\s*(?:${DASHES}|to)\s*B([1-5])\b`, "g");
// the key to the codes, which the words make unnecessary: "B1 is lowest, B5 highest."
const BAND_KEY = /\s*B1 is (?:the )?lowest,? (?:and )?B5 (?:is )?(?:the )?highest\.?/gi;
const BAND = /\bB([1-5])\b/g;
// what is left of "pay band" once the codes are gone
const PAY_BAND_WORDS = /\b([Pp])ay bands?\b/g;
const LEVEL = /\b(L[3-7]|EM[12])\b/g;
// "senior backend engineer (L5)": the words before already say it, so the bracket goes
const LEVEL_BRACKET = /\s*\((L[3-7]|EM[12])\)/g;

/** "a pay of at least ₹70 lakh (about $80k+)": what "band B4 or higher" means as money. The lowest band is no floor at all. */
function atLeast(band: number, spec: RegionBands): string {
  const low = edges(spec, band).low;
  return low === undefined ? "any pay" : `a pay of at least ${amount(spec, low)}${dollars(spec, low)}`;
}

/**
 * Turn the level and band codes in a sentence into words. Safe on any text: evidence ids, numbers, sample sizes and every other
 * word are left exactly as they are, and with no region set the text comes back unchanged.
 */
export function humanize(text: string, forRegion: string | undefined = region): string {
  const spec = forRegion ? REGIONS[forRegion] : undefined;
  if (!spec) return text;
  return text
    .replace(BAND_KEY, "")
    .replace(FLOOR, (_m, band: string) => atLeast(Number(band), spec))
    .replace(RANGE, (_m, a: string, b: string) => payWords(Number(a), Number(b), spec))
    .replace(BAND, (_m, band: string) => payWords(Number(band), Number(band), spec))
    .replace(PAY_BAND_WORDS, (_m, first: string) => (first === "P" ? "Yearly pay" : "yearly pay"))
    .replace(LEVEL_BRACKET, "")
    .replace(LEVEL, (code: string) => levelTitle(code));
}

/** The one function components call on a string they are about to show. Identity until a region is set. */
export function h(text: string): string {
  return humanize(text);
}
