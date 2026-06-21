import { useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';
import { speak as speakService, cancelSpeech } from '../services/speech';

/** Thin hook exposing speak() bound to the active language. */
export function useSpeech() {
  const { lang } = useSettings();

  const speak = useCallback((text: string) => speakService(text, lang), [lang]);

  return { speak, cancelSpeech };
}
