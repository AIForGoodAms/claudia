import type { Lang } from '../types';
import { bundledSymbolUrl } from '../assets/symbols/bundledIds';

/**
 * Symbol resolution (ARASAAC).
 *
 * `resolveSymbol(keyword, lang)` returns an image URL through a fallback chain
 * so the board renders fast, offline, and degrades gracefully:
 *   1. localStorage cache  (`arasaac:{lang}:{keyword}` → pictogram id)
 *   2. bundled map         (pre-downloaded PNGs for the fixed board keywords)
 *   3. live API search     (first match's id, then cache it)
 *   4. emoji / placeholder (a data: URL — never a broken image)
 *
 * Paths per ARASAAC's public API (verified 2026-06-21):
 *   search: GET https://api.arasaac.org/api/pictograms/{lang}/search/{keyword}
 *   image:  https://static.arasaac.org/pictograms/{id}/{id}_500.png
 */

const API_BASE = 'https://api.arasaac.org/api/pictograms';
const STATIC_BASE = 'https://static.arasaac.org/pictograms';

function cacheKey(keyword: string, lang: Lang): string {
  return `arasaac:${lang}:${keyword.toLowerCase()}`;
}

function staticUrl(id: number): string {
  return `${STATIC_BASE}/${id}/${id}_500.png`;
}

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function readCachedId(keyword: string, lang: Lang): number | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(cacheKey(keyword, lang));
    if (raw === null) return null;
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function writeCachedId(keyword: string, lang: Lang, id: number): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(cacheKey(keyword, lang), String(id));
  } catch {
    // Quota/availability errors are non-fatal — resolution still works.
  }
}

interface PictogramSearchResult {
  _id: number;
}

/** Search the live API and return the first match's id, or null. */
async function searchApi(keyword: string, lang: Lang): Promise<number | null> {
  try {
    const url = `${API_BASE}/${lang}/search/${encodeURIComponent(keyword)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const results = (await res.json()) as PictogramSearchResult[];
    if (!Array.isArray(results) || results.length === 0) return null;
    const id = results[0]?._id;
    return typeof id === 'number' ? id : null;
  } catch {
    // Network down / offline — fall through to the emoji placeholder.
    return null;
  }
}

/**
 * Build an inline SVG data URL showing an emoji (default ❔) on a neutral tile.
 * Used as the final fallback so an unknown keyword never renders broken.
 */
export function emojiPlaceholder(emoji = '❔'): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="%23eef0f2"/>` +
    `<text x="50" y="50" font-size="54" text-anchor="middle" ` +
    `dominant-baseline="central">${emoji}</text></svg>`;
  return `data:image/svg+xml;utf8,${svg}`;
}

/**
 * Resolve a keyword to a pictograph image URL through the fallback chain above.
 * Always resolves (never rejects): the worst case is an emoji placeholder.
 */
export async function resolveSymbol(keyword: string, lang: Lang): Promise<string> {
  if (!keyword) return emojiPlaceholder();

  // 1. localStorage cache.
  const cachedId = readCachedId(keyword, lang);
  if (cachedId !== null) return staticUrl(cachedId);

  // 2. Bundled map (instant + offline for the seeded board).
  const bundled = bundledSymbolUrl(keyword);
  if (bundled) return bundled;

  // 3. Live API search.
  const found = await searchApi(keyword, lang);
  if (found !== null) {
    writeCachedId(keyword, lang, found);
    return staticUrl(found);
  }

  // 4. Emoji / placeholder.
  return emojiPlaceholder();
}
