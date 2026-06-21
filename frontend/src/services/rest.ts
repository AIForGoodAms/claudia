import type { Lang } from '../types';
import { HTTP_BASE } from './config';
import type { OptionsResponse, SelectResponse, SymbolCard } from './transport/types';

/**
 * REST client for the AAC Translator backend (api-contract.md).
 *
 * The live conversation path is the WebSocket; these endpoints back manual /
 * dev flows and the select round-trip:
 *   - `POST /expressive/options` — generate options from typed text (dev/manual).
 *   - `POST /expressive/select`  — mark a choice, get `{ text, lang }` to speak.
 *   - `POST /translate`          — decompose text into glosses + symbol cards.
 */

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${HTTP_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/** `POST /expressive/options` — dev/manual: reply options from typed text. */
export function fetchOptions(text: string, lang?: Lang): Promise<OptionsResponse> {
  return postJson<OptionsResponse>('/expressive/options', lang ? { text, lang } : { text });
}

/** `POST /expressive/select` — mark an option chosen; returns text to speak. */
export function selectOption(interactionId: number, optionId: number): Promise<SelectResponse> {
  return postJson<SelectResponse>('/expressive/select', {
    interaction_id: interactionId,
    option_id: optionId,
  });
}

/** `POST /translate` — decompose arbitrary text into glosses + symbol cards. */
export function translate(
  text: string,
  lang?: Lang,
): Promise<{ glosses: string[]; symbols: SymbolCard[] }> {
  return postJson('/translate', lang ? { text, lang } : { text });
}
