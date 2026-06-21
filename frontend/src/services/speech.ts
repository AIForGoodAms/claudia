import type { Lang } from '../types';

/** BCP-47 voice locale preferences per app language (best first). */
const VOICE_LOCALES: Record<Lang, string[]> = {
  nl: ['nl-NL', 'nl-BE', 'nl'],
  en: ['en-GB', 'en-US', 'en'],
};

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

function hasSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * Resolve the available voices. Voices load asynchronously: on first call they
 * are often empty until `onvoiceschanged` fires, which would make the first
 * utterance silent. We wait for that event (with a timeout fallback) and cache
 * the promise.
 */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!hasSynthesis()) return Promise.resolve([]);
  if (voicesReady) return voicesReady;

  voicesReady = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const existing = synth.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener('voiceschanged', onChange);
      resolve(synth.getVoices());
    };
    const onChange = () => finish();

    synth.addEventListener('voiceschanged', onChange);
    // Fallback: some browsers never fire the event if voices are already there.
    setTimeout(finish, 1000);
  });

  return voicesReady;
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: Lang): SpeechSynthesisVoice | undefined {
  for (const locale of VOICE_LOCALES[lang]) {
    const exact = voices.find((v) => v.lang.toLowerCase() === locale.toLowerCase());
    if (exact) return exact;
  }
  // Loose prefix match (e.g. any 'nl*').
  const prefix = lang;
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
}

/**
 * Speak `text` in the active language via the browser's SpeechSynthesis.
 * Cancels any in-flight utterance first. No-ops (with a warning) when speech
 * synthesis is unavailable. This is the browser side of design-doc §7
 * `/expressive/select` → `{ text, lang }`.
 */
export async function speak(text: string, lang: Lang): Promise<void> {
  if (!hasSynthesis()) {
    console.warn('[speech] SpeechSynthesis unavailable — cannot speak:', text);
    return;
  }
  if (!text) return;

  const synth = window.speechSynthesis;
  const voices = await loadVoices();
  const voice = pickVoice(voices, lang);

  // Stop whatever is currently being spoken before the new utterance.
  synth.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = VOICE_LOCALES[lang][0];
  if (voice) utter.voice = voice;

  // Resolve when playback ends so callers can time the echo guard (unmute the
  // mic only after the spoken reply has finished).
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    synth.speak(utter);
  });
}

/** Stop any in-flight utterance. */
export function cancelSpeech(): void {
  if (hasSynthesis()) window.speechSynthesis.cancel();
}
