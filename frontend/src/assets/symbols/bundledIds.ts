/**
 * Bundled ARASAAC pictographs for the fixed board keywords.
 *
 * The PNGs in this folder were pre-downloaded from
 * `https://static.arasaac.org/pictograms/{id}/{id}_500.png` so the seeded board
 * renders instantly and offline (fallback-chain step 2 in services/arasaac.ts).
 *
 * `KEYWORD_TO_ID` maps a board keyword to its ARASAAC pictogram id; Vite's
 * `import.meta.glob` resolves the matching PNG to a hashed asset URL at build
 * time. ARASAAC pictographs are CC BY-NC-SA (attribution in README, Phase 7).
 */

/** Board keyword (Dutch) → ARASAAC pictogram id. */
export const KEYWORD_TO_ID: Record<string, number> = {
  eten: 6456,
  drinken: 6061,
  persoon: 34560,
  kleding: 7233,
  gevoel: 27833,
  klok: 2549,
  praten: 6517,
  lichaam: 6473,
  weer: 7223,
  spelen: 23392,
  communicatie: 34623,
  spel: 39187,
  huis: 6964,
  ja: 5584,
  nee: 5526,
  microfoon: 37404,
  brood: 2494,
  appel: 2462,
  water: 32464,
  melk: 2445,
  banaan: 2530,
  koek: 2402,
  blij: 3245,
  verdrietig: 35545,
  boos: 35539,
  moe: 2314,
  bang: 2261,
  wachten: 27547,
  meisje: 27509,
  verzorgen: 3302,
  snack: 4695,
  dag: 37731,
  tijd: 22631,
  boek: 25191,
  lijst: 7144,
  slapen: 6479,
  wassen: 34826,
};

// Eagerly resolve every bundled PNG to its hashed asset URL: `{id}.png` → URL.
const pngUrls = import.meta.glob('./*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** ARASAAC id → bundled asset URL. */
const ID_TO_URL: Record<number, string> = {};
for (const [path, url] of Object.entries(pngUrls)) {
  const match = path.match(/(\d+)\.png$/);
  if (match) ID_TO_URL[Number(match[1])] = url;
}

/**
 * Resolve a board keyword to its bundled pictograph URL, or `undefined` if the
 * keyword is not bundled (the caller then falls through to cache/API/emoji).
 */
export function bundledSymbolUrl(keyword: string): string | undefined {
  const id = KEYWORD_TO_ID[keyword];
  if (id === undefined) return undefined;
  return ID_TO_URL[id];
}
