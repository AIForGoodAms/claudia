import { useNavigate } from 'react-router-dom';
import type { Tile } from '../types';
import { useSpeech } from '../hooks/useSpeech';
import DwellTile from './DwellTile';
import Symbol from './Symbol';

/**
 * The new record entry point on the home board. On dwell it announces
 * "Opname gestart" (recording started) and then opens the dedicated /record
 * page — her normal board flow is left untouched (a separate route).
 */
export default function RecordTile({ tile }: { tile: Tile }) {
  const navigate = useNavigate();
  const { speak } = useSpeech();

  const onSelect = () => {
    speak('Opname gestart');
    navigate('/record');
  };

  return (
    <DwellTile
      label={tile.label}
      color={tile.color}
      onSelect={onSelect}
      className="record-tile"
    >
      {tile.symbolKeyword && <Symbol keyword={tile.symbolKeyword} alt={tile.label} />}
    </DwellTile>
  );
}
