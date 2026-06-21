import { useRef, useState } from 'react';
import type { Tile } from '../types';
import { useSpeech } from '../hooks/useSpeech';
import DwellTile from './DwellTile';
import Symbol from './Symbol';

/** An utterance tile: dwell speaks `utterance` aloud with a brief highlight. */
export default function UtteranceTile({ tile }: { tile: Tile }) {
  const { speak } = useSpeech();
  const [speaking, setSpeaking] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSelect = () => {
    speak(tile.utterance ?? tile.label);
    setSpeaking(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setSpeaking(false), 900);
  };

  return (
    <DwellTile
      label={tile.label}
      color={tile.color}
      onSelect={onSelect}
      className={speaking ? 'dwell-tile--speaking' : undefined}
    >
      {tile.glyph ? (
        <span className="dwell-tile__glyph">{tile.glyph}</span>
      ) : (
        tile.symbolKeyword && <Symbol keyword={tile.symbolKeyword} alt={tile.label} />
      )}
    </DwellTile>
  );
}
