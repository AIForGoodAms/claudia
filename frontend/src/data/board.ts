import type { Tile, TileLayout } from '../types';

/**
 * Seed of Yasmin's board, reproducing three real device screens (2026-06-21):
 *   - home page                       → `homeTiles`        (7-column grid)
 *   - the `algemeen` category          → `algemeenChildren` (7-column grid)
 *   - the `vakantie` story sub-page    → `vakantieChildren` (3-column grid)
 *
 * Tiles are placed on a grid by (col, row); empty cells are skipped, giving the
 * device's scattered look. Columns are equal width; row height follows content
 * (long phrases make their row taller). Colors are token names from
 * styles/tokens.css. Labels/text are caregiver/dev text, spoken aloud; she
 * navigates by symbol + audio.
 */

const c = (name: string) => `var(--tile-${name})`;
const g = (col: number, row: number, colSpan?: number, rowSpan?: number): TileLayout => ({
  col,
  row,
  colSpan,
  rowSpan,
});

// ── Sub-sub-page: vakantie (holiday story, image 3) ──────────────────────────
const vakantieChildren: Tile[] = [
  {
    id: 'vak-1', kind: 'utterance', symbolKeyword: 'strand', layout: g(1, 1),
    label: 'Zo, dat was een heerlijk weekje vakantie in Egmond samen met vriendin Danique en begeleidsters Stefanie en Anja. We hadden hetzelfde appartement als vorig jaar',
    utterance: 'Zo, dat was een heerlijk weekje vakantie in Egmond samen met vriendin Danique en begeleidsters Stefanie en Anja. We hadden hetzelfde appartement als vorig jaar',
  },
  {
    id: 'vak-2', kind: 'utterance', symbolKeyword: 'winkelen', layout: g(2, 1),
    label: 'Nadat we onze ouders hadden uitgewuifd, hebben we alles ingericht, een programma gemaakt voor de hele week en boodschappen gedaan. Daarna lekker gaan slapen in 2 bedden naast elkaar met Danique',
    utterance: 'Nadat we onze ouders hadden uitgewuifd, hebben we alles ingericht, een programma gemaakt voor de hele week en boodschappen gedaan. Daarna lekker gaan slapen in 2 bedden naast elkaar met Danique',
  },
  { id: 'vak-back', kind: 'back', label: 'Terug', color: c('blue'), layout: g(3, 1) },
  {
    id: 'vak-3', kind: 'utterance', symbolKeyword: 'ijs', layout: g(1, 2),
    label: 'De eerste 2 dagen in Egmond op terrasjes gezeten, op de boulevard gewandeld en veel ijsjes gegeten. Heerlijk genoten van de koelte in het appartement, waar ik door Anja gemasseerd werd',
    utterance: 'De eerste 2 dagen in Egmond op terrasjes gezeten, op de boulevard gewandeld en veel ijsjes gegeten. Heerlijk genoten van de koelte in het appartement, waar ik door Anja gemasseerd werd',
  },
  {
    id: 'vak-4', kind: 'utterance', symbolKeyword: 'wiel', layout: g(2, 2),
    label: 'Op de warmste dag met de Valies naar Scheveningen om sieraad te bekijken. Dat is niet gelukt, omdat ik een lekke band kreeg en we drie uur moesten wachten op de monteur. We zaten wel lekker in een ijssalon',
    utterance: 'Op de warmste dag met de Valies naar Scheveningen om sieraad te bekijken. Dat is niet gelukt, omdat ik een lekke band kreeg en we drie uur moesten wachten op de monteur. We zaten wel lekker in een ijssalon',
  },
  {
    id: 'vak-5', kind: 'utterance', symbolKeyword: 'reuzenrad', layout: g(3, 2),
    label: 'We hebben wel veel lol gehad bij de reparatie van de lekke band. Dus hebben ze mij op mijn kant gezet en met mijn rolstoel tegengehouden. Net of ik in een kermiswagentje zat. Ik hou daar wel van',
    utterance: 'We hebben wel veel lol gehad bij de reparatie van de lekke band. Dus hebben ze mij op mijn kant gezet en met mijn rolstoel tegengehouden. Net of ik in een kermiswagentje zat. Ik hou daar wel van',
  },
  {
    id: 'vak-6', kind: 'utterance', symbolKeyword: 'onweer', layout: g(1, 3),
    label: 'Woensdag lekker in het dorp uitgebreid geluncht om daarna over de braderie te lopen. Maar helaas brak er toen onweer los en zijn we met slappe lach naar het appartement teruggegaan',
    utterance: 'Woensdag lekker in het dorp uitgebreid geluncht om daarna over de braderie te lopen. Maar helaas brak er toen onweer los en zijn we met slappe lach naar het appartement teruggegaan',
  },
  {
    id: 'vak-7', kind: 'utterance', symbolKeyword: 'foto', layout: g(2, 3),
    label: 'Donderdag op tijd op want de Valies bracht ons naar Volendam. Hartstikke leuke foto in klederdracht gemaakt en stiekem een foto van Kees Tol gemaakt',
    utterance: 'Donderdag op tijd op want de Valies bracht ons naar Volendam. Hartstikke leuke foto in klederdracht gemaakt en stiekem een foto van Kees Tol gemaakt',
  },
  {
    id: 'vak-8', kind: 'utterance', symbolKeyword: 'koffie', layout: g(3, 3),
    label: 'En vrijdag kwamen onze ouders ons alweer ophalen. Nog gezellig met zijn allen koffie gedronken en plannetjes gemaakt voor een volgend bezoek',
    utterance: 'En vrijdag kwamen onze ouders ons alweer ophalen. Nog gezellig met zijn allen koffie gedronken en plannetjes gemaakt voor een volgend bezoek',
  },
];

// ── Sub-page: algemeen (general, image 2) ────────────────────────────────────
const algemeenChildren: Tile[] = [
  { id: 'alg-bedoel-niet', kind: 'utterance', label: 'dat bedoel ik niet.', utterance: 'Dat bedoel ik niet', symbolKeyword: 'fout', layout: g(4, 1) },
  { id: 'alg-back', kind: 'back', label: 'Terug', layout: g(7, 1) },
  { id: 'alg-thuis', kind: 'category', label: 'Thuis', symbolKeyword: 'huis', color: c('green'), layout: g(3, 2) },
  { id: 'alg-leeftijd', kind: 'utterance', label: 'Ik ben nu 37 jaar', glyph: '37', utterance: 'Ik ben nu 37 jaar', layout: g(5, 2) },
  { id: 'alg-dagbesteding', kind: 'category', label: 'dagbesteding', symbolKeyword: 'school', color: c('green'), layout: g(1, 3) },
  { id: 'alg-bus', kind: 'utterance', label: 'bus', symbolKeyword: 'bus', utterance: 'de bus', layout: g(4, 3) },
  { id: 'alg-gezin', kind: 'category', label: 'gezin', symbolKeyword: 'gezin', layout: g(6, 3) },
  { id: 'alg-rooster', kind: 'utterance', label: 'rooster db', symbolKeyword: 'rooster', utterance: 'rooster dagbesteding', layout: g(3, 4) },
  { id: 'vakantie', kind: 'category', label: 'Vakantie', symbolKeyword: 'strand', children: vakantieChildren, layout: g(5, 4) },
  { id: 'alg-bezoek', kind: 'category', label: 'Bezoek', symbolKeyword: 'bezoek', layout: g(7, 4) },
  { id: 'alg-hobbies', kind: 'category', label: 'hobbies', symbolKeyword: 'restaurant', layout: g(1, 5) },
  { id: 'alg-mobiliteit', kind: 'category', label: 'mobiliteit', symbolKeyword: 'rolstoel', layout: g(6, 5) },
  { id: 'alg-communiceren', kind: 'category', label: 'communiceren', symbolKeyword: 'praten', layout: g(3, 6) },
  { id: 'alg-allergie', kind: 'utterance', label: 'allergie', symbolKeyword: 'noten', utterance: 'allergie', layout: g(5, 6) },
  { id: 'alg-naam', kind: 'utterance', label: 'Ik heet Yasmin en niet Yasmiene', symbolKeyword: 'meisje', utterance: 'Ik heet Yasmin en niet Yasmiene', color: c('blue'), layout: g(7, 6) },
];

// ── Home page (image 1, 7-column grid) ───────────────────────────────────────
export const homeTiles: Tile[] = [
  { id: 'algemeen', kind: 'category', label: 'algemeen', symbolKeyword: 'lijst', color: c('white'), children: algemeenChildren, layout: g(1, 1) },
  { id: 'nee', kind: 'utterance', label: 'NEE', glyph: '✕', utterance: 'Nee', color: c('white'), layout: g(2, 1) },
  { id: 'dagbesteding', kind: 'category', label: 'dagbesteding', symbolKeyword: 'school', color: c('salmon'), layout: g(3, 1) },
  { id: 'villa', kind: 'category', label: 'Villa', symbolKeyword: 'huis', color: c('brown'), layout: g(6, 1) },
  { id: 'ja', kind: 'utterance', label: 'JA', symbolKeyword: 'blij', utterance: 'Ja', color: c('teal'), layout: g(7, 1) },

  { id: 'eten', kind: 'category', label: 'eten', symbolKeyword: 'eten', color: c('yellow'), children: etenChildren(), layout: g(2, 2) },
  { id: 'personen', kind: 'category', label: 'personen', symbolKeyword: 'personen', color: c('green'), layout: g(4, 2) },
  { id: 'drinken', kind: 'category', label: 'drinken - snacks', symbolKeyword: 'drinken', color: c('brown'), layout: g(7, 2) },

  { id: 'kleding', kind: 'category', label: 'kleding', symbolKeyword: 'kleding', color: c('brown'), layout: g(1, 3) },
  { id: 'waar-ben-ik', kind: 'utterance', label: 'Waar ben ik', symbolKeyword: 'vraag', utterance: 'Waar ben ik?', color: c('white'), layout: g(2, 3) },
  { id: 'ik-ben-yasmin', kind: 'utterance', label: 'Ik ben Yasmin', symbolKeyword: 'meisje', utterance: 'Ik ben Yasmin', color: c('white'), layout: g(3, 3) },
  { id: 'verzorging', kind: 'category', label: 'verzorging', symbolKeyword: 'verzorgen', color: c('yellow'), layout: g(4, 3) },
  { id: 'spelletje', kind: 'utterance', label: 'Kan ik een spelletje spelen?', symbolKeyword: 'spelen', utterance: 'Kan ik een spelletje spelen?', color: c('darkblue'), layout: g(5, 3) },
  { id: 'tijd', kind: 'category', label: 'tijd', symbolKeyword: 'kalender', color: c('blue'), layout: g(7, 3) },

  { id: 'beurt-wachten', kind: 'utterance', label: 'Ik ben nu aan de beurt. Wil je even wachten?', symbolKeyword: 'wachten', utterance: 'Ik ben nu aan de beurt. Wil je even wachten?', color: c('yellow'), layout: g(2, 4) },
  { id: 'gesprek', kind: 'category', label: 'gesprek', symbolKeyword: 'praten', color: c('white'), layout: g(3, 4) },
  { id: 'lichaam', kind: 'category', label: 'lichaam', symbolKeyword: 'lichaam', color: c('white'), layout: g(4, 4) },
  { id: 'weer', kind: 'category', label: 'weer', symbolKeyword: 'weer', color: c('blue'), layout: g(7, 4) },

  { id: 'activiteiten', kind: 'category', label: 'activiteiten', symbolKeyword: 'fietsen', color: c('salmon'), layout: g(1, 5) },
  { id: 'gevoelens', kind: 'category', label: 'gevoelens', symbolKeyword: 'gevoel', color: c('teal'), children: gevoelensChildren(), layout: g(3, 5) },
  { id: 'communicatie', kind: 'category', label: 'Communicatie', symbolKeyword: 'communicatie', color: c('white'), layout: g(5, 5) },
  { id: 'spel', kind: 'category', label: 'spel', symbolKeyword: 'spel', color: c('teal'), layout: g(7, 5) },

  // The new record entry point (our addition), prominent at the middle-top.
  { id: 'record', kind: 'record', label: 'opname', symbolKeyword: 'microfoon', color: c('white'), layout: g(4, 1) },
  // Cosmetic / system tiles — rendered for fidelity.
  { id: 'sys-rust', kind: 'system', label: 'Oogbesturing rust', symbolKeyword: 'slapen', color: c('brown'), layout: g(2, 6) },
  { id: 'sys-afstellen', kind: 'system', label: 'afstellen oogbediening', color: c('blue'), layout: g(3, 6) },
  { id: 'sys-accu', kind: 'system', label: 'Accu percentage', glyph: '95', color: c('darkblue'), layout: g(4, 6) },
  { id: 'sys-villa-nieuwtjes', kind: 'system', label: 'villa nieuwtjes', symbolKeyword: 'krant', color: c('red'), layout: g(5, 6) },
];

// ── Sub-page: eten (food) — reachable from the home `eten` tile ───────────────
function etenChildren(): Tile[] {
  return [
    { id: 'eten-brood', kind: 'utterance', label: 'brood', symbolKeyword: 'brood', utterance: 'Ik wil brood', color: c('orange'), layout: g(1, 1) },
    { id: 'eten-appel', kind: 'utterance', label: 'appel', symbolKeyword: 'appel', utterance: 'Ik wil een appel', color: c('green'), layout: g(2, 1) },
    { id: 'eten-banaan', kind: 'utterance', label: 'banaan', symbolKeyword: 'banaan', utterance: 'Ik wil een banaan', color: c('yellow'), layout: g(3, 1) },
    { id: 'eten-back', kind: 'back', label: 'Terug', color: c('blue'), layout: g(4, 1) },
    { id: 'eten-koek', kind: 'utterance', label: 'koek', symbolKeyword: 'koek', utterance: 'Ik wil een koekje', color: c('brown'), layout: g(1, 2) },
    { id: 'eten-snack', kind: 'utterance', label: 'snack', symbolKeyword: 'snack', utterance: 'Ik wil een snack', color: c('salmon'), layout: g(2, 2) },
    { id: 'eten-honger', kind: 'utterance', label: 'honger', symbolKeyword: 'eten', utterance: 'Ik heb honger', color: c('red'), layout: g(3, 2) },
  ];
}

// ── Sub-page: gevoelens (feelings) ────────────────────────────────────────────
function gevoelensChildren(): Tile[] {
  return [
    { id: 'gev-blij', kind: 'utterance', label: 'blij', symbolKeyword: 'blij', utterance: 'Ik ben blij', color: c('yellow'), layout: g(1, 1) },
    { id: 'gev-verdrietig', kind: 'utterance', label: 'verdrietig', symbolKeyword: 'verdrietig', utterance: 'Ik ben verdrietig', color: c('blue'), layout: g(2, 1) },
    { id: 'gev-boos', kind: 'utterance', label: 'boos', symbolKeyword: 'boos', utterance: 'Ik ben boos', color: c('red'), layout: g(3, 1) },
    { id: 'gev-back', kind: 'back', label: 'Terug', color: c('blue'), layout: g(4, 1) },
    { id: 'gev-moe', kind: 'utterance', label: 'moe', symbolKeyword: 'moe', utterance: 'Ik ben moe', color: c('darkblue'), layout: g(1, 2) },
    { id: 'gev-bang', kind: 'utterance', label: 'bang', symbolKeyword: 'bang', utterance: 'Ik ben bang', color: c('teal'), layout: g(2, 2) },
  ];
}

/** Find a category tile by id anywhere in the tree (home or nested sub-page). */
export function findCategory(id: string | undefined): Tile | undefined {
  if (!id) return undefined;
  const stack: Tile[] = [...homeTiles];
  while (stack.length) {
    const tile = stack.pop()!;
    if (tile.id === id && tile.kind === 'category') return tile;
    if (tile.children) stack.push(...tile.children);
  }
  return undefined;
}
