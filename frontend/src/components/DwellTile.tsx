import type { CSSProperties, ReactNode } from 'react';
import { useDwell } from '../hooks/useDwell';
import SonarLoader from './SonarLoader';
import './DwellTile.css';

export interface DwellTileProps {
  /** Fires once when the dwell completes (or on click). */
  onSelect: () => void;
  /** Caregiver/dev label + ARIA name. Not the channel of meaning for her. */
  label: string;
  /** Background color: a CSS color or a tokens.css var like 'var(--tile-green)'. */
  color?: string;
  /** Tile contents (symbol, etc.). */
  children?: ReactNode;
  /** Show the small caregiver label under the content (default true). */
  showLabel?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * The shared selectable tile: any content wrapped with dwell-to-select and the
 * sonar loader. Used by category, utterance, record, and suggestion tiles.
 */
export default function DwellTile({
  onSelect,
  label,
  color,
  children,
  showLabel = true,
  disabled,
  className,
  style,
}: DwellTileProps) {
  const { progress, isDwelling, handlers } = useDwell({ onSelect, disabled });

  // Scale the label down for longer text so it always fits without clipping.
  const len = label.length;
  const textClass =
    len > 120 ? 'dwell-tile--text-xs' : len > 40 ? 'dwell-tile--text-sm' : '';

  return (
    <button
      type="button"
      role="button"
      aria-label={label}
      disabled={disabled}
      className={[
        'dwell-tile',
        isDwelling ? 'dwell-tile--dwelling' : '',
        textClass,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ...(color ? { ['--tile-bg' as string]: color } : {}), ...style }}
      {...handlers}
    >
      <SonarLoader progress={progress} />
      <span className="dwell-tile__content">
        {showLabel && <span className="dwell-tile__label">{label}</span>}
        {children}
      </span>
    </button>
  );
}
