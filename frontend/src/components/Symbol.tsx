import { useEffect, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { resolveSymbol } from '../services/arasaac';
import './Symbol.css';

export interface SymbolProps {
  /** ARASAAC lookup keyword (Dutch for nl). */
  keyword: string;
  /** Caregiver/dev alt text only — she navigates by symbol + audio, never alt. */
  alt: string;
  className?: string;
}

/**
 * Renders the ARASAAC pictograph for a keyword, resolved through the
 * services/arasaac fallback chain (cache → bundle → API → emoji). Shows a
 * loading shimmer until resolved; the resolved URL is itself never broken
 * (emoji placeholder is the floor), so there is no separate error box.
 */
export default function Symbol({ keyword, alt, className }: SymbolProps) {
  const { lang } = useSettings();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSrc(null);
    resolveSymbol(keyword, lang).then((url) => {
      if (active) setSrc(url);
    });
    return () => {
      active = false;
    };
  }, [keyword, lang]);

  return (
    <span className={['symbol', className ?? ''].filter(Boolean).join(' ')}>
      {src === null ? (
        <span className="symbol__shimmer" aria-hidden="true" />
      ) : (
        <img className="symbol__img" src={src} alt={alt} draggable={false} />
      )}
    </span>
  );
}
