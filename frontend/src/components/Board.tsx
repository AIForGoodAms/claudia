import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Tile } from '../types';
import CategoryTile from './CategoryTile';
import UtteranceTile from './UtteranceTile';
import RecordTile from './RecordTile';
import BackButton from './BackButton';
import DwellTile from './DwellTile';
import Symbol from './Symbol';
import './Board.css';

function cellStyle(tile: Tile): CSSProperties {
  const l = tile.layout;
  if (!l) return {};
  return {
    gridColumn: `${l.col} / span ${l.colSpan ?? 1}`,
    gridRow: `${l.row} / span ${l.rowSpan ?? 1}`,
  };
}

/** Widest column referenced by any tile — the grid's column count. */
function columnCount(tiles: Tile[]): number {
  return tiles.reduce((max, t) => {
    const l = t.layout;
    if (!l) return max;
    return Math.max(max, l.col + (l.colSpan ?? 1) - 1);
  }, 1);
}

/**
 * The eye-control "rest" tile. Selecting it disconnects eye-gaze tracking — we
 * mark that state with a persistent red border so a caregiver can see at a
 * glance that the sensors are paused. Dwelling again re-connects.
 */
function RustTile({ tile }: { tile: Tile }) {
  const [disconnected, setDisconnected] = useState(false);
  return (
    <DwellTile
      label={tile.label}
      color={tile.color}
      onSelect={() => setDisconnected((d) => !d)}
      className={disconnected ? 'dwell-tile--disconnected' : undefined}
    >
      {tile.symbolKeyword && <Symbol keyword={tile.symbolKeyword} alt={tile.label} />}
    </DwellTile>
  );
}

/** Non-interactive system tile (battery, calibration) — cosmetic fidelity only. */
function SystemTile({ tile }: { tile: Tile }) {
  return (
    <div className="board__system-tile" style={{ background: tile.color }} aria-hidden="true">
      <span className="board__system-label">{tile.label}</span>
      {tile.glyph ? (
        <span className="board__system-glyph">{tile.glyph}</span>
      ) : (
        tile.symbolKeyword && <Symbol keyword={tile.symbolKeyword} alt={tile.label} />
      )}
    </div>
  );
}

function renderTile(tile: Tile) {
  switch (tile.kind) {
    case 'category':
      return <CategoryTile tile={tile} />;
    case 'utterance':
      return <UtteranceTile tile={tile} />;
    case 'record':
      return <RecordTile tile={tile} />;
    case 'back':
      return <BackButton tile={tile} />;
    case 'system':
      return tile.id === 'sys-rust' ? <RustTile tile={tile} /> : <SystemTile tile={tile} />;
    default:
      return null;
  }
}

/**
 * Renders a board of tiles on an equal-column grid. Each tile is placed at its
 * (col, row); empty cells are skipped, reproducing the device's scattered
 * arrangement. Columns are equal width; row height follows content.
 */
export default function Board({ tiles }: { tiles: Tile[] }) {
  const cols = columnCount(tiles);
  return (
    <div className="board" style={{ ['--board-cols' as string]: cols }}>
      {tiles.map((tile) => (
        <div key={tile.id} className="board__cell" style={cellStyle(tile)}>
          {renderTile(tile)}
        </div>
      ))}
    </div>
  );
}
