import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Tile } from '../types';
import { useSpeech } from '../hooks/useSpeech';
import DwellTile from './DwellTile';
import Symbol from './Symbol';

/**
 * A category tile. If it has a sub-page (children) the dwell drills into it
 * (`/c/:id`); otherwise there is no page to open, so we just speak its label
 * aloud — every dwell either navigates a real category or pronounces a tile.
 */
export default function CategoryTile({ tile }: { tile: Tile }) {
  const navigate = useNavigate();
  const { speak } = useSpeech();
  const [speaking, setSpeaking] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasSubPage = (tile.children?.length ?? 0) > 0;

  const onSelect = () => {
    if (hasSubPage) {
      navigate(`/c/${tile.id}`);
      return;
    }
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
      {tile.symbolKeyword && <Symbol keyword={tile.symbolKeyword} alt={tile.label} />}
    </DwellTile>
  );
}
