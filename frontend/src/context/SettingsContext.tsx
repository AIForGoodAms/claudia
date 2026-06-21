import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '../types';

export interface Settings {
  /** Active language — single source of truth (design-doc §6): TTS voice,
   *  ARASAAC locale, and (future) backend language all read from this. */
  lang: Lang;
  /** Dwell-to-select duration in milliseconds (frontend-setup.md default 2000). */
  dwellMs: number;
}

interface SettingsContextValue extends Settings {
  setLang: (lang: Lang) => void;
  setDwellMs: (ms: number) => void;
}

const DEFAULTS: Settings = { lang: 'nl', dwellMs: 2000 };

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(DEFAULTS.lang);
  const [dwellMs, setDwellMs] = useState<number>(DEFAULTS.dwellMs);

  const value = useMemo<SettingsContextValue>(
    () => ({ lang, dwellMs, setLang, setDwellMs }),
    [lang, dwellMs],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a <SettingsProvider>');
  return ctx;
}
