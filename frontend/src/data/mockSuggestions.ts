import type { OptionDTO } from '../services/transport/types';

/**
 * Canned suggestion options for the mock recording transport.
 *
 * Shapes match api-contract.md (`OptionDTO`/`SymbolCard`). The mock has no real
 * ARASAAC ids, so `image_url` is null and `id` is -1 — the real backend fills
 * these. `SuggestionTile` resolves each symbol by its `label` keyword through
 * the ARASAAC fallback chain (cache → bundle → API → emoji), so suggestions
 * render online, offline, and for unknown words. `as_text` stays false so the
 * mock always renders a pictogram, not bare text.
 *
 * `text` is the spoken Dutch utterance (the browser side of
 * `/expressive/select` → `{ text, lang }`).
 */

/** Build a contract-shaped symbol; `label` doubles as the ARASAAC keyword. */
function sym(label: string, confidence: number) {
  return { id: -1, label, image_url: null, confidence, as_text: false };
}

/**
 * "Most-used" options shown the instant recording starts — independent of what
 * the listener says. Mirrors a backend that seeds the board with her staples.
 */
export const STATIC_OPTIONS: OptionDTO[] = [
  { option_id: 1, text: 'Ja', symbols: [sym('ja', 0.98)] },
  { option_id: 2, text: 'Nee', symbols: [sym('nee', 0.98)] },
  { option_id: 3, text: 'Ik heb honger', symbols: [sym('eten', 0.9), sym('honger', 0.82)] },
  { option_id: 4, text: 'Ik wil rusten', symbols: [sym('moe', 0.88), sym('rusten', 0.8)] },
  { option_id: 5, text: 'Dank je wel', symbols: [sym('bedankt', 0.86)] },
];

/**
 * Context-flavored dynamic options. Each batch carries a `keywords` list: when
 * the optional `SpeechRecognition` realism is on, a batch fires if the
 * listener's transcript mentions one of its keywords; otherwise the transport
 * rotates through these batches on a timer.
 */
export interface DynamicBatch {
  /** Listener-transcript keywords that select this batch (lowercased). */
  keywords: string[];
  options: OptionDTO[];
}

export const DYNAMIC_BATCHES: DynamicBatch[] = [
  {
    keywords: ['eten', 'honger', 'lunch', 'avondeten', 'broodje'],
    options: [
      { option_id: 101, text: 'Ja, ik wil graag eten', symbols: [sym('eten', 0.93), sym('ja', 0.9)] },
      { option_id: 102, text: 'Ik wil een broodje', symbols: [sym('brood', 0.91)] },
      { option_id: 103, text: 'Nee, ik heb geen honger', symbols: [sym('nee', 0.9), sym('eten', 0.7)] },
    ],
  },
  {
    keywords: ['drinken', 'dorst', 'water', 'thee', 'koffie'],
    options: [
      { option_id: 111, text: 'Ik heb dorst', symbols: [sym('drinken', 0.92), sym('dorst', 0.8)] },
      { option_id: 112, text: 'Mag ik wat water?', symbols: [sym('water', 0.9)] },
    ],
  },
  {
    keywords: ['hoe gaat', 'voel', 'gevoel', 'lekker', 'pijn'],
    options: [
      { option_id: 121, text: 'Ik voel me goed', symbols: [sym('blij', 0.9)] },
      { option_id: 122, text: 'Ik ben een beetje moe', symbols: [sym('moe', 0.88)] },
      { option_id: 123, text: 'Ik heb pijn', symbols: [sym('pijn', 0.85)] },
    ],
  },
  {
    keywords: ['spelen', 'spel', 'spelletje', 'doen', 'activiteit'],
    options: [
      { option_id: 131, text: 'Kan ik een spelletje spelen?', symbols: [sym('spelen', 0.92)] },
      { option_id: 132, text: 'Ja, dat lijkt me leuk', symbols: [sym('blij', 0.88), sym('ja', 0.86)] },
    ],
  },
  {
    keywords: ['naar buiten', 'wandelen', 'buiten', 'weer'],
    options: [
      { option_id: 141, text: 'Ik wil naar buiten', symbols: [sym('buiten', 0.9)] },
      { option_id: 142, text: 'Wat is het weer?', symbols: [sym('weer', 0.85)] },
    ],
  },
];
