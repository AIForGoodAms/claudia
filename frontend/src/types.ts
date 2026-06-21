export type Lang = 'nl' | 'en';

export type TileKind = 'category' | 'utterance' | 'record' | 'system' | 'back';

/**
 * Placement on the board grid. Columns are equal width; rows take their height
 * from content. Cells with no tile are simply skipped, which reproduces the
 * device's scattered arrangement without absolute positioning. 1-based.
 */
export interface TileLayout {
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
}

export interface Tile {
  id: string;
  kind: TileKind;
  /** Caregiver/dev label (1–2 words for categories). Never the channel of meaning for her. */
  label: string;
  /** ARASAAC keyword lookup. */
  symbolKeyword?: string;
  /** Color token name from tokens.css (e.g. 'tile-green'). */
  color?: string;
  /** Spoken text for kind === 'utterance'. */
  utterance?: string;
  /** Sub-page tiles for kind === 'category'. */
  children?: Tile[];
  /** Absolute placement on the board (percent of board surface). */
  layout?: TileLayout;
  /** A big plain glyph instead of an ARASAAC symbol (e.g. NEE's ✕, "37"). */
  glyph?: string;
}
