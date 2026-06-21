import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSymbol, emojiPlaceholder } from '../services/arasaac';

describe('resolveSymbol', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns the cached static URL without a network call when cached', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    localStorage.setItem('arasaac:nl:vliegtuig', '1234');

    const url = await resolveSymbol('vliegtuig', 'nl');

    expect(url).toBe('https://static.arasaac.org/pictograms/1234/1234_500.png');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a bundled URL without a network call for a seeded keyword', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const url = await resolveSymbol('eten', 'nl');

    // jsdom resolves the Vite asset to some URL string; the point is no fetch.
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('searches the API and caches the resolved id on a fresh keyword', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ _id: 9999 }]), { status: 200 }),
    );

    const url = await resolveSymbol('onbekendwoord', 'nl');

    expect(url).toBe('https://static.arasaac.org/pictograms/9999/9999_500.png');
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(localStorage.getItem('arasaac:nl:onbekendwoord')).toBe('9999');
  });

  it('falls back to an emoji placeholder when search returns empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    const url = await resolveSymbol('nietsgevonden', 'nl');

    expect(url).toBe(emojiPlaceholder());
    expect(url.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('falls back to an emoji placeholder when the network throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    const url = await resolveSymbol('geennetwerk', 'nl');

    expect(url).toBe(emojiPlaceholder());
  });
});
