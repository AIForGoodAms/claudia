import { useRef, useState } from 'react';
import { mediaUrl } from '../services/config';
import type { OptionDTO } from '../services/transport/types';
import DwellTile from './DwellTile';
import Symbol from './Symbol';
import './SuggestionTile.css';

export interface SuggestionTileProps {
  option: OptionDTO;
  /** Interaction this option belongs to (for `POST /expressive/select`). */
  interactionId: number;
  /** Mark the option chosen + speak it (the recording page owns the round-trip). */
  onSelect: (interactionId: number, optionId: number) => Promise<void> | void;
  /** True when this is the last pronounced tile — keeps a red border highlight. */
  selected?: boolean;
}

/**
 * A streamed suggestion rendered as a dwell-to-speak tile.
 *
 * Each symbol follows the contract's render rule: when `as_text` is true the
 * `label` shows as text (no image); otherwise the backend `image_url` is used
 * (resolved against the backend host), falling back to the ARASAAC chain by
 * keyword when the mock left `image_url` null. On dwell it asks the parent to
 * run the select round-trip and speak the canonical reply.
 */
export default function SuggestionTile({
  option,
  interactionId,
  onSelect,
  selected,
}: SuggestionTileProps) {
  const [speaking, setSpeaking] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSelect = () => {
    setSpeaking(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setSpeaking(false), 900);
    void onSelect(interactionId, option.option_id);
  };

  return (
    <DwellTile
      label={option.text}
      color="var(--tile-white)"
      onSelect={handleSelect}
      className={[
        'suggestion-tile',
        speaking ? 'dwell-tile--speaking' : '',
        selected ? 'suggestion-tile--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="suggestion-tile__symbols">
        {option.symbols.map((s, i) => {
          if (s.as_text) {
            return (
              <span key={`${s.label}-${i}`} className="suggestion-tile__text">
                {s.label}
              </span>
            );
          }
          const url = mediaUrl(s.image_url);
          return url ? (
            <img
              key={`${s.id}-${i}`}
              className="suggestion-tile__img"
              src={url}
              alt={s.label}
              draggable={false}
            />
          ) : (
            <Symbol key={`${s.label}-${i}`} keyword={s.label} alt={s.label} />
          );
        })}
      </span>
    </DwellTile>
  );
}
