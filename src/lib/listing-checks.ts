import type { ParsedListing } from "./parse-listing";

// the llm tends to infer these from loose wording ("clean title" -> no accidents, "runs great" ->
// excellent). a value only stands when the listing itself says something about it.
const SAYS_NO_ACCIDENT =
  /\b(no|zero|0)\s+(reported\s+)?(accidents?|collisions?|crashes|damage)\b|\baccident[-\s]?free\b|\bnever\s+(been\s+)?(in\s+)?(an?\s+)?(accident|wreck|crash)|\bclean\s+(carfax|autocheck|vehicle\s+history|history\s+report|history)\b|\bsin\s+accidentes?\b/i;
const SAYS_ACCIDENT =
  /\b(accidents?|collisions?|crash(ed)?|wreck(ed)?|fender[-\s]?bender|hail|flood(ed)?|frame\s+damage|body\s+damage|damaged?|salvage|rebuilt|totall?ed|accidentes?)\b/i;
const SAYS_CONDITION = /\b(condition|excellent|good|fair|poor|like[-\s]?new|mint|rough|excelente|buen[oa]?|regular|mal[oa]?)\b/i;
const SAYS_OWNERS = /\b(owners?|due[nñ]os?)\b/i;

// "64,000 miles", "64k mi", "80,000 km", "odometer reads 120,000"
const MILEAGE_MENTIONS = [
  /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|thousand)?\s*(miles?|mi\b|km\b|kms\b|kilomet\w*)/gi,
  /\b(?:odometer|odo|mileage)\s*(?:reads|shows|is|at|of|:)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?/gi,
];
const KM_TO_MILES = 0.621371;

/** every distinct mileage the text states, in miles */
export function mileageMentions(text: string): number[] {
  const found: number[] = [];
  for (const pattern of MILEAGE_MENTIONS) {
    for (const m of text.matchAll(pattern)) {
      let n = Number(m[1].replace(/,/g, ""));
      const thousands = /^(k|thousand)$/i.test(m[2] ?? "");
      if (thousands) n *= 1000;
      if (/^k(m|ms|ilomet)/i.test(m[3] ?? "")) n *= KM_TO_MILES;
      if (!Number.isFinite(n) || (n < 1000 && !thousands)) continue; // "5 miles from downtown"
      if (!found.some((f) => Math.abs(f - n) <= 0.02 * Math.max(f, n))) found.push(Math.round(n));
    }
  }
  return found;
}

/** removes facts the listing never states and flags self-contradicting mileage */
export function checkAgainstText(result: ParsedListing, text: string) {
  if (result.accident_history === false && !SAYS_NO_ACCIDENT.test(text)) result.accident_history = null;
  if (result.accident_history === true && !SAYS_ACCIDENT.test(text)) result.accident_history = null;
  if (result.condition !== null && !SAYS_CONDITION.test(text)) result.condition = null;
  if (result.owners !== null && !SAYS_OWNERS.test(text)) result.owners = null;
  const miles = mileageMentions(text);
  if (miles.length > 1) {
    // the listing contradicts itself: ask instead of letting the ai pick one
    result.mileage = null;
    result.conflicts.push({ field: "mileage", values: miles });
  }
}
