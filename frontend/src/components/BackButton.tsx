import { useNavigate } from 'react-router-dom';
import type { Tile } from '../types';
import DwellTile from './DwellTile';
import './BackButton.css';

/**
 * "Terug" (back) tile shown on every sub-page (top-right, as on the device).
 * Dwell goes back one level. Rendered as a normal board tile so it shares the
 * dwell + sonar styling and sits in its layout cell.
 */
export default function BackButton({ tile }: { tile?: Tile }) {
  const navigate = useNavigate();
  return (
    <DwellTile
      label={tile?.label ?? 'Terug'}
      color={tile?.color ?? 'var(--tile-white)'}
      onSelect={() => navigate(-1)}
      className="back-button"
    >
      <span className="back-button__arrow" aria-hidden="true">
        ←
      </span>
    </DwellTile>
  );
}
